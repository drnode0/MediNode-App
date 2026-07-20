# メンテナンスモード（調整中画面）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 重大なバグ時に、スマホの秘密の管理URLからワンタップでMediNodeを「現在調整中です」画面に切り替えられる（オーナーは素通し）動線を作る。

**Architecture:** Supabase `app_flags.maintenance` boolean を単一の真実源とし、(1) `proxy.ts`（サーバー側ページゲート）と (2) `MaintenanceGate`（クライアント起動時チェック）の2重ゲートで、PWA/SWキャッシュ勢を含む全一般ユーザーに調整中画面を出す。オーナー（`COMP_ADMIN_EMAILS`）は署名付き通行cookieで素通し。切替は `/admin/maintenance` から `/api/maintenance` 経由、再デプロイ不要。

**Tech Stack:** Next.js 16 (App Router, `proxy.ts` middleware, Edge/Node), Supabase (`@supabase/ssr` + service role), Web Crypto (HMAC), Tailwind, vitest。

## Global Constraints

- ブランド色は Tailwind `brand`（常盤グリーン、基準 `brand-600 = #196b4f`、ダークアクセント `brand-300 = #7bd0b0`）。ロゴ画像は `/icon-192.png`。
- 共有ライブラリ `src/lib/maintenance.ts` は **Edge/Node両対応**にする：`node:crypto` と `next/headers` を import しない。署名は Web Crypto（`crypto.subtle`）、フラグ読取は `fetch` のみ。
- 管理者判定は既存の `COMP_ADMIN_EMAILS`（カンマ区切り・小文字比較）を踏襲。サービスロール書込は `createAdminClient()`、セッション読取は `createClient()`（`src/lib/supabase/server.ts`）。
- フラグ読取は失敗時 **フェイルオープン**（メンテOFF扱い）。アプリ全体をフラグ取得失敗で止めない。
- 固定文言のみ（本文編集機能は作らない）。X リンク先は `NEXT_PUBLIC_X_URL`、未設定ならXボタンを出さない。
- 通行cookie署名鍵は `MAINTENANCE_BYPASS_SECRET`（未設定時のみ `SUPABASE_SERVICE_ROLE_KEY` を流用）。cookie 名は `maint_bypass`、httpOnly / SameSite=Lax / path=/ / 7日。
- migration 番号は `0011`（`supabase/migrations/` の最新は 0009、0010 はLP visitで予約済み）。
- コミットは日本語メッセージ、末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。

## File Structure

- Create `supabase/migrations/0011_app_flags.sql` — フラグ表＋RLS＋seed。
- Create `src/lib/maintenance.ts` — Edge/Node共有の純ロジック（管理者判定・署名・ゲート判定・フラグ読取）。
- Create `src/lib/__tests__/maintenance.test.ts` — 上記の単体テスト。
- Create `src/components/MaintenanceScreen.tsx` — 調整中画面の見た目（`/maintenance` と オーバーレイで共用）。
- Create `src/components/MaintenanceGate.tsx` — 起動時チェック＋オーバーレイ（クライアント）。
- Create `src/app/maintenance/page.tsx` — `/maintenance` ルート。
- Create `src/app/api/maintenance/route.ts` — GET（状態＋isAdmin＋cookie付与）/ POST（フラグ更新・管理者限定）。
- Create `src/app/admin/maintenance/page.tsx` + `src/app/admin/maintenance/MaintenanceAdminClient.tsx` — 秘密の切替UI。
- Modify `src/proxy.ts` — メンテゲートを REQUIRE_LOGIN ゲートの手前に追加。
- Modify `src/app/layout.tsx:119` — `<PwaRuntime />` 直後に `<MaintenanceGate />` を追加。
- Modify `.env.example` — `NEXT_PUBLIC_X_URL` / `MAINTENANCE_BYPASS_SECRET` を追記。

---

### Task 1: `app_flags` テーブルの migration

**Files:**
- Create: `supabase/migrations/0011_app_flags.sql`

**Interfaces:**
- Produces: テーブル `public.app_flags(key text pk, value boolean, updated_at timestamptz, updated_by text)`。行 `('maintenance', false)`。anon/authenticated が select 可、書込はRLSで拒否（service_role のみ）。

- [ ] **Step 1: migration SQL を書く**

`supabase/migrations/0011_app_flags.sql`:
```sql
-- アプリ全体のON/OFFフラグ（1行1キー）。初回はメンテナンスモード用。
-- 読取は公開（anon）＝proxy/クライアントがRLS下で読める。書込は service_role のみ（ポリシーを作らない）。
create table if not exists public.app_flags (
  key text primary key,
  value boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by text
);

alter table public.app_flags enable row level security;

-- 公開read（anon/authenticated）。書込ポリシーは意図的に作らない＝service_roleのみ更新可。
drop policy if exists "app_flags public read" on public.app_flags;
create policy "app_flags public read"
  on public.app_flags for select
  using (true);

-- メンテナンスフラグの初期行（既にあれば触らない）。
insert into public.app_flags (key, value)
values ('maintenance', false)
on conflict (key) do nothing;
```

