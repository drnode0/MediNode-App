# Web Push 通知 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アプリを閉じている医療者を「今日の1問／解決済みCQ回答／お知らせ」で外から戻す Web Push 通知を、オーナー専用のお試し（preview）状態まで作り切る。

**Architecture:** 既存の「今日の1問」段階公開（app_flags の `stage` 列 off/preview/on）とまったく同じ型で `push` フラグを足す。購読は Supabase（user単位・RLS本人読み・書込はservice_role）。送信は `web-push` ライブラリで、デイリーは Vercel Cron、CQ回答はイベントフック、お知らせは admin フォーム。アプリ内トグルを主スイッチにして可逆オフを担保する。

**Tech Stack:** Next.js 16 (App Router) / TypeScript / Supabase (`@supabase/supabase-js`, `@supabase/ssr`) / Vitest / Vercel Cron / `web-push`（新規依存）。

## Global Constraints

- テストは Vitest（`npm test` = `vitest run`）。純ロジックのテストは `src/lib/__tests__/<name>.test.ts` に置く。
- 段階公開は app_flags の `stage`（off/preview/on）で管理。**当面のゴールは preview（オーナー専用）。`on`（全員公開）へは進めない。**初期 off。
- preview 許可メール＝`COMP_ADMIN_EMAILS` ∪ `PUSH_PREVIEW_EMAILS`（カンマ区切り・大小無視）。
- Supabase 書込は必ず `createAdminClient()`（service_role）。読取ユーザー特定は `createClient()`＋`supabase.auth.getUser()`。ユーザー未ログイン・env未設定・migration未適用は**すべて無効化して静かに成功扱い**（アプリは通常どおり動く）。
- 個人データ方針：端末ローカルに残す許可状態キーは `src/lib/personal-data.ts` の `PERSONAL_DEVICE_KEYS` に登録する。
- 頻度は静けさ優先：デイリー1通／CQ回答は希少／お知らせ週1上限。連投しない。
- コピーは大人トーン・静かな日本語（「ゲーム」語彙・煽り・AI主役の宣伝はNG）。
- sw.js を変更したら `CACHE_VERSION` を必ず1つ上げる（現在 `medinode-v15`）。
- JST日付は `jstToday()`（既存 `src/lib/daily-question.ts`）を再利用する。

---

## File Structure

- `src/lib/push.ts`（新規）— 純ロジック：stage解釈・preview判定・送信スロット定義/解釈・現在スロット算出・通知種別/prefs型・stage読取（TTLキャッシュ）。`daily-question.ts` と同型。
- `src/lib/push-send.ts`（新規）— `web-push` 送信ラッパ：VAPID設定・1購読への送信・410/404失効掃除・種別トグル判定。
- `supabase/migrations/0014_push.sql`（新規）— app_flags `push` 行＋`push_subscriptions`＋`push_notify_prefs`。
- `src/app/api/push/subscribe/route.ts`（新規）— POST=購読登録/更新・DELETE=解除。
- `src/app/api/push/prefs/route.ts`（新規）— GET/POST=マスター/種別トグル＋送信スロット。
- `src/app/api/push/route.ts`（新規）— GET=stage＋自分のprefs取得（admin にはstage）・POST=stage切替（admin限定）。`daily-question` route と同型。
- `src/app/api/cron/daily-push/route.ts`（新規）— 現在スロット一致の購読者へ「今日の1問」送信。
- `src/app/api/admin/push-broadcast/route.ts`（新規）— お知らせ一斉送信（admin限定）。
- `public/sw.js`（変更）— `push`／`notificationclick` ハンドラ追加＋`CACHE_VERSION` bump。
- `src/components/PushPrimer.tsx`（新規）— 初回回答直後の許可プライマー。iOS未インストールは案内差し替え。
- `src/components/DailyQuestionCard.tsx`（変更・97行付近）— 初回回答成功後にプライマーを発火。
- 設定UI（既存の設定パネル）— 通知トグル＋送信スロットのセレクトを追加。
- `src/lib/personal-data.ts`（変更）— 許可状態キーを `PERSONAL_DEVICE_KEYS` に追加。
- `src/app/admin/maintenance/MaintenanceAdminClient.tsx`（変更）— `push` の stage 切替カード追加。
- `vercel.json`（変更）— cron エントリ追加。
- CQ解決処理（既存の解決フラグ化箇所）— 投稿者購読が取れる場合のみ送信フック。

各フェーズは独立してテスト可能：**Phase 1+2**でオーナーが購読しブラウザから手動送信で受信確認できる、**Phase 3**で自動送信が動く、**Phase 4**で preview を自分だけに点灯。

---

## Task 1: 純ロジック `src/lib/push.ts`（依存追加込み）

**Files:**
- Create: `src/lib/push.ts`
- Create: `src/lib/__tests__/push.test.ts`
- Modify: `package.json`（`web-push` と `@types/web-push` を dependencies/devDependencies に追加）

**Interfaces:**
- Produces:
  - `type PushStage = 'off' | 'preview' | 'on'`
  - `PUSH_FLAG_KEY = 'push'`
  - `type PushKind = 'daily' | 'resolved_cq' | 'announce'`
  - `const DAILY_SLOTS: readonly string[]`（`['07:00','07:30','08:00','12:30','20:00','21:00']`）
  - `DEFAULT_SLOT = '07:30'`
  - `parseStage(raw): PushStage`
  - `parseSlot(raw): string`
  - `jstSlot(nowMs?): string` — JSTの `HH:MM`
  - `isPreviewEmail(email): boolean`
  - `type NotifyPrefs = { master: boolean; daily: boolean; resolvedCq: boolean; announce: boolean; slot: string }`
  - `DEFAULT_PREFS: NotifyPrefs`
  - `parsePrefs(raw: unknown): NotifyPrefs`
  - `kindEnabled(prefs: NotifyPrefs, kind: PushKind): boolean`
  - `readPushStage(opts?): Promise<PushStage>`（TTLキャッシュ）／`__resetPushStageCache(): void`

- [ ] **Step 1: `web-push` を追加**

Run:
```bash
cd ~/medical-search-public && npm install web-push && npm install -D @types/web-push
```
Expected: `package.json` に `web-push` と `@types/web-push` が入る。

- [ ] **Step 2: 失敗するテストを書く**

