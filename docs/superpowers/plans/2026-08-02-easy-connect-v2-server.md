# 段B-1: かんたん接続v2 サーバー基盤 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** どのブラウザ文脈で認可が完了しても成立する（Cookie非依存の）Notion OAuth を作り、トークンは本人のログイン済みセッションで引き取るまで `user_settings` に入れない。引き取り時に既存接続が壊れないことを検査する。

**Architecture:** state はCookieではなく新テーブル `oauth_states` に保存する。`/api/notion/oauth/start` が state を発行して中間ページ `/connect/notion` へ送り、そこから Notion の認可へ出る。`/api/notion/oauth/callback` は Cookie もセッションも要求せず、state だけを鍵にトークンを交換し、**`user_settings` には書かず** `oauth_states.token_enc` に暗号化して置き、完了ページ `/connect/notion/done` を見せる。アプリは `POST /api/notion/oauth/claim`（要ログイン・要 `easy_connect` 機能）で自分の completed state を引き取り、そこで初めて設定へマージする。マージ前に、既存のDB IDが新トークンで読めるかを検査し、読めなければ**何も書かずに conflict を返す**。

**Tech Stack:** Next.js 16 App Router / TypeScript / vitest / Supabase (service_role) / @notionhq/client / 既存 `src/lib/crypto.ts` (AES-256-GCM)

**Spec:** `docs/superpowers/specs/2026-08-02-easy-connect-v2-design.md` — §3（アーキテクチャ）・§6（セキュリティ）・§10（既存ユーザーの保護）・§12（主役切替）・§17（2つの鍵）

## Global Constraints

- **`user_settings` を壊さない。** 既存設定の読み取りに失敗した場合・復号に失敗した場合は**書き込まずに中断する**（v1で確立した原則。`callback/route.ts:63-83` のコメント参照）。DEFAULTでの上書きは行の不在時のみ
- **既存のDB IDが新トークンで読めないなら、トークンを差し替えない**（§10b）。conflict を返して state は `completed` のまま残す
- **部署（team）接続には触らない。** `teamNotionToken` / `teamNotionMedicalDbId` 等は claim のマージ対象外（§10c）
- claim が書くのは `notionToken` / `notionAuthKind` / `notionWorkspaceName` / `notionDuplicatedTemplateId` / `notionTokenPrev` / `notionAuthKindPrev` のみ
- **可視性の鍵は `easy_connect` 機能**（§17）。`isEasyConnectOn()`（`NEXT_PUBLIC_EASY_CONNECT`）は本計画で廃止し、サーバー判定 `sessionHasFeature('easy_connect')` に置き換える。**止まる方向の挙動は維持する**（機能を持たない人は今までどおり静かにホームへ戻す）
- **無効な state は全て同一の静かなエラー**にする（列挙攻撃に情報を返さない・§6）
- client_secret とアクセストークンはサーバー専用。クライアントへ渡すのは claim の応答のみ、ログには出さない
- 新しい依存パッケージを追加しない（トークン交換は `fetch`、乱数は `node:crypto`）
- 文言は静かな日本語・感嘆符なし
- `npx tsc --noEmit` と `npx vitest run` が各タスク完了時に全パス
- コミットメッセージは日本語。末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **作業は worktree で隔離する**（このリポジトリは他セッションが同時に触っている）
- migration は手で流す運用。SQLを書いたら `supabase/migrations/README.md` の表に行を足す（流すのはオーナー）

### 時間の扱い（この計画で確定させる値）

- **pending の有効期限 = 10分**（§6）。超過した state で callback が来ても交換しない
- **completed の引き取り可能期間 = 60分**。スマホで始めてPCで認可を終え、スマホに戻るまでの猶予。§3c の「PWAに戻ると自動でつながる」を成立させるために pending より長く取る
- 掃除は claim 時と start 時に自分の期限切れ行を削除する（cronは足さない・§3a）

### 仕様からの意図的な逸脱（1件）

§6 は「Cookie検証は同一ブラウザ完了時の追加チェックとして残す（あれば照合・なければ許容）」としているが、**本計画では `STATE_COOKIE` を完全に廃止する。**

理由: 「なければ許容」である以上、Cookieを持たない経路（PWA・PCハンドオフ＝v2が成立させたい経路そのもの）では検証が素通りする。攻撃者は Cookie を送らなければよいだけなので、この検証はセッション固定攻撃に対して何も足さない。実際の防御は「トークンは claim まで設定に入らない」と「完了ページで保存先アカウントを見せる」の2つが担っている。素通りする検証を残すと、読む人に守られていると誤解させる。

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `supabase/migrations/0022_oauth_states.sql`（新規） | `oauth_states` テーブル |
| `src/lib/oauth-state.ts`（新規） | 純関数。state生成・期限判定・メールのマスク表示 |
| `src/lib/supabase/oauth-states.ts`（新規） | `oauth_states` への読み書き（service_role）。DBアクセスをここだけに閉じる |
| `src/lib/notion-readability.ts`（新規） | 純ロジック＋Notion呼び出し。既存DB IDが新トークンで読めるかの検査 |
| `src/app/api/notion/oauth/start/route.ts`（変更） | 要ログイン・要 `easy_connect`。state発行→中間ページへ |
| `src/app/api/notion/oauth/callback/route.ts`（変更） | Cookie・セッション不要。state検証→交換→`token_enc` 保存→完了ページへ |
| `src/app/api/notion/oauth/claim/route.ts`（新規） | 要ログイン・要 `easy_connect`。引き取り＋既存接続の保護＋設定マージ |
| `src/app/api/notion/oauth/claimable/route.ts`（新規） | 要ログイン。自分の completed の有無だけ返す |
| `src/app/connect/notion/page.tsx`（新規） | 中間ページ。認可へ出る直前。PCハンドオフのリンク |
| `src/app/connect/notion/CopyLink.tsx`（新規） | リンクコピーのクライアント部品（中間ページ唯一のJS） |
| `src/app/connect/notion/done/page.tsx`（新規） | 完了ページ。保存先アカウントのマスク表示＋戻る導線 |
| `src/proxy.ts`（変更） | `/connect` を公開パスに加える |
| `src/lib/easy-connect-flag.ts`（削除） | 機能ゲートへ置き換え |

---

### Task 1: worktree 作成と migration 0022

**Files:**
- Create: worktree `~/medical-search-public.worktrees/easy-connect-v2-server`（ブランチ `feat/easy-connect-v2-server`）
- Create: `supabase/migrations/0022_oauth_states.sql`
- Modify: `supabase/migrations/README.md`

**Interfaces:**
- Produces: テーブル `public.oauth_states`。Task 3 が読み書きする

- [ ] **Step 1: worktree を作る**

```bash
cd ~/medical-search-public && git worktree add ~/medical-search-public.worktrees/easy-connect-v2-server -b feat/easy-connect-v2-server main
cd ~/medical-search-public.worktrees/easy-connect-v2-server && npm install
```

以降のコマンドはすべて `~/medical-search-public.worktrees/easy-connect-v2-server` で実行する。

- [ ] **Step 2: SQL を書く**

`supabase/migrations/0022_oauth_states.sql`:

```sql
-- MediNode かんたん接続（Notion OAuth）の state 保管。
-- v1 は state を httpOnly Cookie に置いていたが、スタンドアロンPWAのストレージは
-- Safari本体と別なので、PWAから認可へ出るとcallback側にCookieが無く完走できなかった。
-- そこで state をサーバーに持ち、「どのブラウザで認可が完了しても、本人のアプリで
-- 引き取れる」形にする。
--
-- 重要: callback はトークンを user_settings には書かず、ここに暗号化して置くだけにする。
-- 本人のログイン済みセッションからの claim を経て初めて設定へ入る（セッション固定対策）。
--
-- status の遷移は pending → completed → claimed の一方向のみ。
-- token_enc は claim 済み・期限切れの行では null に落とす。

create table if not exists public.oauth_states (
  state        text primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  status       text not null default 'pending',
  token_enc    text,
  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

-- claim は「自分の completed を新しい順に1件」引くので、その形に索引を張る。
create index if not exists oauth_states_user_status_idx
  on public.oauth_states (user_id, status, completed_at desc);

alter table public.oauth_states enable row level security;

-- ポリシーを作らない＝ anon / authenticated からは一切読めない。
-- 読み書きはすべてサーバー（service_role）経由に限る。token_enc を含むため、
-- 本人であってもクライアントから直接引かせない。
```

