// 段1の形式検証。AI が返した並べ替えを、表示する前にここで落とす。
// 見るのは「主張IDの過不足」と「AI が書いた見出し・列挙の語彙」の2つだけで、
// 主張の本文は原文なので検査しない。
//
// 先例は reader-spread.ts の verifyVerbatim（制作スキルの生成物を原文と突き合わせて弾く）。
// 語彙のリストを新しく持たず、「入力に現れない語」を落とす形にしてある。
//
// 検出できないこと: 否定表現の反転。機械的に無理なので、段1に医学的な文を書かせないことで避ける。
// この検証は「書かせない」を確かめる道具であって、「書いた内容の正しさ」を測る道具ではない。

export type Stage1Group = { heading: string; claimIds: string[] }
export type Stage1Output = { groups: Stage1Group[]; notCovered: string[] }
export type Stage1Verdict = 'ok' | 'rejected_ids' | 'rejected_heading' | 'rejected_vocab'

export const GROUP_MAX = 3
export const HEADING_MAX = 20
export const NOT_COVERED_MAX = 4
export const NOT_COVERED_LINE_MAX = 40

const DIGIT_RE = /[0-9０-９]/

// 記号系の単位だけを持つ。「時間」「分」「日」のような一般語は入れない（誤検出になる）。
// 英字の単位は前後を英字で挟まれていないときだけ当てる。挟むと guideline の g、mL の L で
// 一般的な英単語を落としてしまう。
const UNIT_RE = /(?<![A-Za-z])(mmHg|cmH2O|mEq|mmol|bpm|mg|dL|mL|kg|IU|ng|μg|g|L)(?![A-Za-z])|[%％]/

// 比較用の正規化は NFKC と小文字化だけにする。coverage.ts の normalizeForMatch は
// 記号と空白を落とすので語の境界が壊れ、この検査には使えない。
function norm(text: string): string {
  return (text ?? '').normalize('NFKC').toLowerCase()
}

const LATIN_RUN = /[A-Za-z]{3,}/g
// 長音符（ー）を含めて1語として拾う。「ガイドライン」「モニタリング」が語になる。
const KATAKANA_RUN = /[ァ-ヺー]{4,}/g

/** text の中で、haystack のどこにも現れない英字語・カタカナ語を返す */
export function unknownTerms(text: string, haystack: string): string[] {
  const h = norm(haystack)
  const t = norm(text)
  const out: string[] = []
  for (const re of [LATIN_RUN, KATAKANA_RUN]) {
    for (const m of t.matchAll(re)) {
      if (!h.includes(m[0])) out.push(m[0])
    }
  }
  return out
}

/** 語彙検査の突き合わせ先。問いと主張のすべての文字列を1本につなぐ */
export function stage1InputText(
  query: string,
  claims: Array<{ body: string; source: string; sectionHeading: string; pageTitle: string }>,
): string {
  return [query, ...claims.flatMap((c) => [c.body, c.source, c.sectionHeading, c.pageTitle])].join('\n')
}

export function verifyStage1(out: Stage1Output, inputClaimIds: string[], inputText: string): Stage1Verdict {
  // 1. 主張IDが入力集合と完全一致（重複なし・欠落なし・余分なし）。
  //    部分集合を許すと、段0が返した検証済みの主張が段1を踏むと消える。
  const got = out.groups.flatMap((g) => g.claimIds)
  if (got.length !== inputClaimIds.length) return 'rejected_ids'
  if (new Set(got).size !== got.length) return 'rejected_ids'
  const want = new Set(inputClaimIds)
  if (got.some((id) => !want.has(id))) return 'rejected_ids'

  // 2. 形
  if (out.groups.length < 1 || out.groups.length > GROUP_MAX) return 'rejected_heading'
  for (const g of out.groups) {
    const n = [...g.heading].length
    if (n < 1 || n > HEADING_MAX) return 'rejected_heading'
  }
  if (out.notCovered.length > NOT_COVERED_MAX) return 'rejected_heading'
  for (const line of out.notCovered) {
    const n = [...line].length
    if (n < 1 || n > NOT_COVERED_LINE_MAX) return 'rejected_heading'
  }

  // 3. 語彙。AI が書いた文だけを見る。
  const generated = [...out.groups.map((g) => g.heading), ...out.notCovered].join('\n')
  if (DIGIT_RE.test(generated)) return 'rejected_vocab'
  if (UNIT_RE.test(generated)) return 'rejected_vocab'
  if (unknownTerms(generated, inputText).length > 0) return 'rejected_vocab'

  return 'ok'
}
