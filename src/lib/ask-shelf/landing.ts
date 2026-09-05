// 回答通知の飛び先。いちばん具体的なもの（主張＞節＞記事）を指す。
//
// URL は着地画面 /cq/answered/[id] の1つにまとめる。アプリには「記事の特定の節を
// URL で開く」経路が無く（リーダーは objectID でアプリ内から開く。vine-open.ts 参照）、
// ここで URL の形を新しく作ると、リーダー側の開き方と二重の規約になるため。
// 「主張＞節＞記事」の順位は、着地画面が何を見せるかとして表す。
import { APP_URL } from '../trial-end-content'

// 'section' の種別は置かない。主張が recall_claims に無ければ節も分からないため、
// 到達できない分岐になる。節を指せるのは主張が見つかったときだけ。
export type AnswerTarget =
  | { kind: 'claim'; claimId: string; pageId: string; sectionKey: string }
  | { kind: 'article'; pageId: string }
  | { kind: 'none' }

export function resolveAnswerTarget(input: {
  canonicalClaimIds: string[]
  claimsById: Map<string, { pageId: string; sectionKey: string }>
  articlePageId?: string
}): AnswerTarget {
  for (const id of input.canonicalClaimIds) {
    const c = input.claimsById.get(id)
    // 節が分かる主張が最優先。節が空の主張なら、その記事の先頭に落とす。
    if (c) {
      return c.sectionKey
        ? { kind: 'claim', claimId: id, pageId: c.pageId, sectionKey: c.sectionKey }
        : { kind: 'article', pageId: c.pageId }
    }
  }
  if (input.articlePageId) return { kind: 'article', pageId: input.articlePageId }
  return { kind: 'none' }
}

export function answerLandingUrl(intakePageId: string, target: AnswerTarget): string {
  if (target.kind === 'none') return APP_URL
  return `${APP_URL}/cq/answered/${intakePageId}`
}
