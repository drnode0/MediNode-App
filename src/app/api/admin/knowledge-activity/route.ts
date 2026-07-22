// ナレッジ投稿ペース（/admin 今日の管理）。管理者専用・best-effort。
//
//   GET /api/admin/knowledge-activity?weeks=12
//     … サブスク公開の Medical / Reference 2 DB を Notion 直クエリし、
//       created_time / last_edited_time を JST 日次で集計して週グリッドとサマリーを返す。
//
// env 未設定なら { ready:false }（UIは静かな未設定表示）。

import { NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { requireAdmin } from '@/lib/admin-guard'
import {
  aggregateDaily,
  computeSummary,
  buildWeekGrid,
  type PageTiming,
} from '@/lib/knowledge-activity'

export const dynamic = 'force-dynamic'

const ALLOWED_WEEKS = new Set([12, 26, 52])

// 指定 DB を last_edited_time 降順でページングし、since より古くなったら打ち切って
// { createdAt, lastEdited } を集める。since は ISO 文字列（この時刻以降の更新だけ拾う）。
async function fetchTimings(notion: Client, dbId: string, sinceIso: string): Promise<PageTiming[]> {
  const out: PageTiming[] = []
  let cursor: string | undefined = undefined
  do {
    const res = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
    })
    let reachedOld = false
    for (const page of res.results) {
      if (page.object !== 'page') continue
      const p = page as Record<string, unknown>
      const lastEdited = (p.last_edited_time as string) || ''
      const createdAt = (p.created_time as string) || ''
      if (lastEdited && lastEdited < sinceIso) {
        reachedOld = true
        break
      }
      out.push({ createdAt, lastEdited })
    }
    if (reachedOld) break
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
    // グリッド最左列の月曜より前は不要。安全側に weeks*7 + 7 日ぶん遡る。
    const sinceIso = new Date(nowMs - (weeks * 7 + 7) * 86_400_000).toISOString()

    const medical = await fetchTimings(notion, medicalDbId, sinceIso)
    const reference = referenceDbId ? await fetchTimings(notion, referenceDbId, sinceIso) : []

    const daily = aggregateDaily(medical, reference)
    const grid = buildWeekGrid(daily, nowMs, weeks)
    // サマリーは直近30日基準なので daily 全体（sinceは十分過去）で足りる。
    const summary = computeSummary(daily, nowMs)

    return NextResponse.json({
      ready: true,
      weeks,
      columns: grid.columns,
      todayKey: grid.todayKey,
      summary,
    })
  } catch {
    return NextResponse.json({ ready: false })
  }
}
