// callback ルート（v2）。Cookieもセッションも見ず、state だけを鍵にする。
// 成功してもトークンは user_settings に入らず oauth_states に暗号化して置かれる。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { takePendingMock, markCompletedMock, exchangeMock } = vi.hoisted(() => ({
  takePendingMock: vi.fn(),
  markCompletedMock: vi.fn(),
  exchangeMock: vi.fn(),
}))

vi.mock('@/lib/supabase/oauth-states', () => ({
  takePendingState: takePendingMock,
  markCompleted: markCompletedMock,
}))
vi.mock('@/lib/crypto', () => ({
  isCryptoReady: () => true,
  encryptSettings: (json: string) => `enc:${json}`,
}))
vi.mock('@/lib/notion-oauth', async (orig) => ({
  ...(await orig()),
  exchangeCode: exchangeMock,
}))

import { NextRequest } from 'next/server'
import { GET } from '../../app/api/notion/oauth/callback/route'

const req = (qs: string) => new NextRequest(`https://app.example/api/notion/oauth/callback?${qs}`)
const loc = (res: Response) => new URL(res.headers.get('location') || '')

const ROW = {
  state: 'st', user_id: 'u1', status: 'pending' as const,
  token_enc: null, created_at: '2026-08-02T00:00:00.000Z', completed_at: null,
}
const TOKEN = {
  accessToken: 'ntn_new', workspaceName: 'WS', workspaceId: 'w', botId: 'b', duplicatedTemplateId: null,
}

beforeEach(() => {
  takePendingMock.mockReset().mockResolvedValue(ROW)
  markCompletedMock.mockReset().mockResolvedValue(true)
  exchangeMock.mockReset().mockResolvedValue(TOKEN)
  process.env.NOTION_OAUTH_CLIENT_ID = 'cid'
  process.env.NOTION_OAUTH_CLIENT_SECRET = 'sec'
})

describe('GET /api/notion/oauth/callback（v2）', () => {
  it('成功時はトークンを暗号化してstateへ置き、完了ページへ送る', async () => {
    const res = await GET(req('code=c1&state=st'))
    const url = loc(res)
    expect(url.pathname).toBe('/connect/notion/done')
    expect(url.searchParams.get('s')).toBe('st')
    const [state, enc] = markCompletedMock.mock.calls[0]
    expect(state).toBe('st')
    expect(JSON.parse(String(enc).replace(/^enc:/, ''))).toEqual(TOKEN)
  })

  it('セッションが無くても成立する（Cookieもセッションも読まない）', async () => {
    // モックにsupabaseを一切用意していない＝呼べば落ちる。落ちずに完了すれば読んでいない。
    const res = await GET(req('code=c1&state=st'))
    expect(loc(res).searchParams.get('s')).toBe('st')
  })

  it('state が無効なら交換せず、理由を出さずにエラーページへ', async () => {
    takePendingMock.mockResolvedValue(null)
    const res = await GET(req('code=c1&state=nope'))
    expect(loc(res).pathname).toBe('/connect/notion/done')
    expect(loc(res).searchParams.get('e')).toBe('1')
    expect(loc(res).searchParams.get('s')).toBeNull()
    expect(exchangeMock).not.toHaveBeenCalled()
  })

  it('ユーザーが認可を断った場合も同じ静かなエラー', async () => {
    const res = await GET(req('error=access_denied&state=st'))
    expect(loc(res).searchParams.get('e')).toBe('1')
    expect(exchangeMock).not.toHaveBeenCalled()
  })

  it('交換に失敗したら completed にしない', async () => {
    exchangeMock.mockRejectedValue(new Error('invalid_grant'))
    const res = await GET(req('code=c1&state=st'))
    expect(loc(res).searchParams.get('e')).toBe('1')
    expect(markCompletedMock).not.toHaveBeenCalled()
  })

  it('completed への更新に失敗したらエラーページへ（成功に見せない）', async () => {
    markCompletedMock.mockResolvedValue(false)
    const res = await GET(req('code=c1&state=st'))
    expect(loc(res).searchParams.get('e')).toBe('1')
  })

  it('code が無ければ交換しない', async () => {
    const res = await GET(req('state=st'))
    expect(loc(res).searchParams.get('e')).toBe('1')
    expect(exchangeMock).not.toHaveBeenCalled()
  })
})
