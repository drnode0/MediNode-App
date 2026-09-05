import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { Client } from '@notionhq/client'
import { createAdminClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/trial-lifecycle'
import {
  answeredNotifications,
  filterUnnotified,
  markNotified,
  answerNoticeEmail,
  type AnswerNotification,
} from '@/lib/cq-answer-notify'
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

// Resend で1通送る（trial-lifecycle の sendEndedEmail と同じ流儀）。未設定なら送らず false。
async function sendNoticeEmail(to: string, questions: string[]): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM
  if (!apiKey || !from) return false
  const { subject, text } = answerNoticeEmail(questions)
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
    let mailed = 0
    let skipped = 0
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
      if (fresh.length === 0) continue

      const ok = await sendNoticeEmail(user.email!, fresh.map((f) => f.question))
      if (!ok) continue

      mailed++
      const { error: flagErr } = await admin.auth.admin.updateUserById(userId, {
        user_metadata: markNotified(meta, fresh.map((f) => f.pageId), new Date().toISOString()),
      })
      if (flagErr) console.error('cq-answer-notify: 記録更新失敗', flagErr.message)
    }

    return NextResponse.json({
      ok: true,
      scanned: pages.length,
      answered: candidates.length,
      users: byUser.size,
      mailed,
      skipped,
    })
  } catch (err) {
    console.error('Cron cq-answer-notify error:', err)
    const message = err instanceof Error ? err.message : '不明なエラーが発生しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
