# 段A: 機能別の先行体験（early access features）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 「先行体験」を boolean 1本から**機能名（`easy_connect` / `multi_department` / `tower`）ごとの開閉**に変え、/admin で誰にどの機能を開放するかを名前で選べるようにする。

**Architecture:** 判定の正はサーバー。`src/lib/feature-access.ts` に純関数 `hasFeature(feature, input)` を置き、優先順は「機能ごとのGA env → 機能ごとのメールリストenv → 台帳 `user_settings.early_access_features` → レガシー `user_settings.early_access`（`multi_department` と `tower` にのみ効く）」。クライアントへは `/api/premium/status` が `features: string[]` を配り、`PremiumSync` が `AppSettings.earlyAccessFeatures` にミラーする。既存の `early_access` 列・`earlyAccess` 応答フィールド・`resolveEarlyAccess()` は**すべて残す**ので、既存ユーザーの挙動は変わらない。

**Tech Stack:** Next.js App Router / TypeScript / vitest / Supabase (postgres, service_role) / Tailwind / lucide-react

**Spec:** `docs/superpowers/specs/2026-08-02-easy-connect-v2-design.md` §16（追補2）

## Global Constraints

- **既存ユーザーの挙動を変えない。** `user_settings.early_access` のデータは書き換えない（バックフィルしない）。`/api/premium/status` の `earlyAccess: boolean` は残す。`resolveEarlyAccess()` も残す
- **列が未適用でも落ちない。** `early_access_features` の select が失敗したら、`early_access` だけで再取得して続行する（既存の `ledger/route.ts:65-72` と同じ方針）
- 新しい依存パッケージを追加しない
- 文言は静かな日本語・感嘆符なし。/admin のラベルは省略せず「かんたん接続（OAuth検証）」「マルチ部署検索」「知の塔」と書く
- `npx tsc --noEmit` と `npx vitest run` が各タスク完了時に全パス
- コミットメッセージは日本語。末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`
- **作業は worktree で隔離する**（このリポジトリは他セッションが同時に触っている）。Task 1 で作成する
- migration は**手で流す運用**。SQLファイルを書いたら `supabase/migrations/README.md` の表に行を足す（流すのはオーナー）

### 既存挙動の変化として1つだけ許容すること

現在 `MULTI_DEPARTMENT_GA=true` は boolean 1本を通じて知の塔にも効く。本計画で機能を分けると、`MULTI_DEPARTMENT_GA=true` は `multi_department` にしか効かなくなり、知の塔には新設の `TOWER_GA=true` が要る。**本番では `MULTI_DEPARTMENT_GA` は未設定（GAは将来）なので、実挙動の変化は無い。** `EARLY_ACCESS_EMAILS` は両方に効いたままにするので、いま開放されている人の見え方も変わらない。

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `src/lib/feature-access.ts`（変更） | 機能キーの定義と判定の純関数。env 読取のみ。DB非依存 |
| `src/lib/supabase/early-access.ts`（変更） | セッションから台帳を引いて機能一覧を返す。サーバー再判定の入口 |
| `supabase/migrations/0021_early_access_features.sql`（新規） | `user_settings.early_access_features` 列 |
| `src/app/api/premium/status/route.ts`（変更） | クライアントへ `features` を配る |
| `src/lib/settings.ts`（変更） | `earlyAccessFeatures` のミラー先 |
| `src/components/auth/PremiumSync.tsx`（変更） | `features` を localStorage に同期 |
| `src/lib/tower-flags.ts`（変更） | 知の塔の判定を `tower` 機能に切替（フォールバックつき） |
| `src/lib/admin-audit.ts`（変更） | 監査アクションに `grant_feature:<key>` を追加 |
| `src/app/api/admin/ledger/route.ts`（変更） | GET で機能一覧を返す。PATCH に機能トグルを追加 |
| `src/app/admin/AdminLedgerClient.tsx`（変更） | 1ボタン → 機能名つき3トグルのメニュー |

---

### Task 1: worktree 作成と `hasFeature` 純関数（TDD）

**Files:**
- Create: worktree `~/medical-search-public.worktrees/early-access-features`（ブランチ `feat/early-access-features`）
- Modify: `src/lib/feature-access.ts`
- Test: `src/lib/__tests__/feature-access.test.ts`

**Interfaces:**
- Produces: `EARLY_ACCESS_FEATURES`（readonly tuple）／`type EarlyAccessFeature = 'easy_connect' | 'multi_department' | 'tower'`／`type FeatureInput = { email?: string | null; ledgerEarlyAccess?: boolean | null; ledgerFeatures?: string[] | null }`／`hasFeature(feature: EarlyAccessFeature, input: FeatureInput): boolean`／`resolveFeatures(input: FeatureInput): EarlyAccessFeature[]`。Task 3・4・6・7 が使う
- 既存の `isMultiDepartmentGa()` / `emailInEarlyAccessList()` / `resolveEarlyAccess()` は**シグネチャそのままで残す**

- [ ] **Step 1: worktree を作る**

```bash
cd ~/medical-search-public && git worktree add ~/medical-search-public.worktrees/early-access-features -b feat/early-access-features main
cd ~/medical-search-public.worktrees/early-access-features && npm install
```

以降のコマンドはすべて `~/medical-search-public.worktrees/early-access-features` で実行する。

- [ ] **Step 2: 失敗するテストを書く**

`src/lib/__tests__/feature-access.test.ts` の**末尾に追記**する（既存の3 describe はそのまま残す）:

```ts
import { hasFeature, resolveFeatures, EARLY_ACCESS_FEATURES } from '../feature-access'

