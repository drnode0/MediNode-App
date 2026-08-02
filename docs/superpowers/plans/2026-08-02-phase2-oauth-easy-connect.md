# Phase 2: OAuth「かんたん接続」実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「ボタン → Notionの許可画面でページを選ぶ → 完了」でNotion接続が終わるようにする（my-integrations・トークンコピペ・コネクト追加・URL貼りの全廃）。Token手入力は「手動接続」として温存。

**Architecture:** `/api/notion/oauth/start` がstate（CSRF）をhttpOnly Cookieに置いてNotion認可画面へ302。`/api/notion/oauth/callback` がstate検証→コードをトークン交換→**既存の暗号化設定保存（user_settings）に notionToken としてマージ**→アプリへリダイレクト。クライアントは既存のSettingsSync復元でトークンを受け取り、新コンポーネント `OAuthFinish` がDB選択（`/api/notion/list-databases`）→Phase 1の列確認（PropMapEditor）→完了まで運ぶ。下流（同期・検索・CQ捕捉）は notionToken の出自を区別しないため無変更。

**Tech Stack:** Next.js App Router / TypeScript / vitest / @notionhq/client / Supabase (session) / 既存 crypto.ts (AES-256-GCM)

**Spec:** `docs/superpowers/specs/2026-08-02-connection-onboarding-redesign-design.md`（Phase 2節）

## Global Constraints

- 文言は静かな日本語・感嘆符なし。かんたん接続の説明に**「既存のページを編集することはありません」**を必ず入れる（権限は読み取り＋挿入のみで登録済み）
- 新しい依存パッケージを追加しない（トークン交換は `fetch`、Basic認証は `Buffer`）
- 手動接続（Token手入力）の動線・既存ユーザーの保存済み設定は無変更で動き続けること
- env: `NOTION_OAUTH_CLIENT_ID` / `NOTION_OAUTH_CLIENT_SECRET`（Vercel設定済み。ローカル開発は `.env.local` に同名で追加——オーナー作業、コードでは未設定時に「かんたん接続は準備中」フォールバック）
- client_secret はサーバー専用。クライアントへ渡さない・ログに出さない
- Notion API仕様: 認可URL=`https://api.notion.com/v1/oauth/authorize?client_id=…&response_type=code&owner=user&redirect_uri=…&state=…`／トークン交換=POST `https://api.notion.com/v1/oauth/token`（`Authorization: Basic base64(id:secret)`、body `{grant_type:'authorization_code', code, redirect_uri}`）→ `{access_token, workspace_name, workspace_id, bot_id, duplicated_template_id|null}`
- テンプレート複製オプションはNotion側で未設定（チェックOFF）。`duplicated_template_id` は来たら保存だけする（UI分岐はGA後の別タスク）
- `npx tsc --noEmit` と `npx vitest run` が各タスク完了時に全パス
- コミットは日本語＋`Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`
- 作業ブランチ: `feat/oauth-easy-connect`（worktreeで隔離・Task 1で作成）

---

### Task 1: OAuthヘルパー lib（純関数・TDD）

**Files:**
- Create: `src/lib/notion-oauth.ts`
- Test: `src/lib/__tests__/notion-oauth.test.ts`

**Interfaces:**
- Produces: `buildAuthorizeUrl(opts: {clientId: string; redirectUri: string; state: string}): string`／`exchangeCode(opts: {code: string; redirectUri: string; clientId: string; clientSecret: string; fetchFn?: typeof fetch}): Promise<NotionOAuthToken>`／`type NotionOAuthToken = { accessToken: string; workspaceName: string; workspaceId: string; botId: string; duplicatedTemplateId: string | null }`／`STATE_COOKIE = 'medinode_notion_oauth_state'`。Task 2/3 が使う。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/notion-oauth.test.ts`:

```ts
// Notion OAuthヘルパーのテスト。認可URLの組み立てと、コード→トークン交換
// （Basic認証・エラー伝播）を fetch モックで検証する。
import { describe, it, expect, vi } from 'vitest'
import { buildAuthorizeUrl, exchangeCode } from '../notion-oauth'

describe('buildAuthorizeUrl', () => {
  it('必要なクエリを全部含む（owner=user・エンコード済み）', () => {
    const url = new URL(
      buildAuthorizeUrl({ clientId: 'cid-1', redirectUri: 'https://app.example/cb?x=1', state: 'st-abc' }),
    )
    expect(url.origin + url.pathname).toBe('https://api.notion.com/v1/oauth/authorize')
    expect(url.searchParams.get('client_id')).toBe('cid-1')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('owner')).toBe('user')
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/cb?x=1')
    expect(url.searchParams.get('state')).toBe('st-abc')
  })
})

