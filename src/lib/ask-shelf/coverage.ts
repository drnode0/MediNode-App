// 段0の照合の正。文字2つずつ（bigram）に割り、珍しい語ほど重く数えて
// 「問いの言葉を、その主張がどれだけ覆えているか」を出す。
//
// 点数（BM25）ではなく覆い率を使う理由（2026-09-05 の実測・設計書参照）:
// 点数は問いの長さと語の一般性で膨らむため、棚に無い問いが棚にある問いより
// 高得点になる。実測では棚に無い問いの最高点が棚にある問いの最低点を上回り、
// 「無い」と言う閾値を引けなかった。覆い率は問いの側で正規化されるので引ける。
//
// PGroonga はこの計算の代わりではなく、候補を速く絞るためだけに使う。
// 順位と足切りは常にこの関数が決める（設計時の実測がそのまま本番の振る舞いになる）。

// 表記の揺れを消す。NFKC で全角半角をそろえ、記号と空白を落とす。
export function normalizeForMatch(text: string): string {
  return (text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s、。，．・（）()「」『』:：;；/／\-–—[\]？?]+/g, '')
}

export function bigrams(text: string): string[] {
  const s = normalizeForMatch(text)
  const out: string[] = []
  for (let i = 0; i + 1 < s.length; i++) out.push(s.slice(i, i + 2))
  return out
}

export type CoverageIndex = {
  idf: Map<string, number>
  // コーパスに1度も出ない語の重み。未知の語ほど「その主張には無い」と強く言えるので、
  // 最大の重みで数える（未知語だらけの問いは覆い率が下がり、正しく「無い」になる）。
  unknownWeight: number
}

export function buildCoverageIndex(docs: string[]): CoverageIndex {
  const df = new Map<string, number>()
  for (const d of docs) {
    for (const g of new Set(bigrams(d))) df.set(g, (df.get(g) ?? 0) + 1)
  }
  const n = Math.max(docs.length, 1)
  const idf = new Map<string, number>()
  for (const [g, c] of df) idf.set(g, Math.log((n - c + 0.5) / (c + 0.5) + 1))
  return { idf, unknownWeight: Math.log(n + 1) }
}

// 0〜1。問いの語の重みの合計のうち、その主張が持っている語の重みの割合。
export function coverage(query: string, docText: string, index: CoverageIndex): number {
  const qs = new Set(bigrams(query))
  if (qs.size === 0) return 0
  const has = new Set(bigrams(docText))
  let total = 0
  let hit = 0
  for (const g of qs) {
    const w = index.idf.get(g) ?? index.unknownWeight
    total += w
    if (has.has(g)) hit += w
  }
  return total === 0 ? 0 : hit / total
}

// 足切りと件数。実測の出所は設計書 2026-09-05-ask-shelf-design.md。
// 0.25 は「棚にある25/27を拾い、棚に無い11/11を断る」点。ここ1か所で持つ。
export const CLAIM_COVERAGE_MIN = 0.25
// 板の近い疑問は母数が5件しかなく、誤って出しても「近い疑問」として読まれるため層1より緩い。
// この値は実測していない出発点（設計書に明記）。記録を見て引き直す。
export const BOARD_COVERAGE_MIN = 0.15
export const CLAIM_RESULT_MAX = 5
export const SECTION_RESULT_MAX = 3
export const BOARD_RESULT_MAX = 2
