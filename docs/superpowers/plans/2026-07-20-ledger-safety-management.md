# アカウント台帳 スペック② 実装計画（安全管理）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 台帳に運用セキュリティ4機能（操作監査ログ／Stripe不整合検知／異常兆候パネル／メールマスキング＋CSV注意）を追加する。

**Architecture:** 判定は純関数 `src/lib/ledger-safety.ts`（テスト付）。監査書き込みは `src/lib/admin-audit.ts`（失敗しても主アクションを止めない）。新テーブル `admin_audit_log`（migration 0011・手動適用）。UIは `src/app/admin/SafetyPanels.tsx`。台帳APIは後方互換で拡張。

**Tech Stack:** Next.js / React / TypeScript / Supabase(service_role) / Stripe SDK / vitest / lucide-react。

## Global Constraints

- 区分定義は `src/lib/member-ledger.ts` の `MemberKind` に準拠。
- データ欠損（migration未適用・Stripe未設定）でも台帳本体は絶対に落とさない（try/catchで空扱い）。
- 認証は `requireAdmin()`（`{ ok:true, email }` を返す）。actorEmail は必ずサーバー確定値（`auth.email`）を使い、クライアント申告は使わない。
- 既存の削除/付与の安全弁（管理者削除禁止・Stripe契約者への付与/削除拒否・メール再入力確認）は維持。
- メール表示の既定は**表示**。マスクは任意トグル。
- テストは `npx vitest run`。コミットは日本語＋末尾 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。ブランチ `main`、push で自動デプロイ（最終タスクまでpushしない）。

---

### Task 1: migration 0011 ＋ 監査書き込みヘルパー

**Files:**
- Create: `supabase/migrations/0011_admin_audit_log.sql`
- Create: `src/lib/admin-audit.ts`

- [ ] **Step 1: migration を書く**

`supabase/migrations/0011_admin_audit_log.sql`:

```sql
-- 管理者の操作監査ログ（付与/取消/削除/モニター指定/CSV出力）。append-only。
create table if not exists public.admin_audit_log (
  id bigint generated always as identity primary key,
  actor_email text not null,
  action text not null,
  target_user_id uuid,
  target_email text,
  detail jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;
-- 参照・書込はサーバー(service_role)のみ。通常ユーザー向けポリシーは作らない。
create index if not exists admin_audit_log_created_idx
  on public.admin_audit_log (created_at desc);
```

- [ ] **Step 2: 書き込みヘルパーを書く**

`src/lib/admin-audit.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

export type AdminAction =
  | 'grant_comp'
  | 'revoke_comp'
  | 'delete_user'
  | 'set_monitor'
  | 'unset_monitor'
  | 'export_csv'

// 監査ログを1件記録。テーブル未適用・失敗でも主アクションは止めない（握りつぶす）。
export async function logAdminAction(
  admin: SupabaseClient,
  entry: {
    actorEmail: string
    action: AdminAction
    targetUserId?: string | null
    targetEmail?: string | null
    detail?: unknown
  }
): Promise<void> {
  try {
    await admin.from('admin_audit_log').insert({
      actor_email: entry.actorEmail,
      action: entry.action,
      target_user_id: entry.targetUserId ?? null,
      target_email: entry.targetEmail ?? null,
      detail: entry.detail ?? null,
    })
  } catch {
    // テーブル未適用やネットワーク失敗でも黙って続行（監査は best-effort）。
  }
}
```

- [ ] **Step 3: 型チェック**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 4: Commit**