describe('exchangeCode', () => {
  it('Basic認証つきでtokenエンドポイントを叩き、応答を型に詰め替える', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'ntn_tok',
        workspace_name: 'Tatsuki WS',
        workspace_id: 'ws-1',
        bot_id: 'bot-1',
        duplicated_template_id: null,
      }),
    })
    const res = await exchangeCode({
      code: 'code-1',
      redirectUri: 'https://app.example/cb',
      clientId: 'cid-1',
      clientSecret: 'sec-1',
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(res).toEqual({
      accessToken: 'ntn_tok',
      workspaceName: 'Tatsuki WS',
      workspaceId: 'ws-1',
      botId: 'bot-1',
      duplicatedTemplateId: null,
    })
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe('https://api.notion.com/v1/oauth/token')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe(
      'Basic ' + Buffer.from('cid-1:sec-1').toString('base64'),
    )
    expect(JSON.parse(init.body)).toEqual({
      grant_type: 'authorization_code',
      code: 'code-1',
      redirect_uri: 'https://app.example/cb',
    })
  })

  it('Notionがエラーを返したら error フィールドを含む例外を投げる', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: 'invalid_grant' }),
    })
    await expect(
      exchangeCode({
        code: 'bad',
        redirectUri: 'https://app.example/cb',
        clientId: 'cid-1',
        clientSecret: 'sec-1',
        fetchFn: fetchFn as unknown as typeof fetch,
      }),
    ).rejects.toThrow('invalid_grant')
  })

  it('duplicated_template_id が来たら保持する', async () => {
    const fetchFn = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 't',
        workspace_name: '',
        workspace_id: '',
        bot_id: '',
        duplicated_template_id: 'tmpl-1',
      }),
    })
    const res = await exchangeCode({
      code: 'c', redirectUri: 'r', clientId: 'i', clientSecret: 's',
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(res.duplicatedTemplateId).toBe('tmpl-1')
  })
})
```

- [ ] **Step 2: 落ちることを確認**

Run: `npx vitest run src/lib/__tests__/notion-oauth.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: 実装**

`src/lib/notion-oauth.ts`:

```ts
// Notion OAuth（かんたん接続）のヘルパー。サーバー専用（client_secretを扱う）。
// 認可URLの組み立てと、認可コード→アクセストークンの交換のみを担当する。
// トークンの保存は /api/notion/oauth/callback が既存の暗号化設定保存に委ねる。

export const STATE_COOKIE = 'medinode_notion_oauth_state'

export type NotionOAuthToken = {
  accessToken: string
  workspaceName: string
  workspaceId: string
  botId: string
  duplicatedTemplateId: string | null
}

export function buildAuthorizeUrl(opts: {
  clientId: string
  redirectUri: string
  state: string
}): string {
  const url = new URL('https://api.notion.com/v1/oauth/authorize')
  url.searchParams.set('client_id', opts.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('owner', 'user')
  url.searchParams.set('redirect_uri', opts.redirectUri)
  url.searchParams.set('state', opts.state)
  return url.toString()
}

export async function exchangeCode(opts: {
  code: string
  redirectUri: string
  clientId: string
  clientSecret: string
  fetchFn?: typeof fetch
}): Promise<NotionOAuthToken> {
  const doFetch = opts.fetchFn ?? fetch
  const res = await doFetch('https://api.notion.com/v1/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:
        'Basic ' + Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString('base64'),
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      code: opts.code,
      redirect_uri: opts.redirectUri,
    }),
  })
  const data = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    // Notionは {error:'invalid_grant'} 等を返す。メッセージに載せて呼び出し側で分類する。
    throw new Error(String(data.error || `notion_oauth_http_${(res as Response).status}`))
  }
  return {
    accessToken: String(data.access_token || ''),
    workspaceName: String(data.workspace_name || ''),
    workspaceId: String(data.workspace_id || ''),
    botId: String(data.bot_id || ''),
    duplicatedTemplateId: (data.duplicated_template_id as string | null) ?? null,
  }
}
```

- [ ] **Step 4: 通ることを確認**

Run: `npx vitest run src/lib/__tests__/notion-oauth.test.ts && npx tsc --noEmit`
Expected: PASS（4件）・tsc 0

- [ ] **Step 5: ブランチ作成とコミット**

```bash
git checkout -b feat/oauth-easy-connect   # worktree運用の場合は作成済みなのでskip
git add src/lib/notion-oauth.ts src/lib/__tests__/notion-oauth.test.ts
git commit -m "Notion OAuthヘルパーを追加（認可URL組み立て・トークン交換・TDD）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: settings型の拡張（出自フラグ）

**Files:**
- Modify: `src/lib/settings.ts`

**Interfaces:**
- Produces: `AppSettings` に `notionAuthKind?: 'oauth' | 'manual'` と `notionWorkspaceName?: string` と `notionDuplicatedTemplateId?: string`。Task 3/6/7 が読む。

- [ ] **Step 1: 型を追加**

`src/lib/settings.ts` の `notionManualDbId: string` の直後に追加:

```ts
  // Notion接続の出自（任意）。'oauth'=かんたん接続で取得したトークン。
  // 未設定/'manual'=手入力。下流の同期・検索はこのフラグを区別しない（表示と再接続導線のみ）。
  notionAuthKind?: 'oauth' | 'manual'
  // かんたん接続時のワークスペース名（表示用）
  notionWorkspaceName?: string
  // 認可フローでテンプレート複製が行われた場合の複製先ページID（将来のGA用に保持のみ）
  notionDuplicatedTemplateId?: string
