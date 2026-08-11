import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { getUserMock, adminClientMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  adminClientMock: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock } }),
  createAdminClient: adminClientMock,
}))

import { GET, POST } from '../../app/api/account/profile/route'

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/account/profile', { method: 'POST', body: JSON.stringify(body) }))

// user_settings の薄いスタブ。select→maybeSingle と upsert を記録する。
function settingsStub(occupation: string | null) {
  const upsert = vi.fn(async () => ({ error: null }))
  const stub = {
    from: (table: string) => {
      expect(table).toBe('user_settings')
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: occupation === null ? null : { occupation }, error: null }) }) }),
        upsert,
      }
    },
  }
  return { stub, upsert }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
})

describe('GET /api/account/profile', () => {
  it('未ログインは401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await GET()
    expect(res.status).toBe(401)
  })
  it('登録済みの職種を返す', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    adminClientMock.mockReturnValue(settingsStub('看護師').stub)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ occupation: '看護師' })
  })
  it('未登録は null', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    adminClientMock.mockReturnValue(settingsStub(null).stub)
    const res = await GET()
    expect(await res.json()).toEqual({ occupation: null })
  })
})

describe('POST /api/account/profile', () => {
  it('未ログインは401（DBに触らない）', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await post({ occupation: '医師' })
    expect(res.status).toBe(401)
    expect(adminClientMock).not.toHaveBeenCalled()
  })
  it('リスト外の職種は400', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const res = await post({ occupation: '宇宙飛行士' })
    expect(res.status).toBe(400)
  })
  it('正常保存で ok:true・upsert が呼ばれる', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const { stub, upsert } = settingsStub(null)
    adminClientMock.mockReturnValue(stub)
    const res = await post({ occupation: '薬剤師' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(upsert).toHaveBeenCalledWith({ user_id: 'u1', occupation: '薬剤師' }, { onConflict: 'user_id' })
  })
})
