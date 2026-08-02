// /api/admin/ledger PATCH の機能トグル分岐のテスト。
// 現在の配列に対して足す／外すが正しく効き、既存の earlyAccess 分岐を壊さないことを見る。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { requireAdminMock, getUserByIdMock, maybeSingleMock, upsertMock, logMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  getUserByIdMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  upsertMock: vi.fn(),
  logMock: vi.fn(),
}))

vi.mock('@/lib/admin-guard', () => ({ requireAdmin: requireAdminMock }))
vi.mock('@/lib/admin-audit', () => ({ logAdminAction: logMock }))
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: getUserByIdMock } },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }),
      upsert: upsertMock,
    }),
  }),
}))

import { PATCH } from '../../app/api/admin/ledger/route'
import type { NextRequest } from 'next/server'

const makeReq = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest

beforeEach(() => {
  requireAdminMock.mockReset().mockResolvedValue({ ok: true, email: 'owner@x.com' })
  getUserByIdMock.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 't@x.com' } }, error: null })
  maybeSingleMock.mockReset().mockResolvedValue({ data: { early_access_features: [] }, error: null })
  upsertMock.mockReset().mockResolvedValue({ error: null })
  logMock.mockReset().mockResolvedValue(undefined)
})

describe('PATCH /api/admin/ledger（機能トグル）', () => {
  it('enabled=true で機能を足す', async () => {
    const res = await PATCH(makeReq({ userId: 'u1', feature: 'easy_connect', enabled: true }))
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.features).toEqual(['easy_connect'])
    expect(upsertMock.mock.calls[0][0]).toEqual({ user_id: 'u1', early_access_features: ['easy_connect'] })
    expect(logMock.mock.calls[0][1].action).toBe('grant_feature:easy_connect')
  })

  it('enabled=false で機能を外す（他の機能は残す）', async () => {
    maybeSingleMock.mockResolvedValue({ data: { early_access_features: ['easy_connect', 'tower'] }, error: null })
    const res = await PATCH(makeReq({ userId: 'u1', feature: 'easy_connect', enabled: false }))
    const data = await res.json()
    expect(data.features).toEqual(['tower'])
    expect(logMock.mock.calls[0][1].action).toBe('revoke_feature:easy_connect')
  })

  it('二重に足しても重複しない', async () => {
    maybeSingleMock.mockResolvedValue({ data: { early_access_features: ['tower'] }, error: null })
    const res = await PATCH(makeReq({ userId: 'u1', feature: 'tower', enabled: true }))
    expect((await res.json()).features).toEqual(['tower'])
  })

  it('未知の機能名は400', async () => {
    const res = await PATCH(makeReq({ userId: 'u1', feature: 'nope', enabled: true }))
    expect(res.status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('存在しないユーザーは404', async () => {
    getUserByIdMock.mockResolvedValue({ data: null, error: { message: 'not found' } })
    const res = await PATCH(makeReq({ userId: 'u9', feature: 'tower', enabled: true }))
    expect(res.status).toBe(404)
  })

  it('userId が無ければ400', async () => {
    const res = await PATCH(makeReq({ feature: 'tower', enabled: true }))
    expect(res.status).toBe(400)
  })
})
