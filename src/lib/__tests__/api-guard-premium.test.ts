import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { requirePremiumRequest } from '../api-guard'

// リーダー本文・画像のルートは「ログイン確認」と「プレミアム判定」を続けて呼んでおり、
// どちらも supabase.auth.getUser() を叩いていた。getUser() は getSession() と違い
// 毎回認証サーバーへ出る仕様なので、この重複はそのまま待ち時間になる。
// requirePremiumRequest は1回のセッション解決で 401/403 の両方を決める。

const ORIGINAL = process.env.REQUIRE_LOGIN
beforeEach(() => { process.env.REQUIRE_LOGIN = 'true' })
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.REQUIRE_LOGIN
  else process.env.REQUIRE_LOGIN = ORIGINAL
})

const user = { id: 'u1', email: 'a@x.test' }

describe('requirePremiumRequest', () => {
  it('セッション解決は1リクエストにつき1回だけ', async () => {
    const getUser = vi.fn(async () => user)
    await requirePremiumRequest({ getUser, getStatus: async () => true, adminEmails: [] })
    expect(getUser).toHaveBeenCalledTimes(1)
  })

  it('プレミアムなら通し、userId を返す', async () => {
    const r = await requirePremiumRequest({
      getUser: async () => user, getStatus: async () => true, adminEmails: [],
    })
    expect(r.denied).toBeNull()
    expect(r.userId).toBe('u1')
  })

  it('REQUIRE_LOGIN=true で未ログインなら 401', async () => {
    const r = await requirePremiumRequest({
      getUser: async () => null, getStatus: async () => false, adminEmails: [],
    })
    expect(r.denied?.status).toBe(401)
  })

  it('ログイン済みでも非プレミアムなら 403', async () => {
    const r = await requirePremiumRequest({
      getUser: async () => user, getStatus: async () => false, adminEmails: [],
    })
    expect(r.denied?.status).toBe(403)
  })

  it('管理者は契約が無くても通る', async () => {
    const r = await requirePremiumRequest({
      getUser: async () => ({ id: 'u9', email: 'owner@x.test' }),
      getStatus: async () => false,
      adminEmails: ['owner@x.test'],
    })
    expect(r.denied).toBeNull()
  })

  it('REQUIRE_LOGIN が false のときも、非プレミアムは 403 のまま', async () => {
    process.env.REQUIRE_LOGIN = 'false'
    const r = await requirePremiumRequest({
      getUser: async () => null, getStatus: async () => false, adminEmails: [],
    })
    expect(r.denied?.status).toBe(403)
  })
})