- [ ] **Step 3: 適用台帳に行を足す**

`supabase/migrations/README.md` の表の `| 0021 | early_access_features | ...` 行の下に追記する:

```
| 0022 | oauth_states | `oauth_states` | ⬜ |
```

- [ ] **Step 4: 確認とコミット**

Run: `npx tsc --noEmit`
Expected: 0件（TSは変えていないので当然だが、worktreeが健全なことの確認を兼ねる）

```bash
git add supabase/migrations/0022_oauth_states.sql supabase/migrations/README.md
git commit -m "migration 0022: かんたん接続のstate保管テーブル oauth_states を追加

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: state の純関数（TDD）

**Files:**
- Create: `src/lib/oauth-state.ts`
- Test: `src/lib/__tests__/oauth-state.test.ts`

**Interfaces:**
- Produces: `PENDING_TTL_MS = 10 * 60_000`／`CLAIM_WINDOW_MS = 60 * 60_000`／`generateState(): string`／`isPendingExpired(createdAt: string, nowMs: number): boolean`／`isClaimExpired(completedAt: string | null, nowMs: number): boolean`／`maskEmail(email: string | null | undefined): string`。Task 3・5・6・8 が使う

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/oauth-state.test.ts`:

```ts
// かんたん接続の state まわりの純関数。時刻は引数で受けるので Date への依存が無く、
// 期限の境界をそのまま書ける。
import { describe, it, expect } from 'vitest'
import {
  generateState,
  isPendingExpired,
  isClaimExpired,
  maskEmail,
  PENDING_TTL_MS,
  CLAIM_WINDOW_MS,
} from '../oauth-state'

describe('generateState', () => {
  it('48文字の16進文字列（24バイト）を返す', () => {
    const s = generateState()
    expect(s).toMatch(/^[0-9a-f]{48}$/)
  })
  it('呼ぶたびに違う値になる', () => {
    const set = new Set(Array.from({ length: 50 }, () => generateState()))
    expect(set.size).toBe(50)
  })
})

describe('isPendingExpired', () => {
  const base = Date.parse('2026-08-02T00:00:00.000Z')
  it('作成直後は期限内', () => {
    expect(isPendingExpired('2026-08-02T00:00:00.000Z', base)).toBe(false)
  })
  it('TTLちょうどはまだ期限内', () => {
    expect(isPendingExpired('2026-08-02T00:00:00.000Z', base + PENDING_TTL_MS)).toBe(false)
  })
  it('TTLを1ms超えたら期限切れ', () => {
    expect(isPendingExpired('2026-08-02T00:00:00.000Z', base + PENDING_TTL_MS + 1)).toBe(true)
  })
  it('解釈できない日時は期限切れ扱い（安全側）', () => {
    expect(isPendingExpired('not-a-date', base)).toBe(true)
  })
})

describe('isClaimExpired', () => {
  const base = Date.parse('2026-08-02T00:00:00.000Z')
  it('完了直後は引き取り可能', () => {
    expect(isClaimExpired('2026-08-02T00:00:00.000Z', base)).toBe(false)
  })
  it('猶予を超えたら引き取り不可', () => {
    expect(isClaimExpired('2026-08-02T00:00:00.000Z', base + CLAIM_WINDOW_MS + 1)).toBe(true)
  })
  it('completed_at が無ければ引き取り不可（安全側）', () => {
    expect(isClaimExpired(null, base)).toBe(true)
  })
})

describe('maskEmail', () => {
  it('ローカル部の先頭2文字だけ残す', () => {
    expect(maskEmail('tatsuki@example.com')).toBe('ta***@example.com')
  })
  it('ローカル部が2文字以下でも先頭1文字は残す', () => {
    expect(maskEmail('a@example.com')).toBe('a***@example.com')
    expect(maskEmail('ab@example.com')).toBe('ab***@example.com')
  })
  it('メールが無い・形になっていない場合は伏せる', () => {
    expect(maskEmail(null)).toBe('（不明なアカウント）')
    expect(maskEmail('')).toBe('（不明なアカウント）')
    expect(maskEmail('no-at-sign')).toBe('（不明なアカウント）')
  })
})
```

- [ ] **Step 2: 落ちることを確認**

Run: `npx vitest run src/lib/__tests__/oauth-state.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: 実装**

`src/lib/oauth-state.ts`:

```ts
// かんたん接続の state まわりの純関数。DB・Notion・next/headers に依存しない。
// 時刻は必ず引数で受け取る（テストで境界をそのまま書けるようにするため）。
import { randomBytes } from 'crypto'

// 認可へ出てから戻ってくるまでの猶予。これを過ぎた state では交換しない。
export const PENDING_TTL_MS = 10 * 60_000

// 認可が完了してから、本人のアプリが引き取るまでの猶予。
// スマホで始めてPCで認可を終え、スマホに戻るまでを想定して pending より長く取る。
export const CLAIM_WINDOW_MS = 60 * 60_000

// state は唯一の鍵（callbackはCookieもセッションも見ない）。推測不能な長さにする。
export function generateState(): string {
  return randomBytes(24).toString('hex')
}

function elapsedMs(iso: string | null, nowMs: number): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return nowMs - t
}

export function isPendingExpired(createdAt: string, nowMs: number): boolean {
  const elapsed = elapsedMs(createdAt, nowMs)
  // 日時が読めない行は壊れているとみなし、使わせない。
  if (elapsed === null) return true
  return elapsed > PENDING_TTL_MS
}

export function isClaimExpired(completedAt: string | null, nowMs: number): boolean {
  const elapsed = elapsedMs(completedAt, nowMs)
  if (elapsed === null) return true
  return elapsed > CLAIM_WINDOW_MS
}

// 完了ページに「どのアカウントへ保存するか」を出すための表示用。
// 心当たりの無いメールなら進まないでもらうのが目的なので、ドメインは残す。
export function maskEmail(email: string | null | undefined): string {
  if (!email) return '（不明なアカウント）'
  const at = email.indexOf('@')
  if (at <= 0) return '（不明なアカウント）'
  const local = email.slice(0, at)
  const domain = email.slice(at)
  return `${local.slice(0, 2)}***${domain}`
}
```

- [ ] **Step 4: 通ることを確認**

Run: `npx vitest run src/lib/__tests__/oauth-state.test.ts && npx tsc --noEmit`
Expected: 12件PASS・tsc 0件

- [ ] **Step 5: コミット**

```bash
git add src/lib/oauth-state.ts src/lib/__tests__/oauth-state.test.ts
git commit -m "かんたん接続のstate純関数を追加（生成・期限判定・メールのマスク）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: oauth_states のデータアクセス層（TDD）

**Files:**
- Create: `src/lib/supabase/oauth-states.ts`
- Test: `src/lib/__tests__/oauth-states-store.test.ts`

