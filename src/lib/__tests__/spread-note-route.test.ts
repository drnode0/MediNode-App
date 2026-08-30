import { describe, it, expect, vi, beforeEach } from 'vitest'

const { adminMock, notionCtor, queryMock, createMock, appendMock } = vi.hoisted(() => ({
  adminMock: vi.fn(),
  notionCtor: vi.fn(),
  queryMock: vi.fn(),
  createMock: vi.fn(),
  appendMock: vi.fn(),
}))
vi.mock('@/lib/admin-guard', () => ({ requireAdmin: adminMock }))
vi.mock('@/lib/admin-audit', () => ({ logAdminAction: vi.fn(async () => {}) }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: vi.fn(() => ({})) }))
vi.mock('@notionhq/client', () => ({
  Client: class {
    databases = { query: queryMock }
    pages = { create: createMock }
    blocks = { children: { append: appendMock, list: vi.fn() } }
    constructor(a: unknown) { notionCtor(a) }
  },
}))

import { POST } from '../../app/api/admin/spread/note/route'

const PAGE = '3cbfd7567370814185e3da90f1864550'
const post = (body: unknown) =>
  POST(new Request('http://localhost/api/admin/spread/note', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SUBSCRIPTION_SPREAD_NOTES_DB = 'notesdb'
  process.env.SUBSCRIPTION_NOTION_TOKEN = 'tok'
  adminMock.mockResolvedValue({ ok: true, email: 'owner@example.com' })
  queryMock.mockResolvedValue({ results: [], has_more: false, next_cursor: null })
  createMock.mockResolvedValue({ id: 'new-note-page' })
  appendMock.mockResolvedValue({})
})

describe('POST /api/admin/spread/note', () => {
  it('オーナーでなければ弾かれ、Notionに触らない', async () => {
    adminMock.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) })
    const res = await post({ pageId: PAGE, text: 'あ' })
    expect(res.status).toBe(403)
    expect(notionCtor).not.toHaveBeenCalled()
  })

  it('空文字は400（空行をノートに増やさない）', async () => {
    const res = await post({ pageId: PAGE, text: '   ' })
    expect(res.status).toBe(400)
    expect(appendMock).not.toHaveBeenCalled()
  })

  it('page_idが32桁hexでなければ400', async () => {
    const res = await post({ pageId: 'not-a-page', text: 'あ' })
    expect(res.status).toBe(400)
  })

  it('長すぎる文は400（貼り間違いを止める）', async () => {
    const res = await post({ pageId: PAGE, text: 'あ'.repeat(2001) })
    expect(res.status).toBe(400)
    expect(appendMock).not.toHaveBeenCalled()
  })

  it('ノートが無ければ作り、タイトルにpage_idを含める', async () => {
    const res = await post({ pageId: PAGE, text: '解説の文。', title: '📚 急性呼吸不全 Essentials' })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, created: true })
    const title = createMock.mock.calls[0][0].properties.名前.title[0].text.content
    expect(title).toContain(PAGE)
    expect(appendMock).toHaveBeenCalledTimes(1)
  })

  it('ノートがあれば作らずに追記する（既存の行は書き換えない）', async () => {
    queryMock.mockResolvedValue({
      results: [{ id: 'existing', properties: { 名前: { type: 'title', title: [{ plain_text: `記事 ${PAGE}` }] } } }],
      has_more: false,
      next_cursor: null,
    })
    const res = await post({ pageId: PAGE, text: '解説の文。' })
    expect(await res.json()).toMatchObject({ ok: true, created: false, notePageId: 'existing' })
    expect(createMock).not.toHaveBeenCalled()
    expect(appendMock.mock.calls[0][0].block_id).toBe('existing')
  })

  it('ハイフンつきのpage_idでも正規化して探す', async () => {
    const res = await post({ pageId: '3cbfd756-7370-8141-85e3-da90f1864550', text: 'あ' })
    expect(res.status).toBe(200)
    const title = createMock.mock.calls[0][0].properties.名前.title[0].text.content
    expect(title).toContain(PAGE)
  })
})
