// OAuth start/callback ルートのテスト。state Cookieの往復・未ログイン分岐・
// トークン交換成功時のマージ保存・各エラーのリダイレクト先を検証する。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getUserMock, upsertMock, maybeSingleMock, exchangeMock, decryptMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  upsertMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  exchangeMock: vi.fn(),
  decryptMock: vi.fn((enc: string) => ({ json: enc.replace(/^enc:/, ''), needsReencrypt: false })),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock } }),
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }),
      upsert: upsertMock,
    }),
  }),
}))
vi.mock('@/lib/crypto', () => ({
  isCryptoReady: () => true,
  encryptSettings: (json: string) => `enc:${json}`,
  decryptSettingsDetailed: decryptMock,
}))
vi.mock('@/lib/notion-oauth', async (orig) => ({
  ...(await orig()),
  exchangeCode: exchangeMock,
}))

import { NextRequest } from 'next/server'
import { GET as startGET } from '../../app/api/notion/oauth/start/route'
import { GET as callbackGET } from '../../app/api/notion/oauth/callback/route'
import { STATE_COOKIE } from '../notion-oauth'

const req = (url: string, cookies: Record<string, string> = {}) => {
  const r = new NextRequest(url)
  for (const [k, v] of Object.entries(cookies)) r.cookies.set(k, v)
  return r
}

beforeEach(() => {
  getUserMock.mockReset()
  upsertMock.mockReset().mockResolvedValue({ error: null })
  maybeSingleMock.mockReset()
  exchangeMock.mockReset()
  decryptMock.mockReset().mockImplementation((enc: string) => ({ json: enc.replace(/^enc:/, ''), needsReencrypt: false }))
  process.env.NOTION_OAUTH_CLIENT_ID = 'cid-1'
  process.env.NOTION_OAUTH_CLIENT_SECRET = 'sec-1'
  // かんたん接続は既定OFF（調整中）。以下の本体テストはON前提なので明示的に立てる。
  process.env.NEXT_PUBLIC_EASY_CONNECT = 'on'
})

describe('かんたん接続フラグOFF（調整中）', () => {
  it('start はNotionへ飛ばさずホームへ戻す', async () => {
    delete process.env.NEXT_PUBLIC_EASY_CONNECT
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const res = await startGET(req('https://app.example/api/notion/oauth/start'))
    const loc = res.headers.get('location') || ''
    expect(loc).not.toContain('api.notion.com')
    expect(new URL(loc).pathname).toBe('/')
  })

  it('callback はトークン交換も保存もしない', async () => {
    delete process.env.NEXT_PUBLIC_EASY_CONNECT
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const res = await callbackGET(
      req('https://app.example/api/notion/oauth/callback?code=c1&state=st', { [STATE_COOKIE]: 'st' }),
    )
    expect(new URL(res.headers.get('location') || '').pathname).toBe('/')
    expect(exchangeMock).not.toHaveBeenCalled()
    expect(upsertMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/notion/oauth/start', () => {
  it('未ログインは /?oauthError=login へ302', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await startGET(req('https://app.example/api/notion/oauth/start'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('oauthError=login')
  })

  it('ログイン済みはNotion認可URLへ302し、state Cookieを置く', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const res = await startGET(req('https://app.example/api/notion/oauth/start'))
    const loc = res.headers.get('location') || ''
    expect(loc).toContain('https://api.notion.com/v1/oauth/authorize')
    expect(loc).toContain('client_id=cid-1')
    const state = new URL(loc).searchParams.get('state') || ''
    expect(state.length).toBeGreaterThanOrEqual(16)
    expect(res.cookies.get(STATE_COOKIE)?.value).toBe(state)
  })

  it('env未設定なら /?oauthError=unconfigured へ302', async () => {
    delete process.env.NOTION_OAUTH_CLIENT_ID
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const res = await startGET(req('https://app.example/api/notion/oauth/start'))
    expect(res.headers.get('location')).toContain('oauthError=unconfigured')
  })
})

describe('GET /api/notion/oauth/callback', () => {
  it('state不一致は保存せず /?oauthError=state へ', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const res = await callbackGET(
      req('https://app.example/api/notion/oauth/callback?code=c1&state=WRONG', { [STATE_COOKIE]: 'right' }),
    )
    expect(res.headers.get('location')).toContain('oauthError=state')
    expect(exchangeMock).not.toHaveBeenCalled()
  })

  it('ユーザーが認可を拒否（error=access_denied）なら /?oauthError=denied へ', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const res = await callbackGET(
      req('https://app.example/api/notion/oauth/callback?error=access_denied&state=st', { [STATE_COOKIE]: 'st' }),
    )
    expect(res.headers.get('location')).toContain('oauthError=denied')
  })

  it('成功時は既存設定にマージ保存し /?oauth=notion-done へ（state Cookieは削除）', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    maybeSingleMock.mockResolvedValue({
      data: { settings_enc: 'enc:' + JSON.stringify({ searchMode: 'algolia', algoliaAppId: 'A' }) },
      error: null,
    })
    exchangeMock.mockResolvedValue({
      accessToken: 'ntn_new', workspaceName: 'WS', workspaceId: 'w', botId: 'b', duplicatedTemplateId: null,
    })
    const res = await callbackGET(
      req('https://app.example/api/notion/oauth/callback?code=c1&state=st', { [STATE_COOKIE]: 'st' }),
    )
    expect(res.headers.get('location')).toContain('oauth=notion-done')
    const saved = JSON.parse(String(upsertMock.mock.calls[0][0].settings_enc).replace(/^enc:/, ''))
    expect(saved.notionToken).toBe('ntn_new')
    expect(saved.notionAuthKind).toBe('oauth')
    expect(saved.notionWorkspaceName).toBe('WS')
    expect(saved.algoliaAppId).toBe('A') // 既存設定を潰さない
    expect(res.cookies.get(STATE_COOKIE)?.value).toBe('')
  })

  it('交換失敗は /?oauthError=exchange へ', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    exchangeMock.mockRejectedValue(new Error('invalid_grant'))
    const res = await callbackGET(
      req('https://app.example/api/notion/oauth/callback?code=c1&state=st', { [STATE_COOKIE]: 'st' }),
    )
    expect(res.headers.get('location')).toContain('oauthError=exchange')
  })

  it('既存設定の読み取りがDBエラーなら書き込まず /?oauthError=save へ', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: 'db down' } })
    exchangeMock.mockResolvedValue({
      accessToken: 'ntn_new', workspaceName: 'WS', workspaceId: 'w', botId: 'b', duplicatedTemplateId: null,
    })
    const res = await callbackGET(
      req('https://app.example/api/notion/oauth/callback?code=c1&state=st', { [STATE_COOKIE]: 'st' }),
    )
    expect(res.headers.get('location')).toContain('oauthError=save')
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('既存行の復号に失敗したら書き込まず /?oauthError=save へ（DEFAULTでの上書きを防ぐ）', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    maybeSingleMock.mockResolvedValue({
      data: { settings_enc: 'corrupted' },
      error: null,
    })
    decryptMock.mockImplementation(() => {
      throw new Error('decrypt failed')
    })
    exchangeMock.mockResolvedValue({
      accessToken: 'ntn_new', workspaceName: 'WS', workspaceId: 'w', botId: 'b', duplicatedTemplateId: null,
    })
    const res = await callbackGET(
      req('https://app.example/api/notion/oauth/callback?code=c1&state=st', { [STATE_COOKIE]: 'st' }),
    )
    expect(res.headers.get('location')).toContain('oauthError=save')
    expect(upsertMock).not.toHaveBeenCalled()
  })
})