```bash
cd ~/medical-search-public
git add supabase/migrations/0011_admin_audit_log.sql src/lib/admin-audit.ts
git commit -m "feat(admin): 監査ログのテーブル(0011)と書き込みヘルパー

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 安全判定の純関数 `ledger-safety.ts`（TDD）

**Files:**
- Create: `src/lib/ledger-safety.ts`
- Test: `src/lib/__tests__/ledger-safety.test.ts`

**Interfaces:**
- Produces: `maskEmail`, `detectLocalContractIssues`, `detectAnomalySignals`, `reconcileStripe` と型 `ContractIssue/AnomalySignal/LocalSub/StripeSub/Reconciliation`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/ledger-safety.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  maskEmail,
  detectLocalContractIssues,
  detectAnomalySignals,
  reconcileStripe,
} from '../ledger-safety'

describe('maskEmail', () => {
  it('先頭1文字＋***＋ドメイン', () => expect(maskEmail('tatsuki@gmail.com')).toBe('t***@gmail.com'))
  it('null/@なしは安全に扱う', () => {
    expect(maskEmail(null)).toBe('—')
    expect(maskEmail('broken')).toBe('broken')
  })
})

describe('detectLocalContractIssues', () => {
  it('課金中なのにStripe顧客IDが無い行を拾う', () => {
    const issues = detectLocalContractIssues([
      { userId: 'a', email: 'a@x.com', kind: 'premium', status: 'active', plan: 'premium', hasStripe: false },
      { userId: 'b', email: 'b@x.com', kind: 'premium', status: 'active', plan: 'premium', hasStripe: true },
    ])
    expect(issues).toHaveLength(1)
    expect(issues[0].userId).toBe('a')
  })
  it('Stripe顧客IDがあるのに区分がfreeの行を拾う', () => {
    const issues = detectLocalContractIssues([
      { userId: 'c', email: 'c@x.com', kind: 'free', status: 'canceled', plan: 'premium', hasStripe: true },
    ])
    expect(issues).toHaveLength(1)
    expect(issues[0].reason).toContain('無効')
  })
})

describe('detectAnomalySignals', () => {
  const now = Date.parse('2026-07-20T12:00:00+09:00')
  it('紹介集中・使い捨てメール・失効間近を検出', () => {
    const rows = [
      { email: 'a@mailinator.com', kind: 'auto_trial' as const, referralCount: 0, premiumUsedAt: null, trialEndsAt: '2026-07-20T20:00:00+09:00', createdAt: '2026-07-01' },
      { email: 'b@x.com', kind: 'free' as const, referralCount: 12, premiumUsedAt: null, trialEndsAt: null, createdAt: '2026-07-02' },
    ]
    const s = detectAnomalySignals(rows, now)
    const keys = s.map((x) => x.key)
    expect(keys).toContain('referral_concentration')
    expect(keys).toContain('disposable_email')
    expect(keys).toContain('trial_expiring_unused')
  })
  it('該当なしなら空', () => {
    const s = detectAnomalySignals(
      [{ email: 'a@x.com', kind: 'free' as const, referralCount: 0, premiumUsedAt: null, trialEndsAt: null, createdAt: '2026-07-02' }],
      now
    )
    expect(s).toEqual([])
  })
})

describe('reconcileStripe', () => {
  it('宙に浮いた契約（Stripeにactiveだがローカルに無い）を拾う', () => {
    const r = reconcileStripe(
      [{ userId: 'u1', email: 'u1@x.com', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'active' }],
      [
        { id: 'sub_1', customer: 'cus_1', status: 'active' },
        { id: 'sub_2', customer: 'cus_2', status: 'active' }, // ローカルに無い → orphan
      ]
    )
    expect(r.orphanStripe.map((o) => o.subscriptionId)).toEqual(['sub_2'])
    expect(r.staleLocal).toEqual([])
  })
  it('ローカルpremiumだがStripeにactive無し（取り残し）を拾う', () => {
    const r = reconcileStripe(
      [{ userId: 'u3', email: 'u3@x.com', stripeCustomerId: 'cus_3', stripeSubscriptionId: 'sub_3', status: 'active' }],
      [{ id: 'sub_3', customer: 'cus_3', status: 'canceled' }]
    )
    expect(r.staleLocal.map((s) => s.userId)).toEqual(['u3'])
    expect(r.orphanStripe).toEqual([])
  })
})
```

- [ ] **Step 2: 失敗確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/ledger-safety.test.ts`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 実装を書く**

`src/lib/ledger-safety.ts`:

```ts
import type { MemberKind } from './member-ledger'

// メールを t***@domain へ。@が無い等の異常入力は安全にそのまま返す。
export function maskEmail(email: string | null): string {
  if (!email) return '—'
  const at = email.indexOf('@')
  if (at <= 0) return email
  return `${email[0]}***${email.slice(at)}`
}

export type ContractIssue = { userId: string; email: string | null; reason: string }

export function detectLocalContractIssues(
  rows: {
    userId: string
    email: string | null
    kind: MemberKind
    status: string | null
    plan: string | null
    hasStripe: boolean
  }[]
): ContractIssue[] {
  const issues: ContractIssue[] = []
  for (const r of rows) {
    if (r.status === 'active' && r.plan === 'premium' && !r.hasStripe) {
      issues.push({ userId: r.userId, email: r.email, reason: '課金中の記録だがStripe顧客IDが無い' })
    } else if (r.hasStripe && r.kind === 'free') {
      issues.push({ userId: r.userId, email: r.email, reason: 'Stripe顧客IDがあるのに区分が無効(free)' })
    }
  }
  return issues
}

