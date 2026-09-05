// 完了条件の2つの数（更新案H）。どちらも /admin にだけ出す。
// 「段0が効いているか」を印象でなく数で見るための最小の道具で、点数や順位は作らない。
import type { NotionIntakePage } from '../cq-board'

export function notSentRate(rows: { submitted: boolean }[]): { shown: number; notSent: number; rate: number } {
  const shown = rows.length
  const notSent = rows.filter((r) => !r.submitted).length
  return { shown, notSent, rate: shown === 0 ? 0 : notSent / shown }
}

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000

function ownerOf(p: NotionIntakePage): string {
  const arr = (p.properties?.['通知先ユーザーID'] as { rich_text?: Array<{ plain_text?: unknown }> } | undefined)?.rich_text
  return Array.isArray(arr) ? arr.map((t) => String(t?.plain_text ?? '')).join('').trim() : ''
}
function statusOf(p: NotionIntakePage): string {
  const sel = (p.properties?.['対応状態'] as { select?: { name?: unknown } | null } | undefined)?.select
  return sel?.name ? String(sel.name) : ''
}

// 「今回は記事化しません」を見たあとに、同じ人が出し直したか。
// 出口を見せたことで投稿が止まってしまうなら、文言か理由の見せ方を直す合図になる。
export function resubmitAfterDecline(pages: NotionIntakePage[], now: Date): number {
  const declinedAt = new Map<string, number>()
  for (const p of pages) {
    if (statusOf(p) !== '対応不要') continue
    const u = ownerOf(p)
    const t = Date.parse(p.created_time || '')
    if (!u || !Number.isFinite(t)) continue
    // 同じ人に複数あるときは、いちばん新しい見送りを基点にする。
    declinedAt.set(u, Math.max(declinedAt.get(u) ?? 0, t))
  }
  let n = 0
  for (const p of pages) {
    if (statusOf(p) === '対応不要') continue
    const u = ownerOf(p)
    const base = declinedAt.get(u)
    const t = Date.parse(p.created_time || '')
    if (!u || base === undefined || !Number.isFinite(t)) continue
    if (t > base && t - base <= WINDOW_MS && t <= now.getTime()) n++
  }
  return n
}
