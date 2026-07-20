# アカウント台帳 スペック① 実装計画（説明レイヤー＋マーケ可視化）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** アカウント台帳の各セクションに説明（常時キャプション＋「?」定義）を足し、マーケ判断用の4枚（転換率ファネル／トライアル→課金＆解約率／流入元ごとの質／売上MRR）を既存データの派生で追加する。

**Architecture:** 集計は純関数 `src/lib/ledger-metrics.ts` に切り出してユニットテスト。UIは小部品（`SectionHeading` / `MarketingCards`）に分離。`/api/admin/ledger` は既存レスポンスに読み取り2フィールド（`hasStripe`, `subCreatedAt`）を足すのみ。閲覧専用・ミューテーション経路には触れない。

**Tech Stack:** Next.js(app router) / React / TypeScript / Tailwind / vitest / lucide-react。グラフは外部ライブラリ不使用（既存方針踏襲）。

## Global Constraints

- 区分定義は `src/lib/member-ledger.ts` の `MemberKind`（`admin/comp/premium/stripe_trial/trial/auto_trial/expired/free`）に準拠。
- **課金** = `kind==='premium'` のみ。**無料トライアル** = `premium` を除く `stripe_trial/trial/auto_trial`。**課金からの解約** = `kind==='expired' かつ hasStripe`。
- プレミアム単価 = **980円/月**（税込・単一プラン）。
- 認証（`requireAdmin` メールallowlist）・`noindex`・既存のtry/catch（未適用テーブルは空で続行）方針は変更しない。
- テストランナーは `npx vitest run <path>`。コミットは日本語メッセージ、末尾に `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`。
- ブランチは `main`。デプロイは push で自動反映（最終タスクまでは push しない）。

---

### Task 1: API に `hasStripe` / `subCreatedAt` を足す

閲覧派生に必要な2フィールドを行に追加する。`stripe_customer_id` 実値は漏らさず boolean のみ露出。

**Files:**
- Modify: `src/app/api/admin/ledger/route.ts:49`（subscriptions select に `created_at` 追加）
- Modify: `src/app/api/admin/ledger/route.ts:199-229`（row に2フィールド追加）

- [ ] **Step 1: subscriptions の select に created_at を足す**

`route.ts:49` を次に変更:

```ts
      .select('user_id, plan, status, trial_ends_at, current_period_end, stripe_customer_id, updated_at, created_at')
```

- [ ] **Step 2: row に hasStripe と subCreatedAt を足す**

`route.ts` の `return { ... }`（`isMonitor` の直後、`:228` あたり）に追加:

```ts
          isMonitor: u.user_metadata?.is_monitor === true,
          // 課金からの解約（churn）判定用。Stripe顧客に紐づくかだけを boolean で（IDは出さない）。
          hasStripe: !!summary?.stripe_customer_id,
          // MRRの月次推移用。サブスク行の作成時刻（無ければ null）。
          subCreatedAt: (s?.created_at as string | undefined) ?? null,
```

- [ ] **Step 3: 型チェックが通ることを確認**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし（`s.created_at` は select に足したので型に乗る）

- [ ] **Step 4: Commit**

