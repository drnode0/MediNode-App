// 個人・部署syncの後付けパス。クイズ候補（ナレッジ）だけ本文を読み、
// 赤マーカー穴埋めをレコードに載せる。レート対策の3点セット:
//   ① 候補限定 ② 前回同期から未編集なら前回のclozeを引き継ぐ（fetchなし）
//   ③ 1同期あたりの取得上限（bodyFallbackのBODY_FALLBACK_MAXと同思想）
import { extractCloze, type ClozeData } from './cloze'

export const CLOZE_FETCH_MAX = 40

type NotionLike = {
  blocks: {
    children: {
      list: (args: {
        block_id: string
        page_size: number
        start_cursor?: string
      }) => Promise<{ results: unknown[]; has_more?: boolean; next_cursor?: string | null }>
    }
  }
}

type PrevRow = { objectID?: string; lastEdited?: string; cloze?: ClozeData | null } | null
type IndexLike = {
  getObjects: (
    ids: string[],
    opts: { attributesToRetrieve: string[] },
  ) => Promise<{ results: PrevRow[] }>
}

// クイズタブの出題条件（page.tsxのquizCandidates）と同じ「ナレッジ」判定。
export function isClozeCandidate(r: { knowledgeLevel?: unknown }): boolean {
  const lvl = String(r.knowledgeLevel || '')
  return lvl.includes('💡') || lvl.includes('ナレッジ') || lvl.toLowerCase().includes('knowledge')
}

// objectID は `${owner}_${pageId}`。owner接頭辞を剥がしてNotionページIDに戻す。
function pageIdOf(objectID: string): string {
  return objectID.replace(/^(personal|team)_/, '')
}

async function fetchAllBlocks(notion: NotionLike, pageId: string): Promise<unknown[] | null> {
  try {
    const blocks: unknown[] = []
    let cursor: string | undefined = undefined
    do {
      const res = await notion.blocks.children.list({
        block_id: pageId,
        page_size: 100,
        start_cursor: cursor,
      })
      blocks.push(...res.results)
      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
    } while (cursor)
    return blocks
  } catch {
    return null // 権限不足・アーカイブ済み等。cloze無しで続行（同期は止めない）
  }
}

export async function attachClozeData(
  records: Array<Record<string, unknown>>,
  clients: { personal?: NotionLike; team?: NotionLike },
  index: IndexLike,
): Promise<{ fetches: number; limitHit: boolean }> {
  const candidates = records.filter((r) => r.source === 'medical' && isClozeCandidate(r))
  if (candidates.length === 0) return { fetches: 0, limitHit: false }

  // 前回レコードを一括読取（初回同期・index未作成は空扱いで全件新規）
  const prev = new Map<string, { lastEdited?: string; cloze?: ClozeData | null }>()
  try {
    const res = await index.getObjects(
      candidates.map((r) => String(r.objectID)),
      { attributesToRetrieve: ['lastEdited', 'cloze'] },
    )
    for (const row of res.results) if (row?.objectID) prev.set(row.objectID, row)
  } catch {
    // index未作成など。全件を新規扱い
  }

  let fetches = 0
  let limitHit = false
  for (const r of candidates) {
    const client = clients[r.owner as 'personal' | 'team']
    if (!client) continue
    const p = prev.get(String(r.objectID))
    if (p && p.lastEdited && p.lastEdited === r.lastEdited) {
      // 未編集ページは前回の抽出結果を引き継ぐ（本文fetchなし）
      if (p.cloze) r.cloze = p.cloze
      continue
    }
    if (fetches >= CLOZE_FETCH_MAX) {
      limitHit = true
      continue
    }
    fetches++
    const blocks = await fetchAllBlocks(client, pageIdOf(String(r.objectID)))
    if (!blocks) continue
    const cloze = extractCloze(blocks)
    if (cloze) r.cloze = cloze
  }
  return { fetches, limitHit }
}
