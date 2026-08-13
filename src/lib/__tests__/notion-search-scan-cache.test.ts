// シンプルモード検索（/api/notion/search）の走査キャッシュのテスト。
// 見るのは「Notionを何回叩いたか」と「結果が従来と変わらないか」の2点。
//
// キャッシュはモジュール階層に持つため、テストごとに別トークンを使って隔離する
// （鍵にトークンのハッシュが入るので、これでエントリが分かれる）。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { guardMock, queryMock } = vi.hoisted(() => ({
  guardMock: vi.fn(),
  queryMock: vi.fn(),
}))
vi.mock('@/lib/api-guard', () => ({ requireSessionIfLoginRequired: guardMock }))
vi.mock('@/lib/supabase/early-access', () => ({
  getSessionEarlyAccess: vi.fn(async () => ({ earlyAccess: false, features: [] })),
}))
vi.mock('@notionhq/client', () => ({
  Client: class {
    databases = { query: queryMock }
  },
}))

import { POST } from '../../app/api/notion/search/route'
import type { NextRequest } from 'next/server'

const makeReq = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest

const page = (id: string, title: string) => ({
  object: 'page',
  id,
  url: `https://notion.so/${id}`,
  last_edited_time: '2026-08-01T00:00:00.000Z',
  created_time: '2026-08-01T00:00:00.000Z',
  properties: { 名前: { type: 'title', title: [{ plain_text: title }] } },
})

// 1ページ目に敗血症、2ページ目に心不全（既定 pageSize=50 なので、敗血症だけなら
// 1ページ目で打ち切られる＝早期打ち切りが効いている状態を作れる）。
const PAGE1 = Array.from({ length: 100 }, (_, i) => page(`s${i}`, `敗血症のCQ ${i}`))
const PAGE2 = Array.from({ length: 100 }, (_, i) => page(`h${i}`, `心不全のCQ ${i}`))

const search = (keyword: string, token: string) =>
  POST(makeReq({ notionToken: token, notionMedicalDbId: 'db1', keyword }))

beforeEach(() => {
  guardMock.mockReset().mockResolvedValue(null)
  queryMock.mockReset().mockImplementation(({ start_cursor }: { start_cursor?: string }) => {
    if (!start_cursor) return Promise.resolve({ results: PAGE1, has_more: true, next_cursor: 'c2' })
    if (start_cursor === 'c2') return Promise.resolve({ results: PAGE2, has_more: false, next_cursor: null })
    return Promise.resolve({ results: [], has_more: false, next_cursor: null })
  })
})

describe('走査キャッシュ（/api/notion/search）', () => {
  it('取得済みのページで足りる検索は、Notionを叩き直さない', async () => {
    const tok = 'ntn_reuse'
    const first = await (await search('敗血症', tok)).json()
    expect(first.records).toHaveLength(50)
    expect(queryMock.mock.calls.length).toBe(1) // 1ページ目だけで打ち切り

    // 'CQ' も1ページ目だけで50件揃う → 追加取得は不要
    const second = await (await search('CQ', tok)).json()
    expect(second.records).toHaveLength(50)
    expect(queryMock.mock.calls.length).toBe(1)
  })

  it('手元に足りなければ続きのページから読み足す（結果は従来どおり得られる）', async () => {
    const tok = 'ntn_continue'
    await search('敗血症', tok)
    expect(queryMock.mock.calls.length).toBe(1)

    // 心不全は2ページ目にしかない → 続きから読み足して見つける
    const res = await (await search('心不全', tok)).json()
    expect(res.records.length).toBeGreaterThan(0)
    expect(res.records[0].title).toContain('心不全')
    expect(queryMock.mock.calls.length).toBe(2)
    // 2ページ目を読むとき、最初からではなく続きの cursor を渡している
    expect(queryMock.mock.calls[1][0].start_cursor).toBe('c2')
  })

  it('別トークンのキャッシュは共有しない（DB IDだけでは他人の結果を読めない）', async () => {
    await search('敗血症', 'ntn_userA')
    const afterA = queryMock.mock.calls.length
    await search('敗血症', 'ntn_userB')
    expect(queryMock.mock.calls.length).toBeGreaterThan(afterA)
  })

  it('マッチ判定は従来どおり（タイトル・要約・キーワードのAND一致）', async () => {
    const tok = 'ntn_match'
    const hit = await (await search('敗血症 3', tok)).json()
    expect(hit.records.length).toBeGreaterThan(0)
    expect(
      hit.records.every((r: { title: string }) => r.title.includes('敗血症') && r.title.includes('3')),
    ).toBe(true)

    const miss = await (await search('存在しない語', tok)).json()
    expect(miss.records).toEqual([])
  })
})
