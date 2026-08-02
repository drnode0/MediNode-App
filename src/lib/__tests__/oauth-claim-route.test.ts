// claim ルート。既存接続の保護（§10）が中心。
// 「読めないDBがあれば1バイトも書かない」ことをupsertの呼び出し有無で確かめる。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const {
  getUserMock, hasFeatureMock, findClaimableMock, markClaimedMock,
  maybeSingleMock, upsertMock, unreadableMock, cryptoReadyMock,
  rateLimitMock, captureExceptionMock, retireOtherCompletedMock,
} = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  hasFeatureMock: vi.fn(),
  findClaimableMock: vi.fn(),
  markClaimedMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  upsertMock: vi.fn(),
  unreadableMock: vi.fn(),
  cryptoReadyMock: vi.fn(() => true),
  rateLimitMock: vi.fn(async () => true),
  captureExceptionMock: vi.fn(),
  retireOtherCompletedMock: vi.fn(),
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
  retireOtherCompleted: retireOtherCompletedMock,
}))
vi.mock('@/lib/notion-readability', () => ({ findUnreadableDatabases: unreadableMock }))
vi.mock('@/lib/crypto', () => ({
  isCryptoReady: cryptoReadyMock,
  encryptSettings: (json: string) => `enc:${json}`,
  decryptSettingsDetailed: (enc: string) => {
    if (!enc.startsWith('enc:')) throw new Error('decrypt failed')
    return { json: enc.replace(/^enc:/, ''), needsReencrypt: false }
  },
}))
vi.mock('@/lib/rate-limit', () => ({
  rateLimitAsync: rateLimitMock,
  clientIp: () => '203.0.113.1',
}))
vi.mock('@sentry/nextjs', () => ({ captureException: captureExceptionMock }))

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
  cryptoReadyMock.mockReset().mockReturnValue(true)
  rateLimitMock.mockReset().mockResolvedValue(true)
  captureExceptionMock.mockReset()
  retireOtherCompletedMock.mockReset().mockResolvedValue(true)
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
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
    expect(hasFeatureMock).toHaveBeenCalledWith('easy_connect')
    expect(findClaimableMock).not.toHaveBeenCalled()
  })

  it('未ログインは401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await POST()
    expect(res.status).toBe(401)
  })

  it('Supabaseのenvが未設定なら503で何も読み書きしない', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const res = await POST()
    expect(res.status).toBe(503)
    expect(getUserMock).not.toHaveBeenCalled()
  })

  it('crypto未準備なら500で何も読み書きしない', async () => {
    cryptoReadyMock.mockReturnValue(false)
    const res = await POST()
    expect(res.status).toBe(500)
    expect(getUserMock).not.toHaveBeenCalled()
  })

  it('レート制限を超えたら429で何も読み書きしない（ユーザーID単位）', async () => {
    rateLimitMock.mockResolvedValue(false)
    const res = await POST()
    expect(res.status).toBe(429)
    expect(findClaimableMock).not.toHaveBeenCalled()
    expect(rateLimitMock).toHaveBeenCalledWith(expect.stringContaining('u1'), expect.any(Number), expect.any(Number))
  })

  it('新規（既存トークンなし）は素直に保存して ok・hadServerSettingsはfalse', async () => {
    const res = await POST()
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.hadServerSettings).toBe(false)
    const w = written()
    expect(w.notionToken).toBe('ntn_new')
    expect(w.notionAuthKind).toBe('oauth')
    expect(w.notionWorkspaceName).toBe('WS')
    expect(w.notionTokenPrev).toBeUndefined()
    expect(markClaimedMock).toHaveBeenCalledWith('st')
    expect(findClaimableMock).toHaveBeenCalledWith('u1', expect.any(Number))
  })

  it('サーバーに既存設定行があれば hadServerSettings は true', async () => {
    maybeSingleMock.mockResolvedValue(savedSettings({ notionToken: 'secret_old' }))
    const res = await POST()
    const body = await res.json()
    expect(body.hadServerSettings).toBe(true)
  })

  it('Finding1: 行はあるがsettings_encがNULL（早期アクセスのフラグ付与だけの行）なら hadServerSettings は false', async () => {
    maybeSingleMock.mockResolvedValue({ data: { settings_enc: null }, error: null })
    const res = await POST()
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.hadServerSettings).toBe(false)
    // baseはDEFAULT_SETTINGSのまま（実データで上書きされていない）ことも併せて確認する
    const w = written()
    expect(w.notionToken).toBe('ntn_new')
    expect(w.algoliaAppId).toBe('')
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

  it('既存がoauth接続でも、新トークンで既存DBが読めなければconflictにして何も書かない（Finding1: 読めるかチェックはprevKindに関わらず必ず走る）', async () => {
    maybeSingleMock.mockResolvedValue(savedSettings({
      notionToken: 'ntn_old', notionAuthKind: 'oauth', notionMedicalDbId: 'db1',
    }))
    unreadableMock.mockResolvedValue([{ role: 'medical', id: 'db1' }])
    const res = await POST()
    const body = await res.json()
    expect(body.status).toBe('conflict')
    expect(body.unreadable).toEqual([{ role: 'medical', id: 'db1' }])
    expect(upsertMock).not.toHaveBeenCalled()
    expect(markClaimedMock).not.toHaveBeenCalled()
  })

  it('findUnreadableDatabasesには新トークンと3ロールぶんの登録済みIDを渡す（旧トークンを渡さない・medicalだけに絞らない）', async () => {
    maybeSingleMock.mockResolvedValue(savedSettings({
      notionToken: 'secret_old', notionMedicalDbId: 'db1', notionReferenceDbId: 'db2', notionManualDbId: 'db3',
    }))
    await POST()
    expect(unreadableMock).toHaveBeenCalledWith({
      token: 'ntn_new',
      refs: [
        { role: 'medical', id: 'db1' },
        { role: 'reference', id: 'db2' },
        { role: 'manual', id: 'db3' },
      ],
    })
  })

  it('部署（team）の設定・列マッピング・サブスク設定には触らない', async () => {
    maybeSingleMock.mockResolvedValue(savedSettings({
      notionToken: 'secret_old',
      teamNotionToken: 'team_tok', teamNotionMedicalDbId: 'tdb',
      propSummary: '要約列', propKeywords: 'キーワード列', propKnowledgeLevel: 'レベル列', propGenre: 'ジャンル列',
      subscriptionAppId: 'sub_app', subscriptionSearchKey: 'sub_key', subscriptionIndex: 'sub_idx',
    }))
    await POST()
    const w = written()
    expect(w.teamNotionToken).toBe('team_tok')
    expect(w.teamNotionMedicalDbId).toBe('tdb')
    expect(w.propSummary).toBe('要約列')
    expect(w.propKeywords).toBe('キーワード列')
    expect(w.propKnowledgeLevel).toBe('レベル列')
    expect(w.propGenre).toBe('ジャンル列')
    expect(w.subscriptionAppId).toBe('sub_app')
    expect(w.subscriptionSearchKey).toBe('sub_key')
    expect(w.subscriptionIndex).toBe('sub_idx')
  })

  it('notionDuplicatedTemplateIdは値がある時だけ書かれる', async () => {
    const tokenWithTemplate = { ...TOKEN, duplicatedTemplateId: 'tmpl_1' }
    findClaimableMock.mockResolvedValue({ ...claimRow, token_enc: `enc:${JSON.stringify(tokenWithTemplate)}` })
    await POST()
    const w = written()
    expect(w.notionDuplicatedTemplateId).toBe('tmpl_1')
  })

  it('notionDuplicatedTemplateIdがnullなら書かれない', async () => {
    await POST()
    const w = written()
    expect(w.notionDuplicatedTemplateId).toBeUndefined()
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

  it('token_encの復号に失敗したら書かずに500', async () => {
    findClaimableMock.mockResolvedValue({ ...claimRow, token_enc: 'broken' })
    const res = await POST()
    expect(res.status).toBe(500)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('復号できてもaccessTokenが空文字なら書かずに500（トークンの実体が無いまま接続済みにしない）', async () => {
    const emptyToken = { ...TOKEN, accessToken: '' }
    findClaimableMock.mockResolvedValue({ ...claimRow, token_enc: `enc:${JSON.stringify(emptyToken)}` })
    const res = await POST()
    expect(res.status).toBe(500)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('upsertが失敗したら500でmarkClaimedを呼ばない', async () => {
    upsertMock.mockResolvedValue({ error: { message: 'boom' } })
    const res = await POST()
    expect(res.status).toBe(500)
    expect(markClaimedMock).not.toHaveBeenCalled()
  })

  it('markClaimedがfalseでも設定保存は成功しているのでokを返し、Sentryへ報告する', async () => {
    markClaimedMock.mockResolvedValue(false)
    const res = await POST()
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(upsertMock).toHaveBeenCalled()
    expect(captureExceptionMock).toHaveBeenCalled()
  })

  it('すでにoauthのトークンを持っている人は退避しない（Prevを上書きしない）', async () => {
    maybeSingleMock.mockResolvedValue(savedSettings({ notionToken: 'ntn_old', notionAuthKind: 'oauth' }))
    await POST()
    const w = written()
    expect(w.notionTokenPrev).toBeUndefined()
  })

  it('Finding2: 引き取り成功時はretireOtherCompletedを自分のuser_id・引き取った行のstateで呼ぶ', async () => {
    await POST()
    expect(retireOtherCompletedMock).toHaveBeenCalledWith('u1', 'st')
  })

  it('Finding2: conflictのときはretireOtherCompletedを呼ばない（何も書かず退避もしない）', async () => {
    maybeSingleMock.mockResolvedValue(savedSettings({ notionToken: 'secret_old', notionMedicalDbId: 'db1' }))
    unreadableMock.mockResolvedValue([{ role: 'medical', id: 'db1' }])
    const res = await POST()
    const body = await res.json()
    expect(body.status).toBe('conflict')
    expect(retireOtherCompletedMock).not.toHaveBeenCalled()
  })

  it('Finding2: retireOtherCompletedが失敗してもokを返し、Sentryへ報告する', async () => {
    retireOtherCompletedMock.mockResolvedValue(false)
    const res = await POST()
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(captureExceptionMock).toHaveBeenCalled()
  })
})
