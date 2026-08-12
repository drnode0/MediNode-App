// 体験終了アンケートの締め画面「増えたら知らせて」チェック → 既存回答ページの
// 「拡充通知希望」checkboxを立てる追いPOST。
//
// 書けるページは /api/feedback/submit が直近60分内に発行した署名つきIDだけ
// （検証は feedback-optin.ts）。ログイン不要（アンケート本体と同じ方針）。
// checkbox列が受付DBに無い場合はNotionがエラーを返す → 一般文言の500
// （利用者に対処のしようがないのは submit と同じ扱い）。

import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { rateLimitAsync, clientIp } from '@/lib/rate-limit'
import { verifyOptinToken } from '@/lib/feedback-optin'

export const dynamic = 'force-dynamic'

// Notion pages.update に渡す前の形式ガード（ハイフン有無の両形式を許す）。
const PAGE_ID_RE = /^[0-9a-f-]{32,36}$/i

export async function POST(req: NextRequest) {
  const token = process.env.FEEDBACK_NOTION_TOKEN || ''
  if (!token) {
    return NextResponse.json({ error: '現在準備中です。', code: 'not_configured' }, { status: 503 })
  }

  const DAY_MS = 24 * 60 * 60_000
  if (!(await rateLimitAsync(`feedback-optin-ip:${clientIp(req)}`, 10, DAY_MS))) {
    return NextResponse.json({ error: '本日の上限に達しました。' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'リクエストの形式が不正です。' }, { status: 400 })
  }
  const raw = (body ?? {}) as Record<string, unknown>
  const pageId = typeof raw.pageId === 'string' ? raw.pageId : ''
  const ts = typeof raw.ts === 'number' ? raw.ts : NaN
  const sig = typeof raw.sig === 'string' ? raw.sig : ''

  if (!PAGE_ID_RE.test(pageId) || !verifyOptinToken({ pageId, ts, sig }, token, Date.now())) {
    return NextResponse.json({ error: '受け付けられませんでした。' }, { status: 403 })
  }

  try {
    const notion = new Client({ auth: token })
    await notion.pages.update({
      page_id: pageId,
      properties: { 拡充通知希望: { checkbox: true } },
    })
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json(
      { error: '受け付けられませんでした。時間をおいてお試しください。' },
      { status: 500 },
    )
  }
}