- [ ] **Step 2: SQL を目視レビュー**

確認: `enable row level security` があり、select ポリシーのみで insert/update/delete ポリシーが無いこと（＝anon は読めるが書けない）。seed が `on conflict do nothing` で冪等なこと。

- [ ] **Step 3: コミット**

```bash
cd ~/medical-search-public
git add supabase/migrations/0011_app_flags.sql
git commit -m "feat: app_flags テーブル（メンテナンスフラグ）の migration を追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> **適用（実装完了後にオーナーが実施。実装中は不要）:** Supabase SQL Editor でこの SQL を実行する。適用前でも `readMaintenanceFlag` はフェイルオープン（false）で動くため、アプリは壊れない。

---

### Task 2: 共有ロジック `src/lib/maintenance.ts`（純関数＋署名）とテスト

**Files:**
- Create: `src/lib/maintenance.ts`
- Test: `src/lib/__tests__/maintenance.test.ts`

**Interfaces:**
- Produces:
  - `const MAINTENANCE_BYPASS_COOKIE = 'maint_bypass'`
  - `const MAINTENANCE_FLAG_KEY = 'maintenance'`
  - `isAdminEmail(email: string | null | undefined): boolean`
  - `signBypassToken(ttlMs?: number, nowMs?: number): Promise<string | null>`
  - `verifyBypassToken(token: string | null | undefined, nowMs?: number): Promise<boolean>`
  - `isMaintenanceAllowedPath(pathname: string): boolean`
  - `shouldBlockForMaintenance(opts: { maintenance: boolean; pathname: string; hasValidBypass: boolean }): boolean`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/maintenance.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  isAdminEmail,
  signBypassToken,
  verifyBypassToken,
  isMaintenanceAllowedPath,
  shouldBlockForMaintenance,
} from '@/lib/maintenance'

describe('isAdminEmail', () => {
  beforeEach(() => { process.env.COMP_ADMIN_EMAILS = 'Owner@Example.com, second@example.com' })
  afterEach(() => { delete process.env.COMP_ADMIN_EMAILS })

  it('大文字小文字を無視して一致する', () => {
    expect(isAdminEmail('owner@example.com')).toBe(true)
    expect(isAdminEmail('OWNER@EXAMPLE.COM')).toBe(true)
  })
  it('未登録・空・undefined は false', () => {
    expect(isAdminEmail('nobody@example.com')).toBe(false)
    expect(isAdminEmail('')).toBe(false)
    expect(isAdminEmail(undefined)).toBe(false)
  })
})

describe('bypass token 署名/検証', () => {
  beforeEach(() => { process.env.MAINTENANCE_BYPASS_SECRET = 'test-secret-key' })
  afterEach(() => { delete process.env.MAINTENANCE_BYPASS_SECRET })

  it('署名したトークンは検証を通る', async () => {
    const now = 1_000_000
    const token = await signBypassToken(60_000, now)
    expect(token).toBeTruthy()
    expect(await verifyBypassToken(token, now + 30_000)).toBe(true)
  })
  it('期限切れは false', async () => {
    const now = 1_000_000
    const token = await signBypassToken(60_000, now)
    expect(await verifyBypassToken(token, now + 61_000)).toBe(false)
  })
  it('改ざん・空は false', async () => {
    const token = await signBypassToken(60_000, 1_000_000)
    expect(await verifyBypassToken((token ?? '') + 'x', 1_000_000)).toBe(false)
    expect(await verifyBypassToken(null, 1_000_000)).toBe(false)
    expect(await verifyBypassToken('123.abc', 1_000_000)).toBe(false)
  })
  it('署名鍵が無ければ署名は null・検証は false', async () => {
    delete process.env.MAINTENANCE_BYPASS_SECRET
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(await signBypassToken(60_000, 1)).toBe(null)
    expect(await verifyBypassToken('123.abc', 1)).toBe(false)
  })
})

describe('proxy ゲート判定', () => {
  it('許可パスを判定する', () => {
    expect(isMaintenanceAllowedPath('/login')).toBe(true)
    expect(isMaintenanceAllowedPath('/admin/maintenance')).toBe(true)
    expect(isMaintenanceAllowedPath('/api/maintenance')).toBe(true)
    expect(isMaintenanceAllowedPath('/maintenance')).toBe(true)
    expect(isMaintenanceAllowedPath('/')).toBe(false)
    expect(isMaintenanceAllowedPath('/search')).toBe(false)
  })
  it('メンテON・非オーナー・非許可パスのみブロック', () => {
    expect(shouldBlockForMaintenance({ maintenance: true, pathname: '/', hasValidBypass: false })).toBe(true)
    expect(shouldBlockForMaintenance({ maintenance: true, pathname: '/', hasValidBypass: true })).toBe(false)
    expect(shouldBlockForMaintenance({ maintenance: true, pathname: '/login', hasValidBypass: false })).toBe(false)
    expect(shouldBlockForMaintenance({ maintenance: false, pathname: '/', hasValidBypass: false })).toBe(false)
  })
})
```

