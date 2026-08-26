import { describe, it, expect, vi, beforeEach } from 'vitest'

const { retrieveMock, listMock, guardMock } = vi.hoisted(() => ({
  retrieveMock: vi.fn(), listMock: vi.fn(), guardMock: vi.fn(),
}))

vi.mock('@notionhq/client', () => ({
  Client: class { pages = { retrieve: retrieveMock }; blocks = { children: { list: listMock } } },
}))
// ルートは認証と権限を requirePremiumRequest の1回で判定する（getUser の往復を減らすため）。
// ガード自体の挙動は api-guard-premium.test.ts が受け持つ。ここは通す／弾くだけを差し替える。
vi.mock('@/lib/api-guard', () => ({ requirePremiumRequest: guardMock }))
const allow = () => guardMock.mockResolvedValue({ denied: null, userId: 'u1', email: 'a@x.test' })
const deny = (status: number) =>
  guardMock.mockResolvedValue({ denied: NextResponse.json({ error: 'x' }, { status }), userId: null })
// テスト環境にはNextのincremental cache実体がないため、unstable_cacheは素通しにする
// （キャッシュ層の有無に依らずルートのロジックを検証する）。
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))

import { GET } from '../../app/api/subscription/page/route'
import { NextRequest, NextResponse } from 'next/server'

const req = (id?: string) =>
  new NextRequest(`http://localhost/api/subscription/page${id != null ? `?id=${id}` : ''}`)

beforeEach(() => {
  retrieveMock.mockReset(); listMock.mockReset(); guardMock.mockReset()
  allow()
  process.env.SUBSCRIPTION_NOTION_TOKEN = 'ntn_test'
})

describe('GET /api/subscription/page', () => {
  it('id 未指定は 400', async () => {
    allow()
    const res = await GET(req())
    expect(res.status).toBe(400)
  })

  it('非会員は 403（本文を取得しない）', async () => {
    deny(403)
    const res = await GET(req('abc123'))
    expect(res.status).toBe(403)
    expect(retrieveMock).not.toHaveBeenCalled()
    expect(listMock).not.toHaveBeenCalled()
  })

  it('会員は 200 で doc を返し subscription_ 接頭辞を剥がす', async () => {
    allow()
    retrieveMock.mockResolvedValue({
      last_edited_time: '2026-07-20T00:00:00.000Z',
      icon: { type: 'emoji', emoji: '💡' }, cover: null,
      properties: { 名前: { type: 'title', title: [{ plain_text: 'T', annotations: {} }] } },
    })
    listMock.mockResolvedValue({
      results: [{ id: 'b1', type: 'heading_2', has_children: false, heading_2: { rich_text: [{ plain_text: 'H', annotations: {} }] } }],
      has_more: false, next_cursor: null,
    })
    const res = await GET(req('subscription_PAGEID'))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(retrieveMock).toHaveBeenCalledWith({ page_id: 'PAGEID' })
    expect(data.doc.title).toBe('T')
    expect(data.doc.blocks[0]).toEqual({ kind: 'heading', level: 2, inlines: [{ text: 'H' }], blockId: 'b1' })
    expect(res.headers.get('Cache-Control')).toContain('max-age=600')
  })

  it('会員は 200 で doc を返し #secN サフィックスも剥がす（節objectIDが渡った場合の保険）', async () => {
    allow()
    retrieveMock.mockResolvedValue({
      last_edited_time: '2026-07-20T00:00:00.000Z',
      icon: { type: 'emoji', emoji: '💡' }, cover: null,
      properties: { 名前: { type: 'title', title: [{ plain_text: 'T', annotations: {} }] } },
    })
    listMock.mockResolvedValue({ results: [], has_more: false, next_cursor: null })
    const res = await GET(req('subscription_PAGEID#sec3'))
    expect(res.status).toBe(200)
    expect(retrieveMock).toHaveBeenCalledWith({ page_id: 'PAGEID' })
  })

  it('トークン未設定は 500', async () => {
    allow()
    delete process.env.SUBSCRIPTION_NOTION_TOKEN
    const res = await GET(req('abc'))
    expect(res.status).toBe(500)
  })
})