**Interfaces:**
- Consumes: Task 2 の `generateState` / `isPendingExpired` / `isClaimExpired`、既存 `@/lib/supabase/server` の `createAdminClient`
- Produces:
  - `type OAuthStateRow = { state: string; user_id: string; status: 'pending' | 'completed' | 'claimed'; token_enc: string | null; created_at: string; completed_at: string | null }`
  - `createPendingState(userId: string, nowMs: number): Promise<string | null>` — 発行した state を返す。失敗時 null
  - `takePendingState(state: string, nowMs: number): Promise<OAuthStateRow | null>` — pending かつ期限内の行だけ返す。それ以外は null
  - `markCompleted(state: string, tokenEnc: string, nowIso: string): Promise<boolean>`
  - `findClaimable(userId: string, nowMs: number): Promise<OAuthStateRow | null>` — completed かつ猶予内の最新1件
  - `markClaimed(state: string): Promise<boolean>` — token_enc を null に落とす
  - `purgeExpired(userId: string, nowMs: number): Promise<void>` — best-effort
  Task 5・6・8・9 が使う

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/oauth-states-store.test.ts`:

```ts
// oauth_states の読み書き層。Supabaseクライアントはモックし、
// 「期限切れを渡さない」「一方向にしか進めない」ことを検証する。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { insertMock, maybeSingleMock, updateEqMock, deleteMock, capturedSelect } = vi.hoisted(() => ({
  insertMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  updateEqMock: vi.fn(),
  deleteMock: vi.fn(),
  capturedSelect: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => ({
      insert: insertMock,
      select: (cols: string) => {
        capturedSelect(cols)
        return {
          eq: () => ({
            eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: maybeSingleMock }) }) }),
            maybeSingle: maybeSingleMock,
          }),
        }
      },
      update: () => ({ eq: () => ({ eq: updateEqMock }) }),
      delete: () => ({ eq: () => ({ lt: deleteMock }) }),
    }),
  }),
}))

import {
  createPendingState,
  takePendingState,
  markCompleted,
  findClaimable,
  markClaimed,
} from '../supabase/oauth-states'
import { PENDING_TTL_MS, CLAIM_WINDOW_MS } from '../oauth-state'

const NOW = Date.parse('2026-08-02T12:00:00.000Z')
const iso = (ms: number) => new Date(ms).toISOString()

beforeEach(() => {
  insertMock.mockReset().mockResolvedValue({ error: null })
  maybeSingleMock.mockReset()
  updateEqMock.mockReset().mockResolvedValue({ error: null })
  deleteMock.mockReset().mockResolvedValue({ error: null })
  capturedSelect.mockReset()
})

describe('createPendingState', () => {
  it('stateを発行して行を作り、その値を返す', async () => {
    const state = await createPendingState('u1', NOW)
    expect(state).toMatch(/^[0-9a-f]{48}$/)
    expect(insertMock.mock.calls[0][0]).toMatchObject({ state, user_id: 'u1', status: 'pending' })
  })
  it('挿入に失敗したら null', async () => {
    insertMock.mockResolvedValue({ error: { message: 'boom' } })
    expect(await createPendingState('u1', NOW)).toBeNull()
  })
})

describe('takePendingState', () => {
  it('pendingかつ期限内なら行を返す', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { state: 's', user_id: 'u1', status: 'pending', token_enc: null, created_at: iso(NOW), completed_at: null },
      error: null,
    })
    const row = await takePendingState('s', NOW)
    expect(row?.user_id).toBe('u1')
  })
  it('期限切れなら null', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { state: 's', user_id: 'u1', status: 'pending', token_enc: null, created_at: iso(NOW - PENDING_TTL_MS - 1), completed_at: null },
      error: null,
    })
    expect(await takePendingState('s', NOW)).toBeNull()
  })
  it('すでにcompletedなら null（再利用を許さない）', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { state: 's', user_id: 'u1', status: 'completed', token_enc: 'enc', created_at: iso(NOW), completed_at: iso(NOW) },
      error: null,
    })
    expect(await takePendingState('s', NOW)).toBeNull()
  })
  it('行が無い・読み取り失敗はどちらも null', async () => {
    maybeSingleMock.mockResolvedValue({ data: null, error: null })
    expect(await takePendingState('s', NOW)).toBeNull()
    maybeSingleMock.mockResolvedValue({ data: null, error: { message: 'x' } })
    expect(await takePendingState('s', NOW)).toBeNull()
  })
})

describe('markCompleted', () => {
  it('status=completed かつ pending の行だけを更新する', async () => {
    const ok = await markCompleted('s', 'enc-token', iso(NOW))
    expect(ok).toBe(true)
    expect(updateEqMock).toHaveBeenCalled()
  })
  it('更新に失敗したら false', async () => {
    updateEqMock.mockResolvedValue({ error: { message: 'x' } })
    expect(await markCompleted('s', 'enc', iso(NOW))).toBe(false)
  })
})

describe('findClaimable', () => {
  it('猶予内のcompletedを返す', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { state: 's', user_id: 'u1', status: 'completed', token_enc: 'enc', created_at: iso(NOW), completed_at: iso(NOW) },
      error: null,
    })
    const row = await findClaimable('u1', NOW)
    expect(row?.token_enc).toBe('enc')
  })
  it('猶予を過ぎていたら null', async () => {
    maybeSingleMock.mockResolvedValue({
      data: { state: 's', user_id: 'u1', status: 'completed', token_enc: 'enc', created_at: iso(NOW), completed_at: iso(NOW - CLAIM_WINDOW_MS - 1) },
      error: null,
    })
    expect(await findClaimable('u1', NOW)).toBeNull()
  })
})

describe('markClaimed', () => {
  it('token_enc を null に落として claimed にする', async () => {
    expect(await markClaimed('s')).toBe(true)
  })
})
```

- [ ] **Step 2: 落ちることを確認**

Run: `npx vitest run src/lib/__tests__/oauth-states-store.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: 実装**

`src/lib/supabase/oauth-states.ts`:

```ts
// oauth_states への読み書き。かんたん接続の state を扱うのはこのファイルだけにする
// （token_enc に触れる場所を1つに閉じるため）。すべて service_role 経由。
import { createAdminClient } from '@/lib/supabase/server'
import { generateState, isPendingExpired, isClaimExpired } from '@/lib/oauth-state'

export type OAuthStateRow = {
  state: string
  user_id: string
  status: 'pending' | 'completed' | 'claimed'
  token_enc: string | null
  created_at: string
  completed_at: string | null
}

const COLUMNS = 'state, user_id, status, token_enc, created_at, completed_at'

// 認可へ出る直前に発行する。失敗しても例外は投げず null を返す（呼び出し側が静かに戻す）。
export async function createPendingState(userId: string, nowMs: number): Promise<string | null> {
  const state = generateState()
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('oauth_states').insert({
      state,
      user_id: userId,
      status: 'pending',
      created_at: new Date(nowMs).toISOString(),
    })
    if (error) return null
    return state
  } catch {
    return null
  }
}

// callback から呼ぶ。pending かつ期限内の行だけを返す。
// 期限切れ・すでに completed / claimed・行なし・読み取り失敗はすべて null（同じ静かなエラーへ倒す）。
export async function takePendingState(state: string, nowMs: number): Promise<OAuthStateRow | null> {
  if (!state) return null
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('oauth_states')
      .select(COLUMNS)
      .eq('state', state)
      .maybeSingle()
    if (error || !data) return null
    const row = data as OAuthStateRow
    if (row.status !== 'pending') return null
    if (isPendingExpired(row.created_at, nowMs)) return null
    return row
  } catch {
    return null
  }
}

// トークンを暗号化して置き、pending → completed に進める。
// where に status='pending' を含めることで、同じ state で二重に交換されても
// 後勝ちで上書きされない（一方向を DB 側でも担保する）。
export async function markCompleted(state: string, tokenEnc: string, nowIso: string): Promise<boolean> {
  try {
    const admin = createAdminClient()
    const { error } = await admin
      .from('oauth_states')
      .update({ status: 'completed', token_enc: tokenEnc, completed_at: nowIso })
      .eq('state', state)
      .eq('status', 'pending')
    return !error
  } catch {
    return false
  }
}

// claim から呼ぶ。自分の completed のうち、猶予内で最も新しいもの。
export async function findClaimable(userId: string, nowMs: number): Promise<OAuthStateRow | null> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('oauth_states')
      .select(COLUMNS)
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    const row = data as OAuthStateRow
    if (isClaimExpired(row.completed_at, nowMs)) return null
    return row
  } catch {
    return null
  }
}

// 引き取り完了。token_enc は保持し続ける理由が無いので落とす。
export async function markClaimed(state: string): Promise<boolean> {
  try {
    const admin = createAdminClient()
    const { error } = await admin
      .from('oauth_states')
      .update({ status: 'claimed', token_enc: null })
      .eq('state', state)
      .eq('status', 'completed')
    return !error
  } catch {
    return false
  }
}

// 自分の古い行の掃除。best-effort（失敗しても主処理は続ける）。cronは足さない。
export async function purgeExpired(userId: string, nowMs: number): Promise<void> {
  try {
    const admin = createAdminClient()
    // completed の猶予（60分）より古いものは pending / completed / claimed を問わず不要。
    const cutoff = new Date(nowMs - 60 * 60_000).toISOString()
    await admin.from('oauth_states').delete().eq('user_id', userId).lt('created_at', cutoff)
  } catch {
    // 掃除の失敗は無視してよい
  }
}
```

