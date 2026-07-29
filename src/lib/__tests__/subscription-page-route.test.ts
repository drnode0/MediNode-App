import { describe, it, expect, vi, beforeEach } from 'vitest'

const { retrieveMock, listMock, premiumMock, guardMock } = vi.hoisted(() => ({
  retrieveMock: vi.fn(), listMock: vi.fn(), premiumMock: vi.fn(), guardMock: vi.fn(),
}))

vi.mock('@notionhq/client', () => ({
  Client: class { pages = { retrieve: retrieveMock }; blocks = { children: { list: listMock } } },
}))
vi.mock('@/lib/premium-access', () => ({ resolveRequestPremium: premiumMock }))
vi.mock('@/lib/api-guard', () => ({ requireSessionIfLoginRequired: guardMock }))
// テスト環境にはNextのincremental cache実体がないため、unstable_cacheは素通しにする
// （キャッシュ層の有無に依らずルートのロジックを検証する）。
vi.mock('next/cache', () => ({
  unstable_cache: (fn: (...a: unknown[]) => unknown) => fn,
}))

import { GET } from '../../app/api/subscription/page/route'
import { NextRequest } from 'next/server'

const req = (id?: string) =>
  new NextRequest(`http://localhost/api/subscription/page${id != null ? `?id=${id}` : ''}`)

beforeEach(() => {
  retrieveMock.mockReset(); listMock.mockReset(); premiumMock.mockReset(); guardMock.mockReset()
  guardMock.mockResolvedValue(null)
  process.env.SUBSCRIPTION_NOTION_TOKEN = 'ntn_test'
})

describe('GET /api/subscription/page', () => {
  it('id 未指定は 400', async () => {
    premiumMock.mockResolvedValue({ premium: true })
    const res = await GET(req())
    expect(res.status).toBe(400)
  })

  it('非会員は 403（本文を取得しない）', async () => {
    premiumMock.mockResolvedValue({ premium: false })
    const res = await GET(req('abc123'))
    expect(res.status).toBe(403)
    expect(retrieveMock).not.toHaveBeenCalled()
    expect(listMock).not.toHaveBeenCalled()
  })

  it('会員は 200 で doc を返し subscription_ 接頭辞を剥がす', async () => {
    premiumMock.mockResolvedValue({ premium: true })
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
    expect(data.doc.blocks[0]).toEqual({ kind: 'heading', level: 2, inlines: [{ text: 'H' }] })
    expect(res.headers.get('Cache-Control')).toContain('max-age=600')
  })

  it('会員は 200 で doc を返し #secN サフィックスも剥がす（節objectIDが渡った場合の保険）', async () => {
    premiumMock.mockResolvedValue({ premium: true })
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
    premiumMock.mockResolvedValue({ premium: true })
    delete process.env.SUBSCRIPTION_NOTION_TOKEN
    const res = await GET(req('abc'))
    expect(res.status).toBe(500)
  })
})
