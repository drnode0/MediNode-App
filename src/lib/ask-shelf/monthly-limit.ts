// 月5件の上限（裁定6）。1日5件・1IP20件の既存の制限は残したうえで足す。
//
// 数える場所を Upstash ではなく受付DBにした理由: Upstash が本番に設定された記録が無く、
// 未設定だと rate-limit.ts はメモリ版に落ちる。サーバーが入れ替わるたびにカウンタが
// 消えるので30日の窓を保てない。受付DBは投稿そのものの記録なので数え直しても正しい。
//
// 通知に同意していない投稿は「通知先ユーザーID」が無く、数に入らない。同意の線引きを
// 機能のために広げない（cq-submit の既存方針）。そのぶんは1日5件と1IP20件が受ける。
import type { NotionIntakePage } from '../cq-board'

export const MONTHLY_LIMIT = 5
const WINDOW_DAYS = 30

export function countRecentSubmissions(pages: NotionIntakePage[], userId: string, now: Date): number {
  if (!userId) return 0
  const from = now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000
  let n = 0
  for (const p of pages) {
    const arr = (p.properties?.['通知先ユーザーID'] as { rich_text?: Array<{ plain_text?: unknown }> } | undefined)?.rich_text
    const owner = Array.isArray(arr) ? arr.map((t) => String(t?.plain_text ?? '')).join('').trim() : ''
    if (owner !== userId) continue
    const t = Date.parse(p.created_time || '')
    if (Number.isFinite(t) && t >= from) n++
  }
  return n
}

export function monthlyLimitState(count: number): { blocked: boolean; remaining: number; notice: string | null } {
  const remaining = Math.max(MONTHLY_LIMIT - count, 0)
  if (remaining === 0) {
    return { blocked: true, remaining, notice: '今月お送りいただける件数の上限に達しました。来月またお待ちしています。' }
  }
  // 案内は上限に近づいたときだけ（裁定6）。ふだんは数を見せない。
  return { blocked: false, remaining, notice: remaining === 1 ? '今月お送りいただけるのは、あと1件です。' : null }
}
