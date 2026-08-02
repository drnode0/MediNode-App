// かんたん接続後のDB選択用。トークンがアクセスできるデータベースの一覧を返す。
// （OAuthのページピッカーで選ばれた範囲だけが見える）
import { NextRequest, NextResponse } from 'next/server'
import { requireSessionOrSetupRateLimit } from '@/lib/api-guard'
import { Client } from '@notionhq/client'

export async function POST(req: NextRequest) {
  const denied = await requireSessionOrSetupRateLimit(req, 'list-databases', 20, 10 * 60_000)
  if (denied) return denied

  try {
    const { notionToken } = await req.json()
    if (!notionToken) {
      return NextResponse.json({ error: 'notionToken が必要です' }, { status: 400 })
    }
    const notion = new Client({ auth: notionToken })
    const res = await notion.search({
      filter: { property: 'object', value: 'database' },
      page_size: 100,
    })
    const databases = res.results
      .filter((r) => (r as { object?: string }).object === 'database')
      .map((r) => {
        const d = r as { id: string; title?: Array<{ plain_text?: string }> }
        const title = (d.title || []).map((t) => t.plain_text || '').join('').trim()
        return { id: d.id, title: title || '（無題のデータベース）' }
      })
    return NextResponse.json({ databases })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