- [ ] **Step 4: 通ることを確認**

Run: `npx vitest run src/lib/__tests__/oauth-states-store.test.ts && npx tsc --noEmit && npx vitest run 2>&1 | tail -3`
Expected: 新規11件PASS・全suite PASS・tsc 0件

- [ ] **Step 5: コミット**

```bash
git add src/lib/supabase/oauth-states.ts src/lib/__tests__/oauth-states-store.test.ts
git commit -m "oauth_states のデータアクセス層を追加（期限判定つき・一方向遷移をDB側でも担保）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 既存DBの可読性検査（TDD）

**Files:**
- Create: `src/lib/notion-readability.ts`
- Test: `src/lib/__tests__/notion-readability.test.ts`

**Interfaces:**
- Produces: `type DbRef = { role: 'medical' | 'reference' | 'manual'; id: string }`／`findUnreadableDatabases(opts: { token: string; refs: DbRef[]; retrieve?: (token: string, id: string) => Promise<void> }): Promise<DbRef[]>`。Task 8（claim）が使う

**Why this exists:** §10a — 手動Tokenで運用中の人がかんたん接続を使うと、`notionToken` が「認可で選んだページしか読めないOAuthトークン」に置き換わる。既存のDB IDがその認可範囲外だと、同期も検索も静かに壊れる。差し替える前に読めるか確かめ、読めないなら差し替えない。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/notion-readability.test.ts`:

```ts
// 新しいトークンで既存のDB IDが読めるかの検査。
// Notion呼び出しは差し替え可能にしてあるので、ここではネットワークに出ない。
import { describe, it, expect, vi } from 'vitest'
import { findUnreadableDatabases, type DbRef } from '../notion-readability'

const refs: DbRef[] = [
  { role: 'medical', id: 'db-med' },
  { role: 'reference', id: 'db-ref' },
]

describe('findUnreadableDatabases', () => {
  it('全部読めれば空配列', async () => {
    const retrieve = vi.fn().mockResolvedValue(undefined)
    expect(await findUnreadableDatabases({ token: 't', refs, retrieve })).toEqual([])
    expect(retrieve).toHaveBeenCalledTimes(2)
  })

  it('読めないものだけを返す', async () => {
    const retrieve = vi.fn(async (_t: string, id: string) => {
      if (id === 'db-ref') throw new Error('Could not find database')
    })
    expect(await findUnreadableDatabases({ token: 't', refs, retrieve })).toEqual([
      { role: 'reference', id: 'db-ref' },
    ])
  })

  it('空のidは検査対象にしない', async () => {
    const retrieve = vi.fn().mockResolvedValue(undefined)
    const res = await findUnreadableDatabases({
      token: 't',
      refs: [{ role: 'medical', id: '' }, { role: 'manual', id: '  ' }],
      retrieve,
    })
    expect(res).toEqual([])
    expect(retrieve).not.toHaveBeenCalled()
  })

  it('refs が空なら Notion を呼ばない', async () => {
    const retrieve = vi.fn()
    expect(await findUnreadableDatabases({ token: 't', refs: [], retrieve })).toEqual([])
    expect(retrieve).not.toHaveBeenCalled()
  })

  it('全部読めない場合は全部返る（順序は refs のまま）', async () => {
    const retrieve = vi.fn().mockRejectedValue(new Error('unauthorized'))
    expect(await findUnreadableDatabases({ token: 't', refs, retrieve })).toEqual(refs)
  })
})
```

- [ ] **Step 2: 落ちることを確認**

Run: `npx vitest run src/lib/__tests__/notion-readability.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: 実装**

`src/lib/notion-readability.ts`:

```ts
// かんたん接続で新しいトークンに差し替える前に、いま使っているDBがそのトークンで
// 読めるかを確かめる。OAuthのトークンは「認可画面で選んだページ」しか読めないため、
// 既存のDBが範囲外だと同期も検索も静かに壊れる（§10a）。
import { Client } from '@notionhq/client'

export type DbRef = { role: 'medical' | 'reference' | 'manual'; id: string }

// 既定の読み取り。1件でも失敗したら「読めない」とみなす（理由は問わない）。
async function retrieveWithNotion(token: string, id: string): Promise<void> {
  const notion = new Client({ auth: token })
  await notion.databases.retrieve({ database_id: id })
}

export async function findUnreadableDatabases(opts: {
  token: string
  refs: DbRef[]
  // テストと、将来の差し替えのために注入できるようにしておく。
  retrieve?: (token: string, id: string) => Promise<void>
}): Promise<DbRef[]> {
  const retrieve = opts.retrieve ?? retrieveWithNotion
  const targets = opts.refs.filter((r) => r.id.trim().length > 0)
  if (targets.length === 0) return []

  const results = await Promise.all(
    targets.map(async (ref) => {
      try {
        await retrieve(opts.token, ref.id)
        return null
      } catch {
        return ref
      }
    }),
  )
  return results.filter((r): r is DbRef => r !== null)
}
```

- [ ] **Step 4: 通ることを確認**

Run: `npx vitest run src/lib/__tests__/notion-readability.test.ts && npx tsc --noEmit`
Expected: 5件PASS・tsc 0件

- [ ] **Step 5: コミット**

```bash
git add src/lib/notion-readability.ts src/lib/__tests__/notion-readability.test.ts
git commit -m "新トークンで既存DBが読めるかの検査を追加（差し替え前の保護）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: start ルートの作り直し（サーバーstate・機能ゲート）

**Files:**
- Modify: `src/app/api/notion/oauth/start/route.ts`
- Delete: `src/lib/easy-connect-flag.ts`
- Modify: `src/app/api/notion/oauth/callback/route.ts`（import だけ暫定対応・本体は Task 6）
- Modify: `src/app/page.tsx`（`isEasyConnectOn` の呼び出しを外す）
- Modify: `src/components/SetupWizard.tsx`（同上）
- Modify: `src/components/SettingsPanel.tsx`（同上）
- Test: `src/lib/__tests__/oauth-start-route.test.ts`

**Interfaces:**
- Consumes: Task 2 の定数、Task 3 の `createPendingState` / `purgeExpired`、段Aの `sessionHasFeature`（`@/lib/supabase/early-access`）
- Produces: `GET /api/notion/oauth/start` → `easy_connect` を持つログイン済みユーザーには `/connect/notion?s=<state>` へ302。それ以外は `/` へ302（静かに戻す）

**重要（挙動の置き換え）:** いまの可視性は `isEasyConnectOn()`（`NEXT_PUBLIC_EASY_CONNECT`）。これを `sessionHasFeature('easy_connect')` に置き換える。**止まる方向は変えない** — 機能を持たない人はこれまでどおり静かに `/` へ戻る。クライアント側（`page.tsx` / `SetupWizard.tsx` / `SettingsPanel.tsx`）は段B-2でカードを出し分けるので、本タスクでは「常に非表示側」に倒す最小変更にとどめる:
- `SetupWizard.tsx`: `const EASY_CONNECT_ON = false` にし、import を削除（カードは段B-2で機能ベースに戻す）
- `SettingsPanel.tsx`: `isEasyConnectOn()` の呼び出しを `false` に置き換え（＝「調整中」の案内が出続ける。段B-2で機能ベースに）
- `page.tsx`: OAuth帰還の受け口は段B-2で作り直すため、いまは常に閉じたまま（`isEasyConnectOn()` を `false` に置換）

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/oauth-start-route.test.ts`:

```ts
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
```

- [ ] **Step 2: 落ちることを確認**

Run: `npx vitest run src/lib/__tests__/oauth-start-route.test.ts`
Expected: FAIL

- [ ] **Step 3: start を実装**

`src/app/api/notion/oauth/start/route.ts` を全文置き換え:

```ts
// かんたん接続の入口。資格（ログイン＋easy_connect機能）を確かめ、state を
// サーバーに発行してから中間ページへ送る。認可URLへ直接飛ばさないのは、
// スマホで開けなかったときにPCへ逃がす導線を挟むため（§4b）。
//
// 資格が無い場合は理由を出さずにホームへ戻す。かんたん接続は指定アカウントだけの
// 先行体験なので、持っていない人に存在を説明しない。
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sessionHasFeature } from '@/lib/supabase/early-access'
import { createPendingState, purgeExpired } from '@/lib/supabase/oauth-states'

