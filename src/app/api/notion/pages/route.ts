import { NextRequest, NextResponse } from 'next/server'
import { requireSessionIfLoginRequired } from '@/lib/api-guard'
import { Client } from '@notionhq/client'

export async function POST(req: NextRequest) {
  // REQUIRE_LOGIN 有効時はセッション必須（S-3: middlewareに依存しない二重ゲート。
  // 未ログインで叩ける「任意トークンの代理リクエスト」＝オープンプロキシ化を防ぐ）。
  const denied = await requireSessionIfLoginRequired()
  if (denied) return denied

  try {
    const { notionToken } = await req.json()

    if (!notionToken) {
      return NextResponse.json({ error: 'notionToken is required' }, { status: 400 })
    }

    const notion = new Client({ auth: notionToken })

    // Tokenが有効かチェックしつつ、ワークスペース内のページ一覧を取得
    const pages: { id: string; title: string }[] = []
    let cursor: string | undefined = undefined

    do {
      const res = await notion.search({
        filter: { property: 'object', value: 'page' },
        sort: { direction: 'descending', timestamp: 'last_edited_time' },
        page_size: 50,
        start_cursor: cursor,
      })

      for (const result of res.results) {
        if (result.object !== 'page') continue
        const page = result as Record<string, unknown>
        const props = page.properties as Record<string, Record<string, unknown>>

        // タイトルを取得（title型プロパティから）
        let title = ''
        for (const prop of Object.values(props)) {
          if (prop.type === 'title') {
            const titleArr = prop.title as Array<{ plain_text: string }>
            title = (titleArr || []).map((t) => t.plain_text).join('').trim()
            break
          }
        }

        // タイトルが空のページは除外
        if (!title) continue

        pages.push({ id: page.id as string, title })
      }

      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
      // 最大100件で打ち切り
      if (pages.length >= 100) break
    } while (cursor)

    return NextResponse.json({ pages })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラーが発生しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