Create `src/lib/__tests__/push.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  parseStage, parseSlot, jstSlot, isPreviewEmail,
  parsePrefs, kindEnabled, DEFAULT_PREFS, DEFAULT_SLOT,
} from '../push'

describe('parseStage', () => {
  it('未知値は off に倒す', () => {
    expect(parseStage('on')).toBe('on')
    expect(parseStage('preview')).toBe('preview')
    expect(parseStage('nonsense')).toBe('off')
    expect(parseStage(undefined)).toBe('off')
  })
})

describe('parseSlot', () => {
  it('プリセット外は既定スロットに倒す', () => {
    expect(parseSlot('20:00')).toBe('20:00')
    expect(parseSlot('03:17')).toBe(DEFAULT_SLOT)
    expect(parseSlot(null)).toBe(DEFAULT_SLOT)
  })
})

describe('jstSlot', () => {
  it('UTCを+9してHH:MMを返す', () => {
    // 2026-01-01T22:30:00Z = JST 2026-01-02 07:30
    const ms = Date.parse('2026-01-01T22:30:00Z')
    expect(jstSlot(ms)).toBe('07:30')
  })
})

describe('isPreviewEmail', () => {
  it('env未設定なら誰も許可しない', () => {
    delete process.env.COMP_ADMIN_EMAILS
    delete process.env.PUSH_PREVIEW_EMAILS
    expect(isPreviewEmail('a@b.com')).toBe(false)
  })
  it('許可リストに含まれるメールを大小無視で許可', () => {
    process.env.PUSH_PREVIEW_EMAILS = 'Owner@Ex.com, mon@ex.com'
    expect(isPreviewEmail('owner@ex.com')).toBe(true)
    expect(isPreviewEmail('none@ex.com')).toBe(false)
  })
})

describe('prefs', () => {
  it('壊れた入力は既定に倒す', () => {
    expect(parsePrefs(undefined)).toEqual(DEFAULT_PREFS)
    expect(parsePrefs({ master: 'x' })).toEqual(DEFAULT_PREFS)
  })
  it('種別トグルはマスターOFFで全て無効', () => {
    const p = parsePrefs({ master: false, daily: true, resolvedCq: true, announce: true, slot: '20:00' })
    expect(kindEnabled(p, 'daily')).toBe(false)
    expect(kindEnabled(p, 'resolved_cq')).toBe(false)
  })
  it('マスターONなら種別トグルに従う', () => {
    const p = parsePrefs({ master: true, daily: true, resolvedCq: false, announce: true, slot: '20:00' })
    expect(kindEnabled(p, 'daily')).toBe(true)
    expect(kindEnabled(p, 'resolved_cq')).toBe(false)
    expect(kindEnabled(p, 'announce')).toBe(true)
  })
})
```

- [ ] **Step 3: テスト失敗を確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/push.test.ts`
Expected: FAIL（`../push` が存在しない）。

- [ ] **Step 4: `src/lib/push.ts` を実装**

```ts
// Web Push の共有ロジック。段階公開・preview判定・送信スロット・通知設定を純関数で切り出す。
// 「今日の1問」の daily-question.ts と同じ型（stage列・TTLキャッシュ・env上書き）。
import { jstToday } from './daily-question'

export type PushStage = 'off' | 'preview' | 'on'
export const PUSH_FLAG_KEY = 'push'

export type PushKind = 'daily' | 'resolved_cq' | 'announce'

export const DAILY_SLOTS = ['07:00', '07:30', '08:00', '12:30', '20:00', '21:00'] as const
export const DEFAULT_SLOT = '07:30'

export function parseStage(raw: unknown): PushStage {
  return raw === 'on' || raw === 'preview' ? raw : 'off'
}

export function parseSlot(raw: unknown): string {
  return (DAILY_SLOTS as readonly string[]).includes(raw as string) ? (raw as string) : DEFAULT_SLOT
}

// JSTの現在スロット（HH:MM）。cronの一致判定に使う。utc+9は分を保つのでプリセットと揃う。
export function jstSlot(nowMs = Date.now()): string {
  return new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(11, 16)
}

export function isPreviewEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const list = [process.env.COMP_ADMIN_EMAILS || '', process.env.PUSH_PREVIEW_EMAILS || '']
    .join(',')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return list.includes(email.toLowerCase())
}

export type NotifyPrefs = {
  master: boolean
  daily: boolean
  resolvedCq: boolean
  announce: boolean
  slot: string
}

export const DEFAULT_PREFS: NotifyPrefs = {
  master: true,
  daily: true,
  resolvedCq: true,
  announce: true,
  slot: DEFAULT_SLOT,
}

export function parsePrefs(raw: unknown): NotifyPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  return {
    master: bool(o.master, DEFAULT_PREFS.master),
    daily: bool(o.daily, DEFAULT_PREFS.daily),
    resolvedCq: bool(o.resolvedCq, DEFAULT_PREFS.resolvedCq),
    announce: bool(o.announce, DEFAULT_PREFS.announce),
    slot: parseSlot(o.slot),
  }
}

export function kindEnabled(prefs: NotifyPrefs, kind: PushKind): boolean {
  if (!prefs.master) return false
  if (kind === 'daily') return prefs.daily
  if (kind === 'resolved_cq') return prefs.resolvedCq
  return prefs.announce
}

// ── stage読取（TTLキャッシュ・daily-question.ts と同型）──
const STAGE_TTL_MS = 30_000
let stageCache: { value: PushStage; at: number } | null = null

export function __resetPushStageCache(): void {
  stageCache = null
}

export async function readPushStage(opts?: {
  nowMs?: number
  fetchImpl?: typeof fetch
}): Promise<PushStage> {
  const envStage = process.env.PUSH_STAGE
  if (envStage) return parseStage(envStage)

  const nowMs = opts?.nowMs ?? Date.now()
  const fetchImpl = opts?.fetchImpl ?? fetch
  if (stageCache && nowMs - stageCache.at < STAGE_TTL_MS) return stageCache.value

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return stageCache?.value ?? 'off'
  try {
    const res = await fetchImpl(
      `${url}/rest/v1/app_flags?select=stage&key=eq.${PUSH_FLAG_KEY}`,
      { headers: { apikey: anon, Authorization: `Bearer ${anon}` }, cache: 'no-store' },
    )
    if (!res.ok) return stageCache?.value ?? 'off'
    const rows = (await res.json()) as Array<{ stage?: unknown }>
    const value = parseStage(rows[0]?.stage)
    stageCache = { value, at: nowMs }
    return value
  } catch {
    return stageCache?.value ?? 'off'
  }
}

// 再エクスポート（呼び出し側の import を1本化）。
export { jstToday }
```

- [ ] **Step 5: テスト成功を確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/push.test.ts`
Expected: PASS（全ケース）。

- [ ] **Step 6: コミット**

```bash
cd ~/medical-search-public
git add package.json package-lock.json src/lib/push.ts src/lib/__tests__/push.test.ts
git commit -m "feat(push): add web-push and push core logic (stage/slot/prefs)"
```