function home(req: NextRequest): NextResponse {
  return NextResponse.redirect(new URL('/', req.url))
}

export async function GET(req: NextRequest) {
  if (!process.env.NOTION_OAUTH_CLIENT_ID || !process.env.NOTION_OAUTH_CLIENT_SECRET) {
    return home(req)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return home(req)

  if (!(await sessionHasFeature('easy_connect'))) return home(req)

  const nowMs = Date.now()
  // 自分の古い行を掃除してから発行する（cronを持たないため・§3a）。
  await purgeExpired(user.id, nowMs)

  const state = await createPendingState(user.id, nowMs)
  if (!state) return home(req)

  const url = new URL('/connect/notion', req.url)
  url.searchParams.set('s', state)
  return NextResponse.redirect(url)
}
```

- [ ] **Step 4: フラグの参照を外す**

`src/lib/easy-connect-flag.ts` を削除し、4つの参照元を次のように直す（いずれも「常に非表示」に倒す最小変更。段B-2で機能ベースに戻す）:

- `src/components/SetupWizard.tsx`: `import { isEasyConnectOn } from '@/lib/easy-connect-flag'` の行を削除し、`const EASY_CONNECT_ON = isEasyConnectOn()` を次に置き換える

```ts
// かんたん接続カードの表示。段B-2でアカウントの easy_connect 機能を見て出し分ける。
// それまでは非表示（手動接続だけが見える状態を維持する）。
const EASY_CONNECT_ON = false
```

- `src/components/SettingsPanel.tsx`: import を削除し、`if (!isEasyConnectOn()) {` を `if (true) {` ではなく、次のように書き換える（意図が読めるように）

```ts
                // 段B-2でアカウントの easy_connect 機能を見て出し分ける。
                // それまでは、かんたん接続でつながっている人にも手動接続へ戻す案内だけを出す。
                const easyConnectVisible = false
                if (!easyConnectVisible) {
```

- `src/app/page.tsx`: import を削除し、`if (!isEasyConnectOn()) {` を次に書き換える

```ts
    // OAuth帰還の受け口は段B-2で claim ベースに作り直す。それまでは閉じたままにし、
    // 前回の試行で残ったマーカーがあれば掃除する。
    const oauthReceiverOpen = false
    if (!oauthReceiverOpen) {
```

- `src/app/api/notion/oauth/callback/route.ts`: import と `if (!isEasyConnectOn()) { return back(req, '') }` を削除する（本体は Task 6 で全面的に作り直すので、ここでは import エラーを消すだけ）

既存テスト `src/lib/__tests__/notion-oauth-routes.test.ts` は start/callback の旧仕様を検証している。**start に関する describe は本タスクの新テストで置き換わるので削除する。** callback に関する describe は Task 6 で置き換えるため、本タスクでは `describe.skip` にし、`// Task 6 で新仕様に差し替える` とコメントを付ける。

- [ ] **Step 5: 通ることを確認**

Run: `npx vitest run src/lib/__tests__/oauth-start-route.test.ts && npx tsc --noEmit && npx vitest run 2>&1 | tail -3`
Expected: 新規5件PASS・全suite PASS（skip分を除く）・tsc 0件

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "start をサーバーstate＋easy_connect機能ゲートに作り直し、NEXT_PUBLIC_EASY_CONNECTを廃止

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: callback の作り直し（Cookie・セッション不要）

**Files:**
- Modify: `src/app/api/notion/oauth/callback/route.ts`
- Modify: `src/lib/notion-oauth.ts`（`STATE_COOKIE` の削除）
- Test: `src/lib/__tests__/notion-oauth-routes.test.ts`（callback の describe を新仕様に差し替え）

**Interfaces:**
- Consumes: Task 3 の `takePendingState` / `markCompleted`、既存 `exchangeCode`、既存 `encryptSettings` / `isCryptoReady`
- Produces: `GET /api/notion/oauth/callback?code&state` → 成功時 `/connect/notion/done?s=<state>` へ302。失敗時はすべて `/connect/notion/done?e=1` へ302（理由を出し分けない）

**重要:** このルートは**セッションを見ない**。PWAで始めてSafariで認可を終える経路では、callback を受けるブラウザに MediNode のセッションが無いのが普通だからだ（§1の原因②）。代わりに state が唯一の鍵になる。だから無効な state はすべて同じ静かなエラーに倒す（§6）。

- [ ] **Step 1: テストを新仕様に差し替える**

`src/lib/__tests__/notion-oauth-routes.test.ts` を全文置き換え:

```ts
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
```

- [ ] **Step 2: 落ちることを確認**

Run: `npx vitest run src/lib/__tests__/notion-oauth-routes.test.ts`
Expected: FAIL（旧実装がセッションを読むため）

- [ ] **Step 3: callback を実装**

`src/app/api/notion/oauth/callback/route.ts` を全文置き換え:

```ts
// かんたん接続の出口。v1と違い Cookie もセッションも見ない。
//
// なぜか: スタンドアロンPWAのストレージはSafari本体と別なので、PWAから認可へ出ると
// その先のブラウザに MediNode のセッションが無い。v1はここでユーザーを特定していたため、
// 認可がどこで完了してもログイン扱いにならず完走できなかった（設計書§1の原因②）。
//
// 代わりに state が唯一の鍵になる。だから無効な state は理由を出し分けず、すべて同じ
// 静かなエラーへ倒す（列挙攻撃に情報を返さない・§6）。
//
// そして成功してもトークンは user_settings には入れない。oauth_states に暗号化して置き、
// 本人のログイン済みセッションからの claim を経て初めて設定へ入る（セッション固定対策）。
import { NextRequest, NextResponse } from 'next/server'
import { encryptSettings, isCryptoReady } from '@/lib/crypto'
import { exchangeCode } from '@/lib/notion-oauth'
import { takePendingState, markCompleted } from '@/lib/supabase/oauth-states'

function done(req: NextRequest, params: Record<string, string>): NextResponse {
  const url = new URL('/connect/notion/done', req.url)
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

// 失敗はすべてこの1本に集約する。理由をURLに出さない。
function quietError(req: NextRequest): NextResponse {
  return done(req, { e: '1' })
}

export async function GET(req: NextRequest) {
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID
  const clientSecret = process.env.NOTION_OAUTH_CLIENT_SECRET
  if (!clientId || !clientSecret || !isCryptoReady()) return quietError(req)

  const params = req.nextUrl.searchParams
  // 認可画面でキャンセルした場合もここに来る。エラー扱いにはするが理由は出さない。
  if (params.get('error')) return quietError(req)

  const code = params.get('code') || ''
  const state = params.get('state') || ''
  if (!code || !state) return quietError(req)

  const row = await takePendingState(state, Date.now())
  if (!row) return quietError(req)

  let token
  try {
    const redirectUri = new URL('/api/notion/oauth/callback', req.url).toString()
    token = await exchangeCode({ code, redirectUri, clientId, clientSecret })
  } catch {
    return quietError(req)
  }

  // トークン一式をそのまま暗号化して置く（claim 側で復号して設定へマージする）。
  const ok = await markCompleted(state, encryptSettings(JSON.stringify(token)), new Date().toISOString())
  if (!ok) return quietError(req)

  return done(req, { s: state })
}
```

- [ ] **Step 4: `STATE_COOKIE` を消す**

`src/lib/notion-oauth.ts` から次の2行を削除する（v2はCookieを使わない）:

```ts
export const STATE_COOKIE = 'medinode_notion_oauth_state'
```

とその上のコメント行。`grep -rn "STATE_COOKIE" src/` で参照が残っていないことを確かめる（Task 5 で start からは既に消えている）。

- [ ] **Step 5: 通ることを確認**

Run: `npx vitest run src/lib/__tests__/notion-oauth-routes.test.ts && npx tsc --noEmit && npx vitest run 2>&1 | tail -3`
Expected: 新仕様7件PASS・全suite PASS・tsc 0件

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "callback をCookie・セッション非依存に作り直し、トークンはstateへ暗号化保存

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: 中間ページ `/connect/notion` と公開パス

**Files:**
- Create: `src/app/connect/notion/page.tsx`
- Create: `src/app/connect/notion/CopyLink.tsx`
- Modify: `src/proxy.ts`

**Interfaces:**
- Consumes: Task 3 の `takePendingState`（state の持ち主確認に流用）、既存 `buildAuthorizeUrl`
- Produces: `/connect/notion?s=<state>` ページ

**なぜ中間ページを挟むか（§4b）:** iPhoneでは認可URLをNotionアプリが横取りし、認可画面に到達できないことが実機で判明している。直接飛ばさず、ここに「うまく開かないときは、パソコンで」を常設して逃がす。

- [ ] **Step 1: 公開パスに `/connect` を足す**

`src/proxy.ts` の `PUBLIC_PREFIXES` を次に変更する:

```ts
// REQUIRE_LOGIN 有効時でもログイン無しでアクセスを許可するパス。
// /login 自身・認証コールバック・法務ページ等（無限リダイレクト防止＆規約閲覧の確保）。
// /connect はかんたん接続の中間ページと完了ページ。完了ページは「PWAで始めてSafariで
// 認可を終える」経路で開かれるため、そのブラウザにセッションが無いのが普通（§1）。
// ここでログインへ飛ばすと完了を見せられなくなる。
const PUBLIC_PREFIXES = ['/login', '/auth', '/privacy', '/terms', '/legal', '/connect']
```

- [ ] **Step 2: コピー部品を作る**

`src/app/connect/notion/CopyLink.tsx`:

```tsx
'use client'

// PCハンドオフ用のリンクコピー。中間ページで唯一クライアントJSが要る部分なので
// 小さく切り出す（ページ本体はサーバーコンポーネントのまま保つ）。

import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

export function CopyLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // クリップボードが使えない環境では、下の入力欄から手で選べる
    }
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => void copy()}
        className="w-full inline-flex items-center justify-center gap-2 border border-gray-300 dark:border-gray-600 rounded-xl py-2.5 text-sm font-semibold text-gray-700 dark:text-gray-200"
      >
        {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />}
        {copied ? 'コピーしました' : 'リンクをコピー'}
      </button>
      <input
        readOnly
        value={url}
        onFocus={(e) => e.currentTarget.select()}
        className="w-full border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-[11px] text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800"
      />
    </div>
  )
}
```

- [ ] **Step 3: 中間ページを作る**

`src/app/connect/notion/page.tsx`:

```tsx
// かんたん接続の中間ページ。認可へ出る直前に一度ここへ着地させる。
//
// なぜ直接飛ばさないか: iPhoneでは認可URLをNotionアプリがユニバーサルリンクとして
// 横取りし、認可画面に到達できないことが実機で判明している（設計書§1）。ここに
// 「うまく開かないときは、パソコンで」を常設して、詰まったら逃がせるようにする。

import Link from 'next/link'
import { headers } from 'next/headers'
import { buildAuthorizeUrl } from '@/lib/notion-oauth'
import { takePendingState } from '@/lib/supabase/oauth-states'
import { CopyLink } from './CopyLink'

export const dynamic = 'force-dynamic'

// 認可URLをスマホでそのまま開くか、PCへ逃がすかの既定。実機検証の結果で切り替える（§12）。
const MOBILE_PRIMARY = process.env.NEXT_PUBLIC_EASY_CONNECT_MOBILE === 'handoff' ? 'handoff' : 'direct'

export default async function ConnectNotionPage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string }>
}) {
  const { s } = await searchParams
  const state = s || ''
  const row = state ? await takePendingState(state, Date.now()) : null

  if (!row) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-900 px-6 py-12">
        <div className="max-w-sm mx-auto space-y-4 text-center">
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">この接続リンクは使えません</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            時間が経って無効になったか、すでに使われたリンクです。アプリからもう一度お試しください。
          </p>
          <Link href="/" className="block w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold">
            MediNodeに戻る
          </Link>
        </div>
      </main>
    )
  }

  // redirect_uri は callback 側が組み立てる値と1文字でも違うと Notion が交換を拒む。
  // callback は req.url から作るので、こちらもリクエストのホストから作って揃える
  // （NEXT_PUBLIC_APP_URL は末尾スラッシュや別ドメインでずれる余地があるので使わない）。
  const h = await headers()
  const host = h.get('host') || ''
  const proto = h.get('x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')
  const clientId = process.env.NOTION_OAUTH_CLIENT_ID || ''
  const redirectUri = `${proto}://${host}/api/notion/oauth/callback`
  const authorizeUrl = buildAuthorizeUrl({ clientId, redirectUri, state })

  const primaryButton = (
    <a
      href={authorizeUrl}
      className="block w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold text-center"
    >
      Notionを開いて許可する
    </a>
  )

  const handoff = (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-2">
      <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">うまく開かないときは、パソコンで</p>
      <p className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
        パソコンのブラウザでこのリンクを開くと、そのまま続けられます。終わったらスマホのMediNodeを開いてください。
      </p>
      <CopyLink url={authorizeUrl} />
      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        このリンクはあなた専用です。他の人に送らないでください。
      </p>
    </div>
  )

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 px-6 py-12">
      <div className="max-w-sm mx-auto space-y-5">
        <h1 className="text-lg font-bold text-gray-900 dark:text-white">Notionとつなぎます</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
          次の画面で、MediNodeに読ませたいページを選んで許可してください。既存のページを編集することはありません。
        </p>

        {MOBILE_PRIMARY === 'direct' ? (
          <>
            {primaryButton}
            {handoff}
          </>
        ) : (
          <>
            {handoff}
            {primaryButton}
          </>
        )}

        <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
          Notionアプリが開いてしまった場合は、いったん閉じてこのページに戻り、パソコンでお試しください。
        </p>
      </div>
    </main>
  )
}
```

- [ ] **Step 4: 確認とコミット**

Run: `npx tsc --noEmit && npx vitest run 2>&1 | tail -3 && npm run build 2>&1 | tail -5`
Expected: 全パス・ビルド成功（`/connect/notion` がルート一覧に出ること）

```bash
git add -A
git commit -m "中間ページ /connect/notion を追加（PCハンドオフのリンクコピー・/connectを公開パスに）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: claim API（引き取りと既存接続の保護）

**Files:**
- Create: `src/app/api/notion/oauth/claim/route.ts`
- Create: `src/app/api/notion/oauth/claimable/route.ts`
- Test: `src/lib/__tests__/oauth-claim-route.test.ts`

**Interfaces:**
- Consumes: Task 3 の `findClaimable` / `markClaimed`、Task 4 の `findUnreadableDatabases`、段Aの `sessionHasFeature`、既存 `decryptSettingsDetailed` / `encryptSettings`
- Produces:
  - `POST /api/notion/oauth/claim` → `{ status: 'ok', settings: AppSettings }` ／ `{ status: 'conflict', unreadable: DbRef[] }` ／ `{ status: 'none' }` ／ 4xx/5xx
  - `GET /api/notion/oauth/claimable` → `{ claimable: boolean }`
  段B-2 のアプリ側が使う

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/oauth-claim-route.test.ts`:

```ts
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
  decryptSettingsDetailed: (enc: string) => ({ json: enc.replace(/^enc:/, ''), needsReencrypt: false }),
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
```

`decryptSettingsDetailed` のモックは `'broken'` を渡されても例外を投げない実装になっている。復号失敗のテストを成立させるため、モックを次のように書き換える（上のモック定義の該当行を差し替える）:

```ts
  decryptSettingsDetailed: (enc: string) => {
    if (!enc.startsWith('enc:')) throw new Error('decrypt failed')
    return { json: enc.replace(/^enc:/, ''), needsReencrypt: false }
  },
```

- [ ] **Step 2: 落ちることを確認**

Run: `npx vitest run src/lib/__tests__/oauth-claim-route.test.ts`
Expected: FAIL（route not found）

- [ ] **Step 3: claim を実装**

`src/app/api/notion/oauth/claim/route.ts`:

```ts
// かんたん接続の引き取り。認可はどのブラウザで終わっていてもよく、ここで初めて
// 「本人のログイン済みセッション」を確かめてトークンを設定へ入れる（セッション固定対策・§6）。
//
// 保存する前に、いま使っているDBが新しいトークンで読めるかを確かめる。OAuthのトークンは
// 認可画面で選んだページしか読めないため、既存のDBが範囲外だと同期も検索も静かに壊れる。
// 1つでも読めなければ、トークンを差し替えずに conflict を返す（§10b）。
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sessionHasFeature } from '@/lib/supabase/early-access'
import { findClaimable, markClaimed, purgeExpired } from '@/lib/supabase/oauth-states'
import { findUnreadableDatabases, type DbRef } from '@/lib/notion-readability'
import { encryptSettings, decryptSettingsDetailed, isCryptoReady } from '@/lib/crypto'
import type { NotionOAuthToken } from '@/lib/notion-oauth'

// サーバーに設定行がまだ無いユーザー向けの土台（クライアントの既定と同型）。
const DEFAULT_SETTINGS = {
  searchMode: 'notion',
  notionToken: '', notionMedicalDbId: '', notionReferenceDbId: '', notionManualDbId: '',
  algoliaAppId: '', algoliaSearchKey: '', algoliaAdminKey: '', algoliaIndex: 'medical_knowledge',
  teamLabel: '', teamNotionToken: '', teamNotionMedicalDbId: '', teamNotionReferenceDbId: '', teamNotionManualDbId: '',
  subscriptionSearchKey: '', subscriptionAppId: '', subscriptionIndex: '',
  propSummary: '', propKeywords: '', propKnowledgeLevel: '', propGenre: '',
}

export async function POST() {
  if (!isCryptoReady()) {
    return NextResponse.json({ error: '設定の保存準備ができていません' }, { status: 500 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'ログインが必要です' }, { status: 401 })

  if (!(await sessionHasFeature('easy_connect'))) {
    return NextResponse.json({ error: 'この機能はまだ開放されていません' }, { status: 403 })
  }

  const nowMs = Date.now()
  // 自分の古い行を掃除する（cronを持たないため・§3a）。best-effort。
  await purgeExpired(user.id, nowMs)

  const row = await findClaimable(user.id, nowMs)
  if (!row || !row.token_enc) return NextResponse.json({ status: 'none' })

  let token: NotionOAuthToken
  try {
    token = JSON.parse(decryptSettingsDetailed(row.token_enc).json) as NotionOAuthToken
  } catch {
    return NextResponse.json({ error: '接続情報を読み取れませんでした' }, { status: 500 })
  }

  // 既存設定を読む。読み取り失敗・復号失敗のときは書かずに中断する
  // （DEFAULTで上書きすると全設定を失うため。v1で確立した原則）。
  const admin = createAdminClient()
  let base: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  const { data, error: readError } = await admin
    .from('user_settings')
    .select('settings_enc')
    .eq('user_id', user.id)
    .maybeSingle()
  if (readError) {
    return NextResponse.json({ error: '設定を読み取れませんでした' }, { status: 500 })
  }
  if (data?.settings_enc) {
    try {
      base = { ...DEFAULT_SETTINGS, ...JSON.parse(decryptSettingsDetailed(data.settings_enc).json) }
    } catch {
      return NextResponse.json({ error: '設定を読み取れませんでした' }, { status: 500 })
    }
  }

  const prevToken = String(base.notionToken || '')
  const prevKind = String(base.notionAuthKind || '')
  const replacingManual = !!prevToken && prevKind !== 'oauth'

  // 手動Tokenを置き換える場合だけ、いま読めているDBが新トークンでも読めるか確かめる。
  if (replacingManual) {
    const refs: DbRef[] = [
      { role: 'medical', id: String(base.notionMedicalDbId || '') },
      { role: 'reference', id: String(base.notionReferenceDbId || '') },
      { role: 'manual', id: String(base.notionManualDbId || '') },
    ]
    const unreadable = await findUnreadableDatabases({ token: token.accessToken, refs })
    if (unreadable.length > 0) {
      // 何も書かない。state は completed のまま残すので、選び直してからやり直せる。
      return NextResponse.json({ status: 'conflict', unreadable })
    }
  }

  // 書くのは notionToken 系だけ。部署（team）・Algolia・列マッピングには触らない（§10c）。
  const merged = {
    ...base,
    notionToken: token.accessToken,
    notionAuthKind: 'oauth',
    notionWorkspaceName: token.workspaceName,
    ...(token.duplicatedTemplateId ? { notionDuplicatedTemplateId: token.duplicatedTemplateId } : {}),
    // 元に戻せるように、置き換える手動Tokenだけ退避する。
    // すでに oauth のトークンを持っている人の Prev は上書きしない（戻り先を失うため）。
    ...(replacingManual ? { notionTokenPrev: prevToken, notionAuthKindPrev: prevKind || 'manual' } : {}),
  }

  const { error: writeError } = await admin
    .from('user_settings')
    .upsert(
      { user_id: user.id, settings_enc: encryptSettings(JSON.stringify(merged)), updated_at: new Date().toISOString() },
      { onConflict: 'user_id' },
    )
  if (writeError) {
    return NextResponse.json({ error: '設定を保存できませんでした' }, { status: 500 })
  }

  await markClaimed(row.state)

  // クライアントは受け取った設定をそのまま localStorage へ書き、更新時刻を now にする。
  // SettingsSync の復元待ちに頼らないので、古いローカル設定と競合しない（§10d）。
  return NextResponse.json({ status: 'ok', settings: merged })
}
```

- [ ] **Step 4: claimable を実装**

`src/app/api/notion/oauth/claimable/route.ts`:

```ts
// 引き取れる接続があるかだけを返す。アプリ起動時に1回だけ聞き、あれば claim を実行する。
// 中身（トークン）は一切返さない。
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sessionHasFeature } from '@/lib/supabase/early-access'
import { findClaimable } from '@/lib/supabase/oauth-states'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ claimable: false })

  if (!(await sessionHasFeature('easy_connect'))) return NextResponse.json({ claimable: false })

  const row = await findClaimable(user.id, Date.now())
  return NextResponse.json({ claimable: !!row?.token_enc })
}
```

- [ ] **Step 5: 通ることを確認**

Run: `npx vitest run src/lib/__tests__/oauth-claim-route.test.ts && npx tsc --noEmit && npx vitest run 2>&1 | tail -3`
Expected: 新規10件PASS・全suite PASS・tsc 0件

- [ ] **Step 6: コミット**

```bash
git add -A
git commit -m "claim/claimable APIを追加（引き取り・旧トークン退避・既存DBが読めなければ書かない）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: 完了ページ `/connect/notion/done`

