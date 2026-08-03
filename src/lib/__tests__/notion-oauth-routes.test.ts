// callback ルート（v2）。Cookieもセッションも見ず、state だけを鍵にする。
// 成功してもトークンは user_settings に入らず oauth_states に暗号化して置かれる。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { takePendingMock, markCompletedMock, purgeExpiredMock, exchangeMock, isCryptoReadyMock, rateLimitMock } = vi.hoisted(() => ({
  takePendingMock: vi.fn(),
  markCompletedMock: vi.fn(),
  purgeExpiredMock: vi.fn(),
  exchangeMock: vi.fn(),
  isCryptoReadyMock: vi.fn(() => true),
  rateLimitMock: vi.fn(async () => true),
}))

vi.mock('@/lib/supabase/oauth-states', () => ({
  takePendingState: takePendingMock,
  markCompleted: markCompletedMock,
  purgeExpiredStates: purgeExpiredMock,
}))
vi.mock('@/lib/crypto', () => ({
  isCryptoReady: isCryptoReadyMock,
  encryptSettings: (json: string) => `enc:${json}`,
}))
vi.mock('@/lib/notion-oauth', async (orig) => ({
  ...(await orig()),
  exchangeCode: exchangeMock,
}))
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: rateLimitMock,
  clientIp: () => '203.0.113.1',
}))
// このルートはセッションもCookieも読んではいけない設計（v1の反省・§1原因②）。
// 保護を「supabase/server を誰もモックしていない」という不在に頼らせず、
// このモジュールを import した瞬間に例外で落ちるようにして総合的に固定する。
// 直接 createClient/createAdminClient を呼ぶコードが将来ここへ紛れ込んでも、
// vitest 上で（env未設定による偶然の失敗ではなく）このエラーで検出できる。
vi.mock('@/lib/supabase/server', () => {
  throw new Error(
    'callback は @/lib/supabase/server を読んではいけない（セッションも user_settings も触らない設計）',
  )
})

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
  purgeExpiredMock.mockReset().mockResolvedValue(undefined)
  exchangeMock.mockReset().mockResolvedValue(TOKEN)
  isCryptoReadyMock.mockReset().mockReturnValue(true)
  rateLimitMock.mockReset().mockResolvedValue(true)
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
    // 総合的な保証は @/lib/supabase/server の vi.mock（factoryが例外を投げる）側にある。
    // この import が実行されればテストファイル自体がロードに失敗して落ちる。
    // ここでは従来どおりの挙動確認（成立すること）だけを残す。
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

  it('レート制限を超えたら理由を出さずにエラーページへ（DB/交換に進まない）', async () => {
    rateLimitMock.mockResolvedValue(false)
    const res = await GET(req('code=c1&state=st'))
    expect(loc(res).searchParams.get('e')).toBe('1')
    expect(takePendingMock).not.toHaveBeenCalled()
    expect(exchangeMock).not.toHaveBeenCalled()
  })

  it('Finding1: 成功時はmarkCompleted成功直後にpurgeExpiredStatesを呼ぶ（user_id等では絞らずnowMsだけを渡す＝全体スイープ）', async () => {
    const res = await GET(req('code=c1&state=st'))
    expect(loc(res).searchParams.get('s')).toBe('st')
    // 引数は now の1個だけ。以前のように state 行の持ち主(user_id)を渡さない
    // （渡していれば呼び出しは2引数になり、この単一引数マッチには一致しない）。
    expect(purgeExpiredMock).toHaveBeenCalledWith(expect.any(Number))
  })

  it('Finding1: state が無効なら（交換に進まない）purgeExpiredは呼ばない', async () => {
    takePendingMock.mockResolvedValue(null)
    await GET(req('code=c1&state=nope'))
    expect(purgeExpiredMock).not.toHaveBeenCalled()
  })

  it('Finding1: markCompletedが失敗したらpurgeExpiredは呼ばない', async () => {
    markCompletedMock.mockResolvedValue(false)
    await GET(req('code=c1&state=st'))
    expect(purgeExpiredMock).not.toHaveBeenCalled()
  })

  it('Finding1: purgeExpiredが失敗しても成功応答は変わらない（oauth-states.tsは例外を投げない前提）', async () => {
    purgeExpiredMock.mockResolvedValue(undefined)
    const res = await GET(req('code=c1&state=st'))
    expect(res.status).toBe(307)
    expect(loc(res).searchParams.get('s')).toBe('st')
    expect(loc(res).searchParams.get('e')).toBeNull()
  })
})