---

## Task 2: DBスキーマ `supabase/migrations/0014_push.sql`

**Files:**
- Create: `supabase/migrations/0014_push.sql`

**Interfaces:**
- Produces テーブル: `push_subscriptions(user_id, endpoint PK, p256dh, auth, ua, created_at, revoked_at)`、`push_notify_prefs(user_id PK, prefs jsonb, updated_at)`、app_flags に `push` 行。

- [ ] **Step 1: マイグレーションを書く**

```sql
-- Web Push の購読・通知設定・段階公開フラグ。
-- 読取は本人のみ（RLS）。書込は service_role 経由のみ（INSERT/UPDATEポリシーを作らない）。

-- 1) 段階公開フラグ（off/preview/on）。stage列は 0012 で追加済み。
insert into public.app_flags (key, value, stage)
values ('push', false, 'off')
on conflict (key) do nothing;

-- 2) 購読（1ユーザーが複数端末を持ちうるので endpoint を主キー）。
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  p256dh text not null,
  auth text not null,
  ua text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
drop policy if exists "push_subscriptions own read" on public.push_subscriptions;
create policy "push_subscriptions own read"
  on public.push_subscriptions for select
  using (auth.uid() = user_id);

-- 3) 通知設定（マスター/種別トグル＋送信スロット）を1行jsonbで保持。
create table if not exists public.push_notify_prefs (
  user_id uuid primary key references auth.users(id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.push_notify_prefs enable row level security;
drop policy if exists "push_notify_prefs own read" on public.push_notify_prefs;
create policy "push_notify_prefs own read"
  on public.push_notify_prefs for select
  using (auth.uid() = user_id);
```

- [ ] **Step 2: SQL構文をローカル確認（任意）**

Supabaseローカルがあれば `supabase db reset` で通す。無ければ本番適用は Task 14 の手順でオーナーが SQL Editor から実行。ここでは構文の目視確認のみ。

- [ ] **Step 3: コミット**

```bash
cd ~/medical-search-public
git add supabase/migrations/0014_push.sql
git commit -m "feat(push): add push_subscriptions / push_notify_prefs / app_flags push row"
```

---

## Task 3: 購読API `src/app/api/push/subscribe/route.ts`

**Files:**
- Create: `src/app/api/push/subscribe/route.ts`

**Interfaces:**
- Consumes: `createClient`, `createAdminClient`（`@/lib/supabase/server`）。
- Produces: `POST { endpoint, keys:{p256dh, auth}, ua? } → {ok}`（購読upsert）／`DELETE { endpoint } → {ok}`（revoked_at を立てる）。

- [ ] **Step 1: 実装**

```ts
// Web Push 購読の登録/解除。ログイン中ユーザーの購読を user 単位で保存する。
// env/migration 未整備・未ログインは静かに {ok:false}（アプリは通常どおり）。
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

function ready(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export async function POST(req: NextRequest) {
  if (!ready()) return NextResponse.json({ ok: false })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false })

  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string }; ua?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false })
  }
  const endpoint = body.endpoint
  const p256dh = body.keys?.p256dh
  const auth = body.keys?.auth
  if (!endpoint || !p256dh || !auth) return NextResponse.json({ ok: false })

  try {
    const admin = createAdminClient()
    const { error } = await admin.from('push_subscriptions').upsert(
      { endpoint, user_id: user.id, p256dh, auth, ua: body.ua ?? null, revoked_at: null },
      { onConflict: 'endpoint' },
    )
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}

export async function DELETE(req: NextRequest) {
  if (!ready()) return NextResponse.json({ ok: false })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false })
  let body: { endpoint?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false })
  }
  if (!body.endpoint) return NextResponse.json({ ok: false })
  try {
    const admin = createAdminClient()
    await admin
      .from('push_subscriptions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('endpoint', body.endpoint)
      .eq('user_id', user.id)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
```

- [ ] **Step 2: 型チェック**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし。

- [ ] **Step 3: コミット**

```bash
cd ~/medical-search-public
git add src/app/api/push/subscribe/route.ts
git commit -m "feat(push): subscription register/unsubscribe API"
```

---

## Task 4: 通知設定API＋prefs保存 `src/app/api/push/prefs/route.ts`

**Files:**
- Create: `src/app/api/push/prefs/route.ts`
- Create: `src/lib/push-prefs.ts`（prefs の読み書きヘルパ・送信側と共用）
- Create: `src/lib/__tests__/push-prefs.test.ts`

**Interfaces:**
- Consumes: `parsePrefs`, `NotifyPrefs`, `DEFAULT_PREFS`（`@/lib/push`）。
- Produces:
  - `getUserPrefs(admin, userId): Promise<NotifyPrefs>`（行が無ければ `DEFAULT_PREFS`）
  - `saveUserPrefs(admin, userId, prefs): Promise<void>`
  - API: `GET → { prefs }`、`POST { prefs } → { ok, prefs }`

- [ ] **Step 1: 失敗するテストを書く（マージ挙動）**

Create `src/lib/__tests__/push-prefs.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { mergePrefs } from '../push-prefs'
import { DEFAULT_PREFS } from '../push'

describe('mergePrefs', () => {
  it('部分更新は既定にマージされる', () => {
    expect(mergePrefs({ announce: false })).toEqual({ ...DEFAULT_PREFS, announce: false })
  })
  it('不正スロットは既定に矯正', () => {
    expect(mergePrefs({ slot: '03:03' }).slot).toBe(DEFAULT_PREFS.slot)
  })
})
```

- [ ] **Step 2: 失敗確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/push-prefs.test.ts`
Expected: FAIL（`../push-prefs` なし）。

- [ ] **Step 3: `src/lib/push-prefs.ts` を実装**

```ts
// 通知設定（NotifyPrefs）の保存・取得・部分マージ。API と送信側で共用する。
import type { SupabaseClient } from '@supabase/supabase-js'
import { parsePrefs, DEFAULT_PREFS, type NotifyPrefs } from './push'

// 部分入力を既定にマージして正規化する（純関数・テスト対象）。
export function mergePrefs(patch: unknown): NotifyPrefs {
  const base = DEFAULT_PREFS
  const o = (patch && typeof patch === 'object' ? patch : {}) as Partial<NotifyPrefs>
  return parsePrefs({ ...base, ...o })
}

export async function getUserPrefs(admin: SupabaseClient, userId: string): Promise<NotifyPrefs> {
  const { data } = await admin
    .from('push_notify_prefs')
    .select('prefs')
    .eq('user_id', userId)
    .maybeSingle()
  return parsePrefs(data?.prefs)
}