```

- [ ] **Step 2: 確認とコミット**

Run: `npx tsc --noEmit && npx vitest run 2>&1 | tail -3`
Expected: 全パス（mergeSettingsはオプショナル項目を自然に運ぶ。既存テスト無変更で通ること）

```bash
git add src/lib/settings.ts
git commit -m "AppSettingsにNotion接続の出自フラグを追加（oauth/manual・WS名・複製ID）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: /api/notion/oauth/start と /api/notion/oauth/callback

**Files:**
- Create: `src/app/api/notion/oauth/start/route.ts`
- Create: `src/app/api/notion/oauth/callback/route.ts`
- Test: `src/lib/__tests__/notion-oauth-routes.test.ts`

**Interfaces:**
- Consumes: Task 1 の `buildAuthorizeUrl/exchangeCode/STATE_COOKIE`、既存 `@/lib/supabase/server` の `createClient/createAdminClient`、`@/lib/crypto` の `encryptSettings/decryptSettingsDetailed/isCryptoReady`
- Produces: `GET /api/notion/oauth/start` → 302（未ログインは `/?oauthError=login` へ）。`GET /api/notion/oauth/callback?code&state` → 成功時 `/?oauth=notion-done` へ302（サーバー設定に notionToken 保存済み）。失敗時 `/?oauthError=<denied|state|exchange|save>` へ302

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/notion-oauth-routes.test.ts`:

```ts
// OAuth start/callback ルートのテスト。state Cookieの往復・未ログイン分岐・
// トークン交換成功時のマージ保存・各エラーのリダイレクト先を検証する。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getUserMock, upsertMock, maybeSingleMock, exchangeMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  upsertMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  exchangeMock: vi.fn(),
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
  decryptSettingsDetailed: (enc: string) => ({ json: enc.replace(/^enc:/, ''), needsReencrypt: false }),
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
  process.env.NOTION_OAUTH_CLIENT_ID = 'cid-1'
  process.env.NOTION_OAUTH_CLIENT_SECRET = 'sec-1'
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
})
```

- [ ] **Step 2: 落ちることを確認**

Run: `npx vitest run src/lib/__tests__/notion-oauth-routes.test.ts`
Expected: FAIL（routes not found）

- [ ] **Step 3: start route 実装**

`src/app/api/notion/oauth/start/route.ts`:

```ts
// かんたん接続の入口。ログイン済みユーザーをNotionの認可画面へ送る。
// state（CSRF対策）はhttpOnly Cookieに置き、callbackで突き合わせる。
import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createClient } from '@/lib/supabase/server'
import { buildAuthorizeUrl, STATE_COOKIE } from '@/lib/notion-oauth'

export async function GET(req: NextRequest) {
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID
  if (!clientId || !process.env.NOTION_OAUTH_CLIENT_SECRET) {
    return NextResponse.redirect(new URL('/?oauthError=unconfigured', req.url))
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    // かんたん接続はトークンをアカウントに保存するため、先にログインが必要。
    return NextResponse.redirect(new URL('/?oauthError=login', req.url))
  }

  const state = randomBytes(16).toString('hex')
  const redirectUri = new URL('/api/notion/oauth/callback', req.url).toString()
  const res = NextResponse.redirect(buildAuthorizeUrl({ clientId, redirectUri, state }))
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.nextUrl.protocol === 'https:',
    maxAge: 600,
    path: '/',
  })
  return res
}
```

- [ ] **Step 4: callback route 実装**

`src/app/api/notion/oauth/callback/route.ts`:

```ts
// かんたん接続の出口。state検証→コードをトークンに交換→既存の暗号化設定保存
// （user_settings）へ notionToken としてマージ→アプリへ戻す。
// クライアントは既存のSettingsSync（サーバー優先のlast-write-wins）で受け取るため、
// ここで updated_at を now にすることが「復元される」ための条件になる。
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { encryptSettings, decryptSettingsDetailed, isCryptoReady } from '@/lib/crypto'
import { exchangeCode, STATE_COOKIE } from '@/lib/notion-oauth'

// サーバーに設定行がまだ無いユーザー向けの土台（クライアントのsaveSection既定と同型）。
const DEFAULT_SETTINGS = {
  searchMode: 'notion',
  notionToken: '', notionMedicalDbId: '', notionReferenceDbId: '', notionManualDbId: '',
  algoliaAppId: '', algoliaSearchKey: '', algoliaAdminKey: '', algoliaIndex: 'medical_knowledge',
  teamLabel: '', teamNotionToken: '', teamNotionMedicalDbId: '', teamNotionReferenceDbId: '', teamNotionManualDbId: '',
  subscriptionSearchKey: '', subscriptionAppId: '', subscriptionIndex: '',
  propSummary: '', propKeywords: '', propKnowledgeLevel: '', propGenre: '',
}