describe('hasFeature', () => {
  const clean = () => {
    delete process.env.MULTI_DEPARTMENT_GA
    delete process.env.TOWER_GA
    delete process.env.EASY_CONNECT_GA
    delete process.env.EARLY_ACCESS_EMAILS
    delete process.env.EASY_CONNECT_EMAILS
  }

  it('機能キーは3つ', () => {
    expect([...EARLY_ACCESS_FEATURES]).toEqual(['easy_connect', 'multi_department', 'tower'])
  })

  it('機能ごとのGA envが立っていればその機能だけ true', () => {
    clean()
    process.env.EASY_CONNECT_GA = 'true'
    expect(hasFeature('easy_connect', {})).toBe(true)
    expect(hasFeature('multi_department', {})).toBe(false)
    expect(hasFeature('tower', {})).toBe(false)
  })

  it('EASY_CONNECT_EMAILS はかんたん接続にだけ効く（大小無視）', () => {
    clean()
    process.env.EASY_CONNECT_EMAILS = 'Tester@X.com'
    expect(hasFeature('easy_connect', { email: 'tester@x.com' })).toBe(true)
    expect(hasFeature('multi_department', { email: 'tester@x.com' })).toBe(false)
    expect(hasFeature('easy_connect', { email: 'other@x.com' })).toBe(false)
  })

  it('EARLY_ACCESS_EMAILS はマルチ部署と知の塔の両方に効く（既存挙動の維持）', () => {
    clean()
    process.env.EARLY_ACCESS_EMAILS = 'a@x.com'
    expect(hasFeature('multi_department', { email: 'a@x.com' })).toBe(true)
    expect(hasFeature('tower', { email: 'a@x.com' })).toBe(true)
    expect(hasFeature('easy_connect', { email: 'a@x.com' })).toBe(false)
  })

  it('台帳の機能配列に入っていれば true', () => {
    clean()
    expect(hasFeature('easy_connect', { ledgerFeatures: ['easy_connect'] })).toBe(true)
    expect(hasFeature('tower', { ledgerFeatures: ['easy_connect'] })).toBe(false)
  })

  it('レガシー early_access=true はマルチ部署と知の塔にだけ効く', () => {
    clean()
    expect(hasFeature('multi_department', { ledgerEarlyAccess: true })).toBe(true)
    expect(hasFeature('tower', { ledgerEarlyAccess: true })).toBe(true)
    expect(hasFeature('easy_connect', { ledgerEarlyAccess: true })).toBe(false)
  })

  it('どれも無ければ false', () => {
    clean()
    expect(hasFeature('easy_connect', { email: 'x@z.com', ledgerEarlyAccess: false, ledgerFeatures: [] })).toBe(false)
    expect(hasFeature('multi_department', {})).toBe(false)
  })

  it('未知の値が配列に混ざっていても壊れない', () => {
    clean()
    expect(hasFeature('tower', { ledgerFeatures: ['nope', 'tower'] })).toBe(true)
  })
})

describe('resolveFeatures', () => {
  it('有効な機能だけを定義順で返す', () => {
    delete process.env.MULTI_DEPARTMENT_GA
    delete process.env.TOWER_GA
    delete process.env.EASY_CONNECT_GA
    delete process.env.EARLY_ACCESS_EMAILS
    delete process.env.EASY_CONNECT_EMAILS
    expect(resolveFeatures({ ledgerEarlyAccess: true })).toEqual(['multi_department', 'tower'])
    expect(resolveFeatures({ ledgerFeatures: ['easy_connect'] })).toEqual(['easy_connect'])
    expect(resolveFeatures({})).toEqual([])
  })
})

describe('resolveEarlyAccess（既存APIの維持）', () => {
  it('hasFeature(multi_department) と同じ答えを返す', () => {
    delete process.env.MULTI_DEPARTMENT_GA
    delete process.env.EARLY_ACCESS_EMAILS
    expect(resolveEarlyAccess({ email: null, ledgerEarlyAccess: true })).toBe(true)
    expect(resolveEarlyAccess({ email: null, ledgerEarlyAccess: false })).toBe(false)
  })
})
```

- [ ] **Step 3: 落ちることを確認**

Run: `npx vitest run src/lib/__tests__/feature-access.test.ts`
Expected: FAIL（`hasFeature` が export されていない）

- [ ] **Step 4: 実装**

`src/lib/feature-access.ts` を**全文置き換え**:

```ts
// 先行体験の開放判定。純ロジック（env 読取りのみ、DB/Stripe 非依存）。
// 判定の正はサーバー。単一チョークポイント:
//   1. 機能ごとの GA env（例 MULTI_DEPARTMENT_GA=true）で全員 true
//   2. 機能ごとの許可メールリスト env
//   3. 台帳 user_settings.early_access_features（機能名の配列）
//   4. レガシー台帳 user_settings.early_access（boolean）
//
// 4 は「マルチ部署検索」と「知の塔」を1つの boolean で兼務していた時代の互換。
// 既存行を書き換えず読み取り時にだけ解釈するので、移行のためのバックフィルは不要。

// 開閉できる機能の一覧。UI のラベルもこの順に並べる。
export const EARLY_ACCESS_FEATURES = ['easy_connect', 'multi_department', 'tower'] as const
export type EarlyAccessFeature = (typeof EARLY_ACCESS_FEATURES)[number]

// レガシー early_access(boolean) が意味していた機能。かんたん接続は含めない
// （boolean 時代に存在しなかった機能なので、過去の true が新機能を開けてはいけない）。
const LEGACY_BOOLEAN_FEATURES: readonly EarlyAccessFeature[] = ['multi_department', 'tower']

// 機能ごとの env 名。ga=全員開放、emails=指定メールのみ。
// multi_department と tower が同じ EARLY_ACCESS_EMAILS を見るのは既存挙動の維持
// （分離前は1つの boolean で両方が開いていた）。
const FEATURE_ENV: Record<EarlyAccessFeature, { ga: string; emails: string }> = {
  easy_connect: { ga: 'EASY_CONNECT_GA', emails: 'EASY_CONNECT_EMAILS' },
  multi_department: { ga: 'MULTI_DEPARTMENT_GA', emails: 'EARLY_ACCESS_EMAILS' },
  tower: { ga: 'TOWER_GA', emails: 'EARLY_ACCESS_EMAILS' },
}

function envTrue(name: string): boolean {
  return (process.env[name] || '').trim().toLowerCase() === 'true'
}

