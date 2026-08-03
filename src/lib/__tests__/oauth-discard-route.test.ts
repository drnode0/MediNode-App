// discard ルート（Finding4・§10b step4）。
// 「このままの接続を続ける」から呼ぶ。何も引き取らず、claimable な行を却下するだけ。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getUserMock, hasFeatureMock, discardClaimableMock, rateLimitMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  hasFeatureMock: vi.fn(),
  discardClaimableMock: vi.fn(),
  rateLimitMock: vi.fn(async () => true),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock } }),
}))
vi.mock('@/lib/supabase/early-access', () => ({ sessionHasFeature: hasFeatureMock }))
vi.mock('@/lib/supabase/oauth-states', () => ({ discardClaimable: discardClaimableMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: rateLimitMock, clientIp: () => '203.0.113.1' }))

import { POST } from '../../app/api/notion/oauth/discard/route'

beforeEach(() => {
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@x.com' } } })
  hasFeatureMock.mockReset().mockResolvedValue(true)
  discardClaimableMock.mockReset().mockResolvedValue(true)
  rateLimitMock.mockReset().mockResolvedValue(true)
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
})

describe('POST /api/notion/oauth/discard', () => {
  it('ログイン済みで機能を持てば discardClaimable を呼び ok:true を返す', async () => {
    const res = await POST()
    const body = await res.json()
    expect(body).toEqual({ ok: true })
    expect(discardClaimableMock).toHaveBeenCalledWith('u1')
  })

  it('未ログインは ok:false（discardClaimableは呼ばない）', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await POST()
    const body = await res.json()
    expect(body).toEqual({ ok: false })
    expect(discardClaimableMock).not.toHaveBeenCalled()
  })

  it('easy_connect を持たないセッションは ok:false', async () => {
    hasFeatureMock.mockResolvedValue(false)
    const res = await POST()
    const body = await res.json()
    expect(body).toEqual({ ok: false })
    expect(discardClaimableMock).not.toHaveBeenCalled()
  })

  it('レート制限を超えたら ok:false のみ（featureチェックには到達しない）', async () => {
    rateLimitMock.mockResolvedValue(false)
    const res = await POST()
    const body = await res.json()
    expect(body).toEqual({ ok: false })
    expect(hasFeatureMock).not.toHaveBeenCalled()
    expect(discardClaimableMock).not.toHaveBeenCalled()
    expect(rateLimitMock).toHaveBeenCalledWith(expect.stringContaining('u1'), expect.any(Number), expect.any(Number))
  })

  it('Supabaseのenvが未設定ならok:falseで何も読み書きしない', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const res = await POST()
    const body = await res.json()
    expect(body).toEqual({ ok: false })
    expect(getUserMock).not.toHaveBeenCalled()
  })

  it('discardClaimableがfalseを返せばok:false', async () => {
    discardClaimableMock.mockResolvedValue(false)
    const res = await POST()
    const body = await res.json()
    expect(body).toEqual({ ok: false })
  })
})
