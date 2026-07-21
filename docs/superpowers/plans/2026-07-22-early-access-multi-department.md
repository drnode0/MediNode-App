# 先行体験：マルチ部署串刺し検索 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 個人＋部署1枠に加えて「追加部署」を複数登録し横断検索できるようにする。ただしオーナー（私）と指定アカウントだけに開放し、後日 env 1つで全体公開できる形にする。

**Architecture:** 方式A（additive）。既存の単一部署フィールドは無変更のまま、`additionalTeams: TeamConfig[]` を足す。開放判定は純ロジック `resolveEarlyAccess()`（env `EARLY_ACCESS_EMAILS` ∪ 台帳 `user_settings.early_access` ∪ GA `MULTI_DEPARTMENT_GA`）に集約し、サーバー（`premium/status` と検索ルート）で判定・再検証する。クライアントは追加部署をそのまま body に載せるだけで、ゲートはサーバーが担保する。

**Tech Stack:** Next.js (App Router), TypeScript, Supabase (Postgres + Auth), Notion API (@notionhq/client), Vitest, Tailwind。

## Global Constraints

- ブランチは `feature/early-access-multi-department`（`origin/main` 基点）。コミット前に必ず `git branch --show-current` を確認する（誤爆防止）。
- 非対象ユーザー（`additionalTeams` 空）は既存コードパスと完全に同一挙動でなければならない。
- 開放判定の正はサーバー。クライアントのフラグは表示制御のみ。検索ルートは `additionalTeams` を受けても earlyAccess を再検証する。
- migration は「追加のみ・既存データに影響なし・列が無くても動く」方針（既存 0008 に倣う）。Supabase SQL Editor で手動適用。
- 用語: 「鍵」= トークン専用。部署ラベルの既定フォールバックは「部署」。
- 上限は追加部署 5 件（`MAX_ADDITIONAL_TEAMS`）。
- テストは既存同様 `src/lib/__tests__/*.test.ts` に純ロジックのユニットテストを置く。実行は `npx vitest run <path>`。

---

## File Structure

- Create `migrations/0009_user_settings_early_access.sql` — `user_settings.early_access` 列。
- Create `src/lib/teams.ts` — `TeamConfig` 型、`MAX_ADDITIONAL_TEAMS`、`sanitizeAdditionalTeams()`（純）。
- Create `src/lib/feature-access.ts` — `resolveEarlyAccess()` 等（純・env 読取り）。
- Create `src/lib/supabase/early-access.ts` — `getSessionEarlyAccess()`（サーバーIO）。
- Create `src/lib/__tests__/teams.test.ts`, `src/lib/__tests__/feature-access.test.ts`。
- Modify `src/lib/settings.ts` — `AppSettings` に `additionalTeams?` と `earlyAccess?`。
- Modify `src/app/api/premium/status/route.ts` — 応答に `earlyAccess` を追加。
- Modify `src/components/auth/PremiumSync.tsx` — `earlyAccess` を設定にミラー。
- Modify `src/app/api/notion/search/route.ts` — `additionalTeams` 受理＋`queryAdditionalTeams()`＋ラベル付与変更。
- Modify `src/app/page.tsx` — 検索 body に `additionalTeams` を載せる。
- Modify `src/components/SettingsPanel.tsx` — 追加部署セクション（earlyAccess 限定）。
- Modify `src/app/api/admin/ledger/route.ts` — GET に `early_access`、PATCH に early_access トグル。
- Modify `src/app/admin/AdminLedgerClient.tsx` — early_access トグル UI。

---

## Task 1: migration — user_settings.early_access 列

**Files:**
- Create: `migrations/0009_user_settings_early_access.sql`

**Interfaces:**
- Produces: `public.user_settings.early_access boolean not null default false`

- [ ] **Step 1: マイグレーションファイルを作成**

```sql
-- 先行体験（マルチ部署串刺し検索）の開放フラグ。
-- アカウント単位の口座属性（契約有無に依存しない）ため user_settings に置く。
-- 追加のみ・既存データに影響なし。コードは列が無くても動く（照会失敗時は false 扱い）ため、
-- 0006/0007/0008 と同様に Supabase SQL Editor で任意のタイミングで適用してよい。
alter table public.user_settings
  add column if not exists early_access boolean not null default false;
```

- [ ] **Step 2: コミット**

```bash
cd ~/medical-search-public
git add migrations/0009_user_settings_early_access.sql
git commit -m "feat(db): user_settings.early_access 列（先行体験フラグ）"
```

---

## Task 2: teams.ts — TeamConfig 型と sanitize（純ロジック＋テスト）

**Files:**
- Create: `src/lib/teams.ts`
- Test: `src/lib/__tests__/teams.test.ts`

**Interfaces:**
- Produces:
  - `export type TeamConfig = { label: string; notionToken: string; medicalDbId: string; referenceDbId?: string; manualDbId?: string }`
  - `export const MAX_ADDITIONAL_TEAMS = 5`
  - `export function sanitizeAdditionalTeams(input: unknown, max?: number): TeamConfig[]`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/teams.test.ts