**Files:**
- Create: `src/app/connect/notion/done/page.tsx`

**Interfaces:**
- Consumes: Task 3 の `findClaimable` は使わない。state から直接行を引く必要があるため、`src/lib/supabase/oauth-states.ts` に `findStateOwnerEmail(state: string): Promise<string | null>` を追加する
- Consumes: Task 2 の `maskEmail`

**なぜマスクしたメールを出すか（§6）:** callback がセッションを見ない＝公開エンドポイントになるため、攻撃者が自分の state を被害者に踏ませる余地が残る。保存先アカウントを必ず見せ、心当たりが無ければ進まないでもらうことで、被害者側が中断できるようにする。

- [ ] **Step 1: 所有者メールの取得を足す**

`src/lib/supabase/oauth-states.ts` の末尾に追加:

```ts
// 完了ページで「どのアカウントへ保存するか」を出すために、state の持ち主のメールを引く。
// completed の行に限る（pending の state を踏ませてメールを覗く経路を作らない）。
export async function findStateOwnerEmail(state: string): Promise<string | null> {
  if (!state) return null
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('oauth_states')
      .select('user_id, status')
      .eq('state', state)
      .maybeSingle()
    if (error || !data) return null
    const row = data as { user_id: string; status: string }
    if (row.status !== 'completed') return null
    const { data: u, error: uErr } = await admin.auth.admin.getUserById(row.user_id)
    if (uErr || !u?.user) return null
    return u.user.email ?? null
  } catch {
    return null
  }
}
```

