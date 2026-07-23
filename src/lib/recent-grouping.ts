// 新着タブの日付グルーピング（今日 / 今週 / 今月 / それ以前）。
// 「今日」は“直近24時間”のローリング窓ではなく **JSTの暦日** で判定する。
// （旧実装は diffDays<1 だったため、前日夕方に投稿したものが23時間前＝「今日」に入っていた）。

export const RECENT_GROUP_LABELS = ['今日', '今週', '今月', 'それ以前'] as const

// ミリ秒 → JSTの暦日（YYYY-MM-DD）。国内利用前提（daily-question の jstToday と同じ丸め）。
function jstDateStr(ms: number): string {
  return new Date(ms + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// 日付文字列（createdAt / lastEdited）を 0=今日 / 1=今週 / 2=今月 / 3=それ以前 に振り分ける。
//   今日  … 投稿日のJST暦日が本日と同じ
//   今週  … 今日ではないが7日以内
//   今月  … 30日以内
//   それ以前 … それ以上、または日付不明
export function recentGroupIndex(dateStr: string | undefined | null, nowMs: number): number {
  const t = dateStr ? new Date(dateStr).getTime() : NaN
  if (Number.isNaN(t)) return 3
  if (jstDateStr(t) === jstDateStr(nowMs)) return 0
  const diffDays = (nowMs - t) / (1000 * 60 * 60 * 24)
  if (diffDays < 7) return 1
  if (diffDays < 30) return 2
  return 3
}
