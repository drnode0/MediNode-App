// attachClozeData（個人・部署syncの穴埋め後付けパス）のテスト。
// レート対策3点: 候補限定 / 未編集は前回引き継ぎ / 上限40。
import { describe, it, expect } from 'vitest'
import { attachClozeData, isClozeCandidate, tallyBlockTypes, CLOZE_FETCH_MAX } from '@/lib/cloze-sync'

const marked = {
  type: 'paragraph',
  paragraph: {
    rich_text: [
      { plain_text: '答えは ', annotations: { color: 'default' } },
      { plain_text: '42', annotations: { color: 'red_background' } },
    ],
  },
}

function fakeNotion(blocks: unknown[] = [marked]) {
  const calls: string[] = []
  return {
    calls,
    blocks: {
      children: {
        list: async ({ block_id }: { block_id: string }) => {
          calls.push(block_id)
          return { results: blocks, has_more: false, next_cursor: null }
        },
      },
    },
  }
}

const emptyIndex = {
  getObjects: async () => ({ results: [] }),
}

function rec(objectID: string, extra: Record<string, unknown> = {}) {
  return {
    objectID,
    source: 'medical',
    owner: 'personal',
    knowledgeLevel: '💡 ナレッジ',
    lastEdited: '2026-08-12T00:00:00Z',
    ...extra,
  }
}

describe('isClozeCandidate', () => {
  it('ナレッジだけが対象（CQ・空は対象外）', () => {
    expect(isClozeCandidate({ knowledgeLevel: '💡 ナレッジ' })).toBe(true)
    expect(isClozeCandidate({ knowledgeLevel: '❓ CQ' })).toBe(false)
    expect(isClozeCandidate({})).toBe(false)
  })
})

describe('attachClozeData', () => {
  it('新規候補は本文を取得してclozeを載せる', async () => {
    const notion = fakeNotion()
    const records = [rec('personal_p1')]
    const res = await attachClozeData(records, { personal: notion }, emptyIndex)
    expect(res.fetches).toBe(1)
    expect(notion.calls).toEqual(['p1']) // owner接頭辞を剥がしてページIDで呼ぶ
    expect((records[0] as { cloze?: { blankCount: number } }).cloze?.blankCount).toBe(1)
  })

  it('CQ・文献レコードには触らない', async () => {
    const notion = fakeNotion()
    const records = [
      rec('personal_cq', { knowledgeLevel: '❓ CQ' }),
      rec('personal_ref', { source: 'reference' }),
    ]
    const res = await attachClozeData(records, { personal: notion }, emptyIndex)
    expect(res.fetches).toBe(0)
  })

  it('lastEditedが同じなら前回のclozeを引き継ぎ、fetchしない', async () => {
    const notion = fakeNotion()
    const prevCloze = { blocks: [], blankCount: 9, truncated: false }
    const index = {
      getObjects: async () => ({
        results: [
          { objectID: 'personal_p1', lastEdited: '2026-08-12T00:00:00Z', cloze: prevCloze },
        ],
      }),
    }
    const records = [rec('personal_p1')]
    const res = await attachClozeData(records, { personal: notion }, index)
    expect(res.fetches).toBe(0)
    expect((records[0] as { cloze?: unknown }).cloze).toEqual(prevCloze)
  })

  it('lastEditedが変わっていれば再取得する', async () => {
    const notion = fakeNotion()
    const index = {
      getObjects: async () => ({
        results: [{ objectID: 'personal_p1', lastEdited: '2026-08-01T00:00:00Z', cloze: null }],
      }),
    }
    const records = [rec('personal_p1')]
    const res = await attachClozeData(records, { personal: notion }, index)
    expect(res.fetches).toBe(1)
  })

  it('上限を超えたらfetchを止めて limitHit=true', async () => {
    const notion = fakeNotion()
    const records = Array.from({ length: CLOZE_FETCH_MAX + 5 }, (_, i) => rec(`personal_p${i}`))
    const res = await attachClozeData(records, { personal: notion }, emptyIndex)
    expect(res.fetches).toBe(CLOZE_FETCH_MAX)
    expect(res.limitHit).toBe(true)
  })

  it('ownerに対応するクライアントがなければ黙ってスキップ', async () => {
    const records = [rec('team_p1', { owner: 'team' })]
    const res = await attachClozeData(records, { personal: fakeNotion() }, emptyIndex)
    expect(res.fetches).toBe(0)
  })

  it('index未作成（getObjects例外）でも新規として動く', async () => {
    const notion = fakeNotion()
    const index = {
      getObjects: async () => {
        throw new Error('index does not exist')
      },
    }
    const records = [rec('personal_p1')]
    const res = await attachClozeData(records, { personal: notion }, index)
    expect(res.fetches).toBe(1)
  })
})

