// attachClozeData（個人・部署syncの穴埋め後付けパス）のテスト。
// レート対策3点: 候補限定 / 未編集は前回引き継ぎ / 上限40。
import { describe, it, expect } from 'vitest'
import { attachClozeData, isClozeCandidate, CLOZE_FETCH_MAX } from '@/lib/cloze-sync'

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