export async function saveUserPrefs(
  admin: SupabaseClient,
  userId: string,
  prefs: NotifyPrefs,
): Promise<void> {
  await admin.from('push_notify_prefs').upsert(
    { user_id: userId, prefs, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  )
}
```

- [ ] **Step 4: テスト成功を確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/push-prefs.test.ts`
Expected: PASS。

- [ ] **Step 5: API route を実装**

Create `src/app/api/push/prefs/route.ts`:
```ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { DEFAULT_PREFS } from '@/lib/push'
import { getUserPrefs, saveUserPrefs, mergePrefs } from '@/lib/push-prefs'

function ready(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export async function GET() {
  if (!ready()) return NextResponse.json({ prefs: DEFAULT_PREFS })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ prefs: DEFAULT_PREFS })
  try {
    const prefs = await getUserPrefs(createAdminClient(), user.id)
    return NextResponse.json({ prefs })
  } catch {
    return NextResponse.json({ prefs: DEFAULT_PREFS })
  }
}

export async function POST(req: NextRequest) {
  if (!ready()) return NextResponse.json({ ok: false, prefs: DEFAULT_PREFS })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, prefs: DEFAULT_PREFS })
  let body: { prefs?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, prefs: DEFAULT_PREFS })
  }
  const prefs = mergePrefs(body.prefs)
  try {
    await saveUserPrefs(createAdminClient(), user.id, prefs)
    return NextResponse.json({ ok: true, prefs })
  } catch {
    return NextResponse.json({ ok: false, prefs })
  }
}
```

- [ ] **Step 6: コミット**

```bash
cd ~/medical-search-public
git add src/lib/push-prefs.ts src/lib/__tests__/push-prefs.test.ts src/app/api/push/prefs/route.ts
git commit -m "feat(push): notify prefs storage + API"
```

---

## Task 5: 送信ラッパ `src/lib/push-send.ts`

**Files:**
- Create: `src/lib/push-send.ts`
- Create: `src/lib/__tests__/push-send.test.ts`

**Interfaces:**
- Consumes: `web-push`, `createAdminClient`, `getUserPrefs`, `kindEnabled`, `PushKind`。
- Produces:
  - `type PushPayload = { title: string; body: string; url?: string; tag?: string }`
  - `configureVapid(): boolean`（env が揃えば true）
  - `sendToEndpoint(sub, payload): Promise<'ok'|'gone'|'error'>`（410/404 は 'gone'）
  - `sendToUsers(admin, userIds, kind, payload): Promise<{sent:number; pruned:number}>`（種別トグル判定＋失効掃除）

- [ ] **Step 1: 失敗するテストを書く（410は gone として掃除対象）**

Create `src/lib/__tests__/push-send.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import { classifyWebPushError } from '../push-send'

describe('classifyWebPushError', () => {
  it('410/404 は gone', () => {
    expect(classifyWebPushError({ statusCode: 410 })).toBe('gone')
    expect(classifyWebPushError({ statusCode: 404 })).toBe('gone')
  })
  it('その他は error', () => {
    expect(classifyWebPushError({ statusCode: 500 })).toBe('error')
    expect(classifyWebPushError({})).toBe('error')
  })
})
```

- [ ] **Step 2: 失敗確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/push-send.test.ts`
Expected: FAIL。

- [ ] **Step 3: 実装**

```ts
// web-push 送信ラッパ。VAPID設定・単一購読への送信・失効(410/404)判定・種別トグル判定。
import webpush from 'web-push'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getUserPrefs } from './push-prefs'
import { kindEnabled, type PushKind } from './push'

export type PushPayload = { title: string; body: string; url?: string; tag?: string }

type SubRow = { endpoint: string; p256dh: string; auth: string; user_id: string }

export function classifyWebPushError(err: { statusCode?: number }): 'gone' | 'error' {
  return err?.statusCode === 410 || err?.statusCode === 404 ? 'gone' : 'error'
}

let vapidReady: boolean | null = null
export function configureVapid(): boolean {
  if (vapidReady !== null) return vapidReady
  const pub = process.env.VAPID_PUBLIC_KEY
  const key = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:owner@example.com'
  if (!pub || !key) {
    vapidReady = false
    return false
  }
  webpush.setVapidDetails(subject, pub, key)
  vapidReady = true
  return true
}

export async function sendToEndpoint(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: PushPayload,
): Promise<'ok' | 'gone' | 'error'> {
  if (!configureVapid()) return 'error'
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
    )
    return 'ok'
  } catch (err) {
    return classifyWebPushError(err as { statusCode?: number })
  }
}

// 指定ユーザー群へ、各自の種別トグルを尊重して送信。失効購読は revoked_at を立てる。
export async function sendToUsers(
  admin: SupabaseClient,
  userIds: string[],
  kind: PushKind,
  payload: PushPayload,
): Promise<{ sent: number; pruned: number }> {
  if (!configureVapid() || userIds.length === 0) return { sent: 0, pruned: 0 }

  // トグルON のユーザーだけに絞る。
  const allowed: string[] = []
  for (const uid of userIds) {
    const prefs = await getUserPrefs(admin, uid)
    if (kindEnabled(prefs, kind)) allowed.push(uid)
  }
  if (allowed.length === 0) return { sent: 0, pruned: 0 }

  const { data } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, user_id')
    .in('user_id', allowed)
    .is('revoked_at', null)
  const subs = (data ?? []) as SubRow[]

  let sent = 0
  let pruned = 0
  for (const s of subs) {
    const r = await sendToEndpoint(s, payload)
    if (r === 'ok') sent++
    else if (r === 'gone') {
      pruned++
      await admin
        .from('push_subscriptions')
        .update({ revoked_at: new Date().toISOString() })
        .eq('endpoint', s.endpoint)
    }
  }
  return { sent, pruned }
}
```

- [ ] **Step 4: テスト成功を確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/push-send.test.ts`
Expected: PASS。

- [ ] **Step 5: コミット**

```bash
cd ~/medical-search-public
git add src/lib/push-send.ts src/lib/__tests__/push-send.test.ts
git commit -m "feat(push): web-push send wrapper with toggle + prune"
```

---

## Task 6: Service Worker に push/notificationclick を追加

**Files:**
- Modify: `public/sw.js`（`CACHE_VERSION` を `medinode-v16` に上げ、末尾に2ハンドラ追加）

**Interfaces:**
- Consumes: 送信 payload `{title, body, url, tag}`。
- Produces: 通知表示＋クリックで `url`（既定 `/`）へフォーカス/遷移。

- [ ] **Step 1: `CACHE_VERSION` を上げる**

