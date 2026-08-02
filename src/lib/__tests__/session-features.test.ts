// セッションから先行体験の機能一覧を引く関数のテスト。
// 列未適用（select が error を返す）でも early_access だけで続行することを確かめる。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { getUserMock, maybeSingleMock, selectSpy } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  selectSpy: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: (cols: string) => {
        selectSpy(cols)
        return { eq: () => ({ maybeSingle: maybeSingleMock }) }
      },
    }),
  }),
}))

import { getSessionFeatures, sessionHasFeature, getSessionEarlyAccess } from '../supabase/early-access'

const ENV = { ...process.env }

beforeEach(() => {
  getUserMock.mockReset()
  maybeSingleMock.mockReset()
  selectSpy.mockReset()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
  delete process.env.MULTI_DEPARTMENT_GA
  delete process.env.TOWER_GA
  delete process.env.EASY_CONNECT_GA
  delete process.env.EARLY_ACCESS_EMAILS
  delete process.env.EASY_CONNECT_EMAILS
})
afterEach(() => { process.env = { ...ENV } })

describe('getSessionFeatures', () => {
  it('未ログインなら空配列', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    expect(await getSessionFeatures()).toEqual([])
  })

  it('台帳の配列をそのまま機能として返す', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@x.com' } } })
    maybeSingleMock.mockResolvedValue({
      data: { early_access: false, early_access_features: ['easy_connect'] },
      error: null,
    })
    expect(await getSessionFeatures()).toEqual(['easy_connect'])
  })

  it('レガシー early_access=true はマルチ部署と知の塔として読む', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@x.com' } } })
    maybeSingleMock.mockResolvedValue({
      data: { early_access: true, early_access_features: [] },
      error: null,
    })
    expect(await getSessionFeatures()).toEqual(['multi_department', 'tower'])
  })

  it('列未適用（1回目のselectがerror）でも early_access だけで続行する', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@x.com' } } })
    maybeSingleMock
      .mockResolvedValueOnce({ data: null, error: { message: 'column does not exist' } })
      .mockResolvedValueOnce({ data: { early_access: true }, error: null })
    expect(await getSessionFeatures()).toEqual(['multi_department', 'tower'])
    expect(selectSpy).toHaveBeenNthCalledWith(1, 'early_access, early_access_features')
    expect(selectSpy).toHaveBeenNthCalledWith(2, 'early_access')
  })

  it('GA env が立っていればDBを引かずに返す', async () => {
    process.env.EASY_CONNECT_GA = 'true'
    getUserMock.mockResolvedValue({ data: { user: null } })
    expect(await getSessionFeatures()).toEqual(['easy_connect'])
  })
})

describe('sessionHasFeature', () => {
  it('該当機能があれば true', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@x.com' } } })
    maybeSingleMock.mockResolvedValue({
      data: { early_access: false, early_access_features: ['easy_connect'] },
      error: null,
    })
    expect(await sessionHasFeature('easy_connect')).toBe(true)
    expect(await sessionHasFeature('tower')).toBe(false)
  })
})

describe('getSessionEarlyAccess（既存APIの維持）', () => {
  it('レガシー true でそのまま true', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@x.com' } } })
    maybeSingleMock.mockResolvedValue({
      data: { early_access: true, early_access_features: [] },
      error: null,
    })
    expect(await getSessionEarlyAccess()).toBe(true)
  })
})