function emailInEnvList(name: string, email: string | null | undefined): boolean {
  const list = (process.env[name] || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return !!email && list.includes(email.toLowerCase())
}

export type FeatureInput = {
  email?: string | null
  ledgerEarlyAccess?: boolean | null
  // 台帳の機能配列。未知の文字列が混ざっていても無視されるだけで壊れない。
  ledgerFeatures?: string[] | null
}

// ある機能が開いているか。判定の正はこの関数。
export function hasFeature(feature: EarlyAccessFeature, input: FeatureInput): boolean {
  const env = FEATURE_ENV[feature]
  if (envTrue(env.ga)) return true
  if (emailInEnvList(env.emails, input.email)) return true
  if ((input.ledgerFeatures ?? []).includes(feature)) return true
  if (input.ledgerEarlyAccess === true && LEGACY_BOOLEAN_FEATURES.includes(feature)) return true
  return false
}

// 開いている機能の一覧（EARLY_ACCESS_FEATURES の定義順）。
export function resolveFeatures(input: FeatureInput): EarlyAccessFeature[] {
  return EARLY_ACCESS_FEATURES.filter((f) => hasFeature(f, input))
}

// ── 以下は分離前からの公開API。呼び出し側を一斉に書き換えないために残す ──

// 全体公開スイッチ（マルチ部署検索）。true なら誰でも利用可。
export function isMultiDepartmentGa(): boolean {
  return envTrue('MULTI_DEPARTMENT_GA')
}

// env の許可メールリスト（COMP_ADMIN_EMAILS と同型のカンマ区切り）にメールが含まれるか。
export function emailInEarlyAccessList(email: string | null | undefined): boolean {
  return emailInEnvList('EARLY_ACCESS_EMAILS', email)
}

// マルチ部署検索の開放判定。hasFeature('multi_department', …) の別名。
export function resolveEarlyAccess(input: {
  email?: string | null
  ledgerEarlyAccess?: boolean | null
}): boolean {
  return hasFeature('multi_department', input)
}
```

- [ ] **Step 5: 通ることを確認**

Run: `npx vitest run src/lib/__tests__/feature-access.test.ts && npx tsc --noEmit`
Expected: 既存4件＋新規10件がPASS・tsc 0件

- [ ] **Step 6: コミット**

```bash
git add src/lib/feature-access.ts src/lib/__tests__/feature-access.test.ts
git commit -m "先行体験を機能名で判定できるようにする（hasFeature・レガシーboolean互換つき）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: migration 0021（`early_access_features` 列）

**Files:**
- Create: `supabase/migrations/0021_early_access_features.sql`
- Modify: `supabase/migrations/README.md`

**Interfaces:**
- Produces: `public.user_settings.early_access_features text[] not null default '{}'`。Task 3・4・6 が読み書きする

- [ ] **Step 1: SQL を書く**

`supabase/migrations/0021_early_access_features.sql`:

```sql
-- MediNode 機能別の先行体験。
-- これまで user_settings.early_access（boolean）1本が「マルチ部署検索」と「知の塔」を
-- 兼務していた。3つ目（かんたん接続の実機検証）を足すにあたり、機能名の配列に分ける。
--
-- 既存の early_access 列は残す。読み取り側（feature-access.ts）が
-- 「early_access=true なら multi_department と tower を持つ」と解釈するため、
-- 既存行のバックフィルは不要（＝この migration を流しても誰の見え方も変わらない）。
--
-- 値に入るのは 'easy_connect' / 'multi_department' / 'tower' のいずれか。
-- 未知の文字列が入っても読み取り側が無視するだけなので、check 制約は付けない
-- （機能を増やすたびに制約を触る必要をなくす）。

alter table public.user_settings
  add column if not exists early_access_features text[] not null default '{}';
```

- [ ] **Step 2: 適用台帳に行を足す**

`supabase/migrations/README.md` の表（`| 0019 | cq_submissions | ... |` の行の下）に追記する:

```
| 0020 | cq_reactions | `cq_reactions` | ✅ |
| 0021 | early_access_features | `user_settings.early_access_features` | ⬜ |
```

（0020 は表に載っていないが本番適用済み。0021 はオーナーが流すまで ⬜ のままにする）

- [ ] **Step 3: コミット**

```bash
git add supabase/migrations/0021_early_access_features.sql supabase/migrations/README.md
git commit -m "migration 0021: user_settings に early_access_features 列を追加

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: サーバー側の機能読取（TDD）

**Files:**
- Modify: `src/lib/supabase/early-access.ts`
- Test: `src/lib/__tests__/session-features.test.ts`（新規）

**Interfaces:**
- Consumes: Task 1 の `hasFeature` / `resolveFeatures` / `EarlyAccessFeature`
- Produces: `getSessionFeatures(): Promise<EarlyAccessFeature[]>`／`sessionHasFeature(feature: EarlyAccessFeature): Promise<boolean>`。段B の OAuth ルートが `sessionHasFeature('easy_connect')` を使う。既存の `getSessionEarlyAccess(): Promise<boolean>` はシグネチャそのまま維持

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/session-features.test.ts`:

```ts
// セッションから先行体験の機能一覧を引く関数のテスト。
// 列未適用（select が error を返す）でも early_access だけで続行することを確かめる。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { getUserMock, maybeSingleMock, selectSpy } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  selectSpy: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    from: () => ({
      select: (cols: string) => {
        selectSpy(cols)
        return { eq: () => ({ maybeSingle: maybeSingleMock }) }
      },
    }),
  }),
}))

import { getSessionFeatures, sessionHasFeature, getSessionEarlyAccess } from '../supabase/early-access'

const ENV = { ...process.env }

beforeEach(() => {
  getUserMock.mockReset()
  maybeSingleMock.mockReset()
  selectSpy.mockReset()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
  delete process.env.MULTI_DEPARTMENT_GA
  delete process.env.TOWER_GA
  delete process.env.EASY_CONNECT_GA
  delete process.env.EARLY_ACCESS_EMAILS
  delete process.env.EASY_CONNECT_EMAILS
})
afterEach(() => { process.env = { ...ENV } })

describe('getSessionFeatures', () => {
  it('未ログインなら空配列', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    expect(await getSessionFeatures()).toEqual([])
  })

  it('台帳の配列をそのまま機能として返す', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@x.com' } } })
    maybeSingleMock.mockResolvedValue({
      data: { early_access: false, early_access_features: ['easy_connect'] },
      error: null,
    })
    expect(await getSessionFeatures()).toEqual(['easy_connect'])
  })

  it('レガシー early_access=true はマルチ部署と知の塔として読む', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@x.com' } } })
    maybeSingleMock.mockResolvedValue({
      data: { early_access: true, early_access_features: [] },
      error: null,
    })
    expect(await getSessionFeatures()).toEqual(['multi_department', 'tower'])
  })

  it('列未適用（1回目のselectがerror）でも early_access だけで続行する', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@x.com' } } })
    maybeSingleMock
      .mockResolvedValueOnce({ data: null, error: { message: 'column does not exist' } })
      .mockResolvedValueOnce({ data: { early_access: true }, error: null })
    expect(await getSessionFeatures()).toEqual(['multi_department', 'tower'])
    expect(selectSpy).toHaveBeenNthCalledWith(1, 'early_access, early_access_features')
    expect(selectSpy).toHaveBeenNthCalledWith(2, 'early_access')
  })

  it('GA env が立っていればDBを引かずに返す', async () => {
    process.env.EASY_CONNECT_GA = 'true'
    getUserMock.mockResolvedValue({ data: { user: null } })
    expect(await getSessionFeatures()).toEqual(['easy_connect'])
  })
})

describe('sessionHasFeature', () => {
  it('該当機能があれば true', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@x.com' } } })
    maybeSingleMock.mockResolvedValue({
      data: { early_access: false, early_access_features: ['easy_connect'] },
      error: null,
    })
    expect(await sessionHasFeature('easy_connect')).toBe(true)
    expect(await sessionHasFeature('tower')).toBe(false)
  })
})

describe('getSessionEarlyAccess（既存APIの維持）', () => {
  it('レガシー true でそのまま true', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@x.com' } } })
    maybeSingleMock.mockResolvedValue({
      data: { early_access: true, early_access_features: [] },
      error: null,
    })
    expect(await getSessionEarlyAccess()).toBe(true)
  })
})
```

- [ ] **Step 2: 落ちることを確認**

Run: `npx vitest run src/lib/__tests__/session-features.test.ts`
Expected: FAIL（`getSessionFeatures` が export されていない）

- [ ] **Step 3: 実装**

`src/lib/supabase/early-access.ts` を**全文置き換え**:

```ts
// 検索ルート等で、クライアント改ざんを防ぐために先行体験をサーバー側で再判定する。
import { createClient } from '@/lib/supabase/server'
import {
  hasFeature,
  resolveFeatures,
  EARLY_ACCESS_FEATURES,
  type EarlyAccessFeature,
} from '@/lib/feature-access'

// 「env だけで全機能が確定した」＝これ以上DBを引く必要がない、の判定に使う。
const EARLY_ACCESS_FEATURE_COUNT = EARLY_ACCESS_FEATURES.length

// 台帳から先行体験の材料（レガシーboolean＋機能配列）を1回で読む。
// early_access_features 列が未適用の環境では1回目の select が error を返すので、
// early_access だけで取り直して続行する（列の有無でアプリを止めない）。
async function readLedger(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{ earlyAccess: boolean | null; features: string[] }> {
  const first = await supabase
    .from('user_settings')
    .select('early_access, early_access_features')
    .eq('user_id', userId)
    .maybeSingle()

  if (!first.error) {
    const row = first.data as { early_access?: boolean | null; early_access_features?: string[] | null } | null
    return {
      earlyAccess: row?.early_access ?? null,
      features: row?.early_access_features ?? [],
    }
  }

  const fallback = await supabase
    .from('user_settings')
    .select('early_access')
    .eq('user_id', userId)
    .maybeSingle()
  const row = fallback.data as { early_access?: boolean | null } | null
  return { earlyAccess: row?.early_access ?? null, features: [] }
}

// 開いている機能の一覧。未ログイン・失敗時は空配列（＝何も開かない）。
export async function getSessionFeatures(): Promise<EarlyAccessFeature[]> {
  try {
    // GA が立っている機能は、ユーザー確定前に確定できる。
    const gaOnly = resolveFeatures({})
    if (gaOnly.length === EARLY_ACCESS_FEATURE_COUNT) return gaOnly

    const supabaseReady = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
    if (!supabaseReady) return gaOnly

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return gaOnly

    // env/email だけで全機能が決まるなら DB 照会を省く。
    const envOnly = resolveFeatures({ email: user.email })
    if (envOnly.length === EARLY_ACCESS_FEATURE_COUNT) return envOnly

    const ledger = await readLedger(supabase, user.id)
    return resolveFeatures({
      email: user.email,
      ledgerEarlyAccess: ledger.earlyAccess,
      ledgerFeatures: ledger.features,
    })
  } catch {
    return []
  }
}

export async function sessionHasFeature(feature: EarlyAccessFeature): Promise<boolean> {
  return (await getSessionFeatures()).includes(feature)
}

// 分離前からの公開API。マルチ部署検索の判定として残す。
// 中身は sessionHasFeature に委譲する（判定ロジックを2箇所に持たない）。
export async function getSessionEarlyAccess(): Promise<boolean> {
  return sessionHasFeature('multi_department')
}
```

- [ ] **Step 4: 通ることを確認**

Run: `npx vitest run src/lib/__tests__/session-features.test.ts && npx tsc --noEmit && npx vitest run 2>&1 | tail -3`
Expected: 新規7件PASS・全suite PASS・tsc 0件

- [ ] **Step 5: コミット**

```bash
git add src/lib/supabase/early-access.ts src/lib/__tests__/session-features.test.ts
git commit -m "セッションから先行体験の機能一覧を引く（列未適用でも続行）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `/api/premium/status` が `features` を配る

**Files:**
- Modify: `src/app/api/premium/status/route.ts`

**Interfaces:**
- Consumes: Task 1 の `resolveFeatures`
- Produces: 3つの応答すべてに `features: string[]` を追加。既存の `earlyAccess: boolean` は残す。Task 5 の `PremiumSync` が読む

- [ ] **Step 1: 台帳の読み取りを機能配列つきにする**

`src/app/api/premium/status/route.ts` の以下のブロック（`// 先行体験（マルチ部署串刺し検索）フラグ。` から `const earlyAccess = resolveEarlyAccess({ email: user.email, ledgerEarlyAccess })` まで）を置き換える:

```ts
  // 先行体験。env or 台帳 or GA。機能ごとに開閉するため、台帳からは
  // レガシーboolean（early_access）と機能配列（early_access_features）の両方を読む。
  // early_access_features 列が未適用でも落とさない（early_access だけで再取得）。
  let ledgerEarlyAccess: boolean | null = null
  let ledgerFeatures: string[] = []
  {
    const first = await supabase
      .from('user_settings')
      .select('early_access, early_access_features')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!first.error) {
      const row = first.data as { early_access?: boolean | null; early_access_features?: string[] | null } | null
      ledgerEarlyAccess = row?.early_access ?? null
      ledgerFeatures = row?.early_access_features ?? []
    } else {
      const { data: us } = await supabase
        .from('user_settings')
        .select('early_access')
        .eq('user_id', user.id)
        .maybeSingle()
      ledgerEarlyAccess = (us?.early_access as boolean | undefined) ?? null
    }
  }
  const featureInput = { email: user.email, ledgerEarlyAccess, ledgerFeatures }
  // 既存クライアント（PWAキャッシュ含む）のために boolean も返し続ける。
  const earlyAccess = resolveEarlyAccess(featureInput)
  const features = resolveFeatures(featureInput)
```

- [ ] **Step 2: 3つの応答に `features` を足す**

同ファイル内の `NextResponse.json({ ... })` は3か所ある。すべての `earlyAccess,` の**直後**に `features,` を追加する:

1. `if (!sub.active)` の中（`status: sub.status, earlyAccess,` → `status: sub.status, earlyAccess, features,`）
2. `if (!algoliaAppId || !algoliaSearchKey)` の中
3. 末尾の有効契約の応答

- [ ] **Step 3: import を足す**

13行目を置き換える:

```ts
import { resolveEarlyAccess, resolveFeatures } from '@/lib/feature-access'
```

（置き換え前は `import { resolveEarlyAccess } from '@/lib/feature-access'`）

- [ ] **Step 4: 確認とコミット**

Run: `npx tsc --noEmit && npx vitest run 2>&1 | tail -3`
Expected: 全パス

```bash
git add src/app/api/premium/status/route.ts
git commit -m "premium/status が先行体験の機能一覧を返す（earlyAccessは維持）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: クライアントへのミラーと知の塔の切替

**Files:**
- Modify: `src/lib/settings.ts`
- Modify: `src/components/auth/PremiumSync.tsx`
- Modify: `src/lib/tower-flags.ts`

**Interfaces:**
- Consumes: Task 4 の `features`
- Produces: `AppSettings.earlyAccessFeatures?: string[]`。Task 7 は使わない（/admin はサーバー応答を直接見る）。段B のかんたん接続カードがこれを読む

- [ ] **Step 1: settings に型を足す**

`src/lib/settings.ts` の `earlyAccess?: boolean` の直後に追加:

```ts
  // サーバー由来の先行体験・機能一覧のミラー（表示制御のみ・判定の正はサーバー）。
  // 値は 'easy_connect' / 'multi_department' / 'tower'。
  earlyAccessFeatures?: string[]
```

- [ ] **Step 2: PremiumSync を1回の保存にまとめる**

`src/components/auth/PremiumSync.tsx` の以下のブロックを置き換える:

置き換え前（現状）:
```ts
        // 先行体験（マルチ部署串刺し検索）フラグを反映。active/非activeを問わず同期する
        // （フリー会員も対象になりうるため）。変化時のみ保存し、UI 反映のため軽くリロード。
        if (typeof data.earlyAccess === 'boolean' && (current.earlyAccess ?? false) !== data.earlyAccess) {
          saveSettings({ ...current, earlyAccess: data.earlyAccess })
          window.location.reload()
          return
        }
```

置き換え後:
```ts
        // 先行体験を反映。active/非activeを問わず同期する（フリー会員も対象になりうる）。
        // boolean と機能配列の両方を見て、変化があれば「1回だけ」保存してリロードする
        // （別々に判定すると2回リロードが走る）。
        {
          const nextEarlyAccess =
            typeof data.earlyAccess === 'boolean' ? data.earlyAccess : (current.earlyAccess ?? false)
          const nextFeatures: string[] = Array.isArray(data.features)
            ? (data.features as string[])
            : (current.earlyAccessFeatures ?? [])
          const earlyAccessChanged = (current.earlyAccess ?? false) !== nextEarlyAccess
          const featuresChanged =
            JSON.stringify(current.earlyAccessFeatures ?? []) !== JSON.stringify(nextFeatures)
          if (earlyAccessChanged || featuresChanged) {
            saveSettings({ ...current, earlyAccess: nextEarlyAccess, earlyAccessFeatures: nextFeatures })
            window.location.reload()
            return
          }
        }
```

- [ ] **Step 3: 知の塔の判定を tower 機能へ**

`src/lib/tower-flags.ts` を**全文置き換え**:

```ts
// 知の塔の開放判定（単一チョークポイント）。
// 機能別の先行体験に移行済み: サーバーが配る features に 'tower' が含まれるかを見る。
// features がまだ届いていない端末（旧バージョンのキャッシュ・列未適用）では、
// 分離前の earlyAccess にフォールバックする——切替の瞬間に塔が消えないようにするため。
// 全体公開時は TOWER_GA=true を立てる（サーバー側で全員 true になる）。
import { getSettings } from './settings'

export function isTowerEnabled(): boolean {
  try {
    const s = getSettings()
    if (!s) return false
    const features = s.earlyAccessFeatures
    if (Array.isArray(features)) return features.includes('tower')
    return s.earlyAccess === true
  } catch {
    return false
  }
}
```

- [ ] **Step 4: 確認とコミット**

Run: `npx tsc --noEmit && npx vitest run 2>&1 | tail -3`
Expected: 全パス

```bash
git add src/lib/settings.ts src/components/auth/PremiumSync.tsx src/lib/tower-flags.ts
git commit -m "機能一覧を端末へ同期し、知の塔の判定を tower 機能に切り替える

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: /admin API — 機能一覧の取得とトグル（TDD）

**Files:**
- Modify: `src/lib/admin-audit.ts`
- Modify: `src/app/api/admin/ledger/route.ts`
- Test: `src/lib/__tests__/ledger-feature-toggle.test.ts`（新規）

**Interfaces:**
- Consumes: Task 1 の `EARLY_ACCESS_FEATURES` / `EarlyAccessFeature`
- Produces: GET の各行に `earlyAccessFeatures: string[]`。`PATCH { userId, feature, enabled }` → `{ ok: true, userId, feature, enabled, features }`。Task 7 が使う

- [ ] **Step 1: 監査アクションに機能名つきを足す**

`src/lib/admin-audit.ts` の `AdminAction` 型を変更する。`import type { EarlyAccessFeature } from './feature-access'` を先頭に足し、union に2行追加:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { EarlyAccessFeature } from './feature-access'

export type AdminAction =
  | 'grant_comp'
  | 'revoke_comp'
  | 'delete_user'
  | 'set_monitor'
  | 'unset_monitor'
  | 'set_owner'
  | 'unset_owner'
  | 'export_csv'
  | 'grant_early_access'
  | 'revoke_early_access'
  // 機能別の先行体験。どの機能を開けたかがログから直接読めるようにキーを含める。
  | `grant_feature:${EarlyAccessFeature}`
  | `revoke_feature:${EarlyAccessFeature}`
```

- [ ] **Step 2: 失敗するテストを書く**

`src/lib/__tests__/ledger-feature-toggle.test.ts`:

```ts
// /api/admin/ledger PATCH の機能トグル分岐のテスト。
// 現在の配列に対して足す／外すが正しく効き、既存の earlyAccess 分岐を壊さないことを見る。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { requireAdminMock, getUserByIdMock, maybeSingleMock, upsertMock, logMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  getUserByIdMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  upsertMock: vi.fn(),
  logMock: vi.fn(),
}))