export type AnomalySignal = {
  key: string
  label: string
  count: number
  level: 'info' | 'watch'
  hint: string
}

const DISPOSABLE_DOMAINS = [
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com',
]

export function detectAnomalySignals(
  rows: {
    email: string | null
    kind: MemberKind
    referralCount: number
    premiumUsedAt: string | null
    trialEndsAt: string | null
    createdAt: string | null
  }[],
  now: number
): AnomalySignal[] {
  const signals: AnomalySignal[] = []

  // 1) 登録の急増スパイク
  const byDay = new Map<string, number>()
  for (const r of rows) {
    if (!r.createdAt) continue
    const d = r.createdAt.slice(0, 10)
    byDay.set(d, (byDay.get(d) ?? 0) + 1)
  }
  const counts = [...byDay.values()].sort((a, b) => a - b)
  const median = counts.length ? counts[Math.floor(counts.length / 2)] : 0
  const threshold = Math.max(5, median * 3)
  const spikes = [...byDay.values()].filter((c) => c > threshold)
  if (spikes.length) {
    signals.push({
      key: 'signup_spike',
      label: '登録が急増した日',
      count: spikes.length,
      level: 'watch',
      hint: `1日の新規が${threshold}件超の日。bot/乱用の可能性。日別グラフと突き合わせを。`,
    })
  }

  // 2) 紹介の異常集中
  const heavyReferrers = rows.filter((r) => r.referralCount >= 10).length
  if (heavyReferrers) {
    signals.push({
      key: 'referral_concentration',
      label: '紹介が突出した人',
      count: heavyReferrers,
      level: 'watch',
      hint: '10人以上を招待。自己紹介・不正招待でないか確認を。',
    })
  }

  // 3) 使い捨てメールドメイン
  const disposable = rows.filter((r) => {
    const at = r.email?.lastIndexOf('@') ?? -1
    if (!r.email || at < 0) return false
    return DISPOSABLE_DOMAINS.includes(r.email.slice(at + 1).toLowerCase())
  }).length
  if (disposable) {
    signals.push({
      key: 'disposable_email',
      label: '使い捨てメール',
      count: disposable,
      level: 'watch',
      hint: '既知の使い捨てドメインのメール。トライアル乱用の可能性。',
    })
  }

  // 4) 自動トライアル未利用のまま失効間近
  const soon = rows.filter((r) => {
    if (r.kind !== 'auto_trial' || r.premiumUsedAt || !r.trialEndsAt) return false
    const end = new Date(r.trialEndsAt).getTime()
    return end > now && end - now <= 24 * 60 * 60 * 1000
  }).length
  if (soon) {
    signals.push({
      key: 'trial_expiring_unused',
      label: '未利用トライアル失効間近',
      count: soon,
      level: 'info',
      hint: '24時間以内に失効する自動トライアルで、一度も利用が無い人。フォローの機会。',
    })
  }

  return signals
}

// Stripe照合の純粋部分。ローカルとStripeのサブスク配列を突合。
export type LocalSub = {
  userId: string
  email: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  status: string | null
}
export type StripeSub = { id: string; customer: string; status: string }
export type Reconciliation = {
  orphanStripe: { subscriptionId: string; customer: string; status: string }[]
  staleLocal: { userId: string; email: string | null; status: string | null }[]
}