- [ ] **Step 2: テストが失敗するのを確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/maintenance.test.ts`
Expected: FAIL（`@/lib/maintenance` が存在しない旨の解決エラー）

- [ ] **Step 3: `src/lib/maintenance.ts` を実装（純関数＋署名部分）**

`src/lib/maintenance.ts`:
```ts
// メンテナンスモードの共有ロジック。
// ★ Edge（proxy.ts）と Node（route handler）の両方から import されるため、
//   node:crypto / next/headers は使わない。署名は Web Crypto、フラグ読取は fetch のみ。

export const MAINTENANCE_BYPASS_COOKIE = 'maint_bypass'
export const MAINTENANCE_FLAG_KEY = 'maintenance'

// メンテ中でも常に通す（＝オーナーがログイン→切替に到達できる）パス。
const MAINTENANCE_ALLOWED_PREFIXES = [
  '/login',
  '/auth',
  '/maintenance',
  '/admin',
  '/api/maintenance',
  '/api/admin',
]

// COMP_ADMIN_EMAILS（カンマ区切り）に含まれるか。大文字小文字は無視。
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const admins = (process.env.COMP_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return admins.includes(email.toLowerCase())
}

// 通行cookieの署名鍵。専用鍵が無ければサービスロールキー（サーバー専用値）を流用する。
function bypassSecret(): string | null {
  return process.env.MAINTENANCE_BYPASS_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null
}

// HMAC-SHA256 → base64url。Web Crypto なので Edge/Node 両対応。
async function hmacBase64Url(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  let bin = ''
  for (const b of new Uint8Array(sig)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

// 通行トークン = `${expMs}.${hmac(secret, expMs)}`。既定 7 日有効。
export async function signBypassToken(
  ttlMs = 7 * 24 * 60 * 60 * 1000,
  nowMs = Date.now(),
): Promise<string | null> {
  const secret = bypassSecret()
  if (!secret) return null
  const exp = String(nowMs + ttlMs)
  const sig = await hmacBase64Url(secret, exp)
  return `${exp}.${sig}`
}

// トークン検証。期限内かつ署名一致で true。鍵が無ければ常に false。
export async function verifyBypassToken(
  token: string | null | undefined,
  nowMs = Date.now(),
): Promise<boolean> {
  if (!token) return false
  const secret = bypassSecret()
  if (!secret) return false
  const dot = token.indexOf('.')
  if (dot <= 0) return false
  const exp = token.slice(0, dot)
  const sig = token.slice(dot + 1)
  const expNum = Number(exp)
  if (!Number.isFinite(expNum) || expNum < nowMs) return false
  const expected = await hmacBase64Url(secret, exp)
  return expected === sig
}

export function isMaintenanceAllowedPath(pathname: string): boolean {
  return MAINTENANCE_ALLOWED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
}

// proxy のゲート判定（純関数）。メンテON・非オーナー（通行cookie無効）・非許可パスのみブロック。
export function shouldBlockForMaintenance(opts: {
  maintenance: boolean
  pathname: string
  hasValidBypass: boolean
}): boolean {
  if (!opts.maintenance) return false
  if (opts.hasValidBypass) return false
  if (isMaintenanceAllowedPath(opts.pathname)) return false
  return true
}
```

- [ ] **Step 4: テストが通るのを確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/maintenance.test.ts`
Expected: PASS（全ケース green）

- [ ] **Step 5: コミット**

```bash
cd ~/medical-search-public
git add src/lib/maintenance.ts src/lib/__tests__/maintenance.test.ts
git commit -m "feat: メンテナンスモードの共有ロジック（管理者判定・通行cookie署名・ゲート判定）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: フラグ読取 `readMaintenanceFlag`（TTLキャッシュ）をライブラリに追加

**Files:**
- Modify: `src/lib/maintenance.ts`（末尾に追記）
- Test: `src/lib/__tests__/maintenance.test.ts`（追記）

**Interfaces:**
- Consumes: なし
- Produces:
  - `readMaintenanceFlag(opts?: { nowMs?: number; fetchImpl?: typeof fetch }): Promise<boolean>`
  - `__resetMaintenanceFlagCache(): void`（テスト＆POST後の即時反映用）

- [ ] **Step 1: 失敗するテストを追記**

`src/lib/__tests__/maintenance.test.ts` の末尾に追記:
```ts
import { readMaintenanceFlag, __resetMaintenanceFlagCache } from '@/lib/maintenance'

describe('readMaintenanceFlag', () => {
  beforeEach(() => {
    __resetMaintenanceFlagCache()
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  })
  afterEach(() => {
    __resetMaintenanceFlagCache()
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  })

  it('Supabaseの値 true を返す', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify([{ value: true }]), { status: 200 })) as unknown as typeof fetch
    expect(await readMaintenanceFlag({ nowMs: 1000, fetchImpl })).toBe(true)
  })

  it('行が無ければ false', async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify([]), { status: 200 })) as unknown as typeof fetch
    expect(await readMaintenanceFlag({ nowMs: 1000, fetchImpl })).toBe(false)
  })

  it('TTL内は2回目にfetchしない（キャッシュ）', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      return new Response(JSON.stringify([{ value: true }]), { status: 200 })
    }) as unknown as typeof fetch
    await readMaintenanceFlag({ nowMs: 1000, fetchImpl })
    await readMaintenanceFlag({ nowMs: 1000 + 5000, fetchImpl }) // TTL(30s)内
    expect(calls).toBe(1)
  })

  it('TTLを過ぎたら再fetchする', async () => {
    let calls = 0
    const fetchImpl = (async () => {
      calls++
      return new Response(JSON.stringify([{ value: false }]), { status: 200 })
    }) as unknown as typeof fetch
    await readMaintenanceFlag({ nowMs: 1000, fetchImpl })
    await readMaintenanceFlag({ nowMs: 1000 + 31_000, fetchImpl }) // TTL(30s)超
    expect(calls).toBe(2)
  })

  it('fetch失敗時はフェイルオープン（false）', async () => {
    const fetchImpl = (async () => { throw new Error('network') }) as unknown as typeof fetch
    expect(await readMaintenanceFlag({ nowMs: 1000, fetchImpl })).toBe(false)
  })
})
```

- [ ] **Step 2: テストが失敗するのを確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/maintenance.test.ts`
Expected: FAIL（`readMaintenanceFlag` / `__resetMaintenanceFlagCache` が未エクスポート）

