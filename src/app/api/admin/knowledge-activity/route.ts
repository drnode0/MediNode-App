// ナレッジ投稿ペース（/admin 今日の管理）。管理者専用・best-effort。
//
//   GET /api/admin/knowledge-activity?weeks=12
//     … サブスク公開の Medical / Reference 2 DB を Notion 直クエリし、
//       created_time / last_edited_time を JST 日次で集計して週グリッド・サマリーに、
//       created_time の全件を累積推移（ナレッジ総数・参考文献総数・現場の疑問由来）に返す。
//
// env 未設定なら { ready:false }（UIは静かな未設定表示）。

import { NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { requireAdmin } from '@/lib/admin-guard'
import {
  aggregateDaily,
  computeSummary,
  buildWeekGrid,
  isReaderOrigin,
} from '@/lib/knowledge-activity'

export const dynamic = 'force-dynamic'

const ALLOWED_WEEKS = new Set([12, 26, 52])

type Row = { createdAt: string; lastEdited: string; origin: string }

// 由来プロパティ（select / multi_select / rich_text / title を想定）から文字列を取り出す。
function readOrigin(props: Record<string, Record<string, unknown>> | undefined): string {
  const p = props?.['由来']
  if (!p) return ''
  const type = p.type as string
  if (type === 'select') return (p.select as { name: string } | null)?.name || ''
  if (type === 'multi_select')
    return ((p.multi_select as Array<{ name: string }>) || []).map((x) => x.name).join(',')
  if (type === 'rich_text')
    return ((p.rich_text as Array<{ plain_text: string }>) || []).map((x) => x.plain_text).join('')
  if (type === 'title')
    return ((p.title as Array<{ plain_text: string }>) || []).map((x) => x.plain_text).join('')
  return ''
}

// 指定 DB の全ページを取得し { createdAt, lastEdited, origin } を集める。
// 累積推移は全期間が必要なので since 打ち切りはしない（admin限定・低頻度なので全件走査で可）。
async function fetchAllRows(notion: Client, dbId: string, withOrigin: boolean): Promise<Row[]> {
  const out: Row[] = []
  let cursor: string | undefined = undefined
  do {
    const res = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
    })
    for (const page of res.results) {
      if (page.object !== 'page') continue
      const p = page as Record<string, unknown>
      out.push({
        createdAt: (p.created_time as string) || '',
        lastEdited: (p.last_edited_time as string) || '',
        origin: withOrigin ? readOrigin(p.properties as Record<string, Record<string, unknown>>) : '',
      })
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)
  return out
}

export async function GET(req: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.response

  const weeksParam = Number(new URL(req.url).searchParams.get('weeks'))
  const weeks = ALLOWED_WEEKS.has(weeksParam) ? weeksParam : 12

  const token = process.env.SUBSCRIPTION_NOTION_TOKEN
  const medicalDbId = process.env.SUBSCRIPTION_MEDICAL_DB_ID
  const referenceDbId = process.env.SUBSCRIPTION_REFERENCE_DB_ID
  if (!token || !medicalDbId) {
    return NextResponse.json({ ready: false })
  }

  try {
    const notion = new Client({ auth: token })
    const nowMs = Date.now()

    const medical = await fetchAllRows(notion, medicalDbId, true)
    const reference = referenceDbId ? await fetchAllRows(notion, referenceDbId, false) : []

    // ヒートマップ・サマリー（Row は {createdAt,lastEdited} を持つので PageTiming として渡せる）
    const daily = aggregateDaily(medical, reference)
    const grid = buildWeekGrid(daily, nowMs, weeks)
    const summary = computeSummary(daily, nowMs)

    // 累積推移用（全期間の作成日）と合計数
    const readerRows = medical.filter((r) => isReaderOrigin(r.origin))
    const cumulative = {
      medicalCreated: medical.map((r) => r.createdAt).filter(Boolean),
      referenceCreated: reference.map((r) => r.createdAt).filter(Boolean),
      readerCreated: readerRows.map((r) => r.createdAt).filter(Boolean),
    }
    const totals = {
      medical: medical.length,
      reference: reference.length,
      readerOrigin: readerRows.length,
    }

    return NextResponse.json({
      ready: true,
      weeks,
      columns: grid.columns,
      todayKey: grid.todayKey,
      summary,
      cumulative,
      totals,
    })
  } catch {
    return NextResponse.json({ ready: false })
  }
}