export function reconcileStripe(local: LocalSub[], stripe: StripeSub[]): Reconciliation {
  const localByCustomer = new Set(
    local.map((l) => l.stripeCustomerId).filter((v): v is string => !!v)
  )
  const localBySubId = new Set(
    local.map((l) => l.stripeSubscriptionId).filter((v): v is string => !!v)
  )
  const activeStripe = stripe.filter((s) => s.status === 'active' || s.status === 'trialing')
  const orphanStripe = activeStripe
    .filter((s) => !localBySubId.has(s.id) && !localByCustomer.has(s.customer))
    .map((s) => ({ subscriptionId: s.id, customer: s.customer, status: s.status }))
  const activeCustomers = new Set(activeStripe.map((s) => s.customer))
  const staleLocal = local
    .filter((l) => l.status === 'active' && l.stripeCustomerId && !activeCustomers.has(l.stripeCustomerId))
    .map((l) => ({ userId: l.userId, email: l.email, status: l.status }))
  return { orphanStripe, staleLocal }
}
```

- [ ] **Step 4: テスト通過確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/ledger-safety.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd ~/medical-search-public
git add src/lib/ledger-safety.ts src/lib/__tests__/ledger-safety.test.ts
git commit -m "feat(admin): 安全判定の純関数（マスク/契約不整合/異常兆候/Stripe突合）＋テスト

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: API に監査記録・auditLog・Stripe照合を配線

**Files:**
- Modify: `src/app/api/admin/ledger/route.ts`（import・GET・POST分岐・DELETE・PATCH）
- Modify: `src/app/api/premium/comp/route.ts`（revoke に監査記録）

**Interfaces:**
- Consumes: `logAdminAction`（Task1）, `reconcileStripe/LocalSub/StripeSub`（Task2）

- [ ] **Step 1: route.ts に import を追加**

`ledger/route.ts` 冒頭の import 群に:

```ts
import { logAdminAction } from '@/lib/admin-audit'
import { reconcileStripe, type StripeSub } from '@/lib/ledger-safety'
import Stripe from 'stripe'
```

- [ ] **Step 2: GET レスポンスに auditLog を追加**

`ledger/route.ts` の `return NextResponse.json({ ... })` 内、`lpToday` の直後に追加するため、まず return の手前で監査ログを取得:

```ts
    // 操作履歴（最近50件）。テーブル未適用なら空（try/catch）。
    let auditLog: Array<{
      action: string; actorEmail: string; targetEmail: string | null; createdAt: string; detail: unknown
    }> = []
    try {
      const { data } = await admin
        .from('admin_audit_log')
        .select('action, actor_email, target_email, created_at, detail')
        .order('created_at', { ascending: false })
        .limit(50)
      auditLog = (data ?? []).map((r) => ({
        action: String(r.action),
        actorEmail: String(r.actor_email),
        targetEmail: (r.target_email as string | null) ?? null,
        createdAt: String(r.created_at),
        detail: r.detail ?? null,
      }))
    } catch {
      // 0011 未適用なら空（UIは「適用待ち」表示）。
    }
```

そして return オブジェクトに `auditLog,` を追加（`lpToday: jstToday,` の次の行）:

```ts
      lpToday: jstToday,
      auditLog,
    })
```

- [ ] **Step 3: POST を action 分岐に拡張（audit / stripe_reconcile / 既定=付与）**

`POST` の `try {` 直後を次の構造に置き換える。既存の付与ロジック（userId 検証〜grant〜return）は `default` 相当として残し、先頭で action を読む:

```ts
export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  try {
    const body = (await req.json()) as { action?: string; userId?: unknown; event?: string; detail?: unknown }
    const admin = createAdminClient()

    // (a) クライアント発の監査イベント記録（CSV出力など）。
    if (body.action === 'audit') {
      if (body.event === 'export_csv') {
        await logAdminAction(admin, { actorEmail: auth.email, action: 'export_csv', detail: body.detail ?? null })
      }
      return NextResponse.json({ ok: true })
    }

    // (b) Stripe と照合（宙に浮いた契約・取り残しを洗う）。押下時のみ実行。
    if (body.action === 'stripe_reconcile') {
      const stripeKey = process.env.STRIPE_SECRET_KEY
      if (!stripeKey) return NextResponse.json({ ok: true, stripeConfigured: false, orphanStripe: [], staleLocal: [] })
      const stripe = new Stripe(stripeKey)
      const stripeSubs: StripeSub[] = []
      // ページング（現規模では十分な上限）。
      let startingAfter: string | undefined
      for (let i = 0; i < 20; i++) {
        const page = await stripe.subscriptions.list({ status: 'all', limit: 100, starting_after: startingAfter })
        for (const s of page.data) {
          stripeSubs.push({ id: s.id, customer: typeof s.customer === 'string' ? s.customer : s.customer.id, status: s.status })
        }
        if (!page.has_more || page.data.length === 0) break
        startingAfter = page.data[page.data.length - 1].id
      }
      const { data: localData } = await admin
        .from('subscriptions')
        .select('user_id, stripe_customer_id, stripe_subscription_id, status')
      // ローカルの user_id → email を引くため users を利用（既に GET で使う createAdminClient と同じ）。
      const { data: usersData } = await admin.auth.admin.listUsers({ perPage: 1000 })
      const emailById = new Map((usersData?.users ?? []).map((u) => [u.id, u.email ?? null]))
      const local = (localData ?? []).map((l) => ({
        userId: String(l.user_id),
        email: emailById.get(String(l.user_id)) ?? null,
        stripeCustomerId: (l.stripe_customer_id as string | null) ?? null,
        stripeSubscriptionId: (l.stripe_subscription_id as string | null) ?? null,
        status: (l.status as string | null) ?? null,
      }))
      const result = reconcileStripe(local, stripeSubs)
      return NextResponse.json({ ok: true, stripeConfigured: true, ...result })
    }

    // (c) 既定: 永続無料(comp)の付与。
    const userId = body.userId
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId を指定してください' }, { status: 400 })
    }
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error || !data?.user) {
      return NextResponse.json({ error: '対象のユーザーが見つかりません' }, { status: 404 })
    }
    const { data: existing } = await admin
      .from('subscriptions')
      .select('stripe_customer_id, status')
      .eq('user_id', userId)
      .maybeSingle()
    if (existing?.stripe_customer_id) {
      return NextResponse.json(
        { error: 'このユーザーはStripe契約の記録があるため、台帳からは付与できません' },
        { status: 409 },
      )
    }
    await grantComplimentaryByUserId(userId)
    await logAdminAction(admin, { actorEmail: auth.email, action: 'grant_comp', targetUserId: userId, targetEmail: data.user.email ?? null })
    return NextResponse.json({ ok: true, userId, plan: 'comp' })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