- [ ] **Step 3: `readMaintenanceFlag` を実装（`src/lib/maintenance.ts` 末尾に追記）**

```ts
// ── フラグ読取（TTLキャッシュ付き）──
// proxy が毎ページ表示で叩くため、Supabaseへの往復をTTLで間引く。
// ウォームインスタンスではキャッシュヒットでDBアクセスを省略。ON切替は最大 TTL 秒で反映。
const FLAG_TTL_MS = 30_000
let flagCache: { value: boolean; at: number } | null = null

export function __resetMaintenanceFlagCache(): void {
  flagCache = null
}

export async function readMaintenanceFlag(opts?: {
  nowMs?: number
  fetchImpl?: typeof fetch
}): Promise<boolean> {
  const nowMs = opts?.nowMs ?? Date.now()
  const fetchImpl = opts?.fetchImpl ?? fetch

  if (flagCache && nowMs - flagCache.at < FLAG_TTL_MS) return flagCache.value

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return false // 未設定はフェイルオープン

  try {
    const res = await fetchImpl(
      `${url}/rest/v1/app_flags?select=value&key=eq.${MAINTENANCE_FLAG_KEY}`,
      {
        headers: { apikey: anon, Authorization: `Bearer ${anon}` },
        cache: 'no-store',
      },
    )
    if (!res.ok) return flagCache?.value ?? false
    const rows = (await res.json()) as Array<{ value: boolean }>
    const value = rows.length > 0 ? !!rows[0].value : false
    flagCache = { value, at: nowMs }
    return value
  } catch {
    // ネットワーク不調時は前回値、無ければフェイルオープン（アプリを止めない）。
    return flagCache?.value ?? false
  }
}
```

- [ ] **Step 4: テストが通るのを確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/maintenance.test.ts`
Expected: PASS（新規5ケースを含め全 green）

- [ ] **Step 5: コミット**

```bash
cd ~/medical-search-public
git add src/lib/maintenance.ts src/lib/__tests__/maintenance.test.ts
git commit -m "feat: メンテナンスフラグ読取（TTLキャッシュ・フェイルオープン）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `/api/maintenance` route（GET 状態＋cookie付与 / POST 切替）

**Files:**
- Create: `src/app/api/maintenance/route.ts`

**Interfaces:**
- Consumes: `readMaintenanceFlag`, `signBypassToken`, `isAdminEmail`, `__resetMaintenanceFlagCache`, `MAINTENANCE_BYPASS_COOKIE`, `MAINTENANCE_FLAG_KEY`（Task 2/3）；`createClient`, `createAdminClient`（`src/lib/supabase/server.ts`）；`requireAdmin`（`src/lib/admin-guard.ts`）。
- Produces:
  - `GET /api/maintenance` → `{ maintenance: boolean, isAdmin: boolean }`。isAdmin のとき `maint_bypass` cookie をセット。
  - `POST /api/maintenance`（管理者限定）body `{ maintenance: boolean }` → `{ ok: true, maintenance }`。

- [ ] **Step 1: route を実装**

