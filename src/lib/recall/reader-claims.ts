// 読む画面が「この行はどの主張か」を知るための索引。
// クライアントでハッシュを作らない（サーバーとハッシュの実装がずれる危険を作らない）。
// 引くのは /api/recall/claims が返した確定済みの claim だけで、
// 見つからなければ null を返す＝その行に Node を出さない。誤って別の主張に付くことはない。
import { normalizeBody, normalizePageId, splitClaim } from './claim-text'
import type { RecallClaim } from './types'

export type ClaimIndex = Map<string, RecallClaim>

// 正規化した本文 → 主張。ページで絞ってから作る（同じ文が別ページにあっても混ざらない）。
export function buildClaimIndex(claims: RecallClaim[], pageId: string): ClaimIndex {
  const want = normalizePageId(pageId)
  const map: ClaimIndex = new Map()
  for (const c of claims) {
    if (normalizePageId(c.pageId) !== want) continue
    if (!c.active) continue
    map.set(normalizeBody(c.body), c)
  }
  return map
}

// 本文行のテキスト（本文＋マーク＋出典が1つに繋がったもの）から主張を引く。
// 判定は同期側とまったく同じ splitClaim を通すので、規約が2か所に増えない。
export function claimForRowText(index: ClaimIndex, rowText: string): RecallClaim | null {
  const sp = splitClaim(rowText)
  if (!sp || !sp.body) return null
  return index.get(normalizeBody(sp.body)) ?? null
}