vi.mock('@/lib/admin-guard', () => ({ requireAdmin: requireAdminMock }))
vi.mock('@/lib/admin-audit', () => ({ logAdminAction: logMock }))
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: getUserByIdMock } },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: maybeSingleMock }) }),
      upsert: upsertMock,
    }),
  }),
}))

import { PATCH } from '../../app/api/admin/ledger/route'
import type { NextRequest } from 'next/server'

const makeReq = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest

beforeEach(() => {
  requireAdminMock.mockReset().mockResolvedValue({ ok: true, email: 'owner@x.com' })
  getUserByIdMock.mockReset().mockResolvedValue({ data: { user: { id: 'u1', email: 't@x.com' } }, error: null })
  maybeSingleMock.mockReset().mockResolvedValue({ data: { early_access_features: [] }, error: null })
  upsertMock.mockReset().mockResolvedValue({ error: null })
  logMock.mockReset().mockResolvedValue(undefined)
})

describe('PATCH /api/admin/ledger（機能トグル）', () => {
  it('enabled=true で機能を足す', async () => {
    const res = await PATCH(makeReq({ userId: 'u1', feature: 'easy_connect', enabled: true }))
    const data = await res.json()
    expect(data.ok).toBe(true)
    expect(data.features).toEqual(['easy_connect'])
    expect(upsertMock.mock.calls[0][0]).toEqual({ user_id: 'u1', early_access_features: ['easy_connect'] })
    expect(logMock.mock.calls[0][1].action).toBe('grant_feature:easy_connect')
  })

  it('enabled=false で機能を外す（他の機能は残す）', async () => {
    maybeSingleMock.mockResolvedValue({ data: { early_access_features: ['easy_connect', 'tower'] }, error: null })
    const res = await PATCH(makeReq({ userId: 'u1', feature: 'easy_connect', enabled: false }))
    const data = await res.json()
    expect(data.features).toEqual(['tower'])
    expect(logMock.mock.calls[0][1].action).toBe('revoke_feature:easy_connect')
  })

  it('二重に足しても重複しない', async () => {
    maybeSingleMock.mockResolvedValue({ data: { early_access_features: ['tower'] }, error: null })
    const res = await PATCH(makeReq({ userId: 'u1', feature: 'tower', enabled: true }))
    expect((await res.json()).features).toEqual(['tower'])
  })

  it('未知の機能名は400', async () => {
    const res = await PATCH(makeReq({ userId: 'u1', feature: 'nope', enabled: true }))
    expect(res.status).toBe(400)
    expect(upsertMock).not.toHaveBeenCalled()
  })

  it('存在しないユーザーは404', async () => {
    getUserByIdMock.mockResolvedValue({ data: null, error: { message: 'not found' } })
    const res = await PATCH(makeReq({ userId: 'u9', feature: 'tower', enabled: true }))
    expect(res.status).toBe(404)
  })

  it('userId が無ければ400', async () => {
    const res = await PATCH(makeReq({ feature: 'tower', enabled: true }))
    expect(res.status).toBe(400)
  })
})
```

- [ ] **Step 3: 落ちることを確認**

Run: `npx vitest run src/lib/__tests__/ledger-feature-toggle.test.ts`
Expected: FAIL（feature 分岐が無いので 400 や別の応答になる）

- [ ] **Step 4: PATCH に機能トグル分岐を実装**

`src/app/api/admin/ledger/route.ts` の PATCH で、`const { userId, isMonitor, isOwner, ownerNote, earlyAccess } = ...` の分割代入に `feature, enabled` を足す:

```ts
    const { userId, isMonitor, isOwner, ownerNote, earlyAccess, feature, enabled } = (await req.json()) as {
      userId?: unknown
      isMonitor?: unknown
      isOwner?: unknown
      ownerNote?: unknown
      earlyAccess?: unknown
      feature?: unknown
      enabled?: unknown
    }