import { describe, it, expect } from 'vitest'
import { sanitizeAdditionalTeams, MAX_ADDITIONAL_TEAMS } from '../teams'

describe('sanitizeAdditionalTeams', () => {
  it('配列でなければ空配列を返す', () => {
    expect(sanitizeAdditionalTeams(undefined)).toEqual([])
    expect(sanitizeAdditionalTeams(null)).toEqual([])
    expect(sanitizeAdditionalTeams('x')).toEqual([])
  })

  it('label と notionToken と medicalDbId が揃った要素だけを残す', () => {
    const out = sanitizeAdditionalTeams([
      { label: '循環器', notionToken: 'ntn_a', medicalDbId: 'db1' },
      { label: '', notionToken: 'ntn_b', medicalDbId: 'db2' }, // label 無し → 除外
      { label: '呼吸器', notionToken: '', medicalDbId: 'db3' }, // token 無し → 除外
      { label: '消化器', notionToken: 'ntn_c', medicalDbId: '' }, // medicalDbId 無し → 除外
    ])
    expect(out).toEqual([{ label: '循環器', notionToken: 'ntn_a', medicalDbId: 'db1' }])
  })

  it('任意フィールドは保持し、前後空白を落とす', () => {
    const out = sanitizeAdditionalTeams([
      { label: ' 内科 ', notionToken: ' ntn_x ', medicalDbId: ' db ', referenceDbId: 'ref', manualDbId: 'man' },
    ])
    expect(out).toEqual([
      { label: '内科', notionToken: 'ntn_x', medicalDbId: 'db', referenceDbId: 'ref', manualDbId: 'man' },
    ])
  })

  it('max 件で打ち切る（既定 MAX_ADDITIONAL_TEAMS）', () => {
    const many = Array.from({ length: MAX_ADDITIONAL_TEAMS + 3 }, (_, i) => ({
      label: `t${i}`, notionToken: `ntn${i}`, medicalDbId: `db${i}`,
    }))
    expect(sanitizeAdditionalTeams(many)).toHaveLength(MAX_ADDITIONAL_TEAMS)
    expect(sanitizeAdditionalTeams(many, 2)).toHaveLength(2)
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/teams.test.ts`
Expected: FAIL（`../teams` が存在しない）

- [ ] **Step 3: 実装を書く**

```ts
// src/lib/teams.ts
// 部署（team）1件の接続設定。既存の単一部署フィールドに加え、
// 「追加部署」を複数持たせるための型。純データのみ。
export type TeamConfig = {
  label: string
  notionToken: string
  medicalDbId: string
  referenceDbId?: string
  manualDbId?: string
}

// 追加部署の上限（Notion レート保護）。必要になったら緩める。
export const MAX_ADDITIONAL_TEAMS = 5

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

// 受け取った任意値を安全な TeamConfig[] に整える。
// label / notionToken / medicalDbId が揃った要素だけを残し、max 件で打ち切る。
// サーバー・クライアント両方から使える純関数。
export function sanitizeAdditionalTeams(input: unknown, max: number = MAX_ADDITIONAL_TEAMS): TeamConfig[] {
  if (!Array.isArray(input)) return []
  const out: TeamConfig[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const label = str(r.label)
    const notionToken = str(r.notionToken)
    const medicalDbId = str(r.medicalDbId)
    if (!label || !notionToken || !medicalDbId) continue
    const team: TeamConfig = { label, notionToken, medicalDbId }
    const referenceDbId = str(r.referenceDbId)
    const manualDbId = str(r.manualDbId)
    if (referenceDbId) team.referenceDbId = referenceDbId
    if (manualDbId) team.manualDbId = manualDbId
    out.push(team)
    if (out.length >= max) break
  }
  return out
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/teams.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: コミット**

```bash
git add src/lib/teams.ts src/lib/__tests__/teams.test.ts
git commit -m "feat(teams): TeamConfig 型と sanitizeAdditionalTeams（純ロジック）"
```

---

## Task 3: feature-access.ts — 開放判定（純ロジック＋テスト）

**Files:**
- Create: `src/lib/feature-access.ts`
- Test: `src/lib/__tests__/feature-access.test.ts`

**Interfaces:**
- Produces:
  - `export function isMultiDepartmentGa(): boolean`
  - `export function emailInEarlyAccessList(email: string | null | undefined): boolean`
  - `export function resolveEarlyAccess(input: { email?: string | null; ledgerEarlyAccess?: boolean | null }): boolean`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/feature-access.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { resolveEarlyAccess, emailInEarlyAccessList, isMultiDepartmentGa } from '../feature-access'

const ENV = { ...process.env }
afterEach(() => { process.env = { ...ENV } })

describe('emailInEarlyAccessList', () => {
  it('EARLY_ACCESS_EMAILS に大小無視で含まれれば true', () => {
    process.env.EARLY_ACCESS_EMAILS = 'a@x.com, Owner@Y.com'
    expect(emailInEarlyAccessList('owner@y.com')).toBe(true)
    expect(emailInEarlyAccessList('a@x.com')).toBe(true)
    expect(emailInEarlyAccessList('none@z.com')).toBe(false)
    expect(emailInEarlyAccessList(null)).toBe(false)
  })
  it('未設定なら常に false', () => {
    delete process.env.EARLY_ACCESS_EMAILS
    expect(emailInEarlyAccessList('a@x.com')).toBe(false)
  })
})

describe('isMultiDepartmentGa', () => {
  it('MULTI_DEPARTMENT_GA=true のときだけ true', () => {
    process.env.MULTI_DEPARTMENT_GA = 'true'
    expect(isMultiDepartmentGa()).toBe(true)
    process.env.MULTI_DEPARTMENT_GA = 'false'
    expect(isMultiDepartmentGa()).toBe(false)
    delete process.env.MULTI_DEPARTMENT_GA
    expect(isMultiDepartmentGa()).toBe(false)
  })
})

describe('resolveEarlyAccess', () => {
  it('GA が立っていれば email/台帳に関係なく true', () => {
    process.env.MULTI_DEPARTMENT_GA = 'true'
    expect(resolveEarlyAccess({ email: null, ledgerEarlyAccess: false })).toBe(true)
  })
  it('env 許可リスト一致で true', () => {
    delete process.env.MULTI_DEPARTMENT_GA
    process.env.EARLY_ACCESS_EMAILS = 'owner@y.com'
    expect(resolveEarlyAccess({ email: 'owner@y.com', ledgerEarlyAccess: false })).toBe(true)
  })
  it('台帳フラグ true で true', () => {
    delete process.env.MULTI_DEPARTMENT_GA
    delete process.env.EARLY_ACCESS_EMAILS
    expect(resolveEarlyAccess({ email: 'x@z.com', ledgerEarlyAccess: true })).toBe(true)
  })
  it('どれも無ければ false', () => {
    delete process.env.MULTI_DEPARTMENT_GA
    delete process.env.EARLY_ACCESS_EMAILS
    expect(resolveEarlyAccess({ email: 'x@z.com', ledgerEarlyAccess: false })).toBe(false)
    expect(resolveEarlyAccess({ email: null, ledgerEarlyAccess: null })).toBe(false)
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/feature-access.test.ts`
Expected: FAIL（`../feature-access` が存在しない）

- [ ] **Step 3: 実装を書く**

```ts
// src/lib/feature-access.ts
// 先行体験（マルチ部署串刺し検索）の開放判定。純ロジック（env 読取りのみ、DB/Stripe 非依存）。
// 判定の正はサーバー。段階移行の単一チョークポイント:
//   1. 先行体験: EARLY_ACCESS_EMAILS ∪ 台帳 early_access
//   2. GA: MULTI_DEPARTMENT_GA=true で全員 true

// 全体公開スイッチ。true なら誰でも利用可。
export function isMultiDepartmentGa(): boolean {
  return (process.env.MULTI_DEPARTMENT_GA || '').trim().toLowerCase() === 'true'
}

// env の許可メールリスト（COMP_ADMIN_EMAILS と同型のカンマ区切り）にメールが含まれるか。
export function emailInEarlyAccessList(email: string | null | undefined): boolean {
  const list = (process.env.EARLY_ACCESS_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return !!email && list.includes(email.toLowerCase())
}

// 開放判定の中核。env or 台帳 or GA のいずれかで true。
export function resolveEarlyAccess(input: { email?: string | null; ledgerEarlyAccess?: boolean | null }): boolean {
  if (isMultiDepartmentGa()) return true
  if (emailInEarlyAccessList(input.email)) return true
  return input.ledgerEarlyAccess === true
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/feature-access.test.ts`
Expected: PASS（8 tests）

- [ ] **Step 5: コミット**

```bash
git add src/lib/feature-access.ts src/lib/__tests__/feature-access.test.ts
git commit -m "feat(feature-access): resolveEarlyAccess 開放判定の純ロジック"
```

---

## Task 4: settings.ts — AppSettings に additionalTeams / earlyAccess

**Files:**
- Modify: `src/lib/settings.ts:5-77`（AppSettings 型定義内、`teamNotionManualDbId` の直後あたり）

**Interfaces:**
- Consumes: `TeamConfig`（Task 2）
- Produces: `AppSettings.additionalTeams?: TeamConfig[]`, `AppSettings.earlyAccess?: boolean`

- [ ] **Step 1: 型に import とフィールドを追加**

`src/lib/settings.ts` の先頭付近（`export type SearchMode` の下）に import を追加:

```ts
import type { TeamConfig } from './teams'
```

`AppSettings` の「部署用（任意）」ブロック（`teamNotionManualDbId: string` の行）の直後に追加:

```ts
  // 追加部署（先行体験・マルチ部署串刺し検索）。earlyAccess なアカウントだけ設定できる。
  // 未設定/空 = 既存挙動と完全一致（サーバーは earlyAccess を再検証してからのみ使う）。
  additionalTeams?: TeamConfig[]
  // サーバー由来の先行体験フラグのミラー（表示制御のみ・判定の正はサーバー）。
  earlyAccess?: boolean
```

- [ ] **Step 2: 型チェックが通ることを確認**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし（新フィールドは任意なので既存コードに影響しない）

- [ ] **Step 3: コミット**

```bash
git add src/lib/settings.ts
git commit -m "feat(settings): AppSettings に additionalTeams / earlyAccess を追加"
```

---

## Task 5: premium/status — 応答に earlyAccess を追加

**Files:**
- Modify: `src/app/api/premium/status/route.ts`

**Interfaces:**
- Consumes: `resolveEarlyAccess`（Task 3）
- Produces: `GET /api/premium/status` の全ログイン応答に `earlyAccess: boolean`

- [ ] **Step 1: import を追加**

`src/app/api/premium/status/route.ts` の import 群に追加:

```ts
import { resolveEarlyAccess } from '@/lib/feature-access'
```

- [ ] **Step 2: user 確定後に earlyAccess を計算**

`const isAdmin = ...` の直後（`const sub = ...` の前）に追加:

```ts
  // 先行体験（マルチ部署串刺し検索）フラグ。env or 台帳 or GA。
  // env/GA で決まる場合は DB 照会を省く。
  let ledgerEarlyAccess: boolean | null = null
  if (!resolveEarlyAccess({ email: user.email, ledgerEarlyAccess: null })) {
    const { data: us } = await supabase
      .from('user_settings')
      .select('early_access')
      .eq('user_id', user.id)
      .maybeSingle()
    ledgerEarlyAccess = (us?.early_access as boolean | undefined) ?? null
  }
  const earlyAccess = resolveEarlyAccess({ email: user.email, ledgerEarlyAccess })
```

- [ ] **Step 3: 3 つのログイン応答に earlyAccess を足す**

(a) `if (!sub.active)` の return:

```ts
    return NextResponse.json({
      loggedIn: true,
      active: false,
      status: sub.status,
      earlyAccess,
    })
```

(b) Algolia 設定不足の return（`error: 'Algolia設定が不足しています'`）に `earlyAccess,` を追加。

(c) 最終の active 応答（`algolia: {...}` を含む return）に `earlyAccess,` を追加。

- [ ] **Step 4: 型チェック**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/app/api/premium/status/route.ts
git commit -m "feat(status): premium/status 応答に earlyAccess を追加"
```

---

## Task 6: PremiumSync — earlyAccess を設定にミラー

**Files:**
- Modify: `src/components/auth/PremiumSync.tsx:92-120`（`const current = getSettings() || DEFAULT_SETTINGS` の直後）

**Interfaces:**
- Consumes: `GET /api/premium/status` の `data.earlyAccess`
- Produces: localStorage `AppSettings.earlyAccess` の同期

- [ ] **Step 1: earlyAccess ミラー処理を挿入**

`const current = getSettings() || DEFAULT_SETTINGS` の直後、`if (data.active && data.algolia) {` の前に追加:

```ts
        // 先行体験（マルチ部署串刺し検索）フラグを反映。active/非activeを問わず同期する
        // （フリー会員も対象になりうるため）。変化時のみ保存し、UI 反映のため軽くリロード。
        if (typeof data.earlyAccess === 'boolean' && (current.earlyAccess ?? false) !== data.earlyAccess) {
          saveSettings({ ...current, earlyAccess: data.earlyAccess })
          window.location.reload()
          return
        }
```

- [ ] **Step 2: 型チェック**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/components/auth/PremiumSync.tsx
git commit -m "feat(sync): earlyAccess フラグを設定にミラー"
```

---

## Task 7: early-access.ts（サーバー） — セッションから earlyAccess を再判定

**Files:**
- Create: `src/lib/supabase/early-access.ts`

**Interfaces:**
- Consumes: `resolveEarlyAccess`（Task 3）、`@/lib/supabase/server` の `createClient`
- Produces: `export async function getSessionEarlyAccess(): Promise<boolean>`

- [ ] **Step 1: サーバーヘルパーを作成**

```ts
// src/lib/supabase/early-access.ts
// 検索ルート等で、クライアント改ざんを防ぐために earlyAccess をサーバー側で再判定する。
import { createClient } from '@/lib/supabase/server'
import { resolveEarlyAccess } from '@/lib/feature-access'

export async function getSessionEarlyAccess(): Promise<boolean> {
  try {
    // GA が立っていればユーザー確定前に true（誰でも利用可）。
    if (resolveEarlyAccess({ email: null, ledgerEarlyAccess: null })) return true

    const supabaseReady = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
    if (!supabaseReady) return false

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false

    // env/email で決まるなら DB 照会を省く。
    if (resolveEarlyAccess({ email: user.email, ledgerEarlyAccess: null })) return true

    const { data: us } = await supabase
      .from('user_settings')
      .select('early_access')
      .eq('user_id', user.id)
      .maybeSingle()
    return resolveEarlyAccess({ email: user.email, ledgerEarlyAccess: (us?.early_access as boolean | undefined) ?? null })
  } catch {
    return false
  }
}
```

- [ ] **Step 2: 型チェック**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/lib/supabase/early-access.ts
git commit -m "feat(early-access): セッションから earlyAccess を再判定するサーバーヘルパー"
```

---

## Task 8: 検索ルート — additionalTeams を横断検索

**Files:**
- Modify: `src/app/api/notion/search/route.ts`（body 分割代入 ~428、queryDb の下にヘルパー追加、mode ブロックの後 ~547、ラベル付与パス ~549-553）

**Interfaces:**
- Consumes: `TeamConfig`, `sanitizeAdditionalTeams`（Task 2）、`getSessionEarlyAccess`（Task 7）、既存 `queryDb` / `fetchQuizRecords` / `fetchBrowseRecords`
- Produces: `additionalTeams` を含む検索応答（各追加部署の結果は `owner:'team'` かつ `teamLabel = TeamConfig.label`）

- [ ] **Step 1: import を追加**

ファイル冒頭の import に追加:

```ts
import { sanitizeAdditionalTeams, type TeamConfig } from '@/lib/teams'
import { getSessionEarlyAccess } from '@/lib/supabase/early-access'
```

- [ ] **Step 2: body 分割代入に additionalTeams を追加**

`teamOnly = false,` の直後（`} = await req.json()` の前）に追加:

```ts
      // 追加部署（先行体験）。earlyAccess を再検証したうえでのみ使う。
      additionalTeams,
```

- [ ] **Step 3: queryAdditionalTeams ヘルパーを追加**

`queryDb`（および `fetchQuizRecords` / `fetchBrowseRecords`）が定義済みのスコープ内、POST ハンドラの前に追加:

```ts
// 追加部署（先行体験）を、モードごとに既存の取得関数で横断検索する。
// 各部署は独立クライアントで並列に引き、1部署が壊れても .catch で握り潰して他を守る。
// 返す全レコードに team.label を teamLabel として刻む（結果カードの部署バッジ用）。
async function queryAdditionalTeams(
  teams: TeamConfig[],
  mode: string,
  opts: { keyword: string; genre: string; pageSize: number },
): Promise<NotionRecord[]> {
  const out: NotionRecord[] = []
  await Promise.all(
    teams.map(async (team) => {
      const client = new Client({ auth: team.notionToken })
      const label = team.label.trim() || '部署'
      const collected: NotionRecord[] = []
      try {
        if (mode === 'recent') {
          const med = await queryDb(client, team.medicalDbId, 'medical', '', 50, undefined, 'team').catch(() => null)
          const ref = team.referenceDbId
            ? await queryDb(client, team.referenceDbId, 'reference', '', 20, undefined, 'team').catch(() => null)
            : null
          if (med) collected.push(...med.records)
          if (ref) collected.push(...ref.records)
        } else if (mode === 'quiz') {
          const q = await fetchQuizRecords(client, team.medicalDbId, 'team').catch(() => null)
          if (q) collected.push(...q)
        } else if (mode === 'browse') {
          const med = await fetchBrowseRecords(client, team.medicalDbId, opts.genre, opts.pageSize, 'team', 'medical').catch(() => null)
          const ref = team.referenceDbId
            ? await fetchBrowseRecords(client, team.referenceDbId, opts.genre, opts.pageSize, 'team', 'reference').catch(() => null)
            : null
          if (med) collected.push(...med)
          if (ref) collected.push(...ref)
        } else if (mode === 'manual') {
          if (team.manualDbId) {
            const man = await queryDb(client, team.manualDbId, 'manual', opts.keyword, opts.pageSize, undefined, 'team').catch(() => null)
            if (man) collected.push(...man.records)
          }
        } else {
          // 通常検索（keyword 必須）
          if (opts.keyword.trim()) {
            const med = await queryDb(client, team.medicalDbId, 'medical', opts.keyword, opts.pageSize, undefined, 'team').catch(() => null)
            const ref = team.referenceDbId
              ? await queryDb(client, team.referenceDbId, 'reference', opts.keyword, 20, undefined, 'team').catch(() => null)
              : null
            if (med) collected.push(...med.records)
            if (ref) collected.push(...ref.records)
          }
        }
      } catch {
        // この部署は握り潰して他部署・個人結果を守る。
      }
      for (const r of collected) r.teamLabel = label
      out.push(...collected)
    }),
  )
  return out
}
```

- [ ] **Step 4: mode ブロックの後で追加部署を合流**

ラベル付与パスの直前（`// 部署バッジに部署名...` コメントの前）に追加:

```ts
    // 追加部署（先行体験）: earlyAccess をサーバーで再検証し、OK のときだけ横断検索する。
    // additionalTeams が空/未指定なら DB 照会もせず、既存挙動と完全に一致する。
    const requestedTeams = sanitizeAdditionalTeams(additionalTeams)
    if (requestedTeams.length > 0 && (await getSessionEarlyAccess())) {
      const extra = await queryAdditionalTeams(requestedTeams, mode, { keyword, genre, pageSize })
      records.push(...extra)
    }
```

- [ ] **Step 5: ラベル付与パスを「未ラベルのみ」に変更**

既存:

```ts
    for (const r of records) {
      if (r.owner === 'team') r.teamLabel = resolvedTeamLabel
    }
```

を、追加部署が刻んだラベルを上書きしないよう変更:

```ts
    for (const r of records) {
      if (r.owner === 'team' && !r.teamLabel) r.teamLabel = resolvedTeamLabel
    }
```

- [ ] **Step 6: 型チェック**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/app/api/notion/search/route.ts
git commit -m "feat(search): additionalTeams を横断検索（earlyAccess 再検証＋部署別ラベル）"
```

---

## Task 9: page.tsx — 検索 body に additionalTeams を載せる

**Files:**
- Modify: `src/app/page.tsx`（`/api/notion/search` を叩く各 body。`teamLabel: settings.teamLabel || undefined,` を含む箇所すべて）

**Interfaces:**
- Consumes: `settings.additionalTeams`
- Produces: 検索 body に `additionalTeams`（サーバーがゲート）

- [ ] **Step 1: 対象箇所を洗い出す**

Run: `cd ~/medical-search-public && grep -n "teamLabel: settings.teamLabel || undefined," src/app/page.tsx`
Expected: 複数行ヒット（例: 1385, 1471, 1843 付近）。これらが `/api/notion/search` の body。

- [ ] **Step 2: 各 body に additionalTeams を追加**

上で見つかった各 `teamLabel: settings.teamLabel || undefined,` の直後の行に、以下を挿入する（全ヒット箇所に同じ1行を足す）:

```ts
        additionalTeams: settings.additionalTeams && settings.additionalTeams.length ? settings.additionalTeams : undefined,
```

（インデントは各箇所の既存の body プロパティに合わせる。非 earlyAccess ユーザーは `additionalTeams` が空なので `undefined` となり、送信されず既存挙動と一致する。）

- [ ] **Step 3: 全箇所に入ったか確認**

Run: `cd ~/medical-search-public && grep -c "additionalTeams: settings.additionalTeams" src/app/page.tsx`
Expected: Step 1 のヒット数と一致

- [ ] **Step 4: 型チェック**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/app/page.tsx
git commit -m "feat(search-client): 検索 body に additionalTeams を載せる"
```

---

## Task 10: SettingsPanel — 追加部署セクション（earlyAccess 限定）

**Files:**
- Modify: `src/components/SettingsPanel.tsx`（`section === 'team'` ブロック内、既存部署フォームの下）

**Interfaces:**
- Consumes: `getSettings().earlyAccess`, `settings.additionalTeams`, `TeamConfig`, `MAX_ADDITIONAL_TEAMS`, `extractNotionDbId`, `saveSettings`
- Produces: earlyAccess ユーザーだけに現れる追加部署の追加/削除 UI

- [ ] **Step 1: import を追加**

`SettingsPanel.tsx` の import に追加:

```ts
import type { TeamConfig } from '@/lib/teams'
import { MAX_ADDITIONAL_TEAMS } from '@/lib/teams'
```

- [ ] **Step 2: 追加部署のローカル state を用意**

コンポーネント内、`teamForm` の state 定義の近くに追加:

```ts
  // 追加部署（先行体験）。earlyAccess のときだけ編集 UI を出す。
  const [additionalTeams, setAdditionalTeams] = useState<TeamConfig[]>(
    () => (getSettings()?.additionalTeams ?? []).map((t) => ({ ...t })),
  )
  const earlyAccess = getSettings()?.earlyAccess === true

  function saveAdditionalTeams(next: TeamConfig[]) {
    const cleaned = next
      .map((t) => ({
        label: t.label.trim(),
        notionToken: t.notionToken.trim(),
        medicalDbId: t.medicalDbId ? extractNotionDbId(t.medicalDbId) : '',
        referenceDbId: t.referenceDbId ? extractNotionDbId(t.referenceDbId) : undefined,
        manualDbId: t.manualDbId ? extractNotionDbId(t.manualDbId) : undefined,
      }))
      .filter((t) => t.label && t.notionToken && t.medicalDbId)
    const current = getSettings()
    if (current) saveSettings({ ...current, additionalTeams: cleaned })
    setAdditionalTeams(next)
  }
```

- [ ] **Step 3: 追加部署 UI を team セクションに挿入**

`section === 'team'` ブロック内、既存の「部署DB接続を解除する」ボタンの `)}` の直後（`</div>` で team セクションを閉じる直前）に追加:

```tsx
              {earlyAccess && (
                <div className="mt-6 border-t border-gray-100 dark:border-gray-800 pt-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">追加部署</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-50 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">先行体験</span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">複数の部署DBを登録すると、検索・新着・ジャンルで横断して表示されます（先行体験中の機能です）。</p>
                  {additionalTeams.map((t, i) => (
                    <div key={i} className="rounded-xl border border-gray-200 dark:border-gray-700 p-3 space-y-2">
                      <input type="text" value={t.label} onChange={(e) => setAdditionalTeams((arr) => arr.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="部署名（例：循環器）" className={inputCls} />
                      <input type="password" value={t.notionToken} onChange={(e) => setAdditionalTeams((arr) => arr.map((x, j) => j === i ? { ...x, notionToken: e.target.value } : x))} placeholder="コネクトToken（ntn_...）" className={inputCls} />
                      <input type="text" value={t.medicalDbId} onChange={(e) => setAdditionalTeams((arr) => arr.map((x, j) => j === i ? { ...x, medicalDbId: e.target.value } : x))} placeholder="Medical DB（URLまたはID）" className={inputCls} />
                      <input type="text" value={t.referenceDbId ?? ''} onChange={(e) => setAdditionalTeams((arr) => arr.map((x, j) => j === i ? { ...x, referenceDbId: e.target.value } : x))} placeholder="Reference DB（任意）" className={inputCls} />
                      <input type="text" value={t.manualDbId ?? ''} onChange={(e) => setAdditionalTeams((arr) => arr.map((x, j) => j === i ? { ...x, manualDbId: e.target.value } : x))} placeholder="Manual DB（任意）" className={inputCls} />
                      <button onClick={() => saveAdditionalTeams(additionalTeams.filter((_, j) => j !== i))} className="w-full text-xs text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 py-1 transition-colors">この部署を削除</button>
                    </div>
                  ))}
                  {additionalTeams.length < MAX_ADDITIONAL_TEAMS && (
                    <button onClick={() => setAdditionalTeams((arr) => [...arr, { label: '', notionToken: '', medicalDbId: '' }])} className="w-full border border-dashed border-gray-300 dark:border-gray-600 rounded-xl py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">＋ 部署を追加</button>
                  )}
                  <button onClick={() => saveAdditionalTeams(additionalTeams)} className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-brand-700 transition-colors">追加部署を保存する</button>
                </div>
              )}
```

- [ ] **Step 4: 型チェック**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/components/SettingsPanel.tsx
git commit -m "feat(settings-ui): 追加部署セクション（earlyAccess 限定）"
```

---

## Task 11: admin ledger — early_access の返却とトグル

**Files:**
- Modify: `src/app/api/admin/ledger/route.ts`（GET の user_settings select ~59、PATCH ~490）
- Modify: `src/app/admin/AdminLedgerClient.tsx`（トグル UI）

**Interfaces:**
- Consumes: `PATCH /api/admin/ledger` の既存パターン（`requireAdmin`, `createAdminClient`, `logAdminAction`）
- Produces: 台帳行に `earlyAccess: boolean`、`PATCH { userId, earlyAccess }` で `user_settings.early_access` を更新

- [ ] **Step 1: GET で user_settings に early_access を含める**

`src/app/api/admin/ledger/route.ts` の GET 内、既存の user_settings 取得:

```ts
    const { data: settings, error: setErr } = await admin
      .from('user_settings')
      .select('user_id, updated_at')
```

を:

```ts
    const { data: settings, error: setErr } = await admin
      .from('user_settings')
      .select('user_id, updated_at, early_access')
```

に変更。直後の `settingsByUser` Map の下に、early_access の Map を追加:

```ts
    const earlyAccessByUser = new Map(
      (settings ?? []).map((s) => [s.user_id as string, (s.early_access as boolean | undefined) ?? false]),
    )
```

そして台帳行を組み立てている箇所（各ユーザーの行オブジェクトを作る `.map(...)`）に `earlyAccess: earlyAccessByUser.get(<userId>) ?? false,` を1プロパティ追加する。
※ 行を組む変数名は実装時に確認: `grep -n "isMonitor\|updated_at\|settingsByUser.get" src/app/api/admin/ledger/route.ts` で行組み立て箇所を特定し、そこに同じ userId キーで `earlyAccess` を足す。

- [ ] **Step 2: PATCH に early_access 分岐を追加**

既存 PATCH は `{ userId, isMonitor }` を受ける。`isMonitor` の型チェックの前に、early_access リクエストを先に処理する分岐を追加する。`const { userId, isMonitor } = ...` を `const { userId, isMonitor, earlyAccess } = (await req.json()) as { userId?: unknown; isMonitor?: unknown; earlyAccess?: unknown }` に変え、`userId` 検証の直後に追加:

```ts
    // 先行体験（マルチ部署検索）の開放トグル。user_settings.early_access を更新する。
    if (typeof earlyAccess === 'boolean') {
      const admin = createAdminClient()
      const { data: u, error: uErr } = await admin.auth.admin.getUserById(userId)
      if (uErr || !u?.user) {
        return NextResponse.json({ error: '対象のユーザーが見つかりません' }, { status: 404 })
      }
      const { error: upErr } = await admin
        .from('user_settings')
        .upsert({ user_id: userId, early_access: earlyAccess }, { onConflict: 'user_id' })
      if (upErr) throw new Error(upErr.message)
      await logAdminAction(admin, {
        actorEmail: auth.email,
        action: earlyAccess ? 'grant_early_access' : 'revoke_early_access',
        targetUserId: userId,
        targetEmail: u.user.email ?? null,
      })
      return NextResponse.json({ ok: true, userId, earlyAccess })
    }
```

（`isMonitor` の型チェックは、この early_access 分岐の後もそのまま残す。両者は排他的に呼ばれる。）

- [ ] **Step 3: AdminLedgerClient にトグルを追加**

`src/app/admin/AdminLedgerClient.tsx` で、行の型に `earlyAccess?: boolean` を足し（GET 応答に合わせる）、`isMonitor` トグルの近くに early_access トグルを追加する。まず既存の isMonitor トグルの実装を確認:

Run: `cd ~/medical-search-public && grep -n "isMonitor\|PATCH\|fetch('/api/admin/ledger'" src/app/admin/AdminLedgerClient.tsx`

見つかった isMonitor トグルの PATCH 呼び出しに倣い、同じ行に early_access トグルを追加する（`body: JSON.stringify({ userId: row.userId, earlyAccess: !row.earlyAccess })` を送り、成功後に一覧を再取得 or 楽観更新）。ラベルは「先行体験」、ON 表示は teal 系。実装は既存 isMonitor トグルの JSX とハンドラを複製し、`isMonitor`→`earlyAccess`、送信ボディを earlyAccess に差し替える。

- [ ] **Step 4: 型チェック**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/app/api/admin/ledger/route.ts src/app/admin/AdminLedgerClient.tsx
git commit -m "feat(admin): 台帳に early_access トグル（先行体験の開放/取消）"
```

---

## Task 12: 全体テスト・手動検証・ロールアウト文書

**Files:**
- Modify: `docs/superpowers/specs/2026-07-22-early-access-multi-department-design.md`（ロールアウト実績を追記）または新規 `HANDOFF` セクション

- [ ] **Step 1: 全ユニットテスト**

Run: `cd ~/medical-search-public && npx vitest run`
Expected: 全 PASS（既存＋新規 teams / feature-access）

- [ ] **Step 2: 型・lint・ビルド**

Run: `cd ~/medical-search-public && npx tsc --noEmit && npm run build`
Expected: エラーなし

- [ ] **Step 3: ローカル手動検証（dev サーバー）**

- `.env.local` に `EARLY_ACCESS_EMAILS=<オーナーのメール>` を設定して dev 起動。
- オーナーでログイン → 設定→部署 に「追加部署（先行体験）」が出る。2 部署を登録。
- 検索・新着・ジャンルで、各部署の結果が部署名バッジ付きで出ることを確認。
- `EARLY_ACCESS_EMAILS` を空にして別アカウント（または同アカウントで earlyAccess=false）で確認 → 追加部署セクションが出ず、既存挙動が不変。

- [ ] **Step 4: 本番反映手順を文書化**

design doc（または HANDOFF）に以下を追記:
1. Supabase SQL Editor で `migrations/0009_user_settings_early_access.sql` を適用（ダッシュボード: https://supabase.com/dashboard → 該当プロジェクト → SQL Editor）。
2. Vercel の環境変数に `EARLY_ACCESS_EMAILS=<オーナーのメール>` を設定（https://vercel.com/dashboard → 該当プロジェクト → Settings → Environment Variables）。GA 時は `MULTI_DEPARTMENT_GA=true`。
3. `feature/early-access-multi-department` を main へマージ → 自動デプロイ。
4. 指定アカウントを増やす場合: `EARLY_ACCESS_EMAILS` に追記 して再デプロイ、または /admin 台帳の early_access トグルを ON（再デプロイ不要）。
5. Notion 実装ロードマップDB の第1弾エントリを「先行体験リリース」に更新。

- [ ] **Step 5: コミット**

```bash
git add docs/superpowers
git commit -m "docs: 先行体験マルチ部署検索のロールアウト手順"
```

---

## Self-Review 結果（記入済み）

- **Spec coverage**: 開放判定(env/台帳/GA)=Task3/5/7/11、データモデル=Task2/4、検索合流＝Task8、UI=Task10、結果バッジ=既存ResultCardで充足（変更不要と明記）、多層防御=Task7/8、GA移行=Task3＋文書=Task12、migration=Task1。全節に対応タスクあり。
- **Placeholder scan**: 具体コードを各ステップに記載。Task9/11 の一部は「実装時に grep で行を特定」する手順だが、対象の grep コマンドと挿入内容を明示済み（page.tsx の複数 body、ledger の行組み立ては可変のため）。
- **Type consistency**: `TeamConfig`（teams.ts 単一定義、settings.ts が import）、`resolveEarlyAccess({email,ledgerEarlyAccess})`、`getSessionEarlyAccess():Promise<boolean>`、`sanitizeAdditionalTeams(input,max?)`、検索 body の `additionalTeams`、status 応答の `earlyAccess`、PATCH の `{userId, earlyAccess}` — 全タスク間で一致。