// ── expandChildren（2026-08-12追記）: callout等の子を取得して添付する ──
import { expandChildren, CHILD_FETCH_MAX_PER_PAGE } from '@/lib/cloze-sync'

function fakeNotionTree(childrenById: Record<string, unknown[]>) {
  const calls: string[] = []
  return {
    calls,
    blocks: {
      children: {
        list: async ({ block_id }: { block_id: string }) => {
          calls.push(block_id)
          return { results: childrenById[block_id] || [], has_more: false, next_cursor: null }
        },
      },
    },
  }
}

describe('expandChildren', () => {
  it('has_childrenのcalloutの子を取得してchildrenに添付する', async () => {
    const blocks = [{ id: 'c1', type: 'callout', has_children: true, callout: { rich_text: [] } }]
    const notion = fakeNotionTree({ c1: [marked] })
    await expandChildren(notion, blocks)
    expect(notion.calls).toEqual(['c1'])
    expect((blocks[0] as { children?: unknown[] }).children).toEqual([marked])
  })

  it('孫（深さ2）まで取得し、それ以上は降りない', async () => {
    const blocks = [{ id: 'c1', type: 'callout', has_children: true, callout: { rich_text: [] } }]
    const child = { id: 'b1', type: 'bulleted_list_item', has_children: true, bulleted_list_item: { rich_text: [] } }
    const grand = { id: 'b2', type: 'bulleted_list_item', has_children: true, bulleted_list_item: { rich_text: [] } }
    const notion = fakeNotionTree({ c1: [child], b1: [grand], b2: [marked] })
    await expandChildren(notion, blocks)
    expect(notion.calls).toEqual(['c1', 'b1']) // b2（深さ3の取得）はしない
  })

  it('コンテナ以外・has_childrenなしは取得しない', async () => {
    const blocks = [
      { id: 'p1', type: 'paragraph', has_children: false, paragraph: { rich_text: [] } },
      { id: 'img', type: 'image', has_children: true, image: {} },
    ]
    const notion = fakeNotionTree({})
    await expandChildren(notion, blocks)
    expect(notion.calls).toEqual([])
  })

  it('1ページあたりの子取得は上限で打ち切る', async () => {
    const blocks = Array.from({ length: CHILD_FETCH_MAX_PER_PAGE + 3 }, (_, i) => ({
      id: `c${i}`, type: 'callout', has_children: true, callout: { rich_text: [] },
    }))
    const notion = fakeNotionTree({})
    await expandChildren(notion, blocks)
    expect(notion.calls).toHaveLength(CHILD_FETCH_MAX_PER_PAGE)
  })

  it('attachClozeDataはcallout内のマークも拾う（結合確認）', async () => {
    const calloutBlock = {
      id: 'c1',
      type: 'callout',
      has_children: true,
      callout: { rich_text: [{ plain_text: 'この問いへの答え', annotations: { color: 'default' } }] },
    }
    const notion = {
      blocks: {
        children: {
          list: async ({ block_id }: { block_id: string }) => ({
            results: block_id === 'p1' ? [calloutBlock] : [marked],
            has_more: false,
            next_cursor: null,
          }),
        },
      },
    }
    const records = [rec('personal_p1')]
    await attachClozeData(records, { personal: notion }, emptyIndex)
    const cloze = (records[0] as { cloze?: { blocks: { heading: string | null }[] } }).cloze
    expect(cloze?.blocks[0]?.heading).toBe('この問いへの答え')
  })
})

describe('tallyBlockTypes / typeCounts（Phase 0 ブロックタイプ分布）', () => {
  it('取得したブロックのtype別出現数を子まで再帰的に集計する', () => {
    const counts: Record<string, number> = {}
    tallyBlockTypes(
      [
        { type: 'paragraph' },
        { type: 'toggle', children: [{ type: 'paragraph' }, { type: 'code' }] },
        { type: 'paragraph' },
        { notABlock: true },
      ],
      counts,
    )
    expect(counts).toEqual({ paragraph: 3, toggle: 1, code: 1 })
  })

  it('attachClozeDataが本文を読んだページのtypeCountsを返す', async () => {
    const notion = fakeNotion([marked, { type: 'divider' }])
    const records = [rec('personal_p1')]
    const res = await attachClozeData(records, { personal: notion }, emptyIndex)
    expect(res.typeCounts).toEqual({ paragraph: 1, divider: 1 })
  })

  it('未編集（fetchなし）のページは分布に加算されない', async () => {
    const notion = fakeNotion()
    const index = {
      getObjects: async () => ({
        results: [
          {
            objectID: 'personal_p1',
            lastEdited: '2026-08-12T00:00:00Z',
            cloze: { blocks: [], blankCount: 1, truncated: false },
          },
        ],
      }),
    }
    const records = [rec('personal_p1')]
    const res = await attachClozeData(records, { personal: notion }, index)
    expect(res.fetches).toBe(0)
    expect(res.typeCounts).toEqual({})
  })
})
