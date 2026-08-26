import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireAdmin = vi.fn()
const upsert = vi.fn()
const notionRetrieve = vi.fn()
const logAdminAction = vi.fn()
const revalidateSubscriptionReaderDocs = vi.fn()

vi.mock('@/lib/admin-guard', () => ({ requireAdmin: () => requireAdmin() }))
vi.mock('@/lib/admin-audit', () => ({ logAdminAction }))
vi.mock('@/lib/reader-cache', () => ({ revalidateSubscriptionReaderDocs }))
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({ from: () => ({ upsert, select: () => ({ order: () => ({ data: [], error: null }) }) }) }),
}))
vi.mock('@/lib/notion-page', () => ({
  fetchPageBlocks: async () => [
    { id: 'b1', type: 'heading_2', heading_2: { rich_text: [{ plain_text: '1. 見出し' }] } },
    { id: 'b2', type: 'paragraph', paragraph: { rich_text: [{ plain_text: '本文。' }] } },
  ],
}))
vi.mock('@notionhq/client', () => ({
  Client: class { pages = { retrieve: (...a: unknown[]) => notionRetrieve(...a) } },
}))

const { PUT } = await import('../../app/api/admin/spread/route')

const req = (body: unknown) =>
  new Request('http://localhost/api/admin/spread', { method: 'PUT', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SUBSCRIPTION_NOTION_TOKEN = 'tok'
  requireAdmin.mockResolvedValue({ ok: true, email: 'owner@example.com' })
  notionRetrieve.mockResolvedValue({ last_edited_time: '2026-08-20T00:00:00.000Z', properties: {} })
  upsert.mockResolvedValue({ error: null })
})

describe('PUT /api/admin/spread', () => {
  it('管理者でなければ弾く', async () => {
    const { NextResponse } = await import('next/server')
    requireAdmin.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) })
    const res = await PUT(req({ pageId: 'p1' }))
    expect(res.status).toBe(403)
  })

  it('原本から誌面を組んで保存する', async () => {
    const res = await PUT(req({ pageId: 'p1' }))
    expect(res.status).toBe(200)
    const saved = upsert.mock.calls[0][0]
    expect(saved.page_id).toBe('p1')
    expect(saved.status).toBe('draft')
    expect(saved.spread_doc.sections).toHaveLength(1)
    expect(saved.source_last_edited).toBe('2026-08-20T00:00:00.000Z')

    // 監査ログが呼ばれ、action が 'put_spread' であること
    expect(logAdminAction).toHaveBeenCalled()
    const auditCall = logAdminAction.mock.calls[0]
    expect(auditCall[1].action).toBe('put_spread')
    // pageId が detail に入り、targetUserId には入らないこと
    expect(auditCall[1].detail.pageId).toBe('p1')
    expect(auditCall[1].targetUserId).toBeUndefined()

    // キャッシュ失効が呼ばれたこと
    expect(revalidateSubscriptionReaderDocs).toHaveBeenCalled()
  })

  it('publish: true なら公開状態で保存する', async () => {
    await PUT(req({ pageId: 'p1', publish: true }))
    expect(upsert.mock.calls[0][0].status).toBe('published')
    // action が 'publish_spread' になることを確認
    const auditCall = logAdminAction.mock.calls[0]
    expect(auditCall[1].action).toBe('publish_spread')
  })

  it('原本に無い文を含むオーバレイは400で拒否する', async () => {
    const res = await PUT(req({
      pageId: 'p1',
      overlay: { parts: { '1': { kind: 'bignumber', value: '99%', caption: [{ text: '原本に無い文。' }] } } },
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('verbatim_mismatch')
    expect(body.missing).toContain('原本に無い文。')
    expect(upsert).not.toHaveBeenCalled()
    // 拒否されたときは監査ログとキャッシュ失効は呼ばれない
    expect(logAdminAction).not.toHaveBeenCalled()
    expect(revalidateSubscriptionReaderDocs).not.toHaveBeenCalled()
  })
})