- [ ] **Step 2: 完了ページを作る**

`src/app/connect/notion/done/page.tsx`:

```tsx
// かんたん接続の完了ページ。callback から来る。
//
// このページはセッションを持たないブラウザでも開かれる（PWAで始めてSafariで認可を
// 終える経路・PCへ逃がした経路）。だからここでは何も保存しない。保存は本人のアプリが
// claim したときに初めて起きる。
//
// 保存先アカウントを必ず見せる: callback は公開エンドポイントなので、他人のstateを
// 踏まされる余地が残る。心当たりの無いメールが出たら進まないでもらう（§6）。

import Link from 'next/link'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import { findStateOwnerEmail } from '@/lib/supabase/oauth-states'
import { maskEmail } from '@/lib/oauth-state'

export const dynamic = 'force-dynamic'

export default async function ConnectNotionDonePage({
  searchParams,
}: {
  searchParams: Promise<{ s?: string; e?: string }>
}) {
  const { s, e } = await searchParams

  if (e || !s) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-900 px-6 py-12">
        <div className="max-w-sm mx-auto space-y-4 text-center">
          <AlertCircle className="h-8 w-8 mx-auto text-gray-400" aria-hidden />
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">接続を完了できませんでした</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            時間が経ってやり直しになったか、許可が最後まで終わりませんでした。アプリからもう一度お試しください。
          </p>
          <Link href="/" className="block w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold">
            MediNodeに戻る
          </Link>
        </div>
      </main>
    )
  }

  const email = await findStateOwnerEmail(s)
  if (!email) {
    return (
      <main className="min-h-screen bg-gray-50 dark:bg-gray-900 px-6 py-12">
        <div className="max-w-sm mx-auto space-y-4 text-center">
          <AlertCircle className="h-8 w-8 mx-auto text-gray-400" aria-hidden />
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">この接続は確認できませんでした</h1>
          <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
            アプリからもう一度お試しください。
          </p>
          <Link href="/" className="block w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold">
            MediNodeに戻る
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-gray-50 dark:bg-gray-900 px-6 py-12">
      <div className="max-w-sm mx-auto space-y-5">
        <div className="text-center space-y-2">
          <CheckCircle2 className="h-8 w-8 mx-auto text-green-600 dark:text-green-400" aria-hidden />
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">Notionとの接続を確認しました</h1>
        </div>

        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 space-y-1.5">
          <p className="text-xs text-gray-500 dark:text-gray-400">保存先のアカウント</p>
          <p className="text-sm font-semibold text-gray-900 dark:text-white">{maskEmail(email)}</p>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
            このメールに心当たりがなければ、このまま閉じてください。閉じれば何も保存されません。
          </p>
        </div>

        <Link href="/" className="block w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold text-center">
          MediNodeに戻る
        </Link>

        <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
          パソコンでここまで進めた場合は、スマホのMediNodeを開くと自動で続きが始まります。読み取るDBはそこで選べます。
        </p>
      </div>
    </main>
  )
}
```