```bash
cd ~/medical-search-public
git add src/app/api/admin/ledger/route.ts
git commit -m "feat(admin): 台帳APIに hasStripe / subCreatedAt を追加（解約率・MRR推移用）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: 集計の純関数 `ledger-metrics.ts`（TDD）

**Files:**
- Create: `src/lib/ledger-metrics.ts`
- Test: `src/lib/__tests__/ledger-metrics.test.ts`

**Interfaces:**
- Produces:
  - `pct(part:number, whole:number): number` — 小数第1位までの%。whole≤0で0。
  - `computeFunnel(input:{lpVisits,registered,trialStarted,paying}): FunnelStage[]`（`FunnelStage={label:string;count:number;pct:number|null}`）
  - `countTrialStarted(rows:{kind:MemberKind}[]): number`
  - `computeRetention(rows:{kind:MemberKind;hasStripe:boolean}[]): Retention`（`Retention={payingActive,churnedPaying,trialToPaying,churn}`、率は0..1）
  - `computeSourceQuality(rows:{source:string;kind:MemberKind}[]): SourceQuality[]`（`SourceQuality={source,registered,trial,paying,cvr}`）
  - `computeRevenue(rows:{kind:MemberKind;subCreatedAt:string|null}[], unitPrice:number): Revenue`（`Revenue={payingCount,mrr,arr,monthly:{month,count}[]}`）
  - `PREMIUM_MONTHLY_JPY = 980`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/ledger-metrics.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  pct,
  computeFunnel,
  countTrialStarted,
  computeRetention,
  computeSourceQuality,
  computeRevenue,
  PREMIUM_MONTHLY_JPY,
} from '../ledger-metrics'

describe('pct', () => {
  it('小数第1位まで返す', () => expect(pct(1, 3)).toBe(33.3))
  it('母数0は0', () => expect(pct(5, 0)).toBe(0))
})

describe('computeFunnel', () => {
  it('各段の人数と前段比%を返す（先頭はnull）', () => {
    const f = computeFunnel({ lpVisits: 200, registered: 50, trialStarted: 40, paying: 10 })
    expect(f.map((s) => s.count)).toEqual([200, 50, 40, 10])
    expect(f[0].pct).toBeNull()
    expect(f[1].pct).toBe(25) // 50/200
    expect(f[2].pct).toBe(80) // 40/50
    expect(f[3].pct).toBe(25) // 10/40
  })
  it('LP訪問0なら登録段の%はnull（ゼロ除算回避）', () => {
    const f = computeFunnel({ lpVisits: 0, registered: 3, trialStarted: 2, paying: 1 })
    expect(f[1].pct).toBeNull()
  })
})

describe('countTrialStarted', () => {
  it('premium/stripe_trial/trial/auto_trial を試用済みとして数える', () => {
    const rows = [
      { kind: 'premium' as const },
      { kind: 'stripe_trial' as const },
      { kind: 'trial' as const },
      { kind: 'auto_trial' as const },
      { kind: 'free' as const },
      { kind: 'expired' as const },
    ]
    expect(countTrialStarted(rows)).toBe(4)
  })
})

describe('computeRetention', () => {
  it('解約率＝課金解約/(課金中+課金解約)、転換率＝課金中/試用母集団', () => {
    const rows = [
      { kind: 'premium' as const, hasStripe: true }, // 課金中
      { kind: 'premium' as const, hasStripe: true }, // 課金中
      { kind: 'expired' as const, hasStripe: true }, // 課金からの解約
      { kind: 'expired' as const, hasStripe: false }, // 無料トライアル失効（churn対象外）
      { kind: 'trial' as const, hasStripe: false }, // 試用中
    ]
    const r = computeRetention(rows)
    expect(r.payingActive).toBe(2)
    expect(r.churnedPaying).toBe(1)
    expect(r.churn).toBeCloseTo(1 / 3) // 1/(2+1)
    // 試用母集団 = premium2 + trial1 + churnedPaying1 = 4、課金中2
    expect(r.trialToPaying).toBeCloseTo(2 / 4)
  })
  it('母数0でゼロ除算しない', () => {
    const r = computeRetention([{ kind: 'free' as const, hasStripe: false }])
    expect(r.churn).toBe(0)
    expect(r.trialToPaying).toBe(0)
  })
})

describe('computeSourceQuality', () => {
  it('流入元別に登録/試用/課金/CVRを集計し登録数降順', () => {
    const rows = [
      { source: 'x', kind: 'premium' as const },
      { source: 'x', kind: 'trial' as const },
      { source: 'x', kind: 'free' as const },
      { source: 'note', kind: 'free' as const },
    ]
    const q = computeSourceQuality(rows)
    expect(q[0].source).toBe('x') // 登録3で先頭
    expect(q[0]).toMatchObject({ registered: 3, trial: 1, paying: 1 })
    expect(q[0].cvr).toBeCloseTo(33.3) // 1/3
    expect(q[1]).toMatchObject({ source: 'note', registered: 1, paying: 0, cvr: 0 })
  })
})

describe('computeRevenue', () => {
  it('MRR=課金者×単価、ARR=×12、月次は累積', () => {
    const rows = [
      { kind: 'premium' as const, subCreatedAt: '2026-06-10T00:00:00Z' },
      { kind: 'premium' as const, subCreatedAt: '2026-07-02T00:00:00Z' },
      { kind: 'premium' as const, subCreatedAt: '2026-07-20T00:00:00Z' },
      { kind: 'stripe_trial' as const, subCreatedAt: '2026-07-01T00:00:00Z' }, // 課金でない
      { kind: 'expired' as const, subCreatedAt: null },
    ]
    const r = computeRevenue(rows, PREMIUM_MONTHLY_JPY)
    expect(r.payingCount).toBe(3)
    expect(r.mrr).toBe(3 * 980)
    expect(r.arr).toBe(3 * 980 * 12)
    expect(r.monthly).toEqual([
      { month: '2026-06', count: 1 },
      { month: '2026-07', count: 3 },
    ])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/ledger-metrics.test.ts`