`src/app/api/maintenance/route.ts`:
```ts
// メンテナンスモードの状態取得と切替。
//   GET  /api/maintenance … 公開。現在の状態＋このセッションがオーナーかを返す。
//                           オーナーには通行cookie（maint_bypass）を付与する。
//   POST /api/maintenance … 管理者限定（requireAdmin）。フラグを更新する。
// クライアント（MaintenanceGate）と管理UI（/admin/maintenance）から呼ばれる。

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin-guard'
import {
  MAINTENANCE_BYPASS_COOKIE,
  MAINTENANCE_FLAG_KEY,
  isAdminEmail,
  signBypassToken,
  readMaintenanceFlag,
  __resetMaintenanceFlagCache,
} from '@/lib/maintenance'

export async function GET() {
  const maintenance = await readMaintenanceFlag()

  let isAdmin = false
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    isAdmin = isAdminEmail(user?.email)
  } catch {
    // 未ログイン等は非オーナー扱い。
  }

  const res = NextResponse.json({ maintenance, isAdmin })
  if (isAdmin) {
    const token = await signBypassToken()
    if (token) {
      res.cookies.set(MAINTENANCE_BYPASS_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60,
      })
    }
  }
  return res
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body: { maintenance?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSONが不正です' }, { status: 400 })
  }
  if (typeof body.maintenance !== 'boolean') {
    return NextResponse.json(
      { error: 'maintenance は boolean で指定してください' },
      { status: 400 },
    )
  }

  try {
    const admin = createAdminClient()
    const { error } = await admin.from('app_flags').upsert(
      {
        key: MAINTENANCE_FLAG_KEY,
        value: body.maintenance,
        updated_at: new Date().toISOString(),
        updated_by: auth.email,
      },
      { onConflict: 'key' },
    )
    if (error) throw new Error(error.message)
    __resetMaintenanceFlagCache() // このインスタンスは次の読取で即最新化
    return NextResponse.json({ ok: true, maintenance: body.maintenance })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

- [ ] **Step 2: 型・ビルド確認**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし（既存の型定義と整合）

- [ ] **Step 3: コミット**

```bash
cd ~/medical-search-public
git add src/app/api/maintenance/route.ts
git commit -m "feat: /api/maintenance（状態取得＋通行cookie付与 / 管理者による切替）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> **手動検証（Task 8 で管理UIと合わせて実施）:** ログイン無しで `GET /api/maintenance` が `{maintenance:false,isAdmin:false}` を返し Set-Cookie 無し。オーナーでGETすると `isAdmin:true` かつ `maint_bypass` cookie が付くこと。

---

### Task 5: 調整中画面 `MaintenanceScreen` と `/maintenance` ルート

**Files:**
- Create: `src/components/MaintenanceScreen.tsx`
- Create: `src/app/maintenance/page.tsx`

**Interfaces:**
- Produces: `MaintenanceScreen`（default export のクライアントコンポーネント。props 無し）。`/maintenance` ページがこれを描画。オーバーレイ（Task 6）も同じものを使う。

- [ ] **Step 1: `MaintenanceScreen` を実装**

`src/components/MaintenanceScreen.tsx`:
```tsx
'use client'

// 調整中画面の見た目。/maintenance ルートと MaintenanceGate オーバーレイで共用する。
// ブランド色（常盤グリーン brand-600）とロゴで、白画面にせず安心感を出す。

export default function MaintenanceScreen() {
  const xUrl = process.env.NEXT_PUBLIC_X_URL

  return (
    <div className="min-h-screen w-full bg-gray-50 flex items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm text-center">
        <img
          src="/icon-192.png"
          alt="MediNode"
          width={72}
          height={72}
          className="mx-auto mb-6 rounded-2xl shadow-sm"
        />
        <h1 className="text-xl font-bold text-brand-700">現在調整中です</h1>
        <p className="mt-4 text-sm leading-relaxed text-gray-600">
          ただいまアプリの調整を行っております。
          <br />
          ご不便をおかけし申し訳ありません。
        </p>
        <p className="mt-3 text-sm leading-relaxed text-gray-600">
          再開のお知らせは、アプリ内またはX（旧Twitter）でお伝えします。
        </p>

        <div className="mt-8 flex flex-col gap-3">
          {xUrl ? (
            <a
              href={xUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-700"
            >
              Xで最新情報を見る
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
          >
            再度読み込む
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: `/maintenance` ページを実装**

`src/app/maintenance/page.tsx`:
```tsx
import type { Metadata } from 'next'
import MaintenanceScreen from '@/components/MaintenanceScreen'

export const metadata: Metadata = {
  title: '調整中 | MediNode',
  robots: { index: false, follow: false },
}

