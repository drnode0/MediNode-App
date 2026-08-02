// claim ルート。既存接続の保護（§10）が中心。
// 「読めないDBがあれば1バイトも書かない」ことをupsertの呼び出し有無で確かめる。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  getUserMock, hasFeatureMock, findClaimableMock, markClaimedMock,
  maybeSingleMock, upsertMock, unreadableMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  hasFeatureMock: vi.fn(),
  findClaimableMock: vi.fn(),
  markClaimedMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  upsertMock: vi.fn(),
  unreadableMock: vi.fn(),
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
vi.mock('@/lib/supabase/early-access', () => ({ sessionHasFeature: hasFeatureMock }))
vi.mock('@/lib/supabase/oauth-states', () => ({
  findClaimable: findClaimableMock,
  markClaimed: markClaimedMock,
  purgeExpired: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/notion-readability', () => ({ findUnreadableDatabases: unreadableMock }))
vi.mock('@/lib/crypto', () => ({
  isCryptoReady: () => true,
  encryptSettings: (json: string) => `enc:${json}`,
  decryptSettingsDetailed: (enc: string) => {
    if (!enc.startsWith('enc:')) throw new Error('decrypt failed')
    return { json: enc.replace(/^enc:/, ''), needsReencrypt: false }
  },
}))

import { POST } from '../../app/api/notion/oauth/claim/route'

const TOKEN = { accessToken: 'ntn_new', workspaceName: 'WS', workspaceId: 'w', botId: 'b', duplicatedTemplateId: null }
const claimRow = { state: 'st', user_id: 'u1', status: 'completed' as const, token_enc: `enc:${JSON.stringify(TOKEN)}`, created_at: 'x', completed_at: 'y' }
const savedSettings = (extra: Record<string, unknown>) =>
  ({ data: { settings_enc: 'enc:' + JSON.stringify(extra) }, error: null })
const written = () => JSON.parse(String(upsertMock.mock.calls[0][0].settings_enc).replace(/^enc:/, ''))

beforeEach(() => {
  getUserMock.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@x.com' } } })
  hasFeatureMock.mockReset().mockResolvedValue(true)
  findClaimableMock.mockReset().mockResolvedValue(claimRow)
  markClaimedMock.mockReset().mockResolvedValue(true)
  maybeSingleMock.mockReset().mockResolvedValue({ data: null, error: null })
  upsertMock.mockReset().mockResolvedValue({ error: null })
  unreadableMock.mockReset().mockResolvedValue([])
})

describe('POST /api/notion/oauth/claim', () => {
  it('引き取るものが無ければ none', async () => {
    findClaimableMock.mockResolvedValue(null)
    const res = await POST()
    expect((await res.json()).status).toBe('none')
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('easy_connect を持たない人は403', async () => {
    hasFeatureMock.mockResolvedValue(false)
    const res = await POST()
    expect(res.status).toBe(403)
    expect(findClaimableMock).not.toHaveBeenCalled()
  })

  it('未ログインは401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await POST()
    expect(res.status).toBe(401)
  })

  it('新規（既存トークンなし）は素直に保存して ok', async () => {
    const res = await POST()
    const body = await res.json()
    expect(body.status).toBe('ok')
    const w = written()
    expect(w.notionToken).toBe('ntn_new')
    expect(w.notionAuthKind).toBe('oauth')
    expect(w.notionWorkspaceName).toBe('WS')
    expect(w.notionTokenPrev).toBeUndefined()
    expect(markClaimedMock).toHaveBeenCalledWith('st')
  })

  it('手動Tokenを置き換えるときは旧トークンを退避する', async () => {
    maybeSingleMock.mockResolvedValue(savedSettings({
      notionToken: 'secret_old', notionMedicalDbId: 'db1', algoliaAppId: 'A',
    }))
    await POST()
    const w = written()
    expect(w.notionTokenPrev).toBe('secret_old')
    expect(w.notionAuthKindPrev).toBe('manual')
    expect(w.notionToken).toBe('ntn_new')
    expect(w.algoliaAppId).toBe('A')
  })

  it('既存DBが新トークンで読めないなら1バイトも書かず conflict を返す', async () => {
    maybeSingleMock.mockResolvedValue(savedSettings({ notionToken: 'secret_old', notionMedicalDbId: 'db1' }))
    unreadableMock.mockResolvedValue([{ role: 'medical', id: 'db1' }])
    const res = await POST()
    const body = await res.json()
    expect(body.status).toBe('conflict')
    expect(body.unreadable).toEqual([{ role: 'medical', id: 'db1' }])
    expect(upsertMock).not.toHaveBeenCalled()
    expect(markClaimedMock).not.toHaveBeenCalled()
  })

  it('部署（team）の設定には触らない', async () => {
    maybeSingleMock.mockResolvedValue(savedSettings({
      notionToken: 'secret_old', teamNotionToken: 'team_tok', teamNotionMedicalDbId: 'tdb',
    }))
    await POST()
    const w = written()
    expect(w.teamNotionToken).toBe('team_tok')
    expect(w.teamNotionMedicalDbId).toBe('tdb')
  })

  it('既存設定の読み取りに失敗したら書かずに500', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: 'boom' } })
    const res = await POST()
    expect(res.status).toBe(500)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('既存設定の復号に失敗したら書かずに500（DEFAULTで上書きしない）', async () => {
    maybeSingleMock.mockResolvedValue({ data: { settings_enc: 'broken' }, error: null })
    const res = await POST()
    expect(res.status).toBe(500)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('すでにoauthのトークンを持っている人は退避しない（Prevを上書きしない）', async () => {
    maybeSingleMock.mockResolvedValue(savedSettings({ notionToken: 'ntn_old', notionAuthKind: 'oauth' }))
    await POST()
    const w = written()
    expect(w.notionTokenPrev).toBeUndefined()
  })
})
