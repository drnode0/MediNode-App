// つづけて読む枠の「関連ナレッジ」自動算出。手動キュレーションはしない（腐るため）。
// スコア: 詳細ジャンル共通1値+3 / ジャンル共通1つ+1 / キーワード重複1語+1。
// 足切りは2点: 「同ジャンルなだけ（+1）」では関連に出さない（乳酸値ページに
// 救急蘇生ジャンルが同じだけの抗精神病薬が並んだ実例への対処。2026-07-29）。

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

// 詳細ジャンルはカンマ区切りの複数値（例: 'ショック, 敗血症'）。文字列の完全一致では
// 「ショック」と「ショック, 敗血症」が他人になってしまうため、分割して集合で比べる。
function detailGenres(s?: string): Set<string> {
  return new Set(
    (s || '')
      .split(/[、,\/・]+/)
      .map((w) => w.trim())
      .filter(Boolean),
  )
}

// 「同ジャンルなだけ（+1）」を関連に出さないための足切り。
// 詳細ジャンル共通かキーワード重複が最低1つは必要になる。
const MIN_SCORE = 2

function score(current: RelatedSource, cand: RelatedSource): number {
  let n = 0
  const dg = detailGenres(current.detailGenre)
  for (const d of detailGenres(cand.detailGenre)) if (dg.has(d)) n += 3
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
    .filter((x) => x.s >= MIN_SCORE)
    .sort((a, b) => b.s - a.s || (b.c.lastEdited || '').localeCompare(a.c.lastEdited || ''))
    .slice(0, limit)
    .map((x) => x.c)
}
