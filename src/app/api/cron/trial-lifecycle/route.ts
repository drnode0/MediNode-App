import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { readPushStage, pushEnabledFor } from '@/lib/push'
import { sendToUsers } from '@/lib/push-send'
import {
  classifyTrialLifecycle,
  shouldNotify,
  isAdminEmail,
  NOTIFIED_META_KEY,
  ENDING_SOON_WINDOW_MS,
  ENDED_GRACE_MS,
  TRIAL_PLANS,
  type TrialLifecycleStage,
} from '@/lib/trial-lifecycle'
import {
  endingSoonPushPayload,
  endedPushPayload,
  trialEndedEmailHtml,
  trialEndedEmailSubject,
} from '@/lib/trial-end-content'

/**
 * Vercel Cron 専用：体験（トライアル）終了のお知らせ配信。
 *
 * 対象は "カードなしトライアル"（trial_ends_at がサーバー期限で stripe_customer_id が無い＝
 * auto_trial / noteコード / 紹介コード）。Stripe カードトライアルは Stripe 側で扱うため触らない。
 *
 * 2種類の配信（trial-lifecycle.ts の純判定を使う）:
 *   - ending_soon（前日）… push のみ（ヘッズアップ）
 *   - ended（終了時）    … push ＋ メール（Resend）
 * アプリ内の終了画面は別途クライアント側で出す（この cron はサーバー配信のみ）。
 *
 * 重複防止: user_metadata に「どの期限値に対して通知したか」を残す（DBマイグレーション不要）。
 * 延長で trial_ends_at が動けば値が変わり、新しい期限に対してもう一度だけ通知できる。
 * フラグは "実際に届いたときだけ" 立てる（未設定環境で無言に握りつぶさないため）。
 *
 * 認証: /api/cron/daily-push と同じ（Authorization: Bearer ${CRON_SECRET} を定数時間比較）。
 */
function isCronAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return false
  const a = Buffer.from(authHeader)
  const b = Buffer.from(`Bearer ${expected}`)
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

const iso = (ms: number) => new Date(ms).toISOString()

// 終了メール送信（Resend REST・SDK非依存。welcome と同じ流儀）。未設定なら送らず false。
async function sendEndedEmail(to: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM
  if (!apiKey || !from) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: trialEndedEmailSubject(),
        html: trialEndedEmailHtml(),
      }),
    })
    if (!res.ok) {
      console.error('trial-lifecycle: Resend送信失敗', res.status, (await res.text()).slice(0, 200))
      return false
    }
    return true
  } catch (err) {
    console.error('trial-lifecycle: Resend送信エラー', err instanceof Error ? err.message : err)
    return false
  }
}

type SubRow = {
  user_id: string
  trial_ends_at: string | null
  stripe_customer_id: string | null
  plan: string | null
}

export async function GET(req: NextRequest) {
  try {
    if (!isCronAuthorized(req)) {
      return NextResponse.json(
        { error: 'Unauthorized: Vercel Cron からの呼び出しのみ許可されています' },
        { status: 401 },
      )
    }
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ ok: false, reason: 'supabase_not_configured' })
    }

    const admin = createAdminClient()
    const now = Date.now()
    const stage = await readPushStage()

    // カードなしトライアルのうち、いずれかの窓に入りうる行だけを引く（範囲で絞る）。
    const { data, error } = await admin
      .from('subscriptions')
      .select('user_id, trial_ends_at, stripe_customer_id, plan')
      .is('stripe_customer_id', null)
      .in('plan', [...TRIAL_PLANS]) // カードなしトライアル（trial/auto_trial）のみ。comp/premiumは除外
      .not('trial_ends_at', 'is', null)
      .gte('trial_ends_at', iso(now - ENDED_GRACE_MS))
      .lte('trial_ends_at', iso(now + ENDING_SOON_WINDOW_MS))
      .limit(1000)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as SubRow[]

    let endingSoon = 0
    let ended = 0
    let pushed = 0
    let mailed = 0

    for (const row of rows) {
      const stageForRow = classifyTrialLifecycle(row, { now })
      if (stageForRow === 'none' || !row.trial_ends_at) continue

      // 認証レコード（メール＋user_metadata＝重複フラグ）。取得失敗はスキップ（誤送信防止優先）。
      const { data: u, error: userErr } = await admin.auth.admin.getUserById(row.user_id)
      if (userErr || !u?.user) continue
      const user = u.user
      // 管理者（COMP_ADMIN_EMAILS）は override でプレミアム＝トライアル失効でアクセスを
      // 失わないので通知しない（オーナー/モニターへの誤送信を防ぐ）。
      if (isAdminEmail(user.email, process.env.COMP_ADMIN_EMAILS)) continue
      const meta = (user.user_metadata ?? {}) as Record<string, string | undefined>

      if (!shouldNotify(stageForRow, row.trial_ends_at, meta)) continue

      // 配信（push は stage で自己ゲート。ending_soon=push のみ、ended=push＋メール）。
      let delivered = false
      const pushAllowed = pushEnabledFor(stage, user.email)
      if (pushAllowed) {
        const payload = stageForRow === 'ending_soon' ? endingSoonPushPayload() : endedPushPayload()
        const res = await sendToUsers(admin, [row.user_id], 'announce', payload)
        if (res.sent > 0) {
          delivered = true
          pushed += res.sent
        }
      }
      if (stageForRow === 'ended' && user.email) {
        const ok = await sendEndedEmail(user.email)
        if (ok) {
          delivered = true
          mailed += 1
        }
      }

      // 実際に1通でも届いたときだけ重複フラグを立てる。
      if (delivered) {
        const key = NOTIFIED_META_KEY[stageForRow as Exclude<TrialLifecycleStage, 'none'>]
        const { error: flagErr } = await admin.auth.admin.updateUserById(row.user_id, {
          user_metadata: { ...meta, [key]: row.trial_ends_at },
        })
        if (flagErr) console.error('trial-lifecycle: フラグ更新失敗', flagErr.message)
        if (stageForRow === 'ending_soon') endingSoon += 1
        else ended += 1
      }
    }

    return NextResponse.json({
      ok: true,
      stage,
      scanned: rows.length,
      endingSoon,
      ended,
      pushed,
      mailed,
    })
  } catch (err) {
    console.error('Cron trial-lifecycle error:', err)
    const message = err instanceof Error ? err.message : '不明なエラーが発生しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