```

（注: 既存 POST は `const admin = createAdminClient()` を付与分岐の内側で作っていたが、上記では先頭で1回作るso、重複した `createAdminClient()` 呼び出しが本文に残らないよう置換すること。）

- [ ] **Step 4: DELETE / PATCH に監査記録を差し込む**

DELETE の成功直前（`deleteUser` 成功後、`return NextResponse.json({ ok: true, userId })` の前）に:

```ts
    if (delErr) throw new Error(delErr.message)
    await logAdminAction(admin, { actorEmail: auth.email, action: 'delete_user', targetUserId: userId, targetEmail: data.user.email ?? null })
    return NextResponse.json({ ok: true, userId })
```

PATCH の成功直前（`updateUserById` 成功後、`return` の前）に:

```ts
    if (updErr) throw new Error(updErr.message)
    await logAdminAction(admin, {
      actorEmail: auth.email,
      action: isMonitor ? 'set_monitor' : 'unset_monitor',
      targetUserId: userId,
      targetEmail: data.user.email ?? null,
    })
    return NextResponse.json({ ok: true, userId, isMonitor })
```

- [ ] **Step 5: revoke（premium/comp）に監査記録**

`src/app/api/premium/comp/route.ts` の POST（revoke 成功箇所）に、`requireAdmin` の `email` と `createAdminClient` を使って:

```ts
import { logAdminAction } from '@/lib/admin-audit'
```
を足し、revoke 成功の return 直前に（対象userId・emailが分かる箇所で）:

```ts
    await logAdminAction(admin, { actorEmail: auth.email, action: 'revoke_comp', targetUserId: userId, targetEmail: targetEmail ?? null })
```
※ 変数名は現ファイルに合わせる（`admin`/`auth.email`/対象IDが無ければ取得済みの値を使う）。実装時に該当箇所を読んで合わせる。

- [ ] **Step 6: 型チェック＋既存テスト**

Run: `cd ~/medical-search-public && npx tsc --noEmit && npx vitest run`
Expected: エラーなし・全テストPASS

- [ ] **Step 7: Commit**

```bash
cd ~/medical-search-public
git add src/app/api/admin/ledger/route.ts src/app/api/premium/comp/route.ts
git commit -m "feat(admin): 監査記録の配線＋auditLog返却＋Stripe照合エンドポイント

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 安全パネルUIと台帳への配線

**Files:**
- Create: `src/app/admin/SafetyPanels.tsx`
- Modify: `src/app/admin/AdminLedgerClient.tsx`（型・import・派生・マスク・CSV確認/記録・reconcile・配置）

**Interfaces:**
- Consumes: `ContractIssue/AnomalySignal/Reconciliation`（Task2）, `maskEmail/detectLocalContractIssues/detectAnomalySignals`（Task2）

- [ ] **Step 1: SafetyPanels.tsx を書く**

