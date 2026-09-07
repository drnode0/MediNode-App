import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { fetchSpreadNotesIndex } from '../spread-notes'

const ID_A = '3cbfd7567370814185e3da90f1864550'
const ID_B = '3b0fd7567370814da58ffdf00a15e8b2'

function client(pages: { title: string }[][], onQuery?: () => void) {
  let call = 0
  return {
    blocks: { children: { list: async () => ({ results: [], has_more: false, next_cursor: null }) } },
    databases: {
      query: async () => {
        onQuery?.()
        const page = pages[call] ?? []
        const hasMore = call < pages.length - 1
        call += 1
        return {
          results: page.map((p, i) => ({
            id: `row${i}`,
            properties: { 名前: { type: 'title', title: [{ plain_text: p.title }] } },
          })),
          has_more: hasMore,
          next_cursor: hasMore ? 'next' : null,
        }
      },
    },
  } as unknown as Parameters<typeof fetchSpreadNotesIndex>[0]
}

beforeEach(() => {
  process.env.SUBSCRIPTION_SPREAD_NOTES_DB = 'notesdb'
})
afterEach(() => {
  delete process.env.SUBSCRIPTION_SPREAD_NOTES_DB
})

describe('fetchSpreadNotesIndex', () => {
  it('タイトルに含まれるIDを集合にする', async () => {
    const idx = await fetchSpreadNotesIndex(client([[{ title: `記事A Essentials ${ID_A}` }, { title: `記事B ${ID_B}` }]]))
    expect(idx).toEqual(new Set([ID_A, ID_B]))
  })

  it('ハイフン付き・大文字で書かれたIDも同じ形にそろえる', async () => {
    const hyphenated = '3cbfd756-7370-8141-85e3-da90f1864550'.toUpperCase()
    const idx = await fetchSpreadNotesIndex(client([[{ title: `記事A ${hyphenated}` }]]))
    expect(idx?.has(ID_A)).toBe(true)
  })

  it('IDを含まないタイトルは何も足さない', async () => {
    const idx = await fetchSpreadNotesIndex(client([[{ title: '見せ方のメモ' }]]))
    expect(idx?.size).toBe(0)
  })

  it('一覧の件数ぶん問い合わせない（1回のクエリで読む）', async () => {
    let calls = 0
    const idx = await fetchSpreadNotesIndex(client([[{ title: `記事A ${ID_A}` }]], () => { calls += 1 }))
    expect(calls).toBe(1)
    expect(idx?.size).toBe(1)
  })

  it('環境変数が無ければ null（判定できなかった）', async () => {
    delete process.env.SUBSCRIPTION_SPREAD_NOTES_DB
    expect(await fetchSpreadNotesIndex(client([[]]))).toBe(null)
  })

  it('取得に失敗したら null。空の集合（＝全部ノート無し）にしない', async () => {
    const broken = {
      blocks: { children: { list: async () => ({ results: [], has_more: false, next_cursor: null }) } },
      databases: { query: async () => { throw new Error('boom') } },
    } as unknown as Parameters<typeof fetchSpreadNotesIndex>[0]
    expect(await fetchSpreadNotesIndex(broken)).toBe(null)
  })
})