`public/sw.js` の `const CACHE_VERSION = 'medinode-v15'` を `'medinode-v16'` に変更。

- [ ] **Step 2: ハンドラを末尾に追加**

`public/sw.js` の末尾（fetch ハンドラの後）に追記:
```js
// ── Web Push ──
// payload: { title, body, url?, tag? }。本文が壊れていても最低限のタイトルで表示する。
self.addEventListener('push', (event) => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }
  const title = data.title || 'MediNode'
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'medinode',
    data: { url: data.url || '/' },
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

// 通知クリック: 既に開いているタブがあればフォーカス、無ければ url を開く。
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) {
          c.navigate(target).catch(() => {})
          return c.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
```

- [ ] **Step 3: 構文確認（ビルド）**

Run: `cd ~/medical-search-public && npx tsc --noEmit && npm run build`
Expected: ビルド成功（sw.js は静的配信なのでビルド対象外だが、全体が壊れていないことを確認）。

- [ ] **Step 4: コミット**

```bash
cd ~/medical-search-public
git add public/sw.js
git commit -m "feat(push): service worker push + notificationclick handlers (cache v16)"
```

---

## Task 7: 許可プライマー `src/components/PushPrimer.tsx`＋DailyQuestionCard フック

**Files:**
- Create: `src/components/PushPrimer.tsx`
- Modify: `src/components/DailyQuestionCard.tsx`（97行付近・回答POSTの直後に発火フラグを立てる）

**Interfaces:**
- Consumes: `/api/push/subscribe`（POST）、`VAPID_PUBLIC_KEY` は `NEXT_PUBLIC_VAPID_PUBLIC_KEY` として公開。
- Produces: 初回回答直後に自前シート→OKでネイティブ許可→購読登録。iOS未インストール時は「ホーム画面に追加」案内へ差し替え。

- [ ] **Step 1: env（公開鍵）を追加**

`NEXT_PUBLIC_VAPID_PUBLIC_KEY` を Vercel env に追加（Task 14 でまとめて設定・値は Task 1 の鍵ペアの公開側）。

- [ ] **Step 2: PushPrimer を実装**

```tsx
'use client'
// 「今日の1問」を初回回答した直後に表示する許可プライマー。
// 自前シートで価値を伝えてから、OK時にだけネイティブ許可を呼ぶ（"あとで"はネイティブ許可を焼かない）。
// iOS Safari 未インストール（standalone でない）時は許可を出せないので案内へ差し替える。
import { useEffect, useState } from 'react'

const SEEN_KEY = 'medinode_push_primer_seen_v1' // 一度出したら当面出さない

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)))
}

function isStandalone(): boolean {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

function isIos(): boolean {
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
}

export default function PushPrimer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mode, setMode] = useState<'ask' | 'ios-install'>('ask')

  useEffect(() => {
    if (open && isIos() && !isStandalone()) setMode('ios-install')
  }, [open])

  if (!open) return null

  const enable = async () => {
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        onClose()
        return
      }
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') {
        onClose()
        return
      }
      const reg = await navigator.serviceWorker.ready
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
      if (!key) {
        onClose()
        return
      }
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      })
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: json.endpoint, keys: json.keys, ua: navigator.userAgent }),
      }).catch(() => {})
    } finally {
      onClose()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/30 p-4 sm:items-center">
      <div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl">
        {mode === 'ios-install' ? (
          <>
            <p className="text-base font-semibold text-slate-800">明日の1問を受け取るには</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              iPhoneでは、共有メニューから「ホーム画面に追加」でアプリとして開いておくと、通知を受け取れます。
            </p>
            <button onClick={onClose} className="mt-4 w-full rounded-lg bg-slate-800 py-2 text-sm font-medium text-white">
              わかりました
            </button>
          </>
        ) : (
          <>
            <p className="text-base font-semibold text-slate-800">明日の1問を通知で受け取りますか？</p>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              1日1問だけ、静かにお届けします。通知はいつでも設定からオフにできます。
            </p>
            <div className="mt-4 flex gap-2">
              <button onClick={onClose} className="flex-1 rounded-lg border border-slate-300 py-2 text-sm text-slate-600">
                あとで
              </button>
              <button onClick={enable} className="flex-1 rounded-lg bg-teal-600 py-2 text-sm font-medium text-white">
                受け取る
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

export function shouldShowPrimer(): boolean {
  try {
    if (localStorage.getItem(SEEN_KEY)) return false
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') return false
    return true
  } catch {
    return false
  }
}

export function markPrimerSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1')
  } catch {}
}
```

- [ ] **Step 3: DailyQuestionCard に発火を差し込む**

`src/components/DailyQuestionCard.tsx` の97行 `void fetch('/api/daily-question/answered', { method: 'POST' }).catch(() => {})` の**直後**に、初回回答フラグを見てプライマーを開く処理を足す。カード上部（`import`群）に:
```tsx
import PushPrimer, { shouldShowPrimer, markPrimerSeen } from './PushPrimer'
```
状態を追加（コンポーネント関数の先頭の useState 群に）:
```tsx
const [primerOpen, setPrimerOpen] = useState(false)
```
回答POST直後（97行の直後）に:
```tsx
    if (shouldShowPrimer()) {
      markPrimerSeen()
      setPrimerOpen(true)
    }
```
JSX の末尾（カードの外側 return 直下）に:
```tsx
      <PushPrimer open={primerOpen} onClose={() => setPrimerOpen(false)} />
```

- [ ] **Step 4: 型チェック＋ビルド**

Run: `cd ~/medical-search-public && npx tsc --noEmit && npm run build`
Expected: 成功。

- [ ] **Step 5: コミット**

```bash
cd ~/medical-search-public
git add src/components/PushPrimer.tsx src/components/DailyQuestionCard.tsx
git commit -m "feat(push): permission primer after first daily-question answer"
```

---

## Task 8: 設定UIに通知トグル＋送信スロット

**Files:**
- Modify: 既存の設定パネル（「表示のカスタマイズ」がある設定コンポーネント。`grep -rl "表示のカスタマイズ" src/components` で特定）
- Create: `src/components/PushSettings.tsx`

**Interfaces:**
- Consumes: `/api/push/prefs`（GET/POST）、`DAILY_SLOTS`（`@/lib/push`）。
- Produces: マスターON/OFF＋種別トグル（今日の1問/CQ回答/お知らせ）＋送信スロット select。保存はPOST。

- [ ] **Step 1: PushSettings を実装**

