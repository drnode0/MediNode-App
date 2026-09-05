// 段0の3層の組み立て。AI を使わず、返すのは検証済みの主張・既存の節・板に出ている疑問だけ。
// 層1 主張（recall_claims）→ 層2 節・記事（既存の検索索引）→ 層3 板の近い疑問。
// 各層は独立して空になりうる。3層とも空のときは依頼だけが残る。
import {
  buildCoverageIndex, coverage,
  CLAIM_COVERAGE_MIN, BOARD_COVERAGE_MIN, CLAIM_RESULT_MAX, SECTION_RESULT_MAX, BOARD_RESULT_MAX,
} from './coverage'

export type ShelfClaim = {
  claimId: string; pageId: string; pageTitle: string; sectionKey: string
  sectionHeading: string; body: string; source: string; confidence: string; keywords: string
}
export type ShelfSection = { objectID: string; pageId: string; pageTitle: string; sectionHeading: string }
export type ShelfBoardItem = { id: string; title: string; voteCount: number }

export type RankedClaim = {
  claim: ShelfClaim
  coverage: number
  /** 利用者自身が残している主張か（継ぎ目7b。最上位に出して印を付ける） */
  kept: boolean
  /** 本文を出してよいか。無料の利用者には false（題名・節名・件数までにする） */
  bodyVisible: boolean
}
export type ShelfResult = {
  claims: RankedClaim[]
  sections: ShelfSection[]
  board: ShelfBoardItem[]
  /** 足切り前を含む全主張の最高覆い率。閾値 0.25 を後から引き直すための記録なので、
   *  返さなかった（閾値未満の）主張の点も含める。返す claims の側は閾値を通したものだけ。 */
  topCoverage: number
  /** 層1が空のときだけ入る決まった1行。空でないときは null */
  emptyMessage: string | null
}

// 一字一句この文言。「棚に無い」と言い切りつつ、医学的な根拠が無いとは誤解させない。
export const SHELF_EMPTY_MESSAGE = 'MediNodeにはこの問いの検証済みの主張はまだありません'

export type RankInput = {
  query: string
  claims: ShelfClaim[]
  sections: ShelfSection[]
  boardItems: ShelfBoardItem[]
  /** recall_progress に有効な行がある主張の鍵 */
  keptClaimIds: Set<string>
  /** 主張の本文を出してよい利用者か（プレミアム） */
  paid: boolean
}

function claimText(c: ShelfClaim): string {
  return `${c.body} ${c.sectionHeading} ${c.keywords}`
}

// 無料の利用者に返す形。本文・出典・確信度を落とし、題名と節名だけ残す。
// UI で隠すのではなく、ここで値を落とす（画面の実装を1つ忘れただけで本文が漏れるのを防ぐ）。
function redact(c: ShelfClaim): ShelfClaim {
  return { ...c, body: '', source: '', confidence: '', keywords: '' }
}

export function rankAskShelf(input: RankInput): ShelfResult {
  const q = input.query.trim()
  if (!q) return { claims: [], sections: [], board: [], topCoverage: 0, emptyMessage: null }

  // 重みはコーパス全体（絞り込み前の主張）から作る。候補だけで作ると、
  // 候補に多い語が「珍しくない」と誤って軽く扱われる。
  const index = buildCoverageIndex(input.claims.map(claimText))

  const allScored = input.claims
    .map((c) => ({ claim: c, coverage: coverage(q, claimText(c), index), kept: input.keptClaimIds.has(c.claimId) }))

  const scored = allScored
    // 残した主張は閾値を通さない（本人が既に手元に置いたものなので、出さない理由がない）。
    .filter((x) => x.kept || x.coverage >= CLAIM_COVERAGE_MIN)
    // 残した主張が最上位（継ぎ目7b）。その中と、その下は覆い率の降順。
    .sort((a, b) => (a.kept === b.kept ? b.coverage - a.coverage : a.kept ? -1 : 1))
    .slice(0, CLAIM_RESULT_MAX)

  const claims: RankedClaim[] = scored.map((x) => ({
    claim: input.paid ? x.claim : redact(x.claim),
    coverage: x.coverage,
    kept: x.kept,
    bodyVisible: input.paid,
  }))

  // 層1で出した節は層2から落とす。節の同一性はページIDと節名で見る
  // （層2の objectID は subscription_<pageId>#secN、層1は sectionKey なので直接は比べられない）。
  const shown = new Set(scored.map((x) => `${x.claim.pageId} ${x.claim.sectionHeading}`))
  const sections = input.sections
    .filter((s) => !shown.has(`${s.pageId} ${s.sectionHeading}`))
    .slice(0, SECTION_RESULT_MAX)

  // 板の疑問は板の疑問だけで作った索引で採点する。主張の索引を流用すると、
  // 主張のコーパスに無い語が最大の重み（未知語）で当たり扱いになり、板の覆い率だけが
  // 系統的に高く出る（coverage.ts の注意書きのとおり）。主張の索引に板の題を混ぜないのは、
  // 混ぜると主張側の重みが動き、実測で引いた 0.25 の余裕（0.061）を崩すため。
  const boardIndex = buildCoverageIndex(input.boardItems.map((b) => b.title))
  const board = input.boardItems
    .map((b) => ({ item: b, c: coverage(q, b.title, boardIndex) }))
    .filter((x) => x.c >= BOARD_COVERAGE_MIN)
    .sort((a, b) => b.c - a.c)
    .slice(0, BOARD_RESULT_MAX)
    .map((x) => x.item)

  return {
    claims,
    sections,
    board,
    // 足切り前の全主張の最高値。閾値を通ったものだけで測ると、棚に無い問い（＝閾値を
    // 引き直すために記録している当のもの）が必ず 0 になり、記録が使えなくなる。
    topCoverage: allScored.length ? Math.max(...allScored.map((x) => x.coverage)) : 0,
    emptyMessage: claims.length === 0 ? SHELF_EMPTY_MESSAGE : null,
  }
}