describe('GET /api/notion/oauth/callback（v2）— 失敗経路の応答は完全に同一', () => {
  type Case = {
    name: string
    query: string
    setup?: () => void
  }

  // 「理由を出し分けない」の対象になりうる全経路を網羅する。
  // 内容（location の文字列）だけでなく status・headers まで同一であることを
  // 1つの基準スナップショットと突き合わせて確認する（302/307の取り違えや
  // Set-Cookie混入のような、locationだけ見ていては気付けない回帰を検出するため）。
  const cases: Case[] = [
    {
      name: 'NOTION_OAUTH_CLIENT_ID が未設定',
      query: 'code=c1&state=st',
      setup: () => { delete process.env.NOTION_OAUTH_CLIENT_ID },
    },
    {
      name: 'NOTION_OAUTH_CLIENT_SECRET が未設定',
      query: 'code=c1&state=st',
      setup: () => { delete process.env.NOTION_OAUTH_CLIENT_SECRET },
    },
    {
      name: 'isCryptoReady() が false',
      query: 'code=c1&state=st',
      setup: () => { isCryptoReadyMock.mockReturnValue(false) },
    },
    {
      name: 'ユーザーが認可を拒否（error=access_denied）',
      query: 'error=access_denied&state=st',
    },
    {
      name: 'code が無い',
      query: 'state=st',
    },
    {
      name: 'state が無い',
      query: 'code=c1',
    },
    {
      name: 'state が空文字',
      query: 'code=c1&state=',
    },
    {
      name: 'state が無効・期限切れ（takePendingStateがnull）',
      query: 'code=c1&state=nope',
      setup: () => { takePendingMock.mockResolvedValue(null) },
    },
    {
      name: 'コード交換に失敗',
      query: 'code=c1&state=st',
      setup: () => { exchangeMock.mockRejectedValue(new Error('invalid_grant')) },
    },
    {
      name: 'markCompleted が false（横取りされた）',
      query: 'code=c1&state=st',
      setup: () => { markCompletedMock.mockResolvedValue(false) },
    },
    {
      name: 'レート制限を超過',
      query: 'code=c1&state=st',
      setup: () => { rateLimitMock.mockResolvedValue(false) },
    },
  ]

  it('すべての失敗経路が status・headers・location まで同一のスナップショットになる', async () => {
    const snapshots: Array<{ name: string; status: number; headers: Record<string, string>; location: string }> = []

    for (const c of cases) {
      // 各ケースの前提を毎回まっさらに戻してから、そのケードだけの条件を足す。
      takePendingMock.mockReset().mockResolvedValue(ROW)
      markCompletedMock.mockReset().mockResolvedValue(true)
      purgeExpiredMock.mockReset().mockResolvedValue(undefined)
      exchangeMock.mockReset().mockResolvedValue(TOKEN)
      isCryptoReadyMock.mockReset().mockReturnValue(true)
      rateLimitMock.mockReset().mockResolvedValue(true)
      process.env.NOTION_OAUTH_CLIENT_ID = 'cid'
      process.env.NOTION_OAUTH_CLIENT_SECRET = 'sec'

      c.setup?.()

      const res = await GET(req(c.query))
      snapshots.push({
        name: c.name,
        status: res.status,
        headers: Object.fromEntries(res.headers.entries()),
        location: loc(res).toString(),
      })
    }

    const [baseline, ...rest] = snapshots
    expect(baseline.status).toBe(307)
    expect(baseline.location).toBe('https://app.example/connect/notion/done?e=1')
    for (const s of rest) {
      expect({ status: s.status, headers: s.headers, location: s.location }, s.name)
        .toEqual({ status: baseline.status, headers: baseline.headers, location: baseline.location })
    }
  })

  it('成功時は s を持ち、e は持たない（エラー時に s が無いことの鏡像）', async () => {
    const res = await GET(req('code=c1&state=st'))
    const url = loc(res)
    expect(url.searchParams.get('s')).toBe('st')
    expect(url.searchParams.get('e')).toBeNull()
  })
})
