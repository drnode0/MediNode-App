import { describe, it, expect, vi } from 'vitest'
import { fetchPageBlocks } from '../notion-page'

function clientFrom(byBlock: Record<string, any[]>) {
  const list = vi.fn(async ({ block_id }: { block_id: string }) => ({
    results: byBlock[block_id] ?? [],
    has_more: false,
    next_cursor: null,
  }))
  return { client: { blocks: { children: { list } } }, list }
}

describe('fetchPageBlocks', () => {
  it('トップレベルを取得する', async () => {
    const { client } = clientFrom({ page1: [{ id: 'a', type: 'paragraph', has_children: false }] })
    const out = await fetchPageBlocks(client as any, 'page1')
    expect(out.map((b) => b.id)).toEqual(['a'])
  })

  it('has_children の子を再帰取得して children に格納', async () => {
    const { client, list } = clientFrom({
      page1: [{ id: 'callout1', type: 'callout', has_children: true }],
      callout1: [{ id: 'child1', type: 'paragraph', has_children: false }],
    })
    const out = await fetchPageBlocks(client as any, 'page1')
    expect(out[0].children!.map((c: any) => c.id)).toEqual(['child1'])
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ block_id: 'callout1' }))
  })

  it('ページネーションを辿る', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ results: [{ id: 'a', has_children: false }], has_more: true, next_cursor: 'c2' })
      .mockResolvedValueOnce({ results: [{ id: 'b', has_children: false }], has_more: false, next_cursor: null })
    const out = await fetchPageBlocks({ blocks: { children: { list } } } as any, 'page1')
    expect(out.map((b) => b.id)).toEqual(['a', 'b'])
  })
})