Expected: FAIL（`ledger-metrics` が存在しない）

- [ ] **Step 3: 実装を書く**

`src/lib/ledger-metrics.ts`:

```ts
// 台帳のマーケ指標（転換率ファネル・継続/解約・流入元の質・売上）。
// すべて既存の /api/admin/ledger レスポンスから派生する純関数。テスト対象。
import type { MemberKind } from './member-ledger'

// プレミアムは単一プラン月額980円（税込）。
export const PREMIUM_MONTHLY_JPY = 980

// 「一度でも試用/課金に至った」区分。課金中(premium)も試用は済んでいるため含む。
const TRIAL_OR_PAID: MemberKind[] = ['premium', 'stripe_trial', 'trial', 'auto_trial']

// 小数第1位までの百分率。母数が0以下なら0を返す（ゼロ除算回避）。
export function pct(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 1000) / 10
}

export type FunnelStage = { label: string; count: number; pct: number | null }

export function computeFunnel(input: {
  lpVisits: number
  registered: number
  trialStarted: number
  paying: number
}): FunnelStage[] {
  const { lpVisits, registered, trialStarted, paying } = input
  return [
    { label: 'LP訪問', count: lpVisits, pct: null },
    { label: '登録', count: registered, pct: lpVisits > 0 ? pct(registered, lpVisits) : null },
    { label: 'トライアル開始', count: trialStarted, pct: pct(trialStarted, registered) },
    { label: '課金', count: paying, pct: pct(paying, trialStarted) },
  ]
}

export function countTrialStarted(rows: { kind: MemberKind }[]): number {
  return rows.filter((r) => TRIAL_OR_PAID.includes(r.kind)).length
}

export type Retention = {
  payingActive: number
  churnedPaying: number
  trialToPaying: number // 0..1
  churn: number // 0..1
}

export function computeRetention(rows: { kind: MemberKind; hasStripe: boolean }[]): Retention {
  const payingActive = rows.filter((r) => r.kind === 'premium').length
  const churnedPaying = rows.filter((r) => r.kind === 'expired' && r.hasStripe).length
  // 試用母集団 = 現在 試用/課金中 の全員（premium含む）＋ 課金から解約した人。
  const trialPool = rows.filter((r) => TRIAL_OR_PAID.includes(r.kind)).length + churnedPaying
  const trialToPaying = trialPool > 0 ? payingActive / trialPool : 0
  const denom = payingActive + churnedPaying
  const churn = denom > 0 ? churnedPaying / denom : 0
  return { payingActive, churnedPaying, trialToPaying, churn }
}

export type SourceQuality = {
  source: string
  registered: number
  trial: number
  paying: number
  cvr: number // paying/registered %
}

export function computeSourceQuality(
  rows: { source: string; kind: MemberKind }[]
): SourceQuality[] {
  const map = new Map<string, { registered: number; trial: number; paying: number }>()
  for (const r of rows) {
    const cur = map.get(r.source) ?? { registered: 0, trial: 0, paying: 0 }
    cur.registered += 1
    if (r.kind === 'premium') cur.paying += 1
    else if (TRIAL_OR_PAID.includes(r.kind)) cur.trial += 1
    map.set(r.source, cur)
  }
  return [...map.entries()]
    .map(([source, v]) => ({ source, ...v, cvr: pct(v.paying, v.registered) }))
    .sort((a, b) => b.registered - a.registered)
}

export type Revenue = {
  payingCount: number
  mrr: number
  arr: number
  monthly: Array<{ month: string; count: number }> // 課金開始の累積（YYYY-MM）
}

export function computeRevenue(
  rows: { kind: MemberKind; subCreatedAt: string | null }[],
  unitPrice: number
): Revenue {
  const paying = rows.filter((r) => r.kind === 'premium')
  const byMonth = new Map<string, number>()
  for (const r of paying) {
    if (!r.subCreatedAt) continue
    const m = r.subCreatedAt.slice(0, 7)
    byMonth.set(m, (byMonth.get(m) ?? 0) + 1)
  }
  let acc = 0
  const monthly = [...byMonth.keys()]
    .sort()
    .map((month) => {
      acc += byMonth.get(month)!
      return { month, count: acc }
    })
  const payingCount = paying.length
  return { payingCount, mrr: payingCount * unitPrice, arr: payingCount * unitPrice * 12, monthly }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/ledger-metrics.test.ts`
