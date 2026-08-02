// start ルート。機能を持たない人・未ログインを静かにホームへ戻し、
// 資格のある人にだけ state を発行して中間ページへ送ることを見る。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getUserMock, hasFeatureMock, createStateMock, purgeMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  hasFeatureMock: vi.fn(),
  createStateMock: vi.fn(),
  purgeMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: getUserMock } }) }))
vi.mock('@/lib/supabase/early-access', () => ({ sessionHasFeature: hasFeatureMock }))
vi.mock('@/lib/supabase/oauth-states', () => ({
  createPendingState: createStateMock,
  purgeExpired: purgeMock,
}))

import { NextRequest } from 'next/server'
import { GET } from '../../app/api/notion/oauth/start/route'

const req = () => new NextRequest('https://app.example/api/notion/oauth/start')

beforeEach(() => {
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@x.com' } } })
  hasFeatureMock.mockReset().mockResolvedValue(true)
  createStateMock.mockReset().mockResolvedValue('st-1')
  purgeMock.mockReset().mockResolvedValue(undefined)
  process.env.NOTION_OAUTH_CLIENT_ID = 'cid'
  process.env.NOTION_OAUTH_CLIENT_SECRET = 'sec'
})

describe('GET /api/notion/oauth/start', () => {
  it('資格があれば中間ページへ state つきで送る', async () => {
    const res = await GET(req())
    const loc = new URL(res.headers.get('location') || '')
    expect(loc.pathname).toBe('/connect/notion')
    expect(loc.searchParams.get('s')).toBe('st-1')
    expect(createStateMock).toHaveBeenCalledWith('u1', expect.any(Number))
  })

  it('easy_connect を持たない人はホームへ静かに戻す', async () => {
    hasFeatureMock.mockResolvedValue(false)
    const res = await GET(req())
    expect(new URL(res.headers.get('location') || '').pathname).toBe('/')
    expect(createStateMock).not.toHaveBeenCalled()
  })

  it('未ログインもホームへ静かに戻す', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await GET(req())
    expect(new URL(res.headers.get('location') || '').pathname).toBe('/')
    expect(createStateMock).not.toHaveBeenCalled()
  })

  it('env未設定ならホームへ戻す', async () => {
    delete process.env.NOTION_OAUTH_CLIENT_ID
    const res = await GET(req())
    expect(new URL(res.headers.get('location') || '').pathname).toBe('/')
  })

  it('state の発行に失敗したらホームへ戻す', async () => {
    createStateMock.mockResolvedValue(null)
    const res = await GET(req())
    expect(new URL(res.headers.get('location') || '').pathname).toBe('/')
  })
})
