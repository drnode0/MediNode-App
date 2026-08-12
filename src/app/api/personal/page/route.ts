// 個人・部署ページの本文取得（降格式リーダー用）。
//
//   POST /api/personal/page … body { id, notionToken?, teamNotionToken?, additionalTeams? }
//     … id は `${owner}_${pageId}`（owner: personal | team）。
//       ユーザー自身のNotionトークン（/api/sync・/api/notion/search と同じく
//       クライアントから都度渡す方式）で本文を取得し、ReaderDoc を返す。
//
// サブスク版（/api/subscription/page）との違い:
// - トークンはサーバー環境変数でなくリクエスト本人のもの → 共有キャッシュはしない
//   （クライアント側 reader-prefetch の10分キャッシュが再訪を受ける）
// - 画像プロキシは個人版（/api/personal/image・セッション本人のトークンで解決）
// - doc.sourceUrl にページのNotion URLを載せる（「Notionで開く」逃げ道・
//   未対応ブロックのプレースホルダのリンク先。サブスクは本文防衛のため載せない）

import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { requireSessionIfLoginRequired } from '@/lib/api-guard'
import { fetchPageBlocks } from '@/lib/notion-page'
import { mapBlocksToReaderDoc } from '@/lib/reader-doc'

export const maxDuration = 60

function tokenList(v: unknown): string[] {
  return typeof v === 'string' && v.trim() ? [v.trim()] : []
}

export async function POST(req: NextRequest) {
  const denied = await requireSessionIfLoginRequired()
  if (denied) return denied

  try {
    const body = (await req.json()) as {
      id?: unknown
      notionToken?: unknown
      teamNotionToken?: unknown
      additionalTeams?: unknown
    }
    const raw = typeof body.id === 'string' ? body.id.trim() : ''
    const m = raw.match(/^(personal|team)_([0-9a-f-]{32,36})$/i)
    if (!m) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
    const owner = m[1] as 'personal' | 'team'
    const pageId = m[2]

    // owner に応じて試すトークンを決める。部署は追加部署（マルチ部署検索）の分も
    // 順に試す — objectID からはどの部署かが分からないため、開けたトークンが正解。
    const tokens =
      owner === 'personal'
        ? tokenList(body.notionToken)
        : [
            ...tokenList(body.teamNotionToken),
            ...(Array.isArray(body.additionalTeams)
              ? body.additionalTeams.flatMap((t) => tokenList((t as { notionToken?: unknown })?.notionToken))
              : []),
          ]
    if (tokens.length === 0) return NextResponse.json({ error: 'missing token' }, { status: 400 })

    for (const token of tokens) {
      const notion = new Client({ auth: token })
      let page: Awaited<ReturnType<typeof notion.pages.retrieve>>
      try {
        page = await notion.pages.retrieve({ page_id: pageId })
      } catch {
        continue // このトークンでは読めない（別部署のページ等）。次を試す。
      }
      const blocks = await fetchPageBlocks(notion, pageId)
      const doc = mapBlocksToReaderDoc(
        page as Parameters<typeof mapBlocksToReaderDoc>[0],
        blocks,
        pageId,
        { imageProxyBase: '/api/personal/image' },
      )
      doc.sourceUrl = (page as { url?: string }).url ?? null
      // 自分のDBの本文は編集され得るので、ブラウザ側キャッシュは短め。
      // POST 応答は共有キャッシュに載らないが、意図を明示して private を付ける。
      return NextResponse.json({ doc }, { headers: { 'Cache-Control': 'private, max-age=300' } })
    }
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  } catch {
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 })
  }
}