```tsx
'use client'
// 通知設定。マスターON/OFF＋種別トグル＋送信スロット。オフはいつでも1〜2タップで届く場所に置く。
import { useEffect, useState } from 'react'
import { DAILY_SLOTS, DEFAULT_PREFS, type NotifyPrefs } from '@/lib/push'

export default function PushSettings() {
  const [prefs, setPrefs] = useState<NotifyPrefs>(DEFAULT_PREFS)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    fetch('/api/push/prefs', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: { prefs?: NotifyPrefs }) => {
        if (d.prefs) setPrefs(d.prefs)
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  const save = (next: NotifyPrefs) => {
    setPrefs(next)
    void fetch('/api/push/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefs: next }),
    }).catch(() => {})
  }

  if (!loaded) return null

  const Toggle = ({ label, on, onChange, disabled }: { label: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) => (
    <label className={`flex items-center justify-between py-2 ${disabled ? 'opacity-40' : ''}`}>
      <span className="text-sm text-slate-700">{label}</span>
      <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <p className="text-sm font-semibold text-slate-800">通知</p>
      <Toggle label="通知を受け取る" on={prefs.master} onChange={(v) => save({ ...prefs, master: v })} />
      <div className="mt-1 border-t border-slate-100 pt-1">
        <Toggle label="今日の1問" on={prefs.daily} disabled={!prefs.master} onChange={(v) => save({ ...prefs, daily: v })} />
        <Toggle label="解決済みCQの回答" on={prefs.resolvedCq} disabled={!prefs.master} onChange={(v) => save({ ...prefs, resolvedCq: v })} />
        <Toggle label="お知らせ" on={prefs.announce} disabled={!prefs.master} onChange={(v) => save({ ...prefs, announce: v })} />
      </div>
      <label className={`mt-2 flex items-center justify-between ${!prefs.master || !prefs.daily ? 'opacity-40' : ''}`}>
        <span className="text-sm text-slate-700">今日の1問の時刻</span>
        <select
          value={prefs.slot}
          disabled={!prefs.master || !prefs.daily}
          onChange={(e) => save({ ...prefs, slot: e.target.value })}
          className="rounded border border-slate-300 px-2 py-1 text-sm"
        >
          {DAILY_SLOTS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>
    </div>
  )
}
```

- [ ] **Step 2: 設定パネルに差し込む**

`grep -rl "表示のカスタマイズ" src/components` で設定コンポーネントを特定し、`import PushSettings from './PushSettings'` を足して「表示のカスタマイズ」セクションの近くに `<PushSettings />` を配置する。

- [ ] **Step 3: 型チェック＋ビルド**

Run: `cd ~/medical-search-public && npx tsc --noEmit && npm run build`
Expected: 成功。

- [ ] **Step 4: コミット**

```bash
cd ~/medical-search-public
git add src/components/PushSettings.tsx src/components/<settings-file>.tsx
git commit -m "feat(push): notification settings (master/per-kind toggles + slot)"
```

---

## Task 9: 端末ローカルの許可フラグを PERSONAL_DEVICE_KEYS に登録

**Files:**
- Modify: `src/lib/personal-data.ts`
- Modify: `src/lib/__tests__/personal-data.test.ts`（キー数の期待があれば更新）

**Interfaces:**
- Produces: `PERSONAL_DEVICE_KEYS` に `medinode_push_primer_seen_v1` を追加（アカウント切替でプライマー既読が漏れない）。

- [ ] **Step 1: キーを追加**

`src/lib/personal-data.ts` の `PERSONAL_DEVICE_KEYS` 配列末尾に:
```ts
  'medinode_push_primer_seen_v1', // 通知プライマーの既読水位
```

- [ ] **Step 2: テストを走らせ、キー数の期待があれば直す**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/personal-data.test.ts`
Expected: PASS（配列長を検証しているテストがあれば期待値を+1して合わせる）。

- [ ] **Step 3: コミット**

```bash
cd ~/medical-search-public
git add src/lib/personal-data.ts src/lib/__tests__/personal-data.test.ts
git commit -m "feat(push): scope primer-seen flag to device account switch"
```

---

## Task 10: デイリー配信 cron `src/app/api/cron/daily-push/route.ts`

**Files:**
- Create: `src/app/api/cron/daily-push/route.ts`
- Modify: `vercel.json`（crons に追加）

**Interfaces:**
- Consumes: `readPushStage`, `jstSlot`, `jstToday`, `sendToUsers`, `getUserPrefs`。既存 `/api/cron/subscription-sync/route.ts` の cron 認証ガードと同型のガードを流用。
- Produces: 現在スロットに設定したユーザーのうち当日未送信者へ「今日の1問」を送る。

**Note:** `*/30 * * * *` の頻度 cron は Vercel Pro が必要（Hobbyは日次のみ）。Pro前提。stage=off の間は即return するので、Pro化前でもエンドポイントは無害。

- [ ] **Step 1: cron ルートを実装**

```ts
// 「今日の1問」デイリー通知。30分毎に起動し、現在のJSTスロットに設定したユーザーへ送る。
// stage=off の間は何もしない。当日二重送信は push_notify_prefs とは別の送信ログで防ぐ…のではなく、
// ここでは「当日そのユーザーへ送ったか」を軽量に daily_push_log で判定する（下記）。
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { readPushStage, jstSlot, jstToday, isPreviewEmail } from '@/lib/push'
import { getUserPrefs } from '@/lib/push-prefs'
import { sendToUsers } from '@/lib/push-send'

// 既存 /api/cron/subscription-sync と同じ認証を流用する。
// （そのルートの CRON ガード実装をコピーして使うこと。多くは `authorization: Bearer ${CRON_SECRET}` 判定。）
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 })

  const stage = await readPushStage()
  if (stage === 'off') return NextResponse.json({ ok: true, skipped: 'off' })

  const admin = createAdminClient()
  const slot = jstSlot()
  const today = jstToday()

  // 有効な購読を持つユーザー一覧（重複除去）。
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('user_id')
    .is('revoked_at', null)
  const userIds = [...new Set((subs ?? []).map((s: { user_id: string }) => s.user_id))]

  // このスロットに設定していて、今日まだ送っていないユーザーに絞る。
  const targets: string[] = []
  for (const uid of userIds) {
    const prefs = await getUserPrefs(admin, uid)
    if (prefs.slot !== slot) continue
    // preview中はオーナー/許可メールのみ（emailはauth.usersから引く）。
    if (stage === 'preview') {
      const { data: u } = await admin.auth.admin.getUserById(uid)
      if (!isPreviewEmail(u.user?.email)) continue
    }
    // 当日送信済みチェック。
    const { data: log } = await admin
      .from('daily_push_log')
      .select('user_id')
      .eq('user_id', uid)
      .eq('sent_on', today)
      .maybeSingle()
    if (log) continue
    targets.push(uid)
  }

  const payload = { title: '今日の1問', body: '今日の1問が届いています。', url: '/', tag: 'daily-question' }
  const res = await sendToUsers(admin, targets, 'daily', payload)

  // 送信記録（当日二重送信防止）。
  if (targets.length > 0) {
    await admin
      .from('daily_push_log')
      .upsert(
        targets.map((uid) => ({ user_id: uid, sent_on: today })),
        { onConflict: 'user_id,sent_on', ignoreDuplicates: true },
      )
  }
  return NextResponse.json({ ok: true, slot, ...res, targets: targets.length })
}
```

- [ ] **Step 2: `daily_push_log` を Task 2 のマイグレーションに追記**

`supabase/migrations/0014_push.sql` の末尾に追加:
```sql
-- 当日二重送信防止ログ（送った日付のみ）。
create table if not exists public.daily_push_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  sent_on date not null,
  created_at timestamptz not null default now(),
  primary key (user_id, sent_on)
);
alter table public.daily_push_log enable row level security;
-- 読取ポリシーは作らない（service_role専用）。
```

- [ ] **Step 3: `vercel.json` に cron を追加**

`crons` 配列に追記:
```json
    {
      "path": "/api/cron/daily-push",
      "schedule": "*/30 * * * *"
    }
