import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/lib/supabase/server'
import { readPushStage, jstSlot, jstToday, isPreviewEmail } from '@/lib/push'
import { getUserPrefs } from '@/lib/push-prefs'
import { sendToUsers } from '@/lib/push-send'

/**
 * Vercel Cron 専用：「今日の1問」デイリー通知。
 *
 * vercel.json の crons 設定（30分毎）から呼ばれる。現在のJSTスロットに設定した
 * ユーザーのうち、当日まだ送っていない人へ送る。stage=off の間は即returnするので、
 * 30分毎cron（Vercel Pro前提）を有効化する前でもエンドポイントは無害。
 *
 * 認証:
 *   /api/cron/subscription-sync と同じ仕組みを流用。Vercel Cron はリクエストに
 *   `Authorization: Bearer ${CRON_SECRET}` を自動付与する。CRON_SECRET 環境変数
 *   と一致しない場合は 401（定数時間比較でタイミング攻撃対策）。
 */
function isCronAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false // 未設定なら一切実行させない
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

export async function GET(req: NextRequest) {
  try {
    if (!isCronAuthorized(req)) {
      return NextResponse.json(
        { error: 'Unauthorized: Vercel Cron からの呼び出しのみ許可されています' },
        { status: 401 },
      )
    }

    const stage = await readPushStage()
    if (stage === 'off') return NextResponse.json({ ok: true, skipped: 'off' })

    const admin = createAdminClient()
    const slot = jstSlot()
    const today = jstToday()

    // 有効な購読を持つユーザー一覧（重複除去）。読取失敗を「対象なし」に化けさせない。
    const { data: subs, error: subsError } = await admin
      .from('push_subscriptions')
      .select('user_id')
      .is('revoked_at', null)
    if (subsError) throw new Error(subsError.message)
    const userIds = [...new Set((subs ?? []).map((s: { user_id: string }) => s.user_id))]

    // このスロットに設定していて、今日まだ送っていないユーザーに絞る。
    const targets: string[] = []
    for (const uid of userIds) {
      const prefs = await getUserPrefs(admin, uid)
      if (prefs.slot !== slot) continue

      // preview中はオーナー/許可メールのみ（emailはauth.usersから引く）。読取失敗は握りつぶさない。
      if (stage === 'preview') {
        const { data: u, error: userError } = await admin.auth.admin.getUserById(uid)
        if (userError) throw new Error(userError.message)
        if (!isPreviewEmail(u.user?.email)) continue
      }

      // 当日送信済みチェック。読取失敗時は「既送信」扱いでスキップ（重複送信防止を優先）。
      const { data: log, error: logError } = await admin
        .from('daily_push_log')
        .select('user_id')
        .eq('user_id', uid)
        .eq('sent_on', today)
        .maybeSingle()
      if (logError) {
        console.error('daily-push: daily_push_log 確認に失敗', logError.message)
        continue // fail closed: dedupe read エラーでユーザーをスキップ
      }
      if (log) continue

      targets.push(uid)
    }

    const payload = { title: '今日の1問', body: '今日の1問が届いています。', url: '/', tag: 'daily-question' }
    const res = await sendToUsers(admin, targets, 'daily', payload)

    // 送信記録（当日二重送信防止）。ベストエフォート：失敗しても次回runが再送するだけなので
    // ここでは throw せずログのみに留める（レスポンス自体は成功として返す）。
    if (targets.length > 0) {
      const { error: logWriteError } = await admin
        .from('daily_push_log')
        .upsert(
          targets.map((uid) => ({ user_id: uid, sent_on: today })),
          { onConflict: 'user_id,sent_on', ignoreDuplicates: true },
        )
      if (logWriteError) {
        console.error('daily-push: daily_push_log 記録に失敗', logWriteError.message)
      }
    }

    return NextResponse.json({ ok: true, slot, ...res, targets: targets.length })
  } catch (err) {
    console.error('Cron daily-push error:', err)
    const message = err instanceof Error ? err.message : '不明なエラーが発生しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