export default function MaintenancePage() {
  return <MaintenanceScreen />
}
```

- [ ] **Step 3: プレビューで見た目を確認**

Run: preview_start で dev サーバを起動し `/maintenance` を開く（`.claude/launch.json` の dev 設定。無ければ `runtimeExecutable: "npm"`, `runtimeArgs: ["run","dev"]`, `port: 3000` で作成）。
Expected: ロゴ＋「現在調整中です」＋（`NEXT_PUBLIC_X_URL` 設定時）Xボタン＋再読み込みボタンが中央表示。console にエラー無し。

- [ ] **Step 4: コミット**

```bash
cd ~/medical-search-public
git add src/components/MaintenanceScreen.tsx src/app/maintenance/page.tsx
git commit -m "feat: 調整中画面（MaintenanceScreen）と /maintenance ルート

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: 起動時ゲート `MaintenanceGate` を layout に設置（SW/PWAキャッシュ対策）

**Files:**
- Create: `src/components/MaintenanceGate.tsx`
- Modify: `src/app/layout.tsx:119`（`<PwaRuntime />` 直後）

**Interfaces:**
- Consumes: `MaintenanceScreen`（Task 5）
- Produces: `MaintenanceGate`（named export のクライアントコンポーネント）。マウント時に `/api/maintenance` を叩き、`maintenance && !isAdmin` のとき全画面オーバーレイで `MaintenanceScreen` を出す。

- [ ] **Step 1: `MaintenanceGate` を実装**

`src/components/MaintenanceGate.tsx`:
```tsx
'use client'

// 起動時のメンテナンスチェック。PWA/Service Worker のキャッシュから起動して proxy を
// 経由しなかったユーザーにも、キャッシュ画面の上にオーバーレイで調整中画面を必ず出す。
// オーナー（isAdmin）には出さない（同時にGETの副作用で通行cookieが付与される）。

import { useEffect, useState } from 'react'
import MaintenanceScreen from '@/components/MaintenanceScreen'

export function MaintenanceGate() {
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/maintenance', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { maintenance?: boolean; isAdmin?: boolean } | null) => {
        if (cancelled || !data) return
        setBlocked(!!data.maintenance && !data.isAdmin)
      })
      .catch(() => {
        // 取得失敗時はフェイルオープン（通常アプリを妨げない）。
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!blocked) return null

  return (
    <div className="fixed inset-0 z-[9999] bg-gray-50 overflow-auto">
      <MaintenanceScreen />
    </div>
  )
}
```

- [ ] **Step 2: layout に import を追加**

`src/app/layout.tsx` の import 群（`import { AuthProvider } ...` 付近）に追記:
```tsx
import { MaintenanceGate } from '@/components/MaintenanceGate'
```

- [ ] **Step 3: `<PwaRuntime />` 直後にマウント**

`src/app/layout.tsx:119` の `<PwaRuntime />` の直後に1行追加する。変更後の該当箇所:
```tsx
        <PwaRuntime />
        <MaintenanceGate />
        <AuthProvider>
```

- [ ] **Step 4: 型・ビルド確認**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 5: プレビューで無効時の素通しを確認**

Run: preview で `/`（トップ）を開く（メンテ未適用＝フラグ false）。
Expected: オーバーレイは出ず通常アプリが表示。console にエラー無し。`/api/maintenance` が呼ばれ `{maintenance:false}` を返す（Network で確認）。

- [ ] **Step 6: コミット**