```

- [ ] **Step 4: 認証ガードを既存 cron と一致させる**

`src/app/api/cron/subscription-sync/route.ts` を開き、その CRON 認証の実装を確認。`authorized()` を**その実装に合わせて**書き換える（env名・ヘッダ判定を一致させる。Vercel Cron は `Authorization: Bearer $CRON_SECRET` を送る設定が一般的）。

- [ ] **Step 5: 型チェック＋ビルド**

Run: `cd ~/medical-search-public && npx tsc --noEmit && npm run build`
Expected: 成功。

- [ ] **Step 6: コミット**

```bash
cd ~/medical-search-public
git add src/app/api/cron/daily-push/route.ts supabase/migrations/0014_push.sql vercel.json
git commit -m "feat(push): daily-question push cron (slot match + dedupe log)"
```

---

## Task 11: 解決済みCQ回答のプッシュフック

**Files:**
- Modify: CQが解決フラグ化する既存処理（`grep -rn "resolved" src/app/api` で特定。`src/app/api/resolved-cqs/route.ts` 周辺、または同期処理で解決を検知している箇所）

**Interfaces:**
- Consumes: `sendToUsers`（kind=`resolved_cq`）、投稿者→user_id の対応。
- Produces: 解決を検知したとき、その投稿者（購読があり resolvedCq トグルON）へ1通。

- [ ] **Step 1: 投稿者→アカウントの紐付けを確認**

`grep -rn "投稿者\|submitter\|resolved\|解決" src/app/api src/lib | head -40` で、解決済みCQの投稿者が user_id として辿れるか確認する。
- **辿れる場合**: そのイベント箇所で `sendToUsers(admin, [submitterUserId], 'resolved_cq', payload)` を呼ぶ。
- **辿れない場合（匿名フォーム等）**: v1ではプッシュ対象外にフォールバック（既存のアプリ内 `ResolvedCqs` 表示は維持）。この Task はスキップし、spec の「依存・要確認2」に沿って別途対応と記録する。

- [ ] **Step 2（辿れる場合のみ）: 送信を差し込む**

解決検知箇所に:
```ts
import { sendToUsers } from '@/lib/push-send'
import { createAdminClient } from '@/lib/supabase/server'
// …解決確定後…
await sendToUsers(createAdminClient(), [submitterUserId], 'resolved_cq', {
  title: '回答がつきました',
  body: 'あなたが気にしていた疑問に回答が入りました。',
  url: '/',
  tag: 'resolved-cq',
}).catch(() => {})
```

- [ ] **Step 3: 型チェック＋ビルド＋コミット**

Run: `cd ~/medical-search-public && npx tsc --noEmit && npm run build`
```bash
git add -A && git commit -m "feat(push): notify submitter when their CQ is resolved"
```
（辿れずスキップした場合は、その判断を spec の依存節にメモしてコミットは省略。）

---

## Task 12: お知らせ一斉送信（admin）

**Files:**
- Create: `src/app/api/admin/push-broadcast/route.ts`
- Modify: `/admin` ダッシュボード（お知らせ送信フォーム。`DailyCommandCenter.tsx` などオーナー操作の集約先に小さなフォームを足す）

**Interfaces:**
- Consumes: `requireAdmin`（`@/lib/admin-guard`）、`sendToUsers`（kind=`announce`）。
- Produces: POST `{ title, body, url? }` → 全購読ユーザー（announceトグルON）へ送信。直近送信日時を返す。

- [ ] **Step 1: API を実装**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { createAdminClient } from '@/lib/supabase/server'
import { sendToUsers } from '@/lib/push-send'

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body: { title?: string; body?: string; url?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSONが不正です' }, { status: 400 })
  }
  if (!body.title || !body.body) {
    return NextResponse.json({ error: 'title と body は必須です' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('user_id')
    .is('revoked_at', null)
  const userIds = [...new Set((subs ?? []).map((s: { user_id: string }) => s.user_id))]

  const res = await sendToUsers(admin, userIds, 'announce', {
    title: body.title,
    body: body.body,
    url: body.url || '/',
    tag: 'announce',
  })
  return NextResponse.json({ ok: true, ...res })
}
```

- [ ] **Step 2: /admin に小さな送信フォームを足す**

`src/app/admin/DailyCommandCenter.tsx`（または admin のクライアント）に、件名・本文・任意URLの入力と「送信」ボタンを追加し、`POST /api/admin/push-broadcast` を叩く。送信結果（sent/pruned）をトースト表示。週1上限は運用ルールなので、直近送信の目視のためフォーム脇に注意書きを添える。

- [ ] **Step 3: 型チェック＋ビルド＋コミット**

Run: `cd ~/medical-search-public && npx tsc --noEmit && npm run build`
```bash
git add src/app/api/admin/push-broadcast/route.ts src/app/admin/DailyCommandCenter.tsx
git commit -m "feat(push): admin broadcast (announcements)"
```

---

## Task 13: /admin/maintenance に push stage 切替カード

**Files:**
- Create: `src/app/api/push/route.ts`（GET=stage/prefs・POST=stage切替）
- Modify: `src/app/admin/maintenance/MaintenanceAdminClient.tsx`（「今日の1問」カードと同型の push カード追加）

**Interfaces:**
- Consumes: `requireAdmin`, `isAdminEmail`, `readPushStage`, `parseStage`, `__resetPushStageCache`, `PUSH_FLAG_KEY`。
- Produces: GET→`{ stage? }`（adminのみstage）、POST `{ stage }`→切替（`daily-question` の POST と同型）。