Expected: PASS（全ケース green）

- [ ] **Step 5: Commit**

```bash
cd ~/medical-search-public
git add src/lib/ledger-metrics.ts src/lib/__tests__/ledger-metrics.test.ts
git commit -m "feat(admin): 台帳マーケ指標の純関数（ファネル/継続/流入元の質/MRR）＋テスト

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: 説明部品 `SectionHeading` ＋ `InfoPopover`

見出し＋常時キャプション＋「?」定義（ホバー＆タップ両対応）。

**Files:**
- Create: `src/app/admin/SectionHeading.tsx`

- [ ] **Step 1: 部品を書く**

`src/app/admin/SectionHeading.tsx`:

```tsx
'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { HelpCircle } from 'lucide-react'

// 見出し＋常時キャプション＋「?」定義。既存の h2（text-sm font-semibold）に合わせた見た目。
export function SectionHeading({
  title,
  caption,
  help,
  className = '',
}: {
  title: string
  caption?: string
  help?: ReactNode
  className?: string
}) {
  return (
    <div className={`mb-2 ${className}`}>
      <div className="flex items-center gap-1.5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</h2>
        {help && <InfoPopover>{help}</InfoPopover>}
      </div>
      {caption && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 leading-snug">{caption}</p>
      )}
    </div>
  )
}

// 「?」アイコン。PCはホバー、スマホはタップで開く（title属性頼みにしない）。
export function InfoPopover({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  return (
    <span
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="この指標の説明"
        onClick={() => setOpen((v) => !v)}
        className="text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400"
      >
        <HelpCircle className="w-3.5 h-3.5" aria-hidden />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-5 z-30 w-60 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 p-2.5 text-[11px] leading-relaxed text-gray-600 dark:text-gray-300 shadow-lg"
        >
          {children}
        </span>
      )}
    </span>
  )
}
```

- [ ] **Step 2: 型チェック**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: Commit**

```bash
cd ~/medical-search-public
git add src/app/admin/SectionHeading.tsx
git commit -m "feat(admin): 説明部品 SectionHeading / InfoPopover（キャプション＋?定義）

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: 既存セクションとKPIカードに説明を付ける

`SectionHeading` を既存の裸 `<h2>` に差し替え、KPIカードに「?」定義を足す。

**Files:**
- Modify: `src/app/admin/AdminLedgerClient.tsx`（import追加・KpiCard拡張・見出し差し替え）

**Interfaces:**
- Consumes: `SectionHeading`（Task 3）

- [ ] **Step 1: import と KpiCard に help を足す**

`AdminLedgerClient.tsx` の import 群（`:48` 付近、AdminCharts import の下）に追加:

```tsx
import { SectionHeading, InfoPopover } from './SectionHeading'
```

`KpiCard`（`:191-203`）の props と描画を拡張:

```tsx
function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  highlight = false,
  help,
}: {
  icon: typeof Users
  label: string
  value: number
  sub?: string
  highlight?: boolean
  help?: React.ReactNode
}) {
```

そして `:212-215` のラベル行に「?」を追加:

```tsx
      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mb-1">
        <Icon className={`w-3.5 h-3.5 ${highlight ? 'text-brand-600 dark:text-brand-400' : ''}`} aria-hidden />
        {label}
        {help && <InfoPopover>{help}</InfoPopover>}
      </div>
```

- [ ] **Step 2: 6枚のKPIカードに定義を渡す**

`:730-745` の各 `<KpiCard .../>` に `help` を追加:

```tsx
              <KpiCard icon={Users} label="登録者数" value={rows.length} sub={newLast7d > 0 ? `直近7日 +${newLast7d}人` : '直近7日 +0人'} help="auth.usersの全アカウント数。管理者・本人・モニターも含む総登録数です。" />
              <KpiCard icon={Activity} label="週間アクティブ" value={activity.wau} sub="7日以内に利用形跡" highlight help="直近7日にアプリ利用（app_usage）の記録がある人数（WAU）。" />
              <KpiCard icon={Activity} label="月間アクティブ" value={activity.mau} sub="30日以内（参考）" help="直近30日に利用記録がある人数（MAU・参考値）。" />
              <KpiCard
                icon={Crown}
                label="サブスク中（課金）"
                value={counts.premium}
                sub={`カード登録トライアル ${counts.stripe_trial}人`}
                help="Stripeで実際に課金中（premium）の人数。カード登録済みの無料トライアル中（stripe_trial）は下段に別カウントで併記しています。"
              />
              <KpiCard
                icon={Hourglass}
                label="無料トライアル中"
                value={counts.auto_trial + counts.trial}
                sub={`自動 ${counts.auto_trial}・コード ${counts.trial}人`}
                help="カード登録なしの無料トライアル。自動＝登録時の3日間、コード＝招待/noteコード経由。期限で自動失効します。"
              />
              <KpiCard icon={UserPlus} label="友達紹介で開始" value={referredCount || referralTotal} sub={topReferrers.length > 0 ? `${topReferrers.length}人が招待してくれた` : '紹介コード経由の累計'} help="referral_redemptions経由（友達紹介コード）で登録した人数の累計です。" />
```

- [ ] **Step 3: 既存セクション見出しを SectionHeading に差し替え**

対象の裸 `<h2 className="text-sm font-semibold ...">…</h2>` を `SectionHeading` に置換する（キャプション＋定義を付与）。差し替え箇所と内容:

`:788`「日別アクティブ数」:
```tsx
                <SectionHeading title="日別アクティブ数（直近30日）" caption="その日にアプリを使った人数（ユニーク）。棒が高い日ほど利用が多い。" help="app_usage_daily の日別ユニーク数。同じ人が複数回使っても1人として数えます。" />
```

`:796`「利用時間帯」:
```tsx
                <SectionHeading title="利用時間帯（直近30日・日本時間）" caption="1日のうち何時ごろ使われているか。告知や配信のタイミングの参考に。" help="直近30日の利用を日本時間の時間帯別に合計したもの（app_usage_hourly）。" />
```

`:800`「最終利用の内訳」:
```tsx
                <SectionHeading title="最終利用の内訳" caption="登録者を「最後に使ったのはいつか」で分けたもの。定着度の目安。" help="最終利用・最終ログイン・設定同期の最新値で判定。7日以内／8〜30日／31日以上／形跡なし に分類します。" />
```

`:808`「流入元の割合」（脚注 `:810-812` は残す。h2のみ差し替え）:
```tsx
                <SectionHeading title="流入元の割合" caption="登録者がどの経路（X/note/LINE等）から来たかの内訳。" help="各行の実効的な流入元の割合。公開前の登録者はモニター/本人に自動振り分けされます（下の注記参照）。" />
```

`:815`「セットアップ状況」:
```tsx
                <SectionHeading title="セットアップ状況" caption="初期設定が完了/途中/未計測のどれか。途中なら離脱位置も下に出ます。" help="SetupWizard の到達ステップ（onb_furthest）で判定。「完了」は同期まで到達した人です。" />
```

`:825`「使う知識の選択」:
```tsx
                <SectionHeading title="使う知識の選択（複数選択可・記録がある人のみ）" caption="セットアップで選んだ知識ソース。専門医/自分/みんなの何を求めているか。" help="オンボーディングの選択（onb_targets）。複数選択可のため合計は人数と一致しません。" />
```

`:829`「接続モードとDB設定」:
```tsx
                <SectionHeading title="接続モードとDB設定（記録がある人のみ）" caption="シンプル/パワーの接続方式と、テンプレ複製/既存DB連携のどちらで入ったか。" help="onb_mode（接続モード）と onb_db_setup（DB設定の入り方）の内訳です。" />
```

