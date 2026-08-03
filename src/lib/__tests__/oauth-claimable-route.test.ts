// claimable ルート。「引き取れる接続があるか」だけを返す・トークンは絶対に含めない。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getUserMock, hasFeatureMock, findClaimableMock, cryptoReadyMock, rateLimitMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  hasFeatureMock: vi.fn(),
  findClaimableMock: vi.fn(),
  cryptoReadyMock: vi.fn(() => true),
  rateLimitMock: vi.fn(async () => true),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock } }),
}))
vi.mock('@/lib/supabase/early-access', () => ({ sessionHasFeature: hasFeatureMock }))
vi.mock('@/lib/supabase/oauth-states', () => ({ findClaimable: findClaimableMock }))
vi.mock('@/lib/crypto', () => ({ isCryptoReady: cryptoReadyMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: rateLimitMock, clientIp: () => '203.0.113.1' }))

import { GET } from '../../app/api/notion/oauth/claimable/route'

const TOKEN_JSON = JSON.stringify({ accessToken: 'ntn_secret_should_never_leak', workspaceName: 'WS' })
const claimRow = {
  state: 'st', user_id: 'u1', status: 'completed' as const,
  token_enc: `enc:${TOKEN_JSON}`, created_at: 'x', completed_at: 'y',
}

beforeEach(() => {
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@x.com' } } })
  hasFeatureMock.mockReset().mockResolvedValue(true)
  findClaimableMock.mockReset().mockResolvedValue(null)
  cryptoReadyMock.mockReset().mockReturnValue(true)
  rateLimitMock.mockReset().mockResolvedValue(true)
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
})

describe('GET /api/notion/oauth/claimable', () => {
  it('未ログインは claimable:false（本文にトークンを含まない）', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await GET()
    const body = await res.json()
    expect(body.claimable).toBe(false)
    expect(JSON.stringify(body)).not.toContain('ntn_secret_should_never_leak')
  })

  it('easy_connect を持たないセッションは claimable:false', async () => {
    hasFeatureMock.mockResolvedValue(false)
    const res = await GET()
    const body = await res.json()
    expect(body.claimable).toBe(false)
    expect(hasFeatureMock).toHaveBeenCalledWith('easy_connect')
    expect(findClaimableMock).not.toHaveBeenCalled()
  })

  it('引き取れるものが無ければ claimable:false', async () => {
    findClaimableMock.mockResolvedValue(null)
    const res = await GET()
    const body = await res.json()
    expect(body.claimable).toBe(false)
    expect(findClaimableMock).toHaveBeenCalledWith('u1', expect.any(Number))
  })

  it('引き取れるものがあれば claimable:true（トークン本体は含めない）', async () => {
    findClaimableMock.mockResolvedValue(claimRow)
    const res = await GET()
    const body = await res.json()
    expect(body.claimable).toBe(true)
    expect(JSON.stringify(body)).not.toContain('ntn_secret_should_never_leak')
    expect(Object.keys(body)).toEqual(['claimable'])
  })

  it('Finding2: レート制限を超えたらclaimable:falseのみを返す（reasonフィールドを持たず、feature無しの応答と見分けが付かない）', async () => {
    rateLimitMock.mockResolvedValue(false)
    const res = await GET()
    const body = await res.json()
    expect(body).toEqual({ claimable: false })
    expect(Object.keys(body)).toEqual(['claimable'])
    expect(findClaimableMock).not.toHaveBeenCalled()
    // feature判定より先にレート制限で弾かれるため、sessionHasFeatureにすら到達しない。
    expect(hasFeatureMock).not.toHaveBeenCalled()
    expect(rateLimitMock).toHaveBeenCalledWith(expect.stringContaining('u1'), expect.any(Number), expect.any(Number))
  })

  it('Finding2: featureを持たない呼び出し元も、feature判定の前にレート制限のバケットを消費する', async () => {
    hasFeatureMock.mockResolvedValue(false)
    await GET()
    expect(rateLimitMock).toHaveBeenCalledWith(expect.stringContaining('u1'), expect.any(Number), expect.any(Number))
    const rateLimitOrder = rateLimitMock.mock.invocationCallOrder[0]
    const hasFeatureOrder = hasFeatureMock.mock.invocationCallOrder[0]
    expect(rateLimitOrder).toBeLessThan(hasFeatureOrder)
  })

  it('Supabaseのenvが未設定ならclaimable:falseで何も読み書きしない', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const res = await GET()
    const body = await res.json()
    expect(body.claimable).toBe(false)
    expect(getUserMock).not.toHaveBeenCalled()
  })

  it('コメント是正: service role key未設定でもclaimable:false（findClaimableはservice roleを使うため、claimと同じ判定式にする）', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const res = await GET()
    const body = await res.json()
    expect(body.claimable).toBe(false)
    expect(getUserMock).not.toHaveBeenCalled()
  })

  it('crypto未準備なら、引き取れる行があってもclaimable:false（claimが即失敗するため）', async () => {
    cryptoReadyMock.mockReturnValue(false)
    findClaimableMock.mockResolvedValue(claimRow)
    const res = await GET()
    const body = await res.json()
    expect(body.claimable).toBe(false)
    expect(getUserMock).not.toHaveBeenCalled()
  })
})
