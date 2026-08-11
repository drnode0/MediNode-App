# 登録フローの職種ステップ＋通知オプトイン Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 登録・ログインの流れを `email → sent → profile（職種・必須）→ notify（通知・任意）→ done` に拡張し、職種をアカウント（user_settings.occupation）に保存する。

**Architecture:** LoginModal のフェーズ機械を拡張する（案A・spec承認済み）。遷移判定は純関数 `nextPhaseAfterAuth` に切り出してテストする。職種の保存/取得は `src/lib/account-profile.ts` ＋ `GET/POST /api/account/profile`。CQ投稿（CqCapture）はアカウントの職種を自動入力し、投稿時にアカウント未登録なら裏で埋める。/admin台帳に職種の内訳を1枠追加。

**Tech Stack:** Next.js App Router / Supabase（user_settings）/ vitest / Tailwind。

**Spec:** `docs/superpowers/specs/2026-08-11-registration-occupation-notify-design.md`

## Global Constraints

- 作業は git worktree のブランチ `feat/signup-occupation-notify` で行う（main を直接触らない。理由: memory「shared-worktree-branch-collision」）。
- 職種の唯一のリストは `CQ_OCCUPATIONS`（`src/lib/cq-submit.ts`）。新リストを作らない。
- 文言は静かな日本語（宣伝調・AI主役の文言禁止）。プランに書いてある文言をそのまま使う。
- migration `0024_user_occupation.sql` は Supabase SQL Editor での手動適用。**コードは列が無くても動くこと**（照会失敗→null扱い）。
- テストコマンドは `npx vitest run <path>`（全件は `npx vitest run`）。
- コミットメッセージは日本語・既存の流儀（先頭に要約1行）。

---

### Task 1: migration ＋ account-profile ライブラリ

**Files:**
- Create: `migrations/0024_user_occupation.sql`
- Create: `src/lib/account-profile.ts`
- Test: `src/lib/__tests__/account-profile.test.ts`

**Interfaces:**
- Consumes: `CQ_OCCUPATIONS`（`src/lib/cq-submit.ts`・既存）
- Produces: `isValidOccupation(v: unknown): v is string` / `getUserOccupation(admin: SupabaseClient, userId: string): Promise<string | null>` / `saveUserOccupation(admin: SupabaseClient, userId: string, occupation: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

`src/lib/__tests__/account-profile.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isValidOccupation } from '../account-profile'