- [ ] **Step 1: `src/app/api/push/route.ts` を実装**

```ts
// push の段階公開。GET=管理者にstageを返す・POST=stage切替（off/preview/on）。
// daily-question route の stage 切替と同型。
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin-guard'
import { isAdminEmail } from '@/lib/maintenance'
import { PUSH_FLAG_KEY, parseStage, readPushStage, __resetPushStageCache } from '@/lib/push'

export async function GET() {
  const stage = await readPushStage()
  let email: string | null = null
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    email = user?.email ?? null
  } catch {}
  return NextResponse.json(isAdminEmail(email) ? { stage } : {})
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  let body: { stage?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSONが不正です' }, { status: 400 })
  }
  if (body.stage !== 'off' && body.stage !== 'preview' && body.stage !== 'on') {
    return NextResponse.json({ error: 'stage は off / preview / on で指定してください' }, { status: 400 })
  }
  const stage = parseStage(body.stage)
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('app_flags').upsert(
      { key: PUSH_FLAG_KEY, value: stage !== 'off', stage, updated_at: new Date().toISOString(), updated_by: auth.email },
      { onConflict: 'key' },
    )
    if (error) throw new Error(error.message)
    __resetPushStageCache()
    return NextResponse.json({ ok: true, stage })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '不明なエラー' }, { status: 500 })
  }
}
```

- [ ] **Step 2: maintenance カードを追加**

`MaintenanceAdminClient.tsx` の「今日の1問」stage カード（`fetch('/api/daily-question')` GET / POST の塊）を複製し、エンドポイントを `/api/push` に、ラベルを「プッシュ通知」に、説明文を「preview は COMP_ADMIN_EMAILS＋PUSH_PREVIEW_EMAILS のアカウントにだけ配信されます。当面は preview（自分だけ）で運用し、on（全員）へは進めない。」に変える。ボタンは `preview / off` を主に使う（`on` は当面使わない旨を注記）。

- [ ] **Step 3: 型チェック＋ビルド＋コミット**

Run: `cd ~/medical-search-public && npx tsc --noEmit && npm run build`
```bash
git add src/app/api/push/route.ts src/app/admin/maintenance/MaintenanceAdminClient.tsx
git commit -m "feat(push): stage toggle API + maintenance card (owner-only preview)"
```

---

## Task 14: オーナー専用お試しの点灯（非コード・手順）

**Files:** なし（オーナー操作）。

- [ ] **Step 1: VAPID鍵を生成**

Run: `cd ~/medical-search-public && npx web-push generate-vapid-keys`
公開鍵・秘密鍵を控える。

- [ ] **Step 2: Vercel env を設定**

Vercel（Project → Settings → Environment Variables, https://vercel.com/dashboard ）に追加:
- `VAPID_PUBLIC_KEY` = 生成した公開鍵
- `VAPID_PRIVATE_KEY` = 生成した秘密鍵
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` = 公開鍵（同値・クライアント用）
- `VAPID_SUBJECT` = `mailto:あなたの連絡先`
- `PUSH_PREVIEW_EMAILS` = 自分のログインメール（オーナー専用にするため自分だけ）
- `CRON_SECRET` = 既存 cron と同じ値（`/api/cron/subscription-sync` と揃える。無ければ生成して両方に設定）
再デプロイ（env反映）。

- [ ] **Step 3: migration 0014 を適用**

Supabase（SQL Editor, https://supabase.com/dashboard ）で `supabase/migrations/0014_push.sql` の内容を実行。`app_flags` に `push` 行・`push_subscriptions`・`push_notify_prefs`・`daily_push_log` ができることを確認。

- [ ] **Step 4: Vercel Cron を有効化（Pro必要）**

`*/30 * * * *` cron は Vercel Pro が要る。Pro でなければ、この時点ではデイリー自動送信は動かない（手動確認は Step 6 で代替）。Pro 化の判断は別途。

- [ ] **Step 5: preview に切替（自分だけ）**

`/admin/maintenance` の「プッシュ通知」カードで **preview** を選ぶ。`on`（全員）は選ばない。

- [ ] **Step 6: 自分の端末で受信確認**

1. アプリを開き「今日の1問」に回答 → プライマーが出る → 「受け取る」で許可・購読。
2. `/admin` のお知らせ送信フォームからテスト送信 → 自分の端末に通知が来ることを確認（クリックでアプリが開く）。
3. 設定で「お知らせ」をオフ → 再送 → 来ないことを確認。再オンで即戻せることを確認。
4. （Pro化済みなら）翌日の設定スロット時刻に「今日の1問」通知が1回だけ来ることを確認。

- [ ] **Step 7: 記録**

受信確認できたら、ロードマップDBの「プッシュ通知」項目を「実装中（preview＝オーナー試用）」に更新し、当面 `on` へは進めない方針を明記。

---

## Self-Review（記入済み）

**1. Spec coverage**
- チャネル=Web Push … Task 1,3,5,6,7。
- 通知3種（今日の1問/CQ回答/お知らせ）… Task 10 / 11 / 12。
- ユーザー選択送信時刻 … Task 1(slot), 4(prefs), 8(UI), 10(cron match)。
- 頻度キャップ・静けさ … prefs トグル＋当日dedupe(Task10)＋お知らせ運用注記(Task12)。
- マスター/種別トグル・可逆オフ … Task 4,8（アプリ内トグル主スイッチ＝購読保持で再オン容易）。
- 許可プライマー（初回回答直後・iOS差し替え）… Task 7。
- 段階公開・preview=オーナー専用・初期off・on使わない … Task 2,13,14。
- 失効掃除(410/404) … Task 5。
- 個人データ scoping … Task 9。
- 依存（②公開が先／CQ投稿者紐付け要確認）… Task 7の前提・Task 11で分岐明記。

**2. Placeholder scan**
- コードは各Taskに実体を記載。`<settings-file>` と CQ解決箇所は「grepで特定」の具体手順つき（コードベース依存のため位置のみ動的特定）＝プレースホルダではなく探索指示。

**3. Type consistency**
- `NotifyPrefs`/`PushKind`/`PushStage`/`DAILY_SLOTS`/`parsePrefs`/`kindEnabled`/`sendToUsers`/`getUserPrefs` は Task 1/4/5 の定義と後続の使用で名称・シグネチャ一致を確認済み。
- `PUSH_FLAG_KEY='push'` は Task 1 定義・Task 13 使用で一致。
- cron の認証は Task 10 Step4 で既存実装に合わせる指示（env名の齟齬を回避）。