function back(req: NextRequest, query: string): NextResponse {
  const res = NextResponse.redirect(new URL(`/?${query}`, req.url))
  res.cookies.set(STATE_COOKIE, '', { httpOnly: true, maxAge: 0, path: '/' })
  return res
}

export async function GET(req: NextRequest) {
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID
  const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret || !isCryptoReady()) {
    return back(req, 'oauthError=unconfigured')
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return back(req, 'oauthError=login')

  const params = req.nextUrl.searchParams
  if (params.get('error')) {
    // ユーザーが認可画面で「キャンセル」した場合など。エラー扱いにせず静かに戻す。
    return back(req, 'oauthError=denied')
  }
  const code = params.get('code') || ''
  const state = params.get('state') || ''
  const cookieState = req.cookies.get(STATE_COOKIE)?.value || ''
  if (!code || !state || !cookieState || state !== cookieState) {
    return back(req, 'oauthError=state')
  }

  let token
  try {
    const redirectUri = new URL('/api/notion/oauth/callback', req.url).toString()
    token = await exchangeCode({ code, redirectUri, clientId, clientSecret })
  } catch {
    return back(req, 'oauthError=exchange')
  }

  // 既存のサーバー設定を読み、notionToken系だけ差し替えて保存する（他項目は温存）。
  const admin = createAdminClient()
  let base: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  try {
    const { data } = await admin
      .from('user_settings')
      .select('settings_enc')
      .eq('user_id', user.id)
      .maybeSingle()
    if (data?.settings_enc) {
      const { json } = decryptSettingsDetailed(data.settings_enc)
      base = { ...DEFAULT_SETTINGS, ...JSON.parse(json) }
    }
  } catch {
    // 復号失敗時は土台から作り直す（トークンを失うよりは新規保存を優先）
  }

  const merged = {
    ...base,
    notionToken: token.accessToken,
    notionAuthKind: 'oauth',
    notionWorkspaceName: token.workspaceName,
    ...(token.duplicatedTemplateId ? { notionDuplicatedTemplateId: token.duplicatedTemplateId } : {}),
  }

  try {
    const { error } = await admin
      .from('user_settings')
      .upsert(
        { user_id: user.id, settings_enc: encryptSettings(JSON.stringify(merged)), updated_at: new Date().toISOString() },
        { onConflict: 'user_id' },
      )
    if (error) return back(req, 'oauthError=save')
  } catch {
    return back(req, 'oauthError=save')
  }

  return back(req, 'oauth=notion-done')
}
```

- [ ] **Step 5: 通ることを確認**

Run: `npx vitest run src/lib/__tests__/notion-oauth-routes.test.ts && npx tsc --noEmit && npx vitest run 2>&1 | tail -3`
Expected: 新テスト7件PASS・全suite PASS・tsc 0

- [ ] **Step 6: コミット**

```bash
git add src/app/api/notion/oauth src/lib/__tests__/notion-oauth-routes.test.ts
git commit -m "OAuth start/callback ルートを追加（state検証・トークン交換・暗号化設定へマージ保存）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: /api/notion/list-databases（DB一覧）

**Files:**
- Create: `src/app/api/notion/list-databases/route.ts`
- Test: `src/lib/__tests__/list-databases-route.test.ts`

**Interfaces:**
- Produces: `POST {notionToken}` → `{ databases: Array<{ id: string; title: string }> }`。Task 5 のDB選択UIが使う。ガードは check-props と同じ `requireSessionOrSetupRateLimit`（20回/10分/IP）。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/list-databases-route.test.ts`:

```ts
// list-databases ルートのテスト。search APIの結果をid/titleに整形して返す。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { guardMock, searchMock } = vi.hoisted(() => ({
  guardMock: vi.fn(),
  searchMock: vi.fn(),
}))
vi.mock('@/lib/api-guard', () => ({ requireSessionOrSetupRateLimit: guardMock }))
vi.mock('@notionhq/client', () => ({
  Client: class { search = searchMock },
}))

import { POST } from '../../app/api/notion/list-databases/route'
import type { NextRequest } from 'next/server'
const makeReq = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest

beforeEach(() => {
  guardMock.mockReset().mockResolvedValue(null)
  searchMock.mockReset()
})

