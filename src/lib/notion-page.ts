import type { RawBlock } from './reader-doc'

export type BlockLister = {
  blocks: { children: { list: (a: { block_id: string; page_size?: number; start_cursor?: string }) => Promise<{
    results: any[]; has_more: boolean; next_cursor: string | null
  }> } }
}

export async function fetchPageBlocks(notion: BlockLister, blockId: string): Promise<RawBlock[]> {
  const out: RawBlock[] = []
  let cursor: string | undefined = undefined
  do {
    const res = await notion.blocks.children.list({ block_id: blockId, page_size: 100, start_cursor: cursor })
    for (const raw of res.results) {
      const block = raw as RawBlock
      if (block.has_children) block.children = await fetchPageBlocks(notion, block.id as string)
      out.push(block)
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)
  return out
}