`:840-842`「LP訪問」（`<h2>` 部分のみ差し替え、右側の件数 `<span>` はそのまま維持）:
```tsx
                <SectionHeading title="LP訪問（紹介ページ・登録の手前）" caption="登録の手前、紹介ページ（LP）を見た人の動き。登録者とは別集計の匿名カウント。" help="lp_visits（匿名の訪問計測）。個々の登録者とは紐付けできないため、あくまで登録前の到達量として見ます。" className="mb-0" />
```
※ この箇所は `<div className="flex items-baseline justify-between mb-3">` の中に h2 と span が並ぶ。h2 を SectionHeading（`className="mb-0"`）に置換し、span はそのまま残す。

区分サマリーチップの見出し（`:867` 付近、「区分ごとの人数」相当の見出し）も同様に:
```tsx
                <SectionHeading title="区分ごとの人数" caption="登録者を区分（課金/トライアル/無料/失効など）別に集計したバッジ。" help="member-ledger の区分定義に基づく内訳。0人の区分も薄く表示します。" />
```
（実際の見出し文言は現物に合わせる。裸h2をSectionHeadingに替え、caption/helpを付ければよい）

- [ ] **Step 4: 型チェック＋既存テスト**

Run: `cd ~/medical-search-public && npx tsc --noEmit && npx vitest run`
Expected: エラーなし・既存テスト PASS

- [ ] **Step 5: Commit**

```bash
cd ~/medical-search-public
git add src/app/admin/AdminLedgerClient.tsx
git commit -m "feat(admin): 各セクション＋KPIカードに説明（キャプション/?定義）を追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: マーケ4枚を追加（ファネル/継続/流入元の質/MRR）

**Files:**
- Create: `src/app/admin/MarketingCards.tsx`
- Modify: `src/app/admin/AdminLedgerClient.tsx`（派生useMemo＋配置＋import）

**Interfaces:**
- Consumes: Task 2 の `computeFunnel/computeRetention/computeSourceQuality/computeRevenue/countTrialStarted/PREMIUM_MONTHLY_JPY` と各型、`effectiveSource`（既存, `:124`）
- Produces: `FunnelCard/RetentionCard/SourceQualityTable/RevenueCard`

- [ ] **Step 1: 表示部品を書く**

`src/app/admin/MarketingCards.tsx`:

```tsx
'use client'
import type { ReactNode } from 'react'
import { SectionHeading } from './SectionHeading'
import type { FunnelStage, Retention, SourceQuality, Revenue } from '@/lib/ledger-metrics'

// 流入元キーの表示名（台帳の SOURCE_STYLE と揃える）。未知はそのまま。
const SOURCE_LABEL: Record<string, string> = {
  x: 'X', note: 'note', line: 'LINE', notion: 'Notion', lp: 'LP直接',
  direct: '直接', search: '検索', monitor: 'モニター', self: '本人', 未計測: '未計測',
}
function sourceLabel(s: string): string {
  return SOURCE_LABEL[s] ?? s
}

function Card({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      {children}
    </section>
  )
}

