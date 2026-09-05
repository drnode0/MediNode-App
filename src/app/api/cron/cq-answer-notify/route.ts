import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { Client } from '@notionhq/client'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/trial-lifecycle'
import { APP_URL } from '@/lib/trial-end-content'
import {
  answeredNotifications,
  filterUnnotified,
  markNotified,
  answerNoticeEmail,
  type AnswerNotification,
} from '@/lib/cq-answer-notify'
import { resolveAnswerTarget, answerLandingUrl } from '@/lib/ask-shelf/landing'
import { sendToUsers } from '@/lib/push-send'
import type { NotionIntakePage } from '@/lib/cq-board'

/**
 * Vercel Cron 専用：投稿した臨床疑問に答えが出たときのメール通知。
 *
 * 受付DBで対応状態が「対応済み」になった行のうち、通知に同意した投稿
 * （通知先ユーザーIDあり）の投稿者へ、Resend でお知らせを1通送る。
 * アプリ内の「答えが出ました」表示（cq-mine の stageOf）はアプリを開いた人にしか
 * 見えないため、開かなくなった人にはこの cron が唯一の通知経路になる。
 *
 * 重複防止: trial-lifecycle と同じく user_metadata に記録する
 * （cq_answer_notified = { ページID: 通知日時 }。ページ単位なので同じ回答を二度送らない）。
 * フラグは実際に送れたときだけ立てる。
 *
 * 認証: /api/cron/trial-lifecycle と同じ（Authorization: Bearer ${CRON_SECRET} を定数時間比較）。
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

// 受付DBから対応済みの行を引く。列が無い受付DB（旧スキーマ）ではフィルタが
// 弾かれるので、その時だけ直近を引いてこちら側で絞る（cq/mine と同じ構え）。
const QUERY_LIMIT = 100
async function queryAnsweredPages(token: string, dbId: string): Promise<NotionIntakePage[]> {
  const notion = new Client({ auth: token })
  try {
    const res = await notion.databases.query({
      database_id: dbId,
      filter: { property: '対応状態', select: { equals: '対応済み' } },
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      page_size: QUERY_LIMIT,
    })
    return res.results as unknown as NotionIntakePage[]
  } catch {
    const res = await notion.databases.query({
      database_id: dbId,
      sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      page_size: QUERY_LIMIT,
    })
    return res.results as unknown as NotionIntakePage[]
  }
}

// recall_claims から飛び先解決に要る3列だけを1回で読む（依頼ごとにクエリしない）。
// active=false の主張は着地先として使わない（取り下げた主張を出題母集団に戻さないのと
// 同じ理由。search/route.ts の絞り込みと揃える）。
async function buildClaimsById(
  admin: SupabaseClient,
): Promise<Map<string, { pageId: string; sectionKey: string }>> {
  const claimsById = new Map<string, { pageId: string; sectionKey: string }>()
  const { data, error } = await admin
    .from('recall_claims')
    .select('claim_id, page_id, section_key, active')
    .eq('active', true)
  if (error) {
    console.error('cq-answer-notify: recall_claims の読み取り失敗', error.message)
    return claimsById
  }
  for (const r of data ?? []) {
    claimsById.set(String(r.claim_id), { pageId: String(r.page_id), sectionKey: String(r.section_key ?? '') })
  }
  return claimsById
}

// Resend で1通送る（trial-lifecycle の sendEndedEmail と同じ流儀）。未設定なら送らず false。
async function sendNoticeEmail(to: string, questions: string[], url: string): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM
  if (!apiKey || !from) {
    console.error('cq-answer-notify: RESEND の設定が無いため送らない', {
      apiKey: Boolean(apiKey),
      from: Boolean(from),
    })
    return false
  }
  const { subject, text } = answerNoticeEmail(questions, url)
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text }),
    })
    if (!res.ok) {
      console.error('cq-answer-notify: Resend送信失敗', res.status, (await res.text()).slice(0, 200))
      return false
    }
    return true
  } catch (err) {
    console.error('cq-answer-notify: Resend送信エラー', err instanceof Error ? err.message : err)
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
    const token = process.env.CQ_INTAKE_NOTION_TOKEN || ''
    const dbId = process.env.CQ_INTAKE_DB_ID || ''
    if (!token || !dbId) return NextResponse.json({ ok: false, reason: 'notion_not_configured' })
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({ ok: false, reason: 'supabase_not_configured' })
    }

    const pages = await queryAnsweredPages(token, dbId)
    const candidates = answeredNotifications(pages)

    // 1人に複数の回答があっても1通にまとめる。
    const byUser = new Map<string, AnswerNotification[]>()
    for (const c of candidates) {
      const list = byUser.get(c.userId) ?? []
      list.push(c)
      byUser.set(c.userId, list)
    }

    const admin = createAdminClient()
    // 依頼ごとに問い合わせず、1回だけ読んで使い回す。
    const claimsById = await buildClaimsById(admin)
    let mailed = 0
    let skipped = 0
    let alreadyNotified = 0
    let sendFailed = 0
    let pushed = 0
    for (const [userId, items] of byUser) {
      // 認証レコード（メール＋user_metadata＝重複記録）。取得失敗はスキップ（誤送信防止優先）。
      const { data: u, error: userErr } = await admin.auth.admin.getUserById(userId)
      if (userErr || !u?.user?.email) {
        skipped++
        continue
      }
      const user = u.user
      // 管理者（オーナー自身のテスト投稿など）には送らない。
      if (isAdminEmail(user.email, process.env.COMP_ADMIN_EMAILS)) {
        skipped++
        continue
      }
      const meta = (user.user_metadata ?? {}) as Record<string, unknown>
      const fresh = filterUnnotified(items, meta)
      if (fresh.length === 0) {
        // 送らなかった理由を数字と別に残す。mailed が 0 のとき、
        // 「もう送ってある」のか「送れなかった」のかを後から見分けるため。
        alreadyNotified++
        continue
      }

      // 飛び先URL: 1件なら主張／記事の着地画面、複数件をまとめる本文は箇条書きに
      // URLを差し込む場所が無いので汎用のアプリURLに留める（メール本文レイアウトの
      // 作り直しはこのタスクの範囲外。都度URLを求める配線だけを足す）。
      const url =
        fresh.length === 1
          ? answerLandingUrl(
              fresh[0].pageId,
              resolveAnswerTarget({ canonicalClaimIds: fresh[0].canonicalClaimIds, claimsById }),
            )
          : APP_URL

      const ok = await sendNoticeEmail(user.email!, fresh.map((f) => f.question), url)
      if (!ok) {
        sendFailed++
        continue
      }

      mailed++
      const { error: flagErr } = await admin.auth.admin.updateUserById(userId, {
        user_metadata: markNotified(meta, fresh.map((f) => f.pageId), new Date().toISOString()),
      })
      if (flagErr) console.error('cq-answer-notify: 記録更新失敗', flagErr.message)

      // プッシュはメールと同じ分岐（送信成功後）で送る。失敗してもメールの成否・
      // 記録更新には影響させない（重複防止は同じ user_metadata.cq_answer_notified が担う）。
      try {
        const { sent } = await sendToUsers(admin, [userId], 'resolved_cq', {
          title: 'MediNode',
          body: '投稿された臨床疑問に回答がつきました',
          url,
        })
        pushed += sent
      } catch (err) {
        console.error('cq-answer-notify: プッシュ送信エラー', err instanceof Error ? err.message : err)
      }
    }

    // 応答の JSON は呼び出し元にしか見えないので、件数はログにも残す。
    // Vercel Cron の自動実行は応答を誰も読まないため、これが唯一の記録になる。
    const summary = {
      scanned: pages.length,
      answered: candidates.length,
      users: byUser.size,
      mailed,
      skipped,
      alreadyNotified,
      sendFailed,
      pushed,
    }
    console.log('cq-answer-notify: 完了', JSON.stringify(summary))

    return NextResponse.json({
      ok: true,
      ...summary,
    })
  } catch (err) {
    console.error('Cron cq-answer-notify error:', err)
    const message = err instanceof Error ? err.message : '不明なエラーが発生しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