```

`if (!userId || typeof userId !== 'string')` の 400 チェックの**直後**、既存の `if (typeof earlyAccess === 'boolean')` の**手前**に挿入する:

```ts
    // 機能別の先行体験トグル。user_settings.early_access_features を出し入れする。
    // レガシーの earlyAccess(boolean) 分岐はそのまま残す（古いUIからの呼び出し互換）。
    if (typeof feature === 'string' && typeof enabled === 'boolean') {
      if (!(EARLY_ACCESS_FEATURES as readonly string[]).includes(feature)) {
        return NextResponse.json({ error: '未知の機能名です' }, { status: 400 })
      }
      const key = feature as EarlyAccessFeature
      const admin = createAdminClient()
      const { data: u, error: uErr } = await admin.auth.admin.getUserById(userId)
      if (uErr || !u?.user) {
        return NextResponse.json({ error: '対象のユーザーが見つかりません' }, { status: 404 })
      }
      // 現在値を読んでから差分を作る（配列まるごと上書きなので、読まずに書くと他機能を消す）。
      const { data: cur } = await admin
        .from('user_settings')
        .select('early_access_features')
        .eq('user_id', userId)
        .maybeSingle()
      const currentFeatures = ((cur?.early_access_features as string[] | null) ?? []).filter(Boolean)
      const nextFeatures = enabled
        ? Array.from(new Set([...currentFeatures, key]))
        : currentFeatures.filter((f) => f !== key)
      const { error: upErr } = await admin
        .from('user_settings')
        .upsert({ user_id: userId, early_access_features: nextFeatures }, { onConflict: 'user_id' })
      if (upErr) throw new Error(upErr.message)
      await logAdminAction(admin, {
        actorEmail: auth.email,
        action: enabled ? `grant_feature:${key}` : `revoke_feature:${key}`,
        targetUserId: userId,
        targetEmail: u.user.email ?? null,
      })
      return NextResponse.json({ ok: true, userId, feature: key, enabled, features: nextFeatures })
    }
