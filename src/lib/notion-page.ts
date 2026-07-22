import type { RawBlock } from './reader-doc'

export type BlockLister = {
  blocks: { children: { list: (a: { block_id: string; page_size?: number; start_cursor?: string }) => Promise<{
    results: any[]; has_more: boolean; next_cursor: string | null
  }> } }
}

// 子ブロックの取得を直列で await すると、節が多いページで Notion API 往復が
// 積み上がり「本文を読む」の体感が数秒単位で悪化する。順序は out の位置で保たれるので、
// 子の取得は同時 CHILD_CONCURRENCY 本まで並列化する（全並列にしないのは Notion の
// レート制限 ~3req/s を踏まないため）。
const CHILD_CONCURRENCY = 3

export async function fetchPageBlocks(notion: BlockLister, blockId: string): Promise<RawBlock[]> {
  const out: RawBlock[] = []
  const childTasks: Array<() => Promise<void>> = []
  let cursor: string | undefined = undefined
  do {
    const res = await notion.blocks.children.list({ block_id: blockId, page_size: 100, start_cursor: cursor })
    for (const raw of res.results) {
      const block = raw as RawBlock
      if (block.has_children) {
        childTasks.push(async () => {
          block.children = await fetchPageBlocks(notion, block.id as string)
        })
      }
      out.push(block)
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)

  let next = 0
  const workers = Array.from({ length: Math.min(CHILD_CONCURRENCY, childTasks.length) }, async () => {
    while (next < childTasks.length) {
      const task = childTasks[next++]
      await task()
    }
  })
  await Promise.all(workers)
  return out
}
