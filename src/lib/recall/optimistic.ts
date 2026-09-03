// 押した瞬間の画面と、失敗したときに戻る先を決める純関数。
// 押してから通信が返るまでの見え方は、サーバー側の keep ルートと同じ規則にする
// （記録が無ければ間隔1日で新規、あれば removedAt だけを外す）。ずれると、
// 保存が成功したのに画面の数字が一瞬だけ違う、という見え方になる。
import { newProgress } from './srs'
import { normalizePageId } from './claim-text'
import type { RecallProgress, RecallSectionRead } from './types'

export function keepOptimistic(
  list: RecallProgress[], claimId: string, keep: boolean, now: Date,
): RecallProgress[] {
  const found = list.find((p) => p.claimId === claimId)
  const rest = list.filter((p) => p.claimId !== claimId)
  if (keep) {
    const next = found ? { ...found, removedAt: null } : newProgress(claimId, now)
    return [...rest, next]
  }
  // 残していない主張は外せない（サーバーも404を返す）。画面も何も変えない。
  if (!found) return list
  return [...rest, { ...found, removedAt: now.toISOString() }]
}

export function replaceProgress(list: RecallProgress[], row: RecallProgress): RecallProgress[] {
  return [...list.filter((p) => p.claimId !== row.claimId), row]
}

export function readOptimistic(
  list: RecallSectionRead[], pageId: string, sectionKey: string, now: Date,
): RecallSectionRead[] {
  // 記録側（/api/recall/read）が normalizePageId を通して保存するので、画面側も同じ形で持つ。
  // 揃えないと、いま押した節が「読んだ」に見えないまま残る。
  const id = normalizePageId(pageId)
  const rest = list.filter((r) => !(r.pageId === id && r.sectionKey === sectionKey))
  return [...rest, { pageId: id, sectionKey, readAt: now.toISOString() }]
}

export function removeRead(
  list: RecallSectionRead[], pageId: string, sectionKey: string,
): RecallSectionRead[] {
  const id = normalizePageId(pageId)
  return list.filter((r) => !(r.pageId === id && r.sectionKey === sectionKey))
}
