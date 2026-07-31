import { describe, it, expect, vi, beforeEach } from 'vitest'

const { requireAdminMock, adminClientMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  adminClientMock: vi.fn(),
}))
vi.mock('@/lib/admin-guard', () => ({ requireAdmin: requireAdminMock }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: adminClientMock }))
// タイトル解決は best-effort（no-op）。
vi.mock('algoliasearch', () => ({
  default: () => ({ initIndex: () => ({ getObjects: async () => ({ results: [] }) }) }),
}))

import { GET } from '../../app/api/admin/cq-ranking/route'

const req = () => new Request('http://localhost/api/admin/cq-ranking')

beforeEach(() => {
  vi.clearAllMocks()
  requireAdminMock.mockResolvedValue({ ok: true, email: 'owner@example.com' })
})

describe('GET /api/admin/cq-ranking', () => {
  it('参照回数ランキングに「役に立った」数を添える', async () => {
    adminClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === 'cq_views') {
          const rows = [
            { object_id: 'a', view_count: 20 },
            { object_id: 'b', view_count: 5 },
          ]
          return { select: () => ({ order: () => ({ limit: async () => ({ data: rows, error: null }) }) }) }
        }
        // cq_reactions: a に2人、b に0人
        return {
          select: () => ({
            in: async () => ({
              data: [
                { object_id: 'a' },
                { object_id: 'a' },
              ],
              error: null,
            }),
          }),
        }
      },
    })
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ready).toBe(true)
    expect(body.items).toEqual([
      { objectID: 'a', title: '', count: 20, helpfulCount: 2 },
      { objectID: 'b', title: '', count: 5, helpfulCount: 0 },
    ])
  })

  it('cq_reactions が未適用でもランキング自体は返す（helpfulCount=0）', async () => {
    adminClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === 'cq_views') {
          const rows = [{ object_id: 'a', view_count: 3 }]
          return { select: () => ({ order: () => ({ limit: async () => ({ data: rows, error: null }) }) }) }
        }
        return { select: () => ({ in: async () => ({ data: null, error: { message: 'no table' } }) }) }
      },
    })
    const body = await (await GET(req())).json()
    expect(body.items).toEqual([{ objectID: 'a', title: '', count: 3, helpfulCount: 0 }])
  })
})
