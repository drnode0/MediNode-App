import { describe, it, expect, vi, beforeEach } from 'vitest'

const { retrieveMock, listMock, premiumMock } = vi.hoisted(() => ({
  retrieveMock: vi.fn(), listMock: vi.fn(), premiumMock: vi.fn(),
}))

vi.mock('@notionhq/client', () => ({
  Client: class { pages = { retrieve: retrieveMock }; blocks = { children: { list: listMock } } },
}))
vi.mock('@/lib/premium-access', () => ({ resolveRequestPremium: premiumMock }))

import { GET } from '../../app/api/subscription/thumbnail/route'
import { NextRequest } from 'next/server'

const req = (id?: string) =>
  new NextRequest(`http://localhost/api/subscription/thumbnail${id != null ? `?id=${id}` : ''}`)

beforeEach(() => {
  retrieveMock.mockReset(); listMock.mockReset(); premiumMock.mockReset()
  process.env.SUBSCRIPTION_NOTION_TOKEN = 'ntn_test'
})

describe('GET /api/subscription/thumbnail', () => {
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

  it('会員 + cover ありは 302 で Location にカバーURL', async () => {
    premiumMock.mockResolvedValue({ premium: true })
    retrieveMock.mockResolvedValue({
      last_edited_time: '2026-07-20T00:00:00.000Z',
      icon: { type: 'emoji', emoji: '💡' },
      cover: { type: 'file', file: { url: 'https://notion.so/signed/cover.png' } },
      properties: { 名前: { type: 'title', title: [{ plain_text: 'T', annotations: {} }] } },
    })
    listMock.mockResolvedValue({ results: [], has_more: false, next_cursor: null })
    const res = await GET(req('subscription_PAGEID'))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://notion.so/signed/cover.png')
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=600')
  })

  it('会員 + cover 無し + 先頭imageブロックありはそのURLへ302', async () => {
    premiumMock.mockResolvedValue({ premium: true })
    retrieveMock.mockResolvedValue({
      last_edited_time: '2026-07-20T00:00:00.000Z',
      icon: null,
      cover: null,
      properties: { 名前: { type: 'title', title: [{ plain_text: 'T', annotations: {} }] } },
    })
    listMock.mockResolvedValue({
      results: [
        { id: 'b1', type: 'paragraph', has_children: false, paragraph: { rich_text: [{ plain_text: 'x', annotations: {} }] } },
        { id: 'b2', type: 'image', has_children: false, image: { type: 'file', file: { url: 'https://notion.so/signed/first-image.png' } } },
      ],
      has_more: false, next_cursor: null,
    })
    const res = await GET(req('PAGEID'))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://notion.so/signed/first-image.png')
  })

  it('会員 + cover も image も無ければ 404', async () => {
    premiumMock.mockResolvedValue({ premium: true })
    retrieveMock.mockResolvedValue({
      last_edited_time: '2026-07-20T00:00:00.000Z',
      icon: null,
      cover: null,
      properties: { 名前: { type: 'title', title: [{ plain_text: 'T', annotations: {} }] } },
    })
    listMock.mockResolvedValue({
      results: [{ id: 'b1', type: 'paragraph', has_children: false, paragraph: { rich_text: [{ plain_text: 'x', annotations: {} }] } }],
      has_more: false, next_cursor: null,
    })
    const res = await GET(req('PAGEID'))
    expect(res.status).toBe(404)
  })

  it('subscription_ 接頭辞を剥がしてから pages.retrieve を呼ぶ', async () => {
    premiumMock.mockResolvedValue({ premium: true })
    retrieveMock.mockResolvedValue({
      last_edited_time: '2026-07-20T00:00:00.000Z',
      icon: null,
      cover: { type: 'file', file: { url: 'https://notion.so/signed/cover.png' } },
      properties: { 名前: { type: 'title', title: [{ plain_text: 'T', annotations: {} }] } },
    })
    listMock.mockResolvedValue({ results: [], has_more: false, next_cursor: null })
    await GET(req('subscription_PAGEID'))
    expect(retrieveMock).toHaveBeenCalledWith({ page_id: 'PAGEID' })
  })
})
