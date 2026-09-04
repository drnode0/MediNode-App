// 読む画面が「この行はどの主張か」を知るための索引。
// クライアントでハッシュを作らない（サーバーとハッシュの実装がずれる危険を作らない）。
// 引くのは /api/recall/claims が返した確定済みの claim だけで、
// 見つからなければ null を返す＝その行に Node を出さない。誤って別の主張に付くことはない。
import { normalizeBody, normalizePageId, splitClaim, SECTION_HEAD_RE } from './claim-text'
import type { RecallClaim, RecallSectionRead } from './types'
import type { ReaderBlock } from '@/lib/reader-doc'

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

// ブロックの並びと同じ長さの、各ブロックが属する節キーの配列。
// 節の切り替えは「番号付きH2」だけ。同期側（extract-claims）と同じ規則にしないと、
// 「読んだ」の記録と主張の突き合わせが静かに外れる（エラーが出ない種類の壊れ方）。
export function sectionKeysByBlock(blocks: ReaderBlock[]): string[] {
  let cur = 'sec0'
  return blocks.map((b) => {
    if (b.kind === 'heading' && b.level === 2) {
      const t = b.inlines.map((i) => i.text).join('').trim()
      const m = t.match(SECTION_HEAD_RE)
      if (m) cur = `sec${m[1]}`
    }
    return cur
  })
}

// 節の読了記録を1か所で判定する。節末ボタン（下）と節見出しの印（上）の両方が
// この関数を通す。別々に書くと、書き方がずれて「上は済みだが下は未読了」のような
// 表示の食い違いが起こりうる（2026-09-04 指摘: 節の頭に何も出ないと、2回目以降は
// 読み終えるまで既読かどうか分からない。この関数は見出し側の印にも使う）。
export function isSectionRead(reads: RecallSectionRead[], pageId: string, sectionKey: string): boolean {
  const id = normalizePageId(pageId)
  return reads.some((r) => r.pageId === id && r.sectionKey === sectionKey)
}

// 番号付き節ごとの「最後のブロックの位置」。節末ボタンをこの直後に置く。
// sec0（最初の見出しより前＝⚡結論・署名・大前提）には置かない。
export function sectionEnds(blocks: ReaderBlock[]): { sectionKey: string; afterIndex: number }[] {
  const keys = sectionKeysByBlock(blocks)
  const out: { sectionKey: string; afterIndex: number }[] = []
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] === 'sec0') continue
    const last = out[out.length - 1]
    if (last && last.sectionKey === keys[i]) last.afterIndex = i
    else out.push({ sectionKey: keys[i], afterIndex: i })
  }
  return out
}