`src/app/admin/SafetyPanels.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { ShieldAlert, AlertTriangle, ScrollText, RefreshCw } from 'lucide-react'
import { SectionHeading } from './SectionHeading'
import type { ContractIssue, AnomalySignal } from '@/lib/ledger-safety'

type ReconResult = {
  stripeConfigured: boolean
  orphanStripe: { subscriptionId: string; customer: string; status: string }[]
  staleLocal: { userId: string; email: string | null; status: string | null }[]
} | null

export function ContractIssuesPanel({ issues }: { issues: ContractIssue[] }) {
  const [loading, setLoading] = useState(false)
  const [recon, setRecon] = useState<ReconResult>(null)
  const [error, setError] = useState<string | null>(null)

  const runReconcile = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stripe_reconcile' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '照合に失敗しました')
      setRecon(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '照合に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-start justify-between gap-2">
        <SectionHeading
          title="契約の要確認"
          caption="台帳とStripeの食い違い。宙に浮いた契約や区分ズレを早期に発見。"
          help="常時はローカルの矛盾（課金中なのに顧客IDなし等）を表示。「Stripeと照合」でStripe側にだけある契約（未ログイン決済など）も洗います。"
          className="mb-0"
        />
        <button
          type="button"
          onClick={runReconcile}
          disabled={loading}
          className="shrink-0 inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          Stripeと照合
        </button>
      </div>

      <div className="mt-2 space-y-1.5">
        {issues.length === 0 && !recon && (
          <p className="text-xs text-gray-400 dark:text-gray-500 inline-flex items-center gap-1">
            <ShieldAlert className="w-3.5 h-3.5 text-emerald-500" aria-hidden />
            ローカルの矛盾は見つかりません
          </p>
        )}
        {issues.map((it) => (
          <div key={it.userId} className="text-xs flex items-baseline gap-2">
            <span className="text-amber-600 dark:text-amber-400 shrink-0">●</span>
            <span className="text-gray-700 dark:text-gray-200 truncate">{it.email ?? it.userId}</span>
            <span className="text-gray-400 dark:text-gray-500 ml-auto shrink-0">{it.reason}</span>
          </div>
        ))}
      </div>

      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {recon && (
        <div className="mt-3 border-t border-gray-100 dark:border-gray-700 pt-2 space-y-1.5">
          {!recon.stripeConfigured && <p className="text-xs text-gray-400">Stripe未設定のため照合をスキップしました。</p>}
          {recon.stripeConfigured && recon.orphanStripe.length === 0 && recon.staleLocal.length === 0 && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">Stripeとの食い違いはありません。</p>
          )}
          {recon.orphanStripe.map((o) => (
            <div key={o.subscriptionId} className="text-xs flex items-baseline gap-2">
              <span className="text-red-500 shrink-0">▲</span>
              <span className="text-gray-700 dark:text-gray-200 truncate">{o.subscriptionId}（{o.status}）</span>
              <a
                href={`https://dashboard.stripe.com/customers/${o.customer}`}
                target="_blank" rel="noopener noreferrer"
                className="ml-auto shrink-0 text-brand-600 dark:text-brand-400 hover:underline"
              >
                Stripeで開く
              </a>
            </div>
          ))}
          {recon.orphanStripe.length > 0 && (
            <p className="text-[11px] text-gray-400 dark:text-gray-500">▲ Stripeに契約があるのに台帳に無い（未ログイン決済など）。要対応。</p>
          )}
          {recon.staleLocal.map((s) => (
            <div key={s.userId} className="text-xs flex items-baseline gap-2">
              <span className="text-amber-500 shrink-0">●</span>
              <span className="text-gray-700 dark:text-gray-200 truncate">{s.email ?? s.userId}</span>
              <span className="text-gray-400 dark:text-gray-500 ml-auto shrink-0">台帳はactiveだがStripeに有効契約なし</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function AnomalyPanel({ signals }: { signals: AnomalySignal[] }) {
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <SectionHeading
        title="気になる兆候"
        caption="乱用・botの可能性がある兆候。※確定ではなく手がかりです。"
        help="登録時にIP等を保存していないため、同一人物や重複アカウントの断定はできません。ここは調査のきっかけとなる「兆候」の一覧です。"
      />
      <div className="mt-1 space-y-1.5">
        {signals.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500">特筆すべき兆候はありません。</p>
        )}
        {signals.map((s) => (
          <div key={s.key} className="text-xs">
            <div className="flex items-baseline gap-2">
              <AlertTriangle className={`w-3.5 h-3.5 shrink-0 ${s.level === 'watch' ? 'text-amber-500' : 'text-gray-400'}`} aria-hidden />
              <span className="text-gray-700 dark:text-gray-200">{s.label}</span>
              <span className="ml-auto shrink-0 font-semibold text-gray-800 dark:text-gray-100">{s.count}</span>
            </div>
            <p className="pl-5 text-[11px] text-gray-400 dark:text-gray-500">{s.hint}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

const ACTION_LABEL: Record<string, string> = {
  grant_comp: '永続無料を付与', revoke_comp: '永続無料を取消', delete_user: 'アカウント削除',
  set_monitor: 'モニター指定', unset_monitor: 'モニター解除', export_csv: 'CSV出力',
}

export function AuditLogSection({
  log,
}: {
  log: { action: string; actorEmail: string; targetEmail: string | null; createdAt: string }[]
}) {
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 mb-4">
      <SectionHeading
        title="操作履歴（最近50件）"
        caption="台帳での付与/取消/削除/モニター指定/CSV出力の記録。誤操作・不正の証跡。"
        help="admin_audit_log（サーバーのみ書込・append-only）。表示が空の場合はまだ記録が無いか、テーブル(0011)の適用待ちです。"
      />
      <div className="mt-1 space-y-1">
        {log.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500 inline-flex items-center gap-1">
            <ScrollText className="w-3.5 h-3.5" aria-hidden />
            まだ記録がありません（またはテーブル適用待ち）
          </p>
        )}
        {log.map((e, i) => (
          <div key={`${e.createdAt}-${i}`} className="text-xs flex items-baseline gap-2">
            <span className="text-gray-400 dark:text-gray-500 shrink-0 tabular-nums">
              {e.createdAt.slice(5, 16).replace('T', ' ')}
            </span>
            <span className="text-gray-700 dark:text-gray-200 shrink-0">{ACTION_LABEL[e.action] ?? e.action}</span>
            <span className="text-gray-500 dark:text-gray-400 truncate">{e.targetEmail ?? ''}</span>
            <span className="ml-auto shrink-0 text-gray-400 dark:text-gray-500 truncate max-w-[40%]">{e.actorEmail}</span>
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: AdminLedgerClient に型・import・状態を追加**

import 群に:

```tsx
import { ContractIssuesPanel, AnomalyPanel, AuditLogSection } from './SafetyPanels'
import { maskEmail, detectLocalContractIssues, detectAnomalySignals } from '@/lib/ledger-safety'
import { Eye, EyeOff } from 'lucide-react'
```

`auditLog` の state と受け取り（既存の `lpDaily` などと同様に）。まず型を宣言し、GETのfetch結果から取り込む:

```tsx
  const [auditLog, setAuditLog] = useState<
    { action: string; actorEmail: string; targetEmail: string | null; createdAt: string }[]
  >([])
  const [maskEmails, setMaskEmails] = useState(false)
```

データ取得（`setLpDaily(...)` の並び）に:

```tsx
      setAuditLog(Array.isArray(data.auditLog) ? data.auditLog : [])
```

- [ ] **Step 3: 派生（issues / anomalies）を useMemo で**

`counts` などの近くに:

```tsx
  const contractIssues = useMemo(
    () =>
      detectLocalContractIssues(
        (rows ?? []).map((r) => ({
          userId: r.userId,
          email: r.email,
          kind: r.kind,
          status: r.status,
          plan: r.plan,
          hasStripe: r.hasStripe,
        }))
      ),
    [rows]
  )
  const anomalies = useMemo(
    () =>
      detectAnomalySignals(
        (rows ?? []).map((r) => ({
          email: r.email,
          kind: r.kind,
          referralCount: r.referralCount,
          premiumUsedAt: r.premiumUsedAt,
          trialEndsAt: r.trialEndsAt,
          createdAt: r.createdAt,
        })),
        Date.now()
      ),
    [rows]
  )
```

- [ ] **Step 4: CSV出力に確認ダイアログ＋監査記録**

`downloadCsv`（`:423`）の本体先頭に確認を追加し、成功後に監査POST。関数の冒頭:

```tsx
  const downloadCsv = useCallback(() => {
    if (!window.confirm('個人情報（メールアドレス等）を含むCSVを出力します。取り扱いに注意してください。続けますか？')) {
      return
    }
    // …既存のCSV生成・ダウンロード処理…
    // ダウンロード実行後に監査記録（best-effort）:
    void fetch('/api/admin/ledger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'audit', event: 'export_csv', detail: { count: (rows ?? []).length } }),
    }).catch(() => {})
  }, [rows /* 既存の依存に合わせる */])
```
※ 既存の `downloadCsv` の中身は保持し、先頭に confirm、末尾（ダウンロードのトリガ後）に監査POSTを足すだけ。依存配列は既存を尊重しつつ `rows` を含める。

- [ ] **Step 5: メールマスクのトグルとテーブル反映**

ツールバー（CSV/更新ボタンの並び）に「メールを隠す」トグルを追加:

```tsx
              <button
                type="button"
                onClick={() => setMaskEmails((v) => !v)}
                className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                title={maskEmails ? 'メールを表示する' : 'メールを隠す（スクショ・共有時の保護）'}
              >
                {maskEmails ? <Eye className="w-3.5 h-3.5" aria-hidden /> : <EyeOff className="w-3.5 h-3.5" aria-hidden />}
                {maskEmails ? '表示' : '隠す'}
              </button>
```

テーブルのメール表示箇所（行の email 描画）を、マスク時に `maskEmail(r.email)` を使うよう変更:

```tsx
{maskEmails ? maskEmail(r.email) : (r.email ?? '（メール不明）')}
```
※ 紹介ランキングのメール等、他の生表示箇所も同トグルに追随させるとより安全（実装時に台帳内のメール描画を洗い、`maskEmails` を反映）。

- [ ] **Step 6: パネルを配置**

テーブルの手前（区分サマリー／紹介ランキングの後、検索の前あたり）に安全サマリーを2枚:

```tsx
            <div className="grid gap-3 mb-4 lg:grid-cols-2">
              <ContractIssuesPanel issues={contractIssues} />
              <AnomalyPanel signals={anomalies} />
            </div>
```

操作履歴はページ最下部（既存の長い注釈ブロックの下）に:

```tsx
            <AuditLogSection log={auditLog} />
```

- [ ] **Step 7: 型チェック＋テスト**

Run: `cd ~/medical-search-public && npx tsc --noEmit && npx vitest run`
Expected: エラーなし・全テストPASS

- [ ] **Step 8: Commit**

```bash
cd ~/medical-search-public
git add src/app/admin/SafetyPanels.tsx src/app/admin/AdminLedgerClient.tsx
git commit -m "feat(admin): 安全パネル（契約要確認/気になる兆候/操作履歴）＋メールマスク＋CSV確認

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: 検証・デプロイ・migration適用の案内

- [ ] **Step 1: ビルドと全テスト**

Run: `cd ~/medical-search-public && npx vitest run && npm run build`
Expected: 全テストPASS・ビルド成功

- [ ] **Step 2: デプロイ**

```bash
cd ~/medical-search-public && git push origin main
```

- [ ] **Step 3: migration 0011 の手動適用を案内**

Supabase SQL Editor（ダッシュボード直リンク）で `supabase/migrations/0011_admin_audit_log.sql` を実行するようユーザーに依頼。適用URL: `https://supabase.com/dashboard/project/_/sql/new`（該当プロジェクトを選択）。適用前でも台帳は動作し、操作履歴は「適用待ち」表示。適用後、以降の操作から記録が貯まる。

- [ ] **Step 4: 動作確認の依頼**

本番 `/admin` を管理者ログインで開き、契約の要確認／気になる兆候／操作履歴の3ブロックと「隠す」トグル、CSV確認ダイアログが出ることを確認してもらう。「Stripeと照合」を1回押して結果が返ることも確認。

---

## Self-Review 結果

- **スペック網羅**: 機能1（監査=Task1,3,4）／機能2（Stripe=Task2,3,4）／機能3（異常兆候=Task2,4）／機能4（マスク＋CSV=Task2,4）すべてタスク化。✅
- **プレースホルダ**: 実装差し込み箇所は「実ファイルに合わせる」と明記（revoke/CSV中身/メール描画の洗い出し）。コード本体は実体記載。✅
- **型整合**: `ContractIssue/AnomalySignal/Reconciliation/StripeSub` は Task2 定義と Task3,4 消費で一致。`auth.email`（requireAdmin）と `logAdminAction` の actorEmail が一貫。✅
- **後方互換**: POST は `action` 未指定＝従来の付与。既存の安全弁は保持。✅
- **既知の割り切り**: 異常兆候はヒューリスティック（IP未保存のため重複断定不可・UIに明記）。監査は best-effort（テーブル未適用でも主アクションを止めない）。