- [ ] **Step 3: 確認とコミット**

Run: `npx tsc --noEmit && npx vitest run 2>&1 | tail -3 && npm run build 2>&1 | tail -5`
Expected: 全パス・ビルド成功（`/connect/notion/done` がルート一覧に出ること）

```bash
git add -A
git commit -m "完了ページ /connect/notion/done を追加（保存先アカウントのマスク表示つき）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: env の記載と全体確認

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: `.env.example` を更新する**

段Aで追加した先行体験の節の `EASY_CONNECT_GA` / `EASY_CONNECT_EMAILS` に付けた「まだ配線されていない」旨の注記を削除し（本計画で配線された）、かんたん接続の節を追加する。既存の書式（コメント記号・区切り線・コメントアウトされた例）に合わせること。

```
# ── かんたん接続（Notion OAuth） ──────────────────────
# Notionの公開コネクション。サーバー専用（クライアントへ渡さない）。
# NOTION_OAUTH_CLIENT_ID=
# NOTION_OAUTH_CLIENT_SECRET=
#
# 中間ページ（/connect/notion）でどちらを先に見せるか。
# direct=このスマホで開く／handoff=パソコンで開く。既定は direct。
# iPhone実機の検証結果に応じて切り替える。
# NEXT_PUBLIC_EASY_CONNECT_MOBILE=direct
```

なお `NEXT_PUBLIC_EASY_CONNECT` は本計画で廃止した。`.env.example` に記載があれば削除し、Vercelの環境変数からも消す必要がある旨を、この節のコメントに1行書き添えること。

- [ ] **Step 2: 全体確認**

Run: `npx vitest run && npx tsc --noEmit && npm run build 2>&1 | tail -5`
Expected: すべて成功

- [ ] **Step 3: 参照が残っていないことを確認**

```bash
grep -rn "NEXT_PUBLIC_EASY_CONNECT\b" src/ ; grep -rn "easy-connect-flag" src/ ; grep -rn "STATE_COOKIE" src/
```

Expected: `src/` 配下に一切ヒットしないこと（`NEXT_PUBLIC_EASY_CONNECT_MOBILE` は別名なので `\b` 付きで除外される）

- [ ] **Step 4: コミット**

```bash
git add .env.example
git commit -m "かんたん接続のenvを.env.exampleに記載し、廃止したフラグの記述を削除

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## マージ前チェックリスト（オーナー実施）

- [ ] Supabase SQL Editor で `supabase/migrations/0022_oauth_states.sql` を流す → https://supabase.com/dashboard/project/_/sql/new
- [ ] 流したら `supabase/migrations/README.md` の 0022 行を ⬜ → ✅ に変える
- [ ] Vercel の環境変数から **`NEXT_PUBLIC_EASY_CONNECT` を削除**する（本計画で参照が無くなったため）→ https://vercel.com/dashboard
- [ ] Vercel に `NOTION_OAUTH_CLIENT_ID` / `NOTION_OAUTH_CLIENT_SECRET` が設定済みであることを確認する
- [ ] `/admin` の台帳で自分に「かんたん接続（OAuth検証）」を開放する
- [ ] `/api/notion/oauth/start` を開く → `/connect/notion` に着地し、認可ボタンとリンクコピーが出る
- [ ] 機能を開放していないアカウントで `/api/notion/oauth/start` を開く → 静かにホームへ戻る
- [ ] 期限切れ・でたらめな state で `/connect/notion?s=xxx` を開く → 「このリンクは使えません」
- [ ] **PWA（ホーム画面から起動した状態）で `/connect/notion` と `/connect/notion/done` を開き、Service Worker がキャッシュした別画面を返さないことを確かめる**（`public/sw.js` は `'/'` 限定ガードを入れてあるが、新しいパスなので実機で1度見る・§12）

## この計画で「やらない」こと（段B-2）

- アプリ側の引き取り（起動時の `claimable` 照会 → `claim` 実行）
- `OAuthFinish` の作り直し（conflict フェーズ・選び直し導線）
- かんたん接続カードの2状態表示と、設定画面の「元の接続に戻す」
- テレメトリ（`easy_connect_*` イベント）と /admin 表示
- 登録先行の導線とプレビューリンク（これは段C）