export function FunnelCard({ stages }: { stages: FunnelStage[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count))
  return (
    <Card>
      <SectionHeading
        title="転換率ファネル"
        caption="LP訪問→登録→トライアル→課金の流れ。各段の下に前段からの転換率。"
        help="LP訪問は匿名の直近30日カウントのため、LP→登録の比率は「訪問数ベースの概算」です。登録以降は同じ母集団の内訳なので正確。"
      />
      <div className="space-y-2 mt-1">
        {stages.map((s) => (
          <div key={s.label}>
            <div className="flex items-baseline justify-between text-xs mb-0.5">
              <span className="text-gray-600 dark:text-gray-300">{s.label}</span>
              <span className="font-semibold text-gray-800 dark:text-gray-100">
                {s.count.toLocaleString()}人
                {s.pct !== null && (
                  <span className="ml-1.5 text-[11px] font-normal text-brand-600 dark:text-brand-400">
                    前段の{s.pct}%
                  </span>
                )}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
              <div
                className="h-full rounded-full bg-brand-500 dark:bg-brand-400"
                style={{ width: `${Math.max(2, (s.count / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

export function RetentionCard({ r }: { r: Retention }) {
  return (
    <Card>
      <SectionHeading
        title="トライアル→課金 と 解約率"
        caption="試用した人のうち課金に至った割合と、課金者の解約割合。"
        help="現時点のスナップショット比です（subscriptionsは履歴を持たないため期間コホートではありません）。解約＝Stripe課金からの失効。"
      />
      <div className="grid grid-cols-2 gap-3 mt-1">
        <div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-none">
            {Math.round(r.trialToPaying * 1000) / 10}
            <span className="text-sm font-medium text-gray-400 ml-0.5">%</span>
          </div>
          <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
            試用→課金（課金{r.payingActive}人）
          </div>
        </div>
        <div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-none">
            {Math.round(r.churn * 1000) / 10}
            <span className="text-sm font-medium text-gray-400 ml-0.5">%</span>
          </div>
          <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
            解約率（解約{r.churnedPaying}人）
          </div>
        </div>
      </div>
    </Card>
  )
}

export function SourceQualityTable({ rows }: { rows: SourceQuality[] }) {
  return (
    <Card>
      <SectionHeading
        title="流入元ごとの質"
        caption="チャネル別に、登録が実際に課金まで至るか（CVR）。発信の意思決定材料に。"
        help="流入元＝各行の実効的な媒体。CVR＝課金/登録。登録数の多い順。試用は無料トライアル中（課金除く）の人数です。"
      />
      <div className="overflow-x-auto mt-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400 dark:text-gray-500 text-left">
              <th className="font-medium py-1 pr-2">流入元</th>
              <th className="font-medium py-1 px-2 text-right">登録</th>
              <th className="font-medium py-1 px-2 text-right">試用</th>
              <th className="font-medium py-1 px-2 text-right">課金</th>
              <th className="font-medium py-1 pl-2 text-right">CVR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.source} className="border-t border-gray-100 dark:border-gray-700">
                <td className="py-1 pr-2 text-gray-700 dark:text-gray-200">{sourceLabel(s.source)}</td>
                <td className="py-1 px-2 text-right tabular-nums text-gray-700 dark:text-gray-200">{s.registered}</td>
                <td className="py-1 px-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{s.trial}</td>
                <td className="py-1 px-2 text-right tabular-nums font-semibold text-gray-900 dark:text-gray-100">{s.paying}</td>
                <td className="py-1 pl-2 text-right tabular-nums text-brand-600 dark:text-brand-400">{s.cvr}%</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="py-3 text-center text-gray-400">蓄積待ち</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export function RevenueCard({ rev }: { rev: Revenue }) {
  const yen = (n: number) => `¥${n.toLocaleString()}`
  const max = Math.max(1, ...rev.monthly.map((m) => m.count))
  return (
    <Card>
      <SectionHeading
        title="売上（MRR / ARR）"
        caption="現在の課金者数から算出した月次・年次の経常収益。"
        help="MRR＝課金中（premium）×980円。ARR＝MRR×12。プレミアムは単一プラン月額980円税込。"
      />
      <div className="grid grid-cols-2 gap-3 mt-1">
        <div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-none">{yen(rev.mrr)}</div>
          <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">MRR（課金{rev.payingCount}人）</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-none">{yen(rev.arr)}</div>
          <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">ARR（年換算）</div>
        </div>
      </div>
      {rev.monthly.length >= 2 && (
        <div className="mt-3">
          <div className="text-[11px] text-gray-400 dark:text-gray-500 mb-1">課金者数の推移（累積）</div>
          <div className="flex items-end gap-1 h-12">
            {rev.monthly.map((m) => (
              <div key={m.month} className="flex-1 flex flex-col items-center justify-end" title={`${m.month}: ${m.count}人`}>
                <div className="w-full rounded-t bg-brand-400 dark:bg-brand-500" style={{ height: `${(m.count / max) * 100}%` }} />
                <div className="text-[9px] text-gray-400 mt-0.5">{m.month.slice(5)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
```

- [ ] **Step 2: LedgerRow 型に hasStripe / subCreatedAt を足す**

`AdminLedgerClient.tsx` の `LedgerRow`（`:71` の `isMonitor` 直後）に追加:

```tsx
  isMonitor: boolean
  hasStripe: boolean
  subCreatedAt: string | null
}
```

- [ ] **Step 3: import と派生useMemoを足す**

import に追加（AdminCharts import 群の下）:

```tsx
import { FunnelCard, RetentionCard, SourceQualityTable, RevenueCard } from './MarketingCards'
import {
  computeFunnel,
  computeRetention,
  computeSourceQuality,
  computeRevenue,
  countTrialStarted,
  PREMIUM_MONTHLY_JPY,
} from '@/lib/ledger-metrics'
```

派生useMemo（`counts`/`lpTotal` が定義された後、`:562` の `sourceSegments` の近くに追加）:

```tsx
  const funnel = useMemo(
    () =>
      computeFunnel({
        lpVisits: lpDaily.reduce((sum, p) => sum + p.count, 0),
        registered: (rows ?? []).length,
        trialStarted: countTrialStarted(rows ?? []),
        paying: counts.premium,
      }),
    [rows, lpDaily, counts.premium]
  )
  const retention = useMemo(
    () => computeRetention((rows ?? []).map((r) => ({ kind: r.kind, hasStripe: r.hasStripe }))),
    [rows]
  )
  const sourceQuality = useMemo(
    () =>
      computeSourceQuality(
        (rows ?? []).map((r) => ({ source: effectiveSource(r) ?? '未計測', kind: r.kind }))
      ),
    [rows]
  )
  const revenue = useMemo(
    () =>
      computeRevenue(
        (rows ?? []).map((r) => ({ kind: r.kind, subCreatedAt: r.subCreatedAt })),
        PREMIUM_MONTHLY_JPY
      ),
    [rows]
  )
```

- [ ] **Step 4: 配置する**

KPIカードグリッド（`:746` の閉じ `</div>` ）の直後に、経営サマリーの新グリッドを挿入:

```tsx
            {/* マーケ・経営サマリー: ファネル / 売上 / 継続 */}
            <div className="grid gap-3 mb-4 lg:grid-cols-2">
              <FunnelCard stages={funnel} />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <RevenueCard rev={revenue} />
                <RetentionCard r={retention} />
              </div>
            </div>
```

流入元の質は、既存「流入元の割合」セクション（`:813` の `</section>` ）の直後・同じ4枚グリッド内に追加:

```tsx
              <SourceQualityTable rows={sourceQuality} />
```

- [ ] **Step 5: 型チェック＋テスト**

Run: `cd ~/medical-search-public && npx tsc --noEmit && npx vitest run`
Expected: エラーなし・全テスト PASS

- [ ] **Step 6: Commit**

```bash
cd ~/medical-search-public
git add src/app/admin/MarketingCards.tsx src/app/admin/AdminLedgerClient.tsx
git commit -m "feat(admin): マーケ4枚（転換率ファネル/継続・解約/流入元の質/MRR）を追加

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: 検証とデプロイ

**Files:** なし（ビルド・ブラウザ確認・push）

- [ ] **Step 1: ビルドと全テスト**

Run: `cd ~/medical-search-public && npx vitest run && npm run build`
Expected: テスト全PASS・ビルド成功（型エラー・lintエラーなし）

- [ ] **Step 2: ローカルで /admin を目視確認**

`preview_start`（`.claude/launch.json` の dev サーバー名）→ `/admin` を開く。ログイン済み管理者で:
- KPIカードの「?」がホバー／タップで開くこと
- ファネル・MRR・継続・流入元の質の4枚が表示され、数字が破綻していない（NaN/Infinityが出ない）こと
- 各セクションにキャプションが出ていること
- `read_console_messages` でエラーが無いこと

問題があれば該当タスクに戻って修正し、再検証。

- [ ] **Step 3: デプロイ（main に push）**

```bash
cd ~/medical-search-public
git push origin main
```
push で本番自動反映（Vercel）。数分後に本番 `/admin` を開いて表示を最終確認する。

- [ ] **Step 4: 完了報告**

本番URLで4枚＋説明が出ていることを確認し、スペック②（安全管理）の設計に進むか確認する。

---

## Self-Review 結果

- **スペック網羅**: A（説明レイヤー=Task3,4）／B-1ファネル・B-2継続・B-3流入元の質・B-4 MRR（Task2,5）／API露出（Task1）すべてタスクに対応。✅
- **プレースホルダ**: なし（全コード実体を記載）。✅
- **型整合**: `FunnelStage/Retention/SourceQuality/Revenue` は Task2 定義とTask5 消費で一致。`hasStripe/subCreatedAt` は route(Task1)→型(Task5 Step2)→useMemo(Task5 Step3)で一貫。✅
- **既知の割り切り**: ファネルのLP訪問は直近30日・匿名（caption/helpに明記）。継続/解約はスナップショット比（明記）。MRR推移は`subCreatedAt`がある月のみ・2ヶ月未満は非表示。
