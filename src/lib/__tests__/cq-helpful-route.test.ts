import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { premiumMock, adminClientMock } = vi.hoisted(() => ({
  premiumMock: vi.fn(),
  adminClientMock: vi.fn(),
}))
vi.mock('@/lib/premium-access', () => ({ resolveRequestPremium: premiumMock }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: adminClientMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: vi.fn(async () => true) }))

import { POST } from '../../app/api/cq/helpful/route'

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/cq/helpful', { method: 'POST', body: JSON.stringify(body) }))

// from('cq_reactions') の薄いスタブ。upsert / delete の呼び出しを記録し、合計 count を返す。
function reactionsStub(count: number) {
  const upsert = vi.fn(async () => ({ error: null }))
  const deleteEqEq = vi.fn(async () => ({ error: null }))
  const del = vi.fn(() => ({ eq: () => ({ eq: deleteEqEq }) }))
  const stub = {
    from: (table: string) => {
      expect(table).toBe('cq_reactions')
      return {
        upsert,
        delete: del,
        select: () => ({ eq: async () => ({ count }) }),
      }
    },
  }
  return { stub, upsert, del }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
})

describe('POST /api/cq/helpful', () => {
  it('未ログインは401（DBに触らない）', async () => {
    premiumMock.mockResolvedValue({ premium: false, userId: null })
    const res = await post({ objectId: 'k1', helpful: true })
    expect(res.status).toBe(401)
    expect(adminClientMock).not.toHaveBeenCalled()
  })

  it('非プレミアムは403', async () => {
    premiumMock.mockResolvedValue({ premium: false, userId: 'u1' })
    const res = await post({ objectId: 'k1', helpful: true })
    expect(res.status).toBe(403)
  })

  it('objectId なしは400', async () => {
    premiumMock.mockResolvedValue({ premium: true, userId: 'u1' })
    const res = await post({ helpful: true })
    expect(res.status).toBe(400)
  })

  it('helpful=true で upsert し、最新の合計を返す', async () => {
    premiumMock.mockResolvedValue({ premium: true, userId: 'u1' })
    const { stub, upsert } = reactionsStub(4)
    adminClientMock.mockReturnValue(stub)
    const res = await post({ objectId: 'k1', helpful: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, helpful: true, count: 4 })
    expect(upsert).toHaveBeenCalledWith(
      { user_id: 'u1', object_id: 'k1' },
      { onConflict: 'user_id,object_id' },
    )
  })

  it('helpful=false で行を消し、最新の合計を返す', async () => {
    premiumMock.mockResolvedValue({ premium: true, userId: 'u1' })
    const { stub, del } = reactionsStub(2)
    adminClientMock.mockReturnValue(stub)
    const res = await post({ objectId: 'k1', helpful: false })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, helpful: false, count: 2 })
    expect(del).toHaveBeenCalled()
  })
})