```

同ファイルの import に追加:

```ts
import { EARLY_ACCESS_FEATURES, type EarlyAccessFeature } from '@/lib/feature-access'
```

- [ ] **Step 5: GET が機能一覧を返すようにする**

同ファイルの GET、`const earlyAccessByUser = new Map<string, boolean>()` のブロックを置き換える:

```ts
    const settingsByUser = new Map<string, string | null>()
    const earlyAccessByUser = new Map<string, boolean>()
    const featuresByUser = new Map<string, string[]>()
    {
      type SettingsRow = {
        user_id: string
        updated_at: string | null
        early_access?: boolean | null
        early_access_features?: string[] | null
      }
      const withFeatures = await admin
        .from('user_settings')
        .select('user_id, updated_at, early_access, early_access_features')
      let rows: SettingsRow[]
      if (withFeatures.error) {
        // early_access_features 列が無いなら early_access までで再取得。
        const withEarly = await admin.from('user_settings').select('user_id, updated_at, early_access')
        if (withEarly.error) {
          // early_access 列も無い等で失敗したら、必須の updated_at だけで再取得して続行。
          const basic = await admin.from('user_settings').select('user_id, updated_at')
          if (basic.error) throw new Error(`設定同期時刻の取得に失敗: ${basic.error.message}`)
          rows = (basic.data ?? []) as SettingsRow[]
        } else {
          rows = (withEarly.data ?? []) as SettingsRow[]
        }
      } else {
        rows = (withFeatures.data ?? []) as SettingsRow[]
      }
      for (const s of rows) {
        settingsByUser.set(s.user_id, s.updated_at ?? null)
        earlyAccessByUser.set(s.user_id, s.early_access ?? false)
        featuresByUser.set(s.user_id, s.early_access_features ?? [])
      }
    }