describe('POST /api/notion/list-databases', () => {
  it('database だけをid/titleで返す（titleはplain_text連結・空はUntitled扱い）', async () => {
    searchMock.mockResolvedValue({
      results: [
        { object: 'database', id: 'db1', title: [{ plain_text: 'Medical ' }, { plain_text: 'DB' }] },
        { object: 'database', id: 'db2', title: [] },
        { object: 'page', id: 'p1' },
      ],
    })
    const res = await POST(makeReq({ notionToken: 'ntn_x' }))
    const data = await res.json()
    expect(data.databases).toEqual([
      { id: 'db1', title: 'Medical DB' },
      { id: 'db2', title: '（無題のデータベース）' },
    ])
    expect(searchMock).toHaveBeenCalledWith(
      expect.objectContaining({ filter: { property: 'object', value: 'database' }, page_size: 100 }),
    )
  })

  it('notionToken が無ければ400', async () => {
    const res = await POST(makeReq({}))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 2: 落ちることを確認** — Run: `npx vitest run src/lib/__tests__/list-databases-route.test.ts` → FAIL

- [ ] **Step 3: 実装**

`src/app/api/notion/list-databases/route.ts`:

```ts
// かんたん接続後のDB選択用。トークンがアクセスできるデータベースの一覧を返す。
// （OAuthのページピッカーで選ばれた範囲だけが見える）
import { NextRequest, NextResponse } from 'next/server'
import { requireSessionOrSetupRateLimit } from '@/lib/api-guard'
import { Client } from '@notionhq/client'

export async function POST(req: NextRequest) {
  const denied = await requireSessionOrSetupRateLimit(req, 'list-databases', 20, 10 * 60_000)
  if (denied) return denied

  try {
    const { notionToken } = await req.json()
    if (!notionToken) {
      return NextResponse.json({ error: 'notionToken が必要です' }, { status: 400 })
    }
    const notion = new Client({ auth: notionToken })
    const res = await notion.search({
      filter: { property: 'object', value: 'database' },
      page_size: 100,
    })
    const databases = res.results
      .filter((r) => (r as { object?: string }).object === 'database')
      .map((r) => {
        const d = r as { id: string; title?: Array<{ plain_text?: string }> }
        const title = (d.title || []).map((t) => t.plain_text || '').join('').trim()
        return { id: d.id, title: title || '（無題のデータベース）' }
      })
    return NextResponse.json({ databases })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 4: 確認とコミット**

Run: `npx vitest run src/lib/__tests__/list-databases-route.test.ts && npx tsc --noEmit`

```bash
git add src/app/api/notion/list-databases src/lib/__tests__/list-databases-route.test.ts
git commit -m "DB一覧API list-databases を追加（かんたん接続後の選択用）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: OAuthFinish（接続の仕上げシート）

**Files:**
- Create: `src/components/OAuthFinish.tsx`
- Modify: `src/app/page.tsx`（`?oauth=notion-done` / `?oauthError=` の受け口）

**Interfaces:**
- Consumes: SettingsSyncの決着イベント（`isSettingsSyncSettled/onSettingsSyncSettled` from `./auth/SettingsSync`）、`/api/notion/list-databases`、`/api/notion/check-props`、Phase 1 の `PropMapEditor`・`inferPropMap`、`getSettings/saveSettings`
- Produces: 認可から戻った直後に自動で開くフルスクリーンシート。流れ: 復元待ち → DB選択（Medicalのみ必須・候補1件なら自動選択） → 列の確認（check-props＋PropMapEditor・全exactなら自動スキップ） → 保存して完了。

- [ ] **Step 1: OAuthFinish を実装**

`src/components/OAuthFinish.tsx`:

```tsx
'use client'

// かんたん接続の仕上げ。OAuth認可から戻った直後に開き、
// ①サーバー設定の復元を待つ → ②DBを選ぶ → ③列の読み取りを確認 → ④保存して完了。
// トークンはSettingsSyncが復元済みの settings.notionToken を使う（このコンポーネントは受け取らない）。

import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { getSettings, saveSettings } from '@/lib/settings'
import { isSettingsSyncSettled, onSettingsSyncSettled } from './auth/SettingsSync'
import { inferPropMap } from '@/lib/prop-infer'
import { PropMapEditor } from './PropMapEditor'
import { Spinner } from './Spinner'

type DbItem = { id: string; title: string }
type Phase = 'restoring' | 'pick' | 'columns' | 'saving' | 'done' | 'error'

export function OAuthFinish({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<Phase>('restoring')
  const [error, setError] = useState('')
  const [dbs, setDbs] = useState<DbItem[]>([])
  const [medicalId, setMedicalId] = useState('')
  const [referenceId, setReferenceId] = useState('')
  const [schema, setSchema] = useState<Array<{ name: string; type: string }> | null>(null)
  const [propMap, setPropMap] = useState({ propSummary: '', propKeywords: '', propKnowledgeLevel: '', propGenre: '' })
  const [workspace, setWorkspace] = useState('')

  // ① SettingsSyncの決着を待ってからDB一覧を取りに行く
  useEffect(() => {
    const start = async () => {
      const s = getSettings()
      if (!s?.notionToken) {
        setError('接続情報の受け取りに失敗しました。もう一度「かんたん接続」からやり直してください。')
        setPhase('error')
        return
      }
      setWorkspace(s.notionWorkspaceName || '')
      try {
        const res = await fetch('/api/notion/list-databases', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notionToken: s.notionToken }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || '')
        const list: DbItem[] = data.databases || []
        setDbs(list)
        if (list.length === 1) setMedicalId(list[0].id)
        setPhase('pick')
      } catch {
        setError('データベースの一覧を取得できませんでした。通信環境を確認して、もう一度お試しください。')
        setPhase('error')
      }
    }
    if (isSettingsSyncSettled()) { void start(); return }
    return onSettingsSyncSettled(() => { void start() })
  }, [])

  // ② DB決定 → 列スキーマを取得して確認フェーズへ（全exactならそのまま保存へ）
  const confirmDbs = async () => {
    const s = getSettings()
    if (!s || !medicalId) return
    setPhase('columns')
    try {
      const res = await fetch('/api/notion/check-props', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notionToken: s.notionToken,
          notionMedicalDbId: medicalId,
          notionReferenceDbId: referenceId || undefined,
        }),
      })
      const data = await res.json()
      const sc = (data.medical?.schema as Array<{ name: string; type: string }>) || null
      setSchema(sc)
      if (sc) {
        const inf = inferPropMap(sc)
        const allExact = (['summary', 'keywords', 'genre', 'knowledgeLevel'] as const)
          .every((k) => inf[k].confidence === 'exact' || inf[k].confidence === 'none')
        if (allExact) { await save({}) ; return }
        setPropMap({
          propSummary: inf.summary.confidence === 'likely' ? inf.summary.best || '' : '',
          propKeywords: inf.keywords.confidence === 'likely' ? inf.keywords.best || '' : '',
          propGenre: inf.genre.confidence === 'likely' ? inf.genre.best || '' : '',
          propKnowledgeLevel: inf.knowledgeLevel.confidence === 'likely' ? inf.knowledgeLevel.best || '' : '',
        })
      }
    } catch {
      // スキーマが取れなくても接続は成立させる（列は既定名で読む）
      await save({})
    }
  }

  // ③ 保存して完了
  const save = async (patch: Partial<typeof propMap>) => {
    setPhase('saving')
    const s = getSettings()
    if (!s) { setPhase('error'); setError('設定の読み込みに失敗しました。'); return }
    const finalMap = { ...propMap, ...patch }
    saveSettings({
      ...s,
      searchMode: s.searchMode || 'notion',
      notionMedicalDbId: medicalId,
      notionReferenceDbId: referenceId,
      ...finalMap,
    })
    setPhase('done')
    setTimeout(onComplete, 1200)
  }

  return (
    <div className="fixed inset-0 z-[80] bg-white dark:bg-gray-900 overflow-y-auto">
      <div className="max-w-md mx-auto px-6 py-10 space-y-5">
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">
          かんたん接続{workspace ? `：${workspace}` : ''}
        </h1>

        {phase === 'restoring' && (
          <p className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <Spinner className="w-4 h-4" />Notionから接続情報を受け取っています…
          </p>
        )}

        {phase === 'pick' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              許可したページの中から、知識本体のデータベース（Medical DB）を選んでください。
            </p>
            {dbs.length === 0 ? (
              <div className="bg-amber-50 dark:bg-amber-900/30 rounded-xl p-3 text-xs text-amber-700 dark:text-amber-300">
                データベースが見つかりませんでした。Notionの認可画面で、DBのあるページを選び直してください。
                <button type="button" onClick={() => { window.location.href = '/api/notion/oauth/start' }} className="mt-2 w-full border border-amber-400 rounded-lg py-2 font-semibold">
                  ページを選び直す
                </button>
              </div>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Medical DB（必須）</label>
                  <select value={medicalId} onChange={(e) => setMedicalId(e.target.value)} className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white">
                    <option value="">選んでください</option>
                    {dbs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 dark:text-gray-300 mb-1">Reference DB（文献・任意）</label>
                  <select value={referenceId} onChange={(e) => setReferenceId(e.target.value)} className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-2 text-sm bg-white dark:bg-gray-700 dark:text-white">
                    <option value="">使わない</option>
                    {dbs.filter((d) => d.id !== medicalId).map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                  </select>
                </div>
                <button type="button" disabled={!medicalId} onClick={() => void confirmDbs()} className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold disabled:opacity-50">
                  このDBでつなぐ
                </button>
              </>
            )}
          </div>
        )}

        {phase === 'columns' && schema && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">列の読み取りを確認してください（あとから設定でも変えられます）。</p>
            <PropMapEditor schema={schema} value={propMap} onChange={(p) => setPropMap((v) => ({ ...v, ...p }))} />
            <button type="button" onClick={() => void save({})} className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold">
              この設定で完了
            </button>
          </div>
        )}
        {phase === 'columns' && !schema && (
          <p className="flex items-center gap-2 text-sm text-gray-500"><Loader2 className="w-4 h-4 animate-spin" />列を確認しています…</p>
        )}

        {phase === 'saving' && (
          <p className="flex items-center gap-2 text-sm text-gray-500"><Spinner className="w-4 h-4" />保存しています…</p>
        )}

        {phase === 'done' && (
          <p className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400 font-medium">
            <CheckCircle2 className="w-5 h-5" />接続できました
          </p>
        )}

        {phase === 'error' && (
          <div className="space-y-3">
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            <button type="button" onClick={onComplete} className="w-full border border-gray-300 dark:border-gray-600 rounded-xl py-2.5 text-sm">閉じる</button>
          </div>
        )}
      </div>
    </div>
  )
}
```

（注: `<Database className="hidden" />` は `<option>` 内に要素を置けないため**削除すること**。実装時は `{d.title}` のみにする——このコード例の1箇所だけ意図的な修正ポイント）

- [ ] **Step 2: page.tsx に受け口を追加**

`src/app/page.tsx`:
- import追加: `const OAuthFinish = dynamicImport(() => import('@/components/OAuthFinish').then((m) => m.OAuthFinish), { ssr: false })`（既存のdynamicImportパターンに合わせる）
- state追加（`showOnboardingFromSetup` の近く）: `const [showOauthFinish, setShowOauthFinish] = useState(false)`
- マウント時のURLクエリ処理（既存のクエリ処理useEffectがあればそこへ、なければ新設）:

```tsx
  // かんたん接続（OAuth）から戻ったときの受け口。クエリを消してからシートを開く。
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('oauth') === 'notion-done') {
      window.history.replaceState(null, '', window.location.pathname)
      setShowOauthFinish(true)
    }
    const oauthErr = params.get('oauthError')
    if (oauthErr) {
      window.history.replaceState(null, '', window.location.pathname)
      const msg = oauthErr === 'login'
        ? 'かんたん接続には、先にメールアドレスでのログインが必要です。'
        : oauthErr === 'denied'
        ? 'Notionでの許可がキャンセルされました。もう一度お試しください。'
        : oauthErr === 'unconfigured'
        ? 'かんたん接続は現在準備中です。手動接続をご利用ください。'
        : 'かんたん接続に失敗しました。もう一度お試しください。'
      window.alert(msg)
    }
  }, [])
```

- レンダー: オンボーディング/SetupWizard分岐より**前**（最優先）に:

```tsx
  if (showOauthFinish) {
    return <OAuthFinish onComplete={() => { setShowOauthFinish(false); setSetupDone(true); setShowSettings(false) }} />
  }
```

（`setSetupDone` 等は既存のSetupWizard onComplete と同じ処理系を使う。既存コードの完了処理に合わせること）

- [ ] **Step 3: 確認とコミット**

Run: `npx tsc --noEmit && npx vitest run 2>&1 | tail -3`

```bash
git add src/components/OAuthFinish.tsx src/app/page.tsx
git commit -m "かんたん接続の仕上げシートを追加（復元待ち→DB選択→列確認→保存）

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: SetupWizard に「かんたん接続（推奨）」

**Files:**
- Modify: `src/components/SetupWizard.tsx`（Notionステップの冒頭）

**Interfaces:**
- Consumes: `/api/notion/oauth/start`（フルページ遷移）

- [ ] **Step 1: ボタンを追加**

Notionステップ（「Notionとつなぐ」見出しの直下・「これから、Notionとこのアプリをつなぎます」カードの**前**）に:

```tsx
              {/* かんたん接続（OAuth）。トークン手作業を丸ごと置き換える推奨経路。
                  未ログインならサーバーが /?oauthError=login で戻すので、ここでは判定しない。 */}
              <div className="rounded-2xl border-2 border-brand-500 dark:border-brand-600 p-4 space-y-2 bg-brand-50/50 dark:bg-brand-900/20">
                <p className="text-sm font-bold text-gray-900 dark:text-white">かんたん接続 <span className="ml-1 text-[10px] align-middle bg-brand-600 text-white rounded-full px-2 py-0.5">推奨</span></p>
                <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
                  Notionの画面でページを選んで許可するだけで、接続が終わります。トークンの作成やコピーは不要です。既存のページを編集することはありません。
                </p>
                <button
                  type="button"
                  onClick={() => { window.location.href = '/api/notion/oauth/start' }}
                  className="w-full bg-brand-600 hover:bg-brand-700 text-white rounded-xl py-3 text-sm font-semibold transition-colors"
                >
                  Notionでページを選んで接続する
                </button>
                <p className="text-[11px] text-gray-400 dark:text-gray-500">先にメールアドレスでのログインが必要です（未ログインの場合は案内が出ます）。</p>
              </div>

              <details className="rounded-xl border border-gray-200 dark:border-gray-600 overflow-hidden">
                <summary className="bg-gray-50 dark:bg-gray-700 px-3 py-2 cursor-pointer select-none text-xs font-semibold text-gray-700 dark:text-gray-200">
                  手動で接続する（トークンを自分で作る・上級者向け）
                </summary>
                <div className="p-3 space-y-4">
                  {/* ここに既存のNotionステップの中身（合鍵カード〜Token入力〜DB欄〜接続テスト）を移動 */}
                </div>
              </details>
```

既存のNotionステップの中身（「これから、Notionとこのアプリをつなぎます」カードからDB入力・接続テストまで）を、上記 `<details>` の中へ**そのまま移動**する（コードの変更はインデントのみ。ロジックは触らない）。テンプレ複製派のフロー（テンプレートを複製して使う）はどうなるか実装時に確認し、`<details>` の外に出すべき要素（モード分岐タブ等）があれば構造を保って外に残す。**判断に迷う構造があれば BLOCKED で戻すこと。**

- [ ] **Step 2: 確認とコミット**

Run: `npx tsc --noEmit && npx vitest run 2>&1 | tail -3`
手動確認（devサーバー）: Notionステップの最上部に「かんたん接続」カード、手動フローはdetailsに収納されて全操作が生きていること。

```bash
git add src/components/SetupWizard.tsx
git commit -m "セットアップに「かんたん接続（推奨）」を追加・手動接続をdetailsへ収納

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 設定画面の接続状態表示と再接続

**Files:**
- Modify: `src/components/SettingsPanel.tsx`（Notion接続設定セクションの冒頭）

- [ ] **Step 1: 出自バッジ＋再接続ボタンを追加**

Notion接続設定セクション（「入れ直す前に」カードの直後）に:

```tsx
              {getSettings()?.notionAuthKind === 'oauth' && (
                <div className="bg-brand-50 dark:bg-brand-900/25 border border-brand-100 dark:border-brand-800 rounded-xl p-3 space-y-2 text-xs text-brand-800 dark:text-brand-200">
                  <p className="font-semibold">
                    かんたん接続でつながっています{getSettings()?.notionWorkspaceName ? `（${getSettings()?.notionWorkspaceName}）` : ''}
                  </p>
                  <p>読めるページを増やす・減らすときや、接続をやり直すときは、もう一度Notionの画面から選び直せます。</p>
                  <button
                    type="button"
                    onClick={() => { window.location.href = '/api/notion/oauth/start' }}
                    className="w-full border border-brand-300 dark:border-brand-700 rounded-lg py-2 font-semibold hover:bg-brand-100 dark:hover:bg-brand-900/40 transition-colors"
                  >
                    Notionでページを選び直す
                  </button>
                </div>
              )}
```

- [ ] **Step 2: 確認とコミット**

Run: `npx tsc --noEmit && npx vitest run 2>&1 | tail -3`

```bash
git add src/components/SettingsPanel.tsx
git commit -m "設定にかんたん接続の状態表示と「ページを選び直す」を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: 仕上げ（FAQ・プライバシーポリシー・ビルド・最終レビュー）

**Files:**
- Modify: `src/lib/help-faq.ts`
- Modify: `src/app/privacy/page.tsx`（取得情報の節に「かんたん接続」の1項目を追記）

- [ ] **Step 0: プライバシーポリシーに追記**

`src/app/privacy/page.tsx` の取得・保存する情報を列挙している節に、既存の文体・トーンに合わせて1項目追加する（周辺の実文面を読んでから挿入位置を決めること）:

```
かんたん接続（Notion公式のOAuth認可）をご利用の場合、Notionが発行するアクセストークンとワークスペース名を、暗号化のうえサーバーに保存します。このトークンで当サービスが行うのは、お客様が許可したページの読み取りと、疑問メモの新規作成のみです。既存のページを編集することはありません。接続はNotion側の設定からいつでも解除できます。
```

- [ ] **Step 1: FAQ更新**

(a) `id: 'setup-token'` の回答の**先頭**に1文を足す:

```
いまは「かんたん接続」（セットアップのNotion画面の一番上）を使うと、トークンを作らずにNotionの画面でページを選ぶだけで接続できます。以下は手動接続（トークンを自分で作る場合）の手順です。
```

(b) 新規エントリをセットアップカテゴリ先頭に追加:

```ts
  {
    id: 'setup-oauth',
    category: 'セットアップ',
    q: '「かんたん接続」とは？トークンとどう違う？',
    a: 'Notionの画面でページを選んで許可するだけで接続が終わる方式です。トークンの作成・コピー・コネクト追加は必要ありません。権限は「読み取りと追加」だけで、既存のページを編集することはありません。アカウント（メールログイン）に接続が保存されるため、先にログインが必要です。従来どおりトークンを自分で作る手動接続も、セットアップの「手動で接続する」から使えます。',
    keywords: 'かんたん接続 oauth 認可 許可 ページを選ぶ トークン不要 簡単 接続方法',
  },
```

- [ ] **Step 2: 全体確認**

Run: `npx vitest run && npx tsc --noEmit && npm run build 2>&1 | tail -5`
Expected: すべて成功

- [ ] **Step 3: コミット**

```bash
git add src/lib/help-faq.ts
git commit -m "FAQにかんたん接続の項目を追加・トークン手順を手動接続の位置づけに

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

## 手動E2Eチェックリスト（マージ前・オーナー実施）

- [ ] ローカル `.env.local` に NOTION_OAUTH_CLIENT_ID/SECRET を設定（オーナー作業）
- [ ] 未ログインで「かんたん接続」→ ログイン案内が出る
- [ ] ログイン後「かんたん接続」→ Notion認可画面（MediNode名・読み取り/挿入のみの表示）→ ページ選択 → 仕上げシートが開き、DB選択 → 列確認（既定名DBならスキップ）→ 完了 → 検索が動く
- [ ] 設定に「かんたん接続でつながっています（WS名）」＋選び直しボタン
- [ ] 手動接続（details内）が従来どおり完走できる
- [ ] 認可画面でキャンセル → 静かなエラーメッセージで戻る
- [ ] 本番envはVercel設定済みのため、マージ後に本番でも一連を1回確認
