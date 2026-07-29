// つづけて読む枠の「関連ナレッジ」自動算出。手動キュレーションはしない（腐るため）。
// スコア: 詳細ジャンル一致+3 / ジャンル共通1つ+1 / キーワード重複1語+1。

export type RelatedSource = {
  objectID: string
  title: string
  genre?: string[]
  detailGenre?: string
  aiKeywords?: string
  lastEdited?: string
  isParent?: number
  recordType?: string
  notionUrl?: string
  knowledgeLevel?: string
  aiSummary?: string
  source?: string
  owner?: string
  recordingLevel?: string
}

function keywords(s?: string): Set<string> {
  return new Set(
    (s || '')
      .split(/[、,\/・\s]+/)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length >= 2),
  )
}

function score(current: RelatedSource, cand: RelatedSource): number {
  let n = 0
  if (current.detailGenre && cand.detailGenre && current.detailGenre === cand.detailGenre) n += 3
  const g = new Set(current.genre || [])
  for (const cg of cand.genre || []) if (g.has(cg)) n += 1
  const kw = keywords(current.aiKeywords)
  for (const w of keywords(cand.aiKeywords)) if (kw.has(w)) n += 1
  return n
}

export function pickRelated(
  current: RelatedSource,
  candidates: RelatedSource[],
  limit = 3,
): RelatedSource[] {
  return candidates
    .filter((c) => c.objectID !== current.objectID && c.recordType !== 'section')
    .map((c) => ({ c, s: score(current, c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (b.c.lastEdited || '').localeCompare(a.c.lastEdited || ''))
    .slice(0, limit)
    .map((x) => x.c)
}