```

同ファイルの行を組み立てている箇所（`earlyAccess: earlyAccessByUser.get(u.id) ?? false,` の行）の直後に追加:

```ts
      earlyAccessFeatures: featuresByUser.get(u.id) ?? [],
```

- [ ] **Step 6: 通ることを確認**

Run: `npx vitest run src/lib/__tests__/ledger-feature-toggle.test.ts && npx tsc --noEmit && npx vitest run 2>&1 | tail -3`
Expected: 新規6件PASS・全suite PASS・tsc 0件

- [ ] **Step 7: コミット**

```bash
git add src/lib/admin-audit.ts src/app/api/admin/ledger/route.ts src/lib/__tests__/ledger-feature-toggle.test.ts
git commit -m "/admin APIに機能別トグルを追加（配列の差分更新・監査は機能名つき）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: /admin UI — 機能名つき3トグル

**Files:**
- Modify: `src/app/admin/AdminLedgerClient.tsx`

**Interfaces:**
- Consumes: Task 6 の GET `earlyAccessFeatures` と PATCH `{ userId, feature, enabled }`

- [ ] **Step 1: 型と定数を足す**

`LedgerRow` 型の `earlyAccess?: boolean` の直後に追加:

```ts
  earlyAccessFeatures?: string[]
```

ファイル上部（`const PREMIUM_ELIGIBLE_KINDS` の近く）に、表示ラベルの定義を追加:

```ts
// 先行体験の機能ラベル。何が開くのか読み取れるよう、省略せずに書く。
const FEATURE_LABELS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'easy_connect', label: 'かんたん接続（OAuth検証）', hint: 'Notionの認可でつなぐ新方式。実機検証用' },
  { key: 'multi_department', label: 'マルチ部署検索', hint: '複数の部署DBを横断して検索・新着・ジャンルに出す' },
  { key: 'tower', label: '知の塔', hint: '読了・クイズの記録と塔の画面' },
]
```

- [ ] **Step 2: トグル呼び出しとメニュー開閉の state を足す**

既存の `toggleEarlyAccess` の**直後**に追加:

```ts
  // 機能別の先行体験トグル。1機能ずつサーバーへ投げ、成功したら台帳を読み直す。
  const toggleFeature = useCallback(
    async (row: LedgerRow, feature: string, enabled: boolean) => {
      setBusy(row.userId)
      try {
        const res = await fetch('/api/admin/ledger', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: row.userId, feature, enabled }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) throw new Error(data.error || '先行体験の変更に失敗しました')
        await load()
      } catch (err) {
        window.alert(err instanceof Error ? err.message : '先行体験の変更に失敗しました')
      } finally {
        setBusy(null)
      }
    },
    [load],
  )
```

`busy` の useState 宣言の近くに追加:

```ts
  // 機能メニューを開いている行のuserId（同時に1つだけ開く）。
  const [featureMenuFor, setFeatureMenuFor] = useState<string | null>(null)
```

- [ ] **Step 3: ボタンをメニューに差し替える**

既存の「先行体験を開放」ボタンの JSX（`{/* 管理者行にも出す: …… */}` のコメントから、`{r.earlyAccess ? '先行体験' : '先行体験を開放'}` を含む `</button>` まで）を、丸ごと次に置き換える:

