import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireAdmin = vi.fn()
const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }))
let rows: unknown[] = []
vi.mock('@/lib/admin-guard', () => ({ requireAdmin: () => requireAdmin() }))
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => ({
      update,
      select: () => { const q = { eq: () => q, neq: () => q, order: () => q, then: (res: (v: unknown) => void) => res({ data: rows, error: null }) }; return q },
    }),
  }),
}))
const { GET, PATCH } = await import('../../app/api/admin/recall/cards/route')

beforeEach(() => { requireAdmin.mockReset(); update.mockClear(); rows = [] })

describe('admin recall cards', () => {
  it('管理者でなければガードの応答を返す', async () => {
    requireAdmin.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) })
    expect((await GET(new Request('http://localhost/api/admin/recall/cards'))).status).toBe(403)
  })
  it('GET は穴を持つ主張だけを返す', async () => {
    requireAdmin.mockResolvedValue({ ok: true, email: 'o@example.com' })
    rows = [
      { claim_id: 'a', page_id: 'p', page_title: 't', body: 'b', holes: [[0, 1]], cloze_status: 'pending', confidence: 'ok', genres: [], genre_slot: 4, active: true },
      { claim_id: 'b', page_id: 'p', page_title: 't', body: 'b', holes: [], cloze_status: 'pending', confidence: 'ok', genres: [], genre_slot: 4, active: true },
    ]
    const json = await (await GET(new Request('http://localhost/api/admin/recall/cards?status=pending'))).json()
    expect(json.cards.map((c: { claimId: string }) => c.claimId)).toEqual(['a'])
  })
  it('PATCH は cloze_status と holes を更新し、不正な値は 400', async () => {
    requireAdmin.mockResolvedValue({ ok: true, email: 'o@example.com' })
    const ok = await PATCH(new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ claimId: 'a', clozeStatus: 'approved', holes: [[0, 2]] }) }))
    expect(ok.status).toBe(200)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ cloze_status: 'approved', holes: [[0, 2]] }))
    const bad = await PATCH(new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ claimId: 'a', clozeStatus: 'maybe' }) }))
    expect(bad.status).toBe(400)
    const tooMany = await PATCH(new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ claimId: 'a', holes: [[0, 1], [2, 3], [4, 5], [6, 7]] }) }))
    expect(tooMany.status).toBe(400)
  })
})
