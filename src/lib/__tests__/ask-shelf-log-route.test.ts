import { describe, it, expect, vi, beforeEach } from 'vitest'

const state = { feature: true, user: { id: 'u1' } as { id: string } | null, updates: [] as Record<string, unknown>[], eqs: [] as unknown[][] }

vi.mock('@/lib/supabase/early-access', () => ({ sessionHasFeature: async () => state.feature }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user } }) } }),
  createAdminClient: () => ({
    from: () => {
      const q: Record<string, unknown> = {
        update: (v: Record<string, unknown>) => { state.updates.push(v); return q },
        eq: (col: string, val: unknown) => { state.eqs.push([col, val]); return q },
        then: (r: (v: { error: null }) => void) => r({ error: null }),
      }
      return q
    },
  }),
}))

const { POST } = await import('@/app/api/ask-shelf/log/route')
const call = (body: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => { state.feature = true; state.user = { id: 'u1' }; state.updates = []; state.eqs = [] })

describe('POST /api/ask-shelf/log', () => {
  it('フラグが閉じていれば404', async () => {
    state.feature = false
    expect((await call({ logId: 1 })).status).toBe(404)
  })
  it('依頼に進んだことを記録する', async () => {
    expect((await call({ logId: 1 })).status).toBe(200)
    expect(state.updates[0]).toEqual({ submitted: true })
  })
  it('他人の記録は更新できない（user_id で必ず絞る）', async () => {
    await call({ logId: 1 })
    expect(state.eqs).toContainEqual(['user_id', 'u1'])
  })
  it('logId が数値でなければ400', async () => {
    expect((await call({ logId: 'x' })).status).toBe(400)
  })
})