```bash
cd ~/medical-search-public
git add src/components/MaintenanceGate.tsx src/app/layout.tsx
git commit -m "feat: 起動時メンテナンスゲート（PWA/SWキャッシュ対策のオーバーレイ）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: `proxy.ts` にメンテナンスゲートを追加

**Files:**
- Modify: `src/proxy.ts`

**Interfaces:**
- Consumes: `readMaintenanceFlag`, `verifyBypassToken`, `shouldBlockForMaintenance`, `MAINTENANCE_BYPASS_COOKIE`（Task 2/3）。
- Produces: メンテON時、非オーナー（有効 `maint_bypass` cookie 無し）の非許可パス表示を `/maintenance` に rewrite する挙動。

- [ ] **Step 1: import を追加**

`src/proxy.ts` の import 群に追記（既存 `import { REQUIRE_LOGIN_COOKIE } from '@/lib/login-policy'` の下）:
```ts
import {
  MAINTENANCE_BYPASS_COOKIE,
  readMaintenanceFlag,
  verifyBypassToken,
  shouldBlockForMaintenance,
} from '@/lib/maintenance'
```

- [ ] **Step 2: `proxy()` の先頭（`let response = NextResponse.next({ request })` の直後）にゲートを挿入**

`src/proxy.ts` の `export async function proxy(request: NextRequest) {` 内、最初の `let response = NextResponse.next({ request })` の直後に追加:
```ts
  // ── メンテナンスゲート（REQUIRE_LOGIN より手前）──
  // フラグ ON かつ 非オーナー（有効な通行cookie無し）かつ 非許可パス なら /maintenance を表示。
  // rewrite（URLは変えず内容だけ差し替え）で、ブックマークやPWAの start_url を壊さない。
  {
    const maintenance = await readMaintenanceFlag()
    if (maintenance) {
      const bypass = request.cookies.get(MAINTENANCE_BYPASS_COOKIE)?.value
      const hasValidBypass = await verifyBypassToken(bypass)
      if (
        shouldBlockForMaintenance({
          maintenance,
          pathname: request.nextUrl.pathname,
          hasValidBypass,
        })
      ) {
        const url = request.nextUrl.clone()
        url.pathname = '/maintenance'
        url.search = ''
        return NextResponse.rewrite(url)
      }
    }
  }
```

- [ ] **Step 3: 型・ビルド確認**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 4: 単体テストが引き続き通ることを確認**

Run: `cd ~/medical-search-public && npx vitest run`
Expected: PASS（`maintenance.test.ts` / `login-policy.test.ts` を含む全 green）

- [ ] **Step 5: コミット**

```bash
cd ~/medical-search-public
git add src/proxy.ts
git commit -m "feat: proxy にメンテナンスゲート（非オーナーを /maintenance へ rewrite）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

> **注:** `config.matcher` は API を除外しているため、この proxy ゲートはページ表示にのみ効く。API 側の遮断はしない（オーナー素通し＋起動時 `MaintenanceGate` で一般ユーザーの操作は調整中に落ちるため、YAGNI としてAPI 503 は入れない）。

---

### Task 8: 秘密の切替UI `/admin/maintenance`

**Files:**
- Create: `src/app/admin/maintenance/page.tsx`
- Create: `src/app/admin/maintenance/MaintenanceAdminClient.tsx`

**Interfaces:**
- Consumes: `GET`/`POST /api/maintenance`（Task 4）。
- Produces: 管理者がブックマークする切替ページ。現状表示・ON/OFFボタン・「本番を確認」リンク・プレビューリンク。

- [ ] **Step 1: サーバーページ（noindex）を実装**

`src/app/admin/maintenance/page.tsx`:
```tsx
import type { Metadata } from 'next'
import { MaintenanceAdminClient } from './MaintenanceAdminClient'

export const metadata: Metadata = {
  title: 'メンテナンス切替 | MediNode',
  description: '調整中画面のON/OFF（管理者専用）',
  robots: { index: false, follow: false },
}

export default function MaintenanceAdminPage() {
  return <MaintenanceAdminClient />
}
```

- [ ] **Step 2: クライアントUIを実装**

`src/app/admin/maintenance/MaintenanceAdminClient.tsx`:
```tsx
'use client'

// 秘密の切替UI（管理者専用・スマホでブックマークする想定）。
// マウント時に GET /api/maintenance で現状を読む（＝オーナーの通行cookieもここで付与される）。
// ON/OFF は POST /api/maintenance。403/401 の時は「オーナーでログインが必要」を促す。

import { useCallback, useEffect, useState } from 'react'

export function MaintenanceAdminClient() {
  const [maintenance, setMaintenance] = useState<boolean | null>(null)
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/maintenance', { cache: 'no-store' })
      const data = (await res.json()) as { maintenance?: boolean; isAdmin?: boolean }
      setMaintenance(!!data.maintenance)
      setIsAdmin(!!data.isAdmin)
    } catch {
      setError('状態の取得に失敗しました')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const toggle = useCallback(
    async (next: boolean) => {
      setBusy(true)
      setError(null)
      try {
        const res = await fetch('/api/maintenance', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ maintenance: next }),
        })
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            setError('オーナーとしてログインが必要です（/login からログインしてください）')
          } else {
            const d = (await res.json().catch(() => null)) as { error?: string } | null
            setError(d?.error ?? '切替に失敗しました')
          }
          return
        }
        const d = (await res.json()) as { maintenance: boolean }
        setMaintenance(d.maintenance)
      } catch {
        setError('切替に失敗しました')
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  return (
    <div className="min-h-screen bg-gray-50 px-6 py-10">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="text-lg font-bold text-gray-900">メンテナンス切替</h1>
        <p className="mt-1 text-xs text-gray-500">管理者専用。調整中画面のON/OFFを切り替えます。</p>

        {isAdmin === false ? (
          <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
            オーナーとしてログインしていません。<a className="underline" href="/login">ログイン</a>してから操作してください。
          </p>
        ) : null}

        <div className="mt-6 rounded-2xl border border-gray-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-600">現在の状態</span>
            <span
              className={
                maintenance === null
                  ? 'text-sm text-gray-400'
                  : maintenance
                    ? 'rounded-full bg-red-100 px-3 py-1 text-sm font-semibold text-red-700'
                    : 'rounded-full bg-brand-100 px-3 py-1 text-sm font-semibold text-brand-700'
              }
            >
              {maintenance === null ? '読み込み中…' : maintenance ? '調整中（ON）' : '通常稼働（OFF）'}
            </span>
          </div>

          <div className="mt-5 flex flex-col gap-3">
            <button
              type="button"
              disabled={busy || maintenance === true}
              onClick={() => toggle(true)}
              className="w-full rounded-xl bg-red-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-red-700 disabled:opacity-40"
            >
              調整中にする（ON）
            </button>
            <button
              type="button"
              disabled={busy || maintenance === false}
              onClick={() => toggle(false)}
              className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:opacity-40"
            >
              通常稼働に戻す（OFF）
            </button>
          </div>

          {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}
        </div>

        <div className="mt-5 flex flex-col gap-2 text-sm">
          <a className="text-brand-700 underline" href="/maintenance" target="_blank" rel="noopener noreferrer">
            調整中画面をプレビュー
          </a>
          <a className="text-brand-700 underline" href="/">
            本番を確認（オーナーは素通し）
          </a>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 型・ビルド確認**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 4: プレビューで一連の挙動を手動確認**

Run: preview で以下を確認（ローカルは REQUIRE_LOGIN 未設定で可。Supabase ローカル未接続なら `readMaintenanceFlag`/POST は環境変数依存＝下記は本番相当env or 実DB接続時に確認）。
Expected（環境変数と SupABase が揃う前提）:
1. `/admin/maintenance` を開く → 現状「通常稼働（OFF）」。
2. 「調整中にする（ON）」→ 状態が「調整中（ON）」に。
3. 別ブラウザ/シークレット（非オーナー）で `/` を開く → 調整中画面が出る。
4. オーナーのブラウザで `/` を開く → 通常アプリ（素通し）。
5. 「通常稼働に戻す（OFF）」→ 非オーナー側も最大30秒で通常復帰。

- [ ] **Step 5: コミット**

```bash
cd ~/medical-search-public
git add src/app/admin/maintenance/page.tsx src/app/admin/maintenance/MaintenanceAdminClient.tsx
git commit -m "feat: 秘密の切替UI /admin/maintenance（ON/OFF・状態表示・プレビュー）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: 環境変数のドキュメント化と最終ビルド確認

**Files:**
- Modify: `.env.example`

**Interfaces:**
- Consumes: なし。

- [ ] **Step 1: `.env.example` に追記**

`.env.example` の末尾に追記:
```bash
# ── メンテナンスモード（調整中画面）──
# 調整中画面の「Xで最新情報を見る」リンク先。未設定ならXボタンは非表示。
NEXT_PUBLIC_X_URL=
# オーナー素通し用の通行cookie署名鍵（任意）。未設定なら SUPABASE_SERVICE_ROLE_KEY を流用する。
# 専用鍵にする場合: openssl rand -base64 32 の値を入れる。
MAINTENANCE_BYPASS_SECRET=
```

- [ ] **Step 2: 本番ビルドが通ることを確認**

Run: `cd ~/medical-search-public && npm run build`
Expected: ビルド成功（`/maintenance`・`/admin/maintenance`・`/api/maintenance` がルートとして出力される）。型エラー・未使用importエラー無し。

- [ ] **Step 3: 全テスト再実行**

Run: `cd ~/medical-search-public && npm test`
Expected: PASS（全 green）

- [ ] **Step 4: コミット**

```bash
cd ~/medical-search-public
git add .env.example
git commit -m "docs: メンテナンスモードの環境変数（NEXT_PUBLIC_X_URL / MAINTENANCE_BYPASS_SECRET）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## デプロイ後にオーナーが行う手順（実装外・申し送り）

1. Supabase SQL Editor で `supabase/migrations/0011_app_flags.sql` を実行（フラグ表作成）。
2. Vercel 環境変数に `NEXT_PUBLIC_X_URL`（MediNode公式X URL）を設定。任意で `MAINTENANCE_BYPASS_SECRET` を設定（未設定でも動く）。
3. デプロイ後、オーナーでログインし `/admin/maintenance` をスマホにブックマーク。
4. 一度 ON→非オーナー端末で調整中表示を確認→OFF、の通し確認を本番で実施。

## Self-Review

- **Spec coverage:** 秘密の管理URL（Task 8）／Supabaseフラグ＋RLS（Task 1）／`/api/maintenance` GET・POST・cookie（Task 4）／`/maintenance`画面＝ロゴ・ブランド色・Xリンク・再読み込み・固定文言（Task 5）／proxyゲート＋TTLキャッシュ＋許可パス（Task 3,7）／`MaintenanceGate` SW対策（Task 6）／通行cookie署名（Task 2）／オーナー素通し（Task 4 GET＋Task 7）／フェイルオープン（Task 3）／環境変数（Task 9）— 仕様の全項目に対応タスクあり。
- **Placeholder scan:** TBD/TODO 無し。全 code step に実コードあり。
- **Type consistency:** `readMaintenanceFlag(opts?)` / `signBypassToken(ttlMs?, nowMs?)` / `verifyBypassToken(token, nowMs?)` / `shouldBlockForMaintenance({maintenance,pathname,hasValidBypass})` / `MAINTENANCE_BYPASS_COOKIE` / `MAINTENANCE_FLAG_KEY` の名称・シグネチャは Task 2/3 の定義と Task 4/6/7 の利用で一致。API 応答 `{maintenance,isAdmin}` は Task 4 定義と Task 6/8 利用で一致。
