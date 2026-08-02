// /api/premium/status が features（機能配列）を返すことのテスト。
// 台帳の select が2列とも読める場合と、early_access_features 列が未適用で
// エラーになりフォールバックする場合の両方で、earlyAccess（レガシー）と
// features（新規）が正しく算出されることを確かめる。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { getUserMock, maybeSingleMock, selectSpy, getActiveStatusMock, issueKeyMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  selectSpy: vi.fn(),
  getActiveStatusMock: vi.fn(),
  issueKeyMock: vi.fn(),
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

vi.mock('@/lib/supabase/subscriptions', () => ({
  getActiveStatusByUserId: getActiveStatusMock,
}))

vi.mock('@/lib/algolia-secured', () => ({
  issuePremiumSearchKey: issueKeyMock,
}))

import { GET } from '@/app/api/premium/status/route'

const ENV = { ...process.env }

beforeEach(() => {
  getUserMock.mockReset()
  maybeSingleMock.mockReset()
  selectSpy.mockReset()
  getActiveStatusMock.mockReset()
  issueKeyMock.mockReset()

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
  // GA/許可メール/管理者メールが立っていると台帳の値が結果に埋もれるため、
  // テスト間で漏れないよう毎回消す。
  delete process.env.MULTI_DEPARTMENT_GA
  delete process.env.TOWER_GA
  delete process.env.EASY_CONNECT_GA
  delete process.env.EARLY_ACCESS_EMAILS
  delete process.env.EASY_CONNECT_EMAILS
  delete process.env.COMP_ADMIN_EMAILS

  // 有効契約でない応答（先頭の早期リターン）に倒し、Algolia発行までは踏み込まない。
  getActiveStatusMock.mockResolvedValue({
    active: false,
    status: 'none',
    currentPeriodEnd: null,
    trialEndsAt: null,
    cancelAtPeriodEnd: false,
  })
})

afterEach(() => {
  process.env = { ...ENV }
})

describe('GET /api/premium/status の features', () => {
  it('1回目の select が成功: features に easy_connect を含み earlyAccess は false', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@x.com' } } })
    maybeSingleMock.mockResolvedValue({
      data: { early_access: false, early_access_features: ['easy_connect'] },
      error: null,
    })

    const res = await GET()
    const data = await res.json()

    expect(data.loggedIn).toBe(true)
    expect(data.earlyAccess).toBe(false)
    expect(data.features).toContain('easy_connect')
    expect(selectSpy).toHaveBeenCalledTimes(1)
    expect(selectSpy).toHaveBeenNthCalledWith(1, 'early_access, early_access_features')
  })

  it('1回目の select がエラー（列未適用）: early_access だけで続行し、レガシー機能のみ開く', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@x.com' } } })
    maybeSingleMock
      .mockResolvedValueOnce({ data: null, error: { message: 'column does not exist' } })
      .mockResolvedValueOnce({ data: { early_access: true }, error: null })

    const res = await GET()
    const data = await res.json()

    expect(res.status).toBe(200)
    expect(data.earlyAccess).toBe(true)
    expect(data.features).toContain('multi_department')
    expect(data.features).toContain('tower')
    expect(data.features).not.toContain('easy_connect')
    expect(selectSpy).toHaveBeenNthCalledWith(1, 'early_access, early_access_features')
    expect(selectSpy).toHaveBeenNthCalledWith(2, 'early_access')
  })
})