```tsx
                            {/* 管理者行にも出す: 知の塔の暗転ゲートを兼ねるため、
                                オーナー自身が自分に付与できる必要がある（2026-08-01） */}
                            {(() => {
                              const active = FEATURE_LABELS.filter((f) =>
                                (r.earlyAccessFeatures ?? []).includes(f.key) ||
                                // レガシー: early_access=true はマルチ部署と知の塔を持つ扱い
                                (r.earlyAccess === true && (f.key === 'multi_department' || f.key === 'tower')),
                              )
                              const open = featureMenuFor === r.userId
                              return (
                                <span className="relative inline-block">
                                  <button
                                    type="button"
                                    onClick={() => setFeatureMenuFor(open ? null : r.userId)}
                                    disabled={busy === r.userId}
                                    title="この人に開放する先行体験を選ぶ"
                                    className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border disabled:opacity-50 whitespace-nowrap ${
                                      active.length > 0
                                        ? 'border-teal-300 dark:border-teal-700 bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300'
                                        : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-teal-50 dark:hover:bg-teal-950/30'
                                    }`}
                                  >
                                    {active.length > 0 ? (
                                      <Check className="w-3.5 h-3.5" aria-hidden />
                                    ) : (
                                      <Sparkles className="w-3.5 h-3.5" aria-hidden />
                                    )}
                                    {active.length > 0 ? `先行体験 ${active.length}` : '先行体験'}
                                  </button>
                                  {open && (
                                    <div className="absolute right-0 z-30 mt-1 w-64 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-2 shadow-lg text-left">
                                      {FEATURE_LABELS.map((f) => {
                                        const on = active.some((a) => a.key === f.key)
                                        const legacyOnly =
                                          on && !(r.earlyAccessFeatures ?? []).includes(f.key)
                                        return (
                                          <button
                                            key={f.key}
                                            type="button"
                                            onClick={() => void toggleFeature(r, f.key, !on)}
                                            disabled={busy === r.userId}
                                            title={f.hint}
                                            className="w-full flex items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50"
                                          >
                                            <span
                                              className={`mt-0.5 inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                                                on
                                                  ? 'border-teal-500 bg-teal-500 text-white'
                                                  : 'border-gray-300 dark:border-gray-600'
                                              }`}
                                            >
                                              {on && <Check className="h-2.5 w-2.5" aria-hidden />}
                                            </span>
                                            <span className="flex-1">
                                              <span className="block text-gray-800 dark:text-gray-100">{f.label}</span>
                                              {legacyOnly && (
                                                <span className="block text-[10px] text-gray-400">
                                                  以前の一括開放から引き継ぎ
                                                </span>
                                              )}
                                            </span>
                                          </button>
                                        )
                                      })}
                                    </div>
                                  )}
                                </span>
                              )
                            })()}
```

**注意**: `legacyOnly` の行を「外す」と、レガシー `early_access=true` は残ったままなので見た目が変わらない。これは意図どおり（レガシー boolean は触らない方針）。実運用でレガシー分を外したい場合は、既存の `toggleEarlyAccess` を呼ぶ導線が必要になる——**今回は作らない**（オーナーが必要と言うまでYAGNI）。

- [ ] **Step 4: 未使用になった `toggleEarlyAccess` を削除する**

この変更で `toggleEarlyAccess` は呼び出し元が無くなる。**関数ごと削除する**（使われないコードを残さない）。API 側の `earlyAccess` 分岐は互換のため残っているので、古いクライアントからの呼び出しは引き続き通る。

削除するのは `src/app/admin/AdminLedgerClient.tsx` の `// 先行体験（マルチ部署串刺し検索）の開放 ON/OFF。` のコメントから、その `useCallback` の閉じ括弧 `[load],\n  )` までの一塊。

- [ ] **Step 5: 確認とコミット**

Run: `npx tsc --noEmit && npx vitest run 2>&1 | tail -3`
Expected: 全パス

```bash
git add src/app/admin/AdminLedgerClient.tsx
git commit -m "/admin の先行体験を機能名つき3トグルにする

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: env の記載・全体確認・動作確認

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: `.env.example` に新しい env を書く**

`EARLY_ACCESS_EMAILS` / `MULTI_DEPARTMENT_GA` の記載が無いため、先行体験の節を新設する。ファイル末尾に追記:

```
# ── 先行体験（機能別） ────────────────────────────────────
# 判定は「GA env → メールリスト env → 台帳 user_settings.early_access_features」の順。
# 台帳は /admin のアカウント台帳から人ごとに開閉できるので、env は開発・緊急時用。
#
# 全員へ開放するスイッチ（GA判断）。'true' のときだけ有効。
# MULTI_DEPARTMENT_GA=true
# TOWER_GA=true
# EASY_CONNECT_GA=true
#
# 指定メールだけに開放（カンマ区切り・大小無視）。
# EARLY_ACCESS_EMAILS は マルチ部署検索 と 知の塔 の両方に効く（分離前からの互換）。
# EARLY_ACCESS_EMAILS=owner@example.com,tester@example.com
# EASY_CONNECT_EMAILS=tester@example.com
```

- [ ] **Step 2: 全体確認**

Run: `npx vitest run && npx tsc --noEmit && npm run build 2>&1 | tail -5`
Expected: すべて成功

- [ ] **Step 3: 開発サーバーで /admin を目視**

migration 未適用でも壊れないことを先に見る（この時点では 0021 は流していない）:

```bash
npm run dev -- --port 3032
```

確認すること:
- [ ] /admin のアカウント台帳が今までどおり表示される（列が無くても 500 にならない）
- [ ] 各行の「先行体験」を押すとメニューが開き、3つのラベルが省略なしで読める
- [ ] レガシー `early_access=true` の人は「マルチ部署検索」「知の塔」にチェックが付き、「以前の一括開放から引き継ぎ」と出る
- [ ] チェックを押すと（列未適用なら）エラーが alert で出る。列適用後は反映される

- [ ] **Step 4: コミット**

```bash
git add .env.example
git commit -m "先行体験のenvを.env.exampleに記載

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## マージ前チェックリスト（オーナー実施）

- [ ] Supabase SQL Editor で `supabase/migrations/0021_early_access_features.sql` を流す → https://supabase.com/dashboard/project/_/sql/new
- [ ] 流したら `supabase/migrations/README.md` の 0021 行を ⬜ → ✅ に変える
- [ ] /admin で自分の行の「先行体験」→「かんたん接続（OAuth検証）」にチェック → 台帳を読み直しても付いたままであること
- [ ] 既に先行体験を持っていた人（マルチ部署・知の塔）の見え方が変わっていないこと（アプリ側で追加部署の設定と知の塔が今までどおり出る）
- [ ] チェックを外す → 該当機能が消えること

## この計画で「やらない」こと

- レガシー `early_access` boolean のバックフィルと削除（読み取り互換で足りる。列の掃除は全員が機能配列へ移った後の別作業）
- かんたん接続そのものの実装（段B）。この計画は `easy_connect` を**開閉できる状態**にするところまで
- 登録先行の導線とプレビューリンク（段C）