describe('isValidOccupation', () => {
  it('リスト内の職種を受け入れる', () => {
    expect(isValidOccupation('医師')).toBe(true)
    expect(isValidOccupation('看護師')).toBe(true)
    expect(isValidOccupation('その他')).toBe(true)
  })
  it('リスト外・非文字列を弾く', () => {
    expect(isValidOccupation('宇宙飛行士')).toBe(false)
    expect(isValidOccupation('')).toBe(false)
    expect(isValidOccupation(null)).toBe(false)
    expect(isValidOccupation(undefined)).toBe(false)
    expect(isValidOccupation(123)).toBe(false)
    // 旧リストにしか無かった値は無効（CqCapture.loadCqProfile と同じ判断）
    expect(isValidOccupation('学生')).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/account-profile.test.ts`
Expected: FAIL（`../account-profile` が存在しない）

- [ ] **Step 3: Write implementation**

`migrations/0024_user_occupation.sql`:

```sql
-- 登録フローで訊く職種（アカウント属性）。CQ_OCCUPATIONS の固定リストの値のみが入る。
-- 既存migration（0009等）と同様、列が無くてもコードは動く（照会失敗時は null 扱い）ため、
-- Supabase SQL Editor で任意のタイミングで適用してよい。追加のみ・既存データに影響なし。
alter table public.user_settings
  add column if not exists occupation text;
```

`src/lib/account-profile.ts`:

```ts
// 職種（アカウント属性）の保存・取得。登録フロー（LoginModal）とCQ投稿の自動入力で共用する。
// 保存先は user_settings.occupation（migration 0024）。値は CQ_OCCUPATIONS のみ許可。
import type { SupabaseClient } from '@supabase/supabase-js'
import { CQ_OCCUPATIONS } from './cq-submit'

// 固定リスト内の職種か（純関数・テスト対象）。
export function isValidOccupation(v: unknown): v is string {
  return typeof v === 'string' && (CQ_OCCUPATIONS as readonly string[]).includes(v)
}

// 未登録・行なし・列未適用（migration 0024 前）はすべて null。
export async function getUserOccupation(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('user_settings')
    .select('occupation')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return null
  const v = (data as { occupation?: unknown } | null)?.occupation
  return isValidOccupation(v) ? v : null
}

export async function saveUserOccupation(
  admin: SupabaseClient,
  userId: string,
  occupation: string,
): Promise<void> {
  const { error } = await admin
    .from('user_settings')
    .upsert({ user_id: userId, occupation }, { onConflict: 'user_id' })
  if (error) throw new Error(error.message)
}
```

注: `updated_at` は渡さない。台帳の「設定同期時刻」は settings_enc の有無で判定しており（ledger route のプローブ）、occupation だけの行が設定完了と誤認されることはない。

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/account-profile.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 5: Commit**

```bash
git add migrations/0024_user_occupation.sql src/lib/account-profile.ts src/lib/__tests__/account-profile.test.ts
git commit -m "職種のアカウント保存: migration 0024 と account-profile ライブラリ"
```

---

### Task 2: API `GET/POST /api/account/profile`

**Files:**
- Create: `src/app/api/account/profile/route.ts`
- Test: `src/lib/__tests__/account-profile-route.test.ts`

**Interfaces:**
- Consumes: Task 1 の `getUserOccupation` / `saveUserOccupation` / `isValidOccupation`、`createClient` / `createAdminClient`（`@/lib/supabase/server`・既存）
- Produces: `GET /api/account/profile` → `{ occupation: string | null }`（未ログイン401）。`POST /api/account/profile` body `{ occupation: string }` → `{ ok: true }`（リスト外400・未ログイン401）

- [ ] **Step 1: Write the failing test**

`src/lib/__tests__/account-profile-route.test.ts`（cq-helpful-route.test.ts の流儀に合わせる）:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { getUserMock, adminClientMock } = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  adminClientMock: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: getUserMock } }),
  createAdminClient: adminClientMock,
}))

import { GET, POST } from '../../app/api/account/profile/route'

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/account/profile', { method: 'POST', body: JSON.stringify(body) }))

// user_settings の薄いスタブ。select→maybeSingle と upsert を記録する。
function settingsStub(occupation: string | null) {
  const upsert = vi.fn(async () => ({ error: null }))
  const stub = {
    from: (table: string) => {
      expect(table).toBe('user_settings')
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: occupation === null ? null : { occupation }, error: null }) }) }),
        upsert,
      }
    },
  }
  return { stub, upsert }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
})

describe('GET /api/account/profile', () => {
  it('未ログインは401', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await GET()
    expect(res.status).toBe(401)
  })
  it('登録済みの職種を返す', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    adminClientMock.mockReturnValue(settingsStub('看護師').stub)
    const res = await GET()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ occupation: '看護師' })
  })
  it('未登録は null', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    adminClientMock.mockReturnValue(settingsStub(null).stub)
    const res = await GET()
    expect(await res.json()).toEqual({ occupation: null })
  })
})

describe('POST /api/account/profile', () => {
  it('未ログインは401（DBに触らない）', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await post({ occupation: '医師' })
    expect(res.status).toBe(401)
    expect(adminClientMock).not.toHaveBeenCalled()
  })
  it('リスト外の職種は400', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const res = await post({ occupation: '宇宙飛行士' })
    expect(res.status).toBe(400)
  })
  it('正常保存で ok:true・upsert が呼ばれる', async () => {
    getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } })
    const { stub, upsert } = settingsStub(null)
    adminClientMock.mockReturnValue(stub)
    const res = await post({ occupation: '薬剤師' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    expect(upsert).toHaveBeenCalledWith({ user_id: 'u1', occupation: '薬剤師' }, { onConflict: 'user_id' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/account-profile-route.test.ts`
Expected: FAIL（route が存在しない）

- [ ] **Step 3: Write implementation**

`src/app/api/account/profile/route.ts`:

```ts
// 職種（アカウント属性）API。
// GET  /api/account/profile … ログイン本人の { occupation: string | null }。未ログインは401。
// POST /api/account/profile … { occupation } を保存。リスト外は400。未ログインは401。
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getUserOccupation, saveUserOccupation, isValidOccupation } from '@/lib/account-profile'

function ready(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export async function GET() {
  // Supabase未設定環境（ローカル等）では「職種なし」として静かに通す。
  if (!ready()) return NextResponse.json({ occupation: null })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'login_required' }, { status: 401 })
  const occupation = await getUserOccupation(createAdminClient(), user.id)
  return NextResponse.json({ occupation })
}

export async function POST(req: NextRequest) {
  if (!ready()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'login_required' }, { status: 401 })
  let body: { occupation?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  if (!isValidOccupation(body.occupation)) {
    return NextResponse.json({ ok: false, error: 'invalid_occupation' }, { status: 400 })
  }
  try {
    await saveUserOccupation(createAdminClient(), user.id, body.occupation)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/__tests__/account-profile-route.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: Commit**

```bash
git add src/app/api/account/profile/route.ts src/lib/__tests__/account-profile-route.test.ts
git commit -m "職種API: GET/POST /api/account/profile（本人のみ・リスト検証）"
```

---

### Task 3: 遷移ロジック login-onboarding ＋ push-client ヘルパー

**Files:**
- Create: `src/lib/login-onboarding.ts`
- Modify: `src/lib/push-client.ts`（末尾に2関数追加）
- Modify: `src/lib/cq-submit.ts`（`CQ_PROFILE_KEY` を export）
- Modify: `src/components/CqCapture.tsx`（ローカルの `CQ_PROFILE_KEY` 定義を import に置換）
- Modify: `src/components/PushSettings.tsx`（ローカル `deviceResultMessage` を共用関数に置換）
- Test: `src/lib/__tests__/login-onboarding.test.ts`

**Interfaces:**
- Consumes: `isValidOccupation`（Task 1）、`isIos` / `isStandalone` / `SubscribeResult`（push-client 既存）
- Produces:
  - `nextPhaseAfterAuth(input: { occupation: string | null; subscribed: boolean; canOfferPush: boolean }): 'profile' | 'notify' | 'done'`
  - `nextPhaseAfterProfile(input: { subscribed: boolean; canOfferPush: boolean }): 'notify' | 'done'`
  - `deviceRememberedOccupation(): string`（CQ端末記憶からの初期値。無ければ `''`）
  - `canOfferPushOnThisDevice(): boolean`（push-client）
  - `subscribeResultMessage(result: SubscribeResult): string`（push-client）
  - `CQ_PROFILE_KEY = 'medinode_cq_profile_v1'`（cq-submit）

- [ ] **Step 1: Write the failing test**

`src/lib/__tests__/login-onboarding.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { nextPhaseAfterAuth, nextPhaseAfterProfile } from '../login-onboarding'

describe('nextPhaseAfterAuth', () => {
  it('職種未登録なら profile（購読状態に関わらず）', () => {
    expect(nextPhaseAfterAuth({ occupation: null, subscribed: false, canOfferPush: true })).toBe('profile')
    expect(nextPhaseAfterAuth({ occupation: null, subscribed: true, canOfferPush: false })).toBe('profile')
  })
  it('職種登録済み・未購読・通知を出せる端末なら notify', () => {
    expect(nextPhaseAfterAuth({ occupation: '医師', subscribed: false, canOfferPush: true })).toBe('notify')
  })
  it('購読済み or 通知を出せない端末なら done', () => {
    expect(nextPhaseAfterAuth({ occupation: '医師', subscribed: true, canOfferPush: true })).toBe('done')
    expect(nextPhaseAfterAuth({ occupation: '医師', subscribed: false, canOfferPush: false })).toBe('done')
  })
})

describe('nextPhaseAfterProfile', () => {
  it('未購読・通知を出せる端末なら notify、それ以外は done', () => {
    expect(nextPhaseAfterProfile({ subscribed: false, canOfferPush: true })).toBe('notify')
    expect(nextPhaseAfterProfile({ subscribed: true, canOfferPush: true })).toBe('done')
    expect(nextPhaseAfterProfile({ subscribed: false, canOfferPush: false })).toBe('done')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/__tests__/login-onboarding.test.ts`
Expected: FAIL（`../login-onboarding` が存在しない）

- [ ] **Step 3: Write implementation**

`src/lib/login-onboarding.ts`:

```ts
// 認証成功後の登録フロー遷移判定（LoginModal から使う）。
// フェーズ: profile（職種・必須）→ notify（通知・任意）→ done。
// 職種の照会に失敗したときは呼び出し側で done に直行する（登録を止めない。次回ログイン時に再度出る）。
import { isValidOccupation } from './account-profile'
import { CQ_PROFILE_KEY } from './cq-submit'

export type PostAuthPhase = 'profile' | 'notify' | 'done'

export function nextPhaseAfterAuth(input: {
  occupation: string | null
  subscribed: boolean
  canOfferPush: boolean
}): PostAuthPhase {
  if (!input.occupation) return 'profile'
  return nextPhaseAfterProfile(input)
}

export function nextPhaseAfterProfile(input: {
  subscribed: boolean
  canOfferPush: boolean
}): Extract<PostAuthPhase, 'notify' | 'done'> {
  return input.canOfferPush && !input.subscribed ? 'notify' : 'done'
}

// CQ投稿で端末に記憶済みの職種（あれば profile ステップの初期選択に使う）。
export function deviceRememberedOccupation(): string {
  try {
    const raw = JSON.parse(localStorage.getItem(CQ_PROFILE_KEY) || '{}') as { occupation?: unknown }
    return isValidOccupation(raw.occupation) ? raw.occupation : ''
  } catch {
    return ''
  }
}
```

`src/lib/cq-submit.ts` — `CQ_OCCUPATIONS` 定義の直前に追加:

```ts
// CQ投稿の職種・経験年数・ペンネームの端末記憶キー（CqCapture と登録フローの初期値で共用）。
export const CQ_PROFILE_KEY = 'medinode_cq_profile_v1'
```

`src/components/CqCapture.tsx` — ローカル定義を削除して import に置換:

削除する行（41行目付近）:
```ts
const CQ_PROFILE_KEY = 'medinode_cq_profile_v1'
```
既存の import（32行目付近）に `CQ_PROFILE_KEY` を追加:
```ts
import { CQ_OCCUPATIONS, CQ_EXPERIENCE_YEARS, CQ_DOCTOR_DEPARTMENTS, CQ_DEPARTMENT_OCCUPATION, CQ_PROFILE_KEY, QUESTION_MIN, BACKGROUND_MAX, defaultDestinations, type CqIntent } from '@/lib/cq-submit'
```

`src/lib/push-client.ts` — 末尾に追加:

```ts
// 登録フローの通知ステップを出す意味がある端末か。
// PushManager があり購読を試せるか、iOSの非PWA（「ホーム画面に追加」の案内が出せる）。
export function canOfferPushOnThisDevice(): boolean {
  try {
    if ('serviceWorker' in navigator && 'PushManager' in window) return true
    return isIos() && !isStandalone()
  } catch {
    return false
  }
}

// 購読結果を人に伝える一文（PushSettings と登録フローの通知ステップで共用）。
export function subscribeResultMessage(result: SubscribeResult): string {
  if (result.ok) return 'この端末で受け取れるようになりました'
  switch (result.reason) {
    case 'ios-uninstalled':
      return 'iPhoneでは、共有メニューから「ホーム画面に追加」でアプリとして開くと受け取れます'
    case 'denied':
      return '通知がブロックされています。端末の設定で許可してください'
    case 'server-rejected':
      return 'この端末では今は受け取れません（対象外）'
    default:
      return 'この端末では通知を利用できません'
  }
}
```

`src/components/PushSettings.tsx` — ローカルの `deviceResultMessage` 関数（10〜22行目）を丸ごと削除し、import を差し替え:

```ts
import { getDeviceSubscribed, subscribeThisDevice, subscribeResultMessage } from '@/lib/push-client'
```

`DeviceSubscribe` 内の呼び出しを置換（48行目付近）:
```ts
      setMsg(subscribeResultMessage(result))
```

- [ ] **Step 4: Run tests to verify they pass（既存テストも壊れていないこと）**

Run: `npx vitest run`
Expected: PASS（全件。特に login-onboarding 2 describe / cq-submit.test.ts / push.test.ts が緑）

- [ ] **Step 5: Commit**

```bash
git add src/lib/login-onboarding.ts src/lib/push-client.ts src/lib/cq-submit.ts src/components/CqCapture.tsx src/components/PushSettings.tsx src/lib/__tests__/login-onboarding.test.ts
git commit -m "登録フロー遷移判定と通知ヘルパー: login-onboarding / canOfferPush / subscribeResultMessage 共用化"
```

---

### Task 4: LoginModal に profile / notify フェーズを追加

**Files:**
- Modify: `src/components/auth/LoginModal.tsx`

**Interfaces:**
- Consumes: `nextPhaseAfterAuth` / `nextPhaseAfterProfile` / `deviceRememberedOccupation`（Task 3）、`getDeviceSubscribed` / `subscribeThisDevice` / `canOfferPushOnThisDevice` / `subscribeResultMessage`（push-client）、`CQ_OCCUPATIONS`（cq-submit）、`GET/POST /api/account/profile`（Task 2）
- Produces: フェーズ `'email' | 'sent' | 'profile' | 'notify' | 'done'` のモーダル。外部Props（`onClose`/`onSuccess`/`reason`/`purpose`）は不変。

- [ ] **Step 1: import と state を追加**

import 差し替え（8〜13行目付近）:

```ts
import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { UserPlus, CheckCircle2, Mail, X, Bell } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
import { suggestEmailCorrection, checkEmailDeliverable } from '@/lib/email-typo'
import { CQ_OCCUPATIONS } from '@/lib/cq-submit'
import { getDeviceSubscribed, subscribeThisDevice, canOfferPushOnThisDevice, subscribeResultMessage } from '@/lib/push-client'
import { nextPhaseAfterAuth, nextPhaseAfterProfile, deviceRememberedOccupation } from '@/lib/login-onboarding'
```

phase の型を差し替え（39行目付近）:

```ts
  const [phase, setPhase] = useState<'email' | 'sent' | 'profile' | 'notify' | 'done'>('email')
```

`accountIsNew` の下に state を追加:

```ts
  // 職種ステップ（認証成功後・アカウントに職種が無いときだけ出る）。
  const [occupation, setOccupation] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  // 通知ステップ（この端末が未購読のときだけ出る）。
  const [notifyBusy, setNotifyBusy] = useState(false)
  const [notifyMsg, setNotifyMsg] = useState('')
  const [notifyDone, setNotifyDone] = useState(false)
```

- [ ] **Step 2: 認証成功後の行き先判定を追加し、verifyCode / signInWithPassword から呼ぶ**

`finishDone` の上に追加:

```ts
  // 認証成功後の行き先。職種未登録なら profile、未購読端末なら notify、それ以外は done。
  // 職種の照会に失敗したときは done に直行する（登録を止めない。次回ログイン時に再度出る）。
  const routeAfterAuth = async () => {
    try {
      const res = await fetch('/api/account/profile', { cache: 'no-store' })
      if (!res.ok) throw new Error('profile_fetch_failed')
      const data = (await res.json()) as { occupation?: string | null }
      const subscribed = await getDeviceSubscribed()
      const next = nextPhaseAfterAuth({
        occupation: data.occupation ?? null,
        subscribed,
        canOfferPush: canOfferPushOnThisDevice(),
      })
      if (next === 'profile') setOccupation(deviceRememberedOccupation())
      setPhase(next)
    } catch {
      setPhase('done')
    }
  }

  // 職種を保存して次へ（通知 or 完了）。
  const saveOccupation = async () => {
    if (!occupation) return
    setProfileSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/account/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ occupation }),
      })
      const data = await res.json().catch(() => ({ ok: false }))
      if (!res.ok || !data?.ok) throw new Error('save_failed')
      const subscribed = await getDeviceSubscribed()
      setPhase(nextPhaseAfterProfile({ subscribed, canOfferPush: canOfferPushOnThisDevice() }))
    } catch {
      setError('保存できませんでした。時間をおいて再度お試しください。')
    } finally {
      setProfileSaving(false)
    }
  }

  // この端末で通知を購読する（許可ダイアログが出る）。失敗理由は一文で返る。
  const enableNotify = async () => {
    setNotifyBusy(true)
    setNotifyMsg('')
    try {
      const result = await subscribeThisDevice()
      setNotifyDone(result.ok)
      setNotifyMsg(subscribeResultMessage(result))
    } finally {
      setNotifyBusy(false)
    }
  }
```

`verifyCode` 内の `setPhase('done')`（163行目付近）を差し替え:

```ts
      await routeAfterAuth()
```

`signInWithPassword` 内の `setPhase('done')`（134行目付近）も同様に差し替え:

```ts
      await routeAfterAuth()
```

（どちらも直前の `setAccountIsNew(...)` 行はそのまま残す。）

- [ ] **Step 3: profile / notify フェーズの JSX を追加**

`{phase === 'sent' && (...)}` ブロックの閉じの直後・`{phase === 'done' && (...)}` の直前に追加:

```tsx
        {phase === 'profile' && (
          <>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">職種を教えてください</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                どんな職種の方が読んでいるかを、今後のナレッジ作りに活かします。臨床疑問の投稿時にも自動で入ります。
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="職種の選択">
              {CQ_OCCUPATIONS.map((o) => {
                const on = occupation === o
                return (
                  <button
                    key={o}
                    type="button"
                    aria-pressed={on}
                    onClick={() => { setOccupation(o); setError(null) }}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                      on
                        ? 'bg-brand-600 border-brand-600 text-white'
                        : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-brand-300'
                    }`}
                  >
                    {o}
                  </button>
                )
              })}
            </div>
            <button
              onClick={saveOccupation}
              disabled={profileSaving || !occupation}
              className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {profileSaving ? '保存中...' : 'この職種で続ける'}
            </button>
          </>
        )}

        {phase === 'notify' && (
          <>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100 flex items-center gap-1.5">
                <Bell className="w-4 h-4" />
                通知を受け取りますか？
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                今日の1問・投稿した疑問の解決・お知らせが届きます。オフに戻すのはいつでも1〜2タップです。
              </p>
            </div>
            {notifyMsg && (
              <div className={`rounded-lg p-3 text-xs ${notifyDone ? 'bg-brand-50 dark:bg-brand-900/30 text-brand-700 dark:text-brand-300' : 'bg-gray-50 dark:bg-gray-700/40 text-gray-600 dark:text-gray-300'}`}>
                {notifyMsg}
              </div>
            )}
            {notifyDone ? (
              <button
                onClick={() => setPhase('done')}
                className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
              >
                続ける
              </button>
            ) : (
              <>
                <button
                  onClick={enableNotify}
                  disabled={notifyBusy}
                  className="w-full rounded-lg bg-brand-600 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {notifyBusy ? '設定中...' : 'この端末で通知を受け取る'}
                </button>
                <button
                  onClick={() => setPhase('done')}
                  className="w-full text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                >
                  あとで（設定 → 通知からいつでも）
                </button>
              </>
            )}
          </>
        )}
```

- [ ] **Step 4: ビルドと既存テストの確認**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 型エラーなし・全テストPASS

- [ ] **Step 5: Commit**

```bash
git add src/components/auth/LoginModal.tsx
git commit -m "登録・ログインフローに職種ステップと通知オプトインを追加"
```

---

### Task 5: CqCapture をアカウント職種と接続

**Files:**
- Modify: `src/components/CqCapture.tsx`

**Interfaces:**
- Consumes: `GET/POST /api/account/profile`（Task 2）、`CQ_DEPARTMENT_OCCUPATION`（既存 import 済み）
- Produces: CQ投稿モーダルの職種が「アカウント → 端末記憶」の優先順で自動入力。専門医投稿の成功時、アカウント未登録なら職種を裏で保存。

- [ ] **Step 1: アカウント職種の取得と自動入力**

`CqCaptureModal` 内、`bgConfirmedRef` の下（323行目付近）に ref を追加:

```ts
  // アカウントに保存済みの職種（null=未登録）。投稿成功時の穴埋め判定に使う。
  const accountOccupationRef = useRef<string | null>(null)
```

マウント時の useEffect（331〜334行目）を差し替え:

```ts
  useEffect(() => {
    setMounted(true)
    setProfile(loadCqProfile())
    // アカウントに職種があれば自動入力（アカウント優先。端末記憶より確かな属性）。
    // 未ログイン（401）や失敗は静かに握って端末記憶のまま。
    fetch('/api/account/profile', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { occupation?: string | null } | null) => {
        const occ = d?.occupation
        if (!occ) return
        accountOccupationRef.current = occ
        setProfile((p) => ({
          ...p,
          occupation: occ,
          // 医師以外に確定したら診療科・立場は捨てる（既存の職種変更ハンドラと同じ判断）。
          departments: occ === CQ_DEPARTMENT_OCCUPATION ? p.departments : [],
        }))
      })
      .catch(() => {})
  }, [])
```

- [ ] **Step 2: 投稿成功時の穴埋め保存**

`willSendExpert` の送信ジョブ内、`saveCqProfile(profile)`（491行目付近）の直後に追加:

```ts
            // アカウントに職種が未登録なら、この投稿の職種で埋める（登録フロー導入前の
            // ユーザーの穴埋め。失敗しても投稿は成功扱いのまま静かに握る）。
            if (!accountOccupationRef.current && profile.occupation) {
              void fetch('/api/account/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ occupation: profile.occupation }),
              }).catch(() => {})
            }
```

- [ ] **Step 3: ビルドと既存テストの確認**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 型エラーなし・全テストPASS

- [ ] **Step 4: Commit**

```bash
git add src/components/CqCapture.tsx
git commit -m "CQ投稿の職種をアカウントから自動入力・投稿時に未登録なら穴埋め保存"
```

---

### Task 6: /admin 台帳に職種の内訳

**Files:**
- Modify: `src/app/api/admin/ledger/route.ts`
- Modify: `src/app/admin/AdminLedgerClient.tsx`

**Interfaces:**
- Consumes: `user_settings.occupation`（Task 1 の migration）、`CountBars` / `Segment`（`src/app/admin/AdminCharts.tsx`・既存）
- Produces: ledger API レスポンスに `occupationBreakdown: Record<string, number> | null`（列未適用なら null）。分析タブに「職種の内訳」カード。

- [ ] **Step 1: ledger route に集計を追加**

`return NextResponse.json({` の直前（437行目付近・auditLog の catch の後）に追加:

```ts
    // 職種の内訳（登録フローで訊くアカウント属性）。migration 0024 未適用なら null（UIは適用待ち表示）。
    let occupationBreakdown: Record<string, number> | null = null
    {
      const res = await admin.from('user_settings').select('user_id, occupation')
      if (!res.error) {
        occupationBreakdown = {}
        for (const r of res.data ?? []) {
          const occ = (r as { occupation?: string | null }).occupation
          if (occ) occupationBreakdown[occ] = (occupationBreakdown[occ] ?? 0) + 1
        }
      }
    }
```

レスポンスの `auditLog,` の下に追加:

```ts
      // 職種の内訳（全アカウント。列未適用なら null）。
      occupationBreakdown,
```

- [ ] **Step 2: AdminLedgerClient に state・集計・カードを追加**

state（313行目付近・`lpSources` の近く）に追加:

```ts
  const [occupationBreakdown, setOccupationBreakdown] = useState<Record<string, number> | null>(null)
```

データ取得ハンドラ（359行目付近・`setLpSources` の近く）に追加:

```ts
      setOccupationBreakdown(
        data.occupationBreakdown && typeof data.occupationBreakdown === 'object' ? data.occupationBreakdown : null,
      )
```

`lpTotal` の memo（658行目付近）の下に追加:

```ts
  // 職種の内訳（登録フローで訊くアカウント属性）。未登録 = 全アカウント数 − 職種あり合計。
  const occupationBars = useMemo<Segment[]>(() => {
    if (!occupationBreakdown) return []
    const entries = Object.entries(occupationBreakdown).sort((a, b) => b[1] - a[1])
    const withOcc = entries.reduce((sum, [, c]) => sum + c, 0)
    const bars: Segment[] = entries.map(([label, count]) => ({ label, count, className: 'bg-brand-500' }))
    const none = Math.max(0, (rows?.length ?? 0) - withOcc)
    if (none > 0) bars.push({ label: '未登録', count: none, className: 'bg-gray-300 dark:bg-gray-600' })
    return bars
  }, [occupationBreakdown, rows])
```

JSX: 「接続モードとDB設定」の section の閉じタグ `</section>`（1214行目付近・`dbSetupSegments` の SegmentBar を含む section）の直後、grid の閉じ `</div>` の前に追加:

```tsx
              <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                <SectionHeading title="職種の内訳" caption="登録時に訊く職種の構成。どんな読者に向けてナレッジを作るかの参考。" help="user_settings.occupation の集計（全アカウント）。登録フロー導入前のユーザーは「未登録」に入り、次回ログイン時の職種ステップで集まっていきます。" />
                {occupationBars.length > 0 ? (
                  <CountBars items={occupationBars} label="職種の内訳" />
                ) : (
                  <p className="text-xs text-gray-400 dark:text-gray-500">migration 0024 の適用待ち、または記録がまだありません。</p>
                )}
              </section>
```

（`Segment` 型・`CountBars` はこのファイルで import 済み。未 import ならエラーになるので、その場合は既存の AdminCharts import 行に追加する。）

- [ ] **Step 3: ビルドと既存テストの確認**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 型エラーなし・全テストPASS

- [ ] **Step 4: Commit**

```bash
git add src/app/api/admin/ledger/route.ts src/app/admin/AdminLedgerClient.tsx
git commit -m "/admin台帳に職種の内訳カードを追加"
```

---

### Task 7: 全体検証とブラウザ確認

**Files:**
- なし（検証のみ）

- [ ] **Step 1: 全テスト・型チェック**

Run: `npx tsc --noEmit && npx vitest run`
Expected: すべてPASS

- [ ] **Step 2: dev サーバーで登録フローを一巡（ブラウザ検証）**

dev サーバーを起動し（`.claude/launch.json` の既存設定 or `npm run dev`）、以下を確認:

1. 未ログイン状態でアカウント登録モーダルを開く → メール → 6桁コード（ローカルでSupabase未設定なら、profileフェーズのUIは Storybook 的に確認できないため、`phase` 初期値を一時的に `'profile'` にして目視 → **必ず戻す**。memory「verify-without-destroying-state」参照）
2. profile フェーズ: 15職種のチップが折り返し表示・選択でハイライト・「この職種で続ける」が有効になる
3. notify フェーズ: ボタンと「あとで」・メッセージ表示
4. ダークモードで両フェーズの配色確認（`resize_window` の colorScheme）

- [ ] **Step 3: 最終コミット（残変更があれば）**

```bash
git status --short
```

Expected: クリーン（未コミットの変更なし）

## デプロイ後の残タスク（実装完了時に申し送りへ書く）

1. **migration 0024 を Supabase SQL Editor で手動適用**（適用まで: 職種ステップは毎回スキップ相当・/adminは「適用待ち」表示。壊れはしない）
2. オーナー実機目視: 新規登録一巡・既存アカウントでの再ログイン（職種ステップが一度だけ出る）・iPhone PWA/非PWA の通知ステップ
