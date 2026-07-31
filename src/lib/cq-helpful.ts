// 「役に立った」リアクション（プレミアムナレッジ・解決済みCQ）のクライアント側。
// - helpfulCountLabel: 下限方式のバッジ文言。HELPFUL_BADGE_MIN 未満は '' を返し何も描かない
//   （1〜2人の寂しい数字を見せない。cq-board の voteCountLabel・cq-views の下限と同じ思想）。
// - fetchHelpfulState: 一覧/リーダーに出す objectID 群の合計数と「自分が押したか」をまとめて取得。
// - toggleHelpful: 押す/取り消す。失敗時は null（呼び出し側で見た目を戻す）。

export const HELPFUL_BADGE_MIN = 3

export function helpfulCountLabel(count: number): string {
  return count >= HELPFUL_BADGE_MIN ? `${count}人が役に立ったと言っています` : ''
}

export type HelpfulState = { counts: Record<string, number>; mine: string[] }

export async function fetchHelpfulState(ids: string[]): Promise<HelpfulState> {
  const clean = ids.filter(Boolean)
  if (clean.length === 0) return { counts: {}, mine: [] }
  try {
    const res = await fetch(`/api/cq/helpfuls?ids=${encodeURIComponent(clean.join(','))}`)
    if (!res.ok) return { counts: {}, mine: [] }
    const data = (await res.json()) as { counts?: Record<string, number>; mine?: string[] }
    return { counts: data.counts || {}, mine: data.mine || [] }
  } catch {
    return { counts: {}, mine: [] }
  }
}

export async function toggleHelpful(
  objectId: string,
  helpful: boolean,
): Promise<{ helpful: boolean; count: number } | null> {
  try {
    const res = await fetch('/api/cq/helpful', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objectId, helpful }),
    })
    if (!res.ok) return null
    const d = (await res.json()) as { helpful?: boolean; count?: number }
    if (typeof d.helpful !== 'boolean' || typeof d.count !== 'number') return null
    return { helpful: d.helpful, count: d.count }
  } catch {
    return null
  }
}
