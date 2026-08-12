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

// 子ブロックを取得して添付する対象のコンテナ型。⚡結論ボックス（callout）が本命。
const CONTAINER_TYPES = ['callout', 'toggle', 'bulleted_list_item', 'numbered_list_item', 'quote'] as const

// 1ページあたりの子取得リクエスト上限（コンテナだらけのページでも暴走しない）
export const CHILD_FETCH_MAX_PER_PAGE = 8

// has_childrenのコンテナの子を深さ2まで取得し、ブロックに `children` として添付する。
// extractClozeはこのキーを再帰的に読む。失敗したコンテナは黙って飛ばす（同期は止めない）。
export async function expandChildren(
  notion: NotionLike,
  blocks: unknown[],
  depth = 0,
  budget = { left: CHILD_FETCH_MAX_PER_PAGE },
): Promise<void> {
  if (depth >= 2) return
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown> & { children?: unknown[] }
    if (!b.has_children) continue
    if (!CONTAINER_TYPES.includes(b.type as (typeof CONTAINER_TYPES)[number])) continue
    if (budget.left <= 0) return
    budget.left--
    const children = await fetchAllBlocks(notion, String(b.id))
    if (!children) continue
    b.children = children
    await expandChildren(notion, children, depth + 1, budget)
  }
}

// ブロックタイプ分布の集計（Phase 0計測）。取得済みブロックを再帰的に歩いて
// type別の出現数を counts に加算する。追加のfetchは一切しない＝穴埋め抽出のために
// どうせ読んだ本文から「未対応ブロックがどれだけ出るか」を副産物として拾う。
export function tallyBlockTypes(blocks: unknown[], counts: Record<string, number>): void {
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const b = block as { type?: unknown; children?: unknown[] }
    if (typeof b.type === 'string' && b.type) counts[b.type] = (counts[b.type] || 0) + 1
    if (Array.isArray(b.children)) tallyBlockTypes(b.children, counts)
  }
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
): Promise<{ fetches: number; limitHit: boolean; typeCounts: Record<string, number> }> {
  const typeCounts: Record<string, number> = {}
  const candidates = records.filter((r) => r.source === 'medical' && isClozeCandidate(r))
  if (candidates.length === 0) return { fetches: 0, limitHit: false, typeCounts }

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
    // ⚡結論ボックス等のcallout内マークも拾えるよう、コンテナの子を展開してから抽出する
    await expandChildren(client, blocks)
    tallyBlockTypes(blocks, typeCounts)
    const cloze = extractCloze(blocks)
    if (cloze) r.cloze = cloze
  }
  return { fetches, limitHit, typeCounts }
}
