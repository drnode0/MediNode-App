# 「役に立った」リアクション＋閲覧回数の表示拡張 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プレミアムナレッジと解決済みCQに「役に立った」リアクション（1人1回・トグル・下限3の数表示）を付け、リーダー末尾に閲覧回数バッジも拡張表示する。

**Architecture:** 既存の「私も気になる」投票（cq_votes）と参照回数（cq_views）のパターンを忠実に複製する。新テーブル cq_reactions（service_role専用・RLSポリシーなし）＋トグルAPI＋バッチ取得API。UIはリーダー末尾（ReaderOverlay）と解決済みCQカード（ResolvedCqs）、adminは既存ランキングに列を足すだけ。

**Tech Stack:** Next.js App Router / Supabase (service_role) / vitest / lucide-react / Tailwind

**Spec:** `docs/superpowers/specs/2026-08-01-helpful-reactions-design.md`

## Global Constraints

- ボタン文言は「役に立った」／押した後「役に立った（済）」。アイコンは lucide `ThumbsUp`
- バッジ文言は「N人が役に立ったと言っています」。`HELPFUL_BADGE_MIN = 3` 未満は何も描かない
- 閲覧回数の文言は既存のまま「これまで N回 調べられています」、下限は既存 `VIEW_BADGE_MIN`（=10）を再利用
- 誰が押したかは公開面に一切返さない（返すのは合計数と「自分が押したか」だけ)
- 検索結果カード（ResultCard）には数字を出さない — 変更禁止
- 受付中の「私も気になる」（cq_votes）には触らない
- すべて best-effort: テーブル未適用・env未設定・通信失敗でも閲覧を妨げない
- コメントは日本語・「なぜ」を書く既存の作法に合わせる
- 作業ディレクトリ: `/Users/tatsukinonaka/medical-search-public.worktrees/helpful-reactions`（ブランチ feat/helpful-reactions）
- ベースライン既知の失敗: `admin-engagement-route.test.ts` の1件（深夜帯の日付境界フレーク・本機能と無関係）。これ以外の失敗を出さないこと
- コミットメッセージ末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: migration 0020 ＋ cq-helpful クライアントlib

**Files:**
- Create: `supabase/migrations/0020_cq_reactions.sql`
- Create: `src/lib/cq-helpful.ts`
- Test: `src/lib/__tests__/cq-helpful.test.ts`

**Interfaces:**
- Produces: `HELPFUL_BADGE_MIN: number` / `helpfulCountLabel(count: number): string` / `type HelpfulState = { counts: Record<string, number>; mine: string[] }` / `fetchHelpfulState(ids: string[]): Promise<HelpfulState>` / `toggleHelpful(objectId: string, helpful: boolean): Promise<{ helpful: boolean; count: number } | null>`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/cq-helpful.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { helpfulCountLabel, HELPFUL_BADGE_MIN } from '../cq-helpful'

describe('helpfulCountLabel', () => {
  it('下限未満（0〜2）は空文字＝何も描かない（寂しい数字を見せない）', () => {
    expect(helpfulCountLabel(0)).toBe('')
    expect(helpfulCountLabel(1)).toBe('')
    expect(helpfulCountLabel(HELPFUL_BADGE_MIN - 1)).toBe('')
  })

  it('下限以上は「N人が役に立ったと言っています」', () => {
    expect(helpfulCountLabel(3)).toBe('3人が役に立ったと言っています')
    expect(helpfulCountLabel(1234)).toBe('1234人が役に立ったと言っています')
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/lib/__tests__/cq-helpful.test.ts`
Expected: FAIL（`../cq-helpful` が存在しない）

- [ ] **Step 3: migration と lib を書く**

`supabase/migrations/0020_cq_reactions.sql`:

```sql
-- MediNode 「役に立った」リアクション（プレミアムナレッジ・解決済みCQ）。
-- cq_reactions: 1人1回（primary key で担保）・取り消し可（行の削除）。
-- object_id はサブスクIndexの objectID（ナレッジ/解決済みCQ共通のID空間）。
-- 誰がどれに押したかはサーバー（service_role）でのみ読み、公開面に返すのは
-- 「自分が押したか」と「合計何人か」だけ（他人の一覧は誰にも返さない）。
-- cq_votes（受付中の「私も気になる」）と同型。解決前=需要投票、解決後=評価と使い分ける。

create table if not exists public.cq_reactions (
  user_id    uuid not null,
  object_id  text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, object_id)
);

-- 一覧・リーダーは毎回「対象ごとの合計数」を引くので、object_id 側にも索引を張る。
create index if not exists cq_reactions_object_id_idx on public.cq_reactions (object_id);

alter table public.cq_reactions enable row level security;

-- 読み書きともサーバー（service_role）経由のみ。
-- anon / authenticated から直接触らせない（他人の反応を数えられないようにする）。
```

`src/lib/cq-helpful.ts`:

```ts
// 「役に立った」リアクション（プレミアムナレッジ・解決済みCQ）のクライアント側。
// - helpfulCountLabel: 下限方式のバッジ文言。HELPFUL_BADGE_MIN 未満は '' を返し何も描かない
//   （1〜2人の寂しい数字を見せない。cq-board の voteCountLabel・cq-views の下限と同じ思想）。
// - fetchHelpfulState: 一覧/リーダーに出す objectID 群の合計数と「自分が押したか」をまとめて取得。
// - toggleHelpful: 押す/取り消す。失敗時は null（呼び出し側で見た目を戻す）。

export const HELPFUL_BADGE_MIN = 3

export function helpfulCountLabel(count: number): string {
  return count >= HELPFUL_BADGE_MIN ? `${count}人が役に立ったと言っています` : ''
}

export type HelpfulState = { counts: Record<string, number>; mine: string[] }

export async function fetchHelpfulState(ids: string[]): Promise<HelpfulState> {
  const clean = ids.filter(Boolean)
  if (clean.length === 0) return { counts: {}, mine: [] }
  try {
    const res = await fetch(`/api/cq/helpfuls?ids=${encodeURIComponent(clean.join(','))}`)
    if (!res.ok) return { counts: {}, mine: [] }
    const data = (await res.json()) as { counts?: Record<string, number>; mine?: string[] }
    return { counts: data.counts || {}, mine: data.mine || [] }
  } catch {
    return { counts: {}, mine: [] }
  }
}

export async function toggleHelpful(
  objectId: string,
  helpful: boolean,
): Promise<{ helpful: boolean; count: number } | null> {
  try {
    const res = await fetch('/api/cq/helpful', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ objectId, helpful }),
    })
    if (!res.ok) return null
    const d = (await res.json()) as { helpful?: boolean; count?: number }
    if (typeof d.helpful !== 'boolean' || typeof d.count !== 'number') return null
    return { helpful: d.helpful, count: d.count }
  } catch {
    return null
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/__tests__/cq-helpful.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 5: コミット**

```bash
git add supabase/migrations/0020_cq_reactions.sql src/lib/cq-helpful.ts src/lib/__tests__/cq-helpful.test.ts
git commit -m "feat: 「役に立った」の器（cq_reactions migration＋クライアントlib）"
```

---

### Task 2: POST /api/cq/helpful（トグルAPI）

**Files:**
- Create: `src/app/api/cq/helpful/route.ts`
- Test: `src/lib/__tests__/cq-helpful-route.test.ts`

**Interfaces:**
- Consumes: なし（Task 1のテーブル定義に対応するだけ）
- Produces: `POST /api/cq/helpful` body `{ objectId: string, helpful: boolean }` → 200 `{ ok: true, helpful: boolean, count: number }`／401 `{ error: 'login_required' }`／403 `{ error: 'premium_required' }`

参考: 既存 `src/app/api/cq/vote/route.ts` を忠実に踏襲する（認証・レート制限・エラー文言の作法）。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/cq-helpful-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { premiumMock, adminClientMock } = vi.hoisted(() => ({
  premiumMock: vi.fn(),
  adminClientMock: vi.fn(),
}))
vi.mock('@/lib/premium-access', () => ({ resolveRequestPremium: premiumMock }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: adminClientMock }))
vi.mock('@/lib/rate-limit', () => ({ rateLimitAsync: vi.fn(async () => true) }))

import { POST } from '../../app/api/cq/helpful/route'

const post = (body: unknown) =>
  POST(new NextRequest('http://localhost/api/cq/helpful', { method: 'POST', body: JSON.stringify(body) }))

// from('cq_reactions') の薄いスタブ。upsert / delete の呼び出しを記録し、合計 count を返す。
function reactionsStub(count: number) {
  const upsert = vi.fn(async () => ({ error: null }))
  const deleteEqEq = vi.fn(async () => ({ error: null }))
  const del = vi.fn(() => ({ eq: () => ({ eq: deleteEqEq }) }))
  const stub = {
    from: (table: string) => {
      expect(table).toBe('cq_reactions')
      return {
        upsert,
        delete: del,
        select: () => ({ eq: async () => ({ count }) }),
      }
    },
  }
  return { stub, upsert, del }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
})

describe('POST /api/cq/helpful', () => {
  it('未ログインは401（DBに触らない）', async () => {
    premiumMock.mockResolvedValue({ premium: false, userId: null })
    const res = await post({ objectId: 'k1', helpful: true })
    expect(res.status).toBe(401)
    expect(adminClientMock).not.toHaveBeenCalled()
  })

  it('非プレミアムは403', async () => {
    premiumMock.mockResolvedValue({ premium: false, userId: 'u1' })
    const res = await post({ objectId: 'k1', helpful: true })
    expect(res.status).toBe(403)
  })

  it('objectId なしは400', async () => {
    premiumMock.mockResolvedValue({ premium: true, userId: 'u1' })
    const res = await post({ helpful: true })
    expect(res.status).toBe(400)
  })

  it('helpful=true で upsert し、最新の合計を返す', async () => {
    premiumMock.mockResolvedValue({ premium: true, userId: 'u1' })
    const { stub, upsert } = reactionsStub(4)
    adminClientMock.mockReturnValue(stub)
    const res = await post({ objectId: 'k1', helpful: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, helpful: true, count: 4 })
    expect(upsert).toHaveBeenCalledWith(
      { user_id: 'u1', object_id: 'k1' },
      { onConflict: 'user_id,object_id' },
    )
  })

  it('helpful=false で行を消し、最新の合計を返す', async () => {
    premiumMock.mockResolvedValue({ premium: true, userId: 'u1' })
    const { stub, del } = reactionsStub(2)
    adminClientMock.mockReturnValue(stub)
    const res = await post({ objectId: 'k1', helpful: false })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, helpful: false, count: 2 })
    expect(del).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/lib/__tests__/cq-helpful-route.test.ts`
Expected: FAIL（route が存在しない）

- [ ] **Step 3: route を書く**

`src/app/api/cq/helpful/route.ts`:

```ts
// 「役に立った」リアクションのトグル。
//
// POST /api/cq/helpful { objectId, helpful }
//   - 認証: ログイン＋プレミアム（本文を読める人だけが押せる。「私も気になる」投票と同じ線引き）
//   - helpful=true で付ける（既にあれば何もしない）／false で取り消す
//   - 戻り: { ok: true, helpful, count } … その対象の最新の合計数
//
// 誰が押したかは cq_reactions にのみ残り、他人には返さない（合計と自分の分だけ）。

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveRequestPremium } from '@/lib/premium-access'
import { rateLimitAsync } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabaseReady = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  if (!supabaseReady) {
    return NextResponse.json({ error: 'サーバー設定が不足しています' }, { status: 500 })
  }

  const { premium, userId } = await resolveRequestPremium()
  if (!userId) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 })
  }
  if (!premium) {
    return NextResponse.json({ error: 'premium_required' }, { status: 403 })
  }

  // 連打・スクリプトでの水増しを抑える（通常の利用は1日数回）。
  if (!(await rateLimitAsync(`cq-helpful:${userId}`, 120, 24 * 60 * 60_000))) {
    return NextResponse.json({ error: '操作が多すぎます。時間をおいてお試しください。' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'リクエストの形式が不正です。' }, { status: 400 })
  }
  const { objectId, helpful } = (body ?? {}) as { objectId?: unknown; helpful?: unknown }
  if (typeof objectId !== 'string' || !objectId.trim()) {
    return NextResponse.json({ error: '対象が指定されていません。' }, { status: 400 })
  }

  try {
    const admin = createAdminClient()
    if (helpful === true) {
      // 1人1回は primary key で担保。二重送信は上書きで無害に吸収する。
      await admin
        .from('cq_reactions')
        .upsert({ user_id: userId, object_id: objectId }, { onConflict: 'user_id,object_id' })
    } else {
      await admin.from('cq_reactions').delete().eq('user_id', userId).eq('object_id', objectId)
    }
    const { count } = await admin
      .from('cq_reactions')
      .select('object_id', { count: 'exact', head: true })
      .eq('object_id', objectId)
    return NextResponse.json({ ok: true, helpful: helpful === true, count: count ?? 0 })
  } catch {
    return NextResponse.json({ error: '記録できませんでした。時間をおいてお試しください。' }, { status: 500 })
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/__tests__/cq-helpful-route.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: コミット**

```bash
git add src/app/api/cq/helpful/route.ts src/lib/__tests__/cq-helpful-route.test.ts
git commit -m "feat: 「役に立った」トグルAPI（ログイン＋プレミアム・1人1回）"
```

---

### Task 3: GET /api/cq/helpfuls（バッチ取得API）

**Files:**
- Create: `src/app/api/cq/helpfuls/route.ts`
- Test: `src/lib/__tests__/cq-helpfuls-route.test.ts`

**Interfaces:**
- Produces: `GET /api/cq/helpfuls?ids=a,b,c` → 200 `{ counts: Record<string, number>, mine: string[] }`（mine はログイン時のみ中身が入る。失敗・未設定時は常に空の200）

参考: 既存 `src/app/api/cq/views/route.ts` を踏襲。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/cq-helpfuls-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { premiumMock, adminClientMock } = vi.hoisted(() => ({
  premiumMock: vi.fn(),
  adminClientMock: vi.fn(),
}))
vi.mock('@/lib/premium-access', () => ({ resolveRequestPremium: premiumMock }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: adminClientMock }))

import { GET } from '../../app/api/cq/helpfuls/route'

const get = (ids?: string) =>
  GET(new Request(`http://localhost/api/cq/helpfuls${ids !== undefined ? `?ids=${ids}` : ''}`))

// select('object_id, user_id').in(...) が rows を返す薄いスタブ。
function rowsStub(rows: Array<{ object_id: string; user_id: string }> | null, error: { message: string } | null = null) {
  return {
    from: (table: string) => {
      expect(table).toBe('cq_reactions')
      return { select: () => ({ in: async () => ({ data: rows, error }) }) }
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.local'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role'
  premiumMock.mockResolvedValue({ premium: false, userId: null })
})

describe('GET /api/cq/helpfuls', () => {
  it('counts は対象ごとの合計、mine は自分の分だけ', async () => {
    premiumMock.mockResolvedValue({ premium: true, userId: 'me' })
    adminClientMock.mockReturnValue(rowsStub([
      { object_id: 'a', user_id: 'me' },
      { object_id: 'a', user_id: 'other1' },
      { object_id: 'b', user_id: 'other2' },
    ]))
    const res = await get('a,b,c')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ counts: { a: 2, b: 1 }, mine: ['a'] })
  })

  it('未ログインでも counts は返る（mine は空）', async () => {
    adminClientMock.mockReturnValue(rowsStub([
      { object_id: 'a', user_id: 'other1' },
    ]))
    const body = await (await get('a')).json()
    expect(body).toEqual({ counts: { a: 1 }, mine: [] })
  })

  it('ids なし・空は空の200', async () => {
    expect(await (await get()).json()).toEqual({ counts: {}, mine: [] })
    expect(await (await get('')).json()).toEqual({ counts: {}, mine: [] })
    expect(adminClientMock).not.toHaveBeenCalled()
  })

  it('テーブル未適用などの失敗は空の200に劣化（バッジが出ないだけ）', async () => {
    adminClientMock.mockReturnValue(rowsStub(null, { message: 'no table' }))
    const res = await get('a')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ counts: {}, mine: [] })
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/lib/__tests__/cq-helpfuls-route.test.ts`
Expected: FAIL（route が存在しない）

- [ ] **Step 3: route を書く**

`src/app/api/cq/helpfuls/route.ts`:

```ts
// 「役に立った」数のまとめ読み（リーダー末尾・解決済みCQ一覧のバッジ表示用）。
//
//   GET /api/cq/helpfuls?ids=a,b,c
//     … { counts: { [objectId]: number }, mine: string[] }
//
// counts は集計値のみで個人情報を含まないため誰でも読める（/api/cq/views と同じ）。
// mine（自分が押した対象）はログイン時のみ。他人が何に押したかは誰にも返さない。
// best-effort: 未適用・env未設定・失敗時は空を返す（バッジが出ないだけ）。

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveRequestPremium } from '@/lib/premium-access'

export const dynamic = 'force-dynamic'

// 1リクエストで問い合わせる objectId の上限（一覧の全件でも十分収まる）。
const MAX_IDS = 200

export async function GET(req: Request) {
  const supabaseReady = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  if (!supabaseReady) return NextResponse.json({ counts: {}, mine: [] })

  try {
    const idsParam = new URL(req.url).searchParams.get('ids') || ''
    const ids = idsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_IDS)
    if (ids.length === 0) return NextResponse.json({ counts: {}, mine: [] })

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('cq_reactions')
      .select('object_id, user_id')
      .in('object_id', ids)
    if (error) throw new Error(error.message)

    const { userId } = await resolveRequestPremium()
    const counts: Record<string, number> = {}
    const mine: string[] = []
    for (const row of data || []) {
      const id = row.object_id as string
      counts[id] = (counts[id] || 0) + 1
      if (userId && row.user_id === userId) mine.push(id)
    }
    return NextResponse.json({ counts, mine })
  } catch {
    return NextResponse.json({ counts: {}, mine: [] })
  }
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/__tests__/cq-helpfuls-route.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 5: コミット**

```bash
git add src/app/api/cq/helpfuls/route.ts src/lib/__tests__/cq-helpfuls-route.test.ts
git commit -m "feat: 「役に立った」数のバッチ取得API（counts公開・mineは本人のみ）"
```

---

### Task 4: HelpfulButton ＋ リーダー末尾（ReaderHelpful）

**Files:**
- Create: `src/components/HelpfulButton.tsx`
- Create: `src/components/reader/ReaderHelpful.tsx`
- Modify: `src/components/reader/ReaderOverlay.tsx`（421行付近 `<ReaderFooter objectID={hit.objectID} />` の直前に挿入）

**Interfaces:**
- Consumes: Task 1 の `fetchHelpfulState` / `toggleHelpful` / `helpfulCountLabel`、既存 `src/lib/cq-views.ts` の `fetchCqViewCounts` / `VIEW_BADGE_MIN`
- Produces: `HelpfulButton({ pressed, disabled, onClick }: { pressed: boolean; disabled?: boolean; onClick: () => void })`（presentational・Task 5でも使う）／`ReaderHelpful({ objectID }: { objectID: string })`

UIテストの仕組みはこのリポジトリにない（テストは lib/route のみ）ため、このタスクは型チェックと全テストで確認する。

- [ ] **Step 1: HelpfulButton を書く**

`src/components/HelpfulButton.tsx`:

```tsx
'use client'
// 「役に立った」ボタン（共通の見た目）。リーダー末尾と解決済みCQカードで使う。
// 見た目・トグルの作法は受付中の「私も気になる」ボタン（ResolvedCqs の OpenCqBoard）に合わせる。
import { ThumbsUp } from 'lucide-react'

export function HelpfulButton({ pressed, disabled, onClick }: {
  pressed: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1 border transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
        pressed
          ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-200'
          : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
      }`}
    >
      <ThumbsUp className="w-3.5 h-3.5 shrink-0" strokeWidth={2.2} />
      {pressed ? '役に立った（済）' : '役に立った'}
    </button>
  )
}
```

- [ ] **Step 2: ReaderHelpful を書く**

`src/components/reader/ReaderHelpful.tsx`:

```tsx
'use client'
// リーダー末尾の「役に立った」＋参照回数。読了位置に静かに置く（読書中の画面を汚さない・
// 検索結果カードには出さない、という設計判断はspec参照）。
// 数は下限方式: 役に立った=HELPFUL_BADGE_MIN、参照回数=VIEW_BADGE_MIN 以上のときだけ表示。
import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { HelpfulButton } from '@/components/HelpfulButton'
import { fetchHelpfulState, toggleHelpful, helpfulCountLabel } from '@/lib/cq-helpful'
import { fetchCqViewCounts, VIEW_BADGE_MIN } from '@/lib/cq-views'

export function ReaderHelpful({ objectID }: { objectID: string }) {
  const [count, setCount] = useState(0)
  const [mine, setMine] = useState(false)
  const [views, setViews] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    setCount(0); setMine(false); setViews(0)
    fetchHelpfulState([objectID]).then((s) => {
      if (!alive) return
      setCount(s.counts[objectID] || 0)
      setMine(s.mine.includes(objectID))
    })
    fetchCqViewCounts([objectID]).then((c) => { if (alive) setViews(c[objectID] || 0) })
    return () => { alive = false }
  }, [objectID])

  // 押した瞬間に見た目を変え、サーバーの返した合計で確定させる（待たせない）。
  const onToggle = async () => {
    if (busy) return
    const next = !mine
    setBusy(true)
    setMine(next)
    setCount((c) => Math.max(0, c + (next ? 1 : -1)))
    const r = await toggleHelpful(objectID, next)
    if (r) {
      setMine(r.helpful)
      setCount(r.count)
    } else {
      // 失敗したら見た目を戻す（押せたのに入っていない、を残さない）
      setMine(!next)
      setCount((c) => Math.max(0, c + (next ? -1 : 1)))
    }
    setBusy(false)
  }

  return (
    <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <HelpfulButton pressed={mine} disabled={busy} onClick={onToggle} />
      {helpfulCountLabel(count) && (
        <span className="text-[11px] text-gray-400 dark:text-gray-500">{helpfulCountLabel(count)}</span>
      )}
      {views >= VIEW_BADGE_MIN && (
        <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500">
          <Search className="w-3 h-3 shrink-0" strokeWidth={2.2} />
          これまで {views.toLocaleString()}回 調べられています
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 3: ReaderOverlay に組み込む**

`src/components/reader/ReaderOverlay.tsx` の import 群に追加:

```tsx
import { ReaderHelpful } from './ReaderHelpful'
```

421行付近を次のように変更（`<ReaderFooter … />` の直前に1行挿入）:

```tsx
              </ReaderSearchCtx.Provider>
              <ReaderHelpful objectID={hit.objectID} />
              <ReaderFooter objectID={hit.objectID} />
```

- [ ] **Step 4: 型チェックと全テスト**

Run: `npx tsc --noEmit && npm test`
Expected: 型エラーなし。テストは既知の1件（admin-engagement-route の日付フレーク）以外すべて PASS

- [ ] **Step 5: コミット**

```bash
git add src/components/HelpfulButton.tsx src/components/reader/ReaderHelpful.tsx src/components/reader/ReaderOverlay.tsx
git commit -m "feat: リーダー末尾に「役に立った」＋参照回数バッジ"
```

---

### Task 5: 解決済みCQカードに「役に立った」

**Files:**
- Modify: `src/components/ResolvedCqs.tsx`（`ResolvedCqHistory`、250〜345行付近）

**Interfaces:**
- Consumes: Task 1 の `fetchHelpfulState` / `toggleHelpful` / `helpfulCountLabel` / `HelpfulState`、Task 4 の `HelpfulButton`

- [ ] **Step 1: import を足す**

`src/components/ResolvedCqs.tsx` の import 群に追加:

```tsx
import { HelpfulButton } from '@/components/HelpfulButton'
import { fetchHelpfulState, toggleHelpful, helpfulCountLabel, type HelpfulState } from '@/lib/cq-helpful'
```

- [ ] **Step 2: ResolvedCqHistory に状態とトグルを足す**

既存の

```tsx
  const [viewCounts, setViewCounts] = useState<Record<string, number>>({})
```

の直後に追加:

```tsx
  // 「役に立った」の合計と自分の分。押した瞬間に見た目を変え、サーバーの合計で確定させる。
  const [helpful, setHelpful] = useState<HelpfulState>({ counts: {}, mine: [] })
  const [busyHelpful, setBusyHelpful] = useState<string | null>(null)
```

既存 useEffect 内の

```tsx
      if (ids.length > 0) {
        fetchCqViewCounts(ids).then((c) => { if (!cancelled) setViewCounts(c) })
      }
```

を次に変更:

```tsx
      if (ids.length > 0) {
        fetchCqViewCounts(ids).then((c) => { if (!cancelled) setViewCounts(c) })
        fetchHelpfulState(ids).then((s) => { if (!cancelled) setHelpful(s) })
      }
```

useEffect の直後にトグル関数を追加:

```tsx
  const toggleCardHelpful = useCallback(async (id: string) => {
    if (busyHelpful) return
    const next = !helpful.mine.includes(id)
    setBusyHelpful(id)
    setHelpful((prev) => ({
      counts: { ...prev.counts, [id]: Math.max(0, (prev.counts[id] || 0) + (next ? 1 : -1)) },
      mine: next ? [...prev.mine, id] : prev.mine.filter((m) => m !== id),
    }))
    const r = await toggleHelpful(id, next)
    if (r) {
      setHelpful((prev) => ({
        counts: { ...prev.counts, [id]: r.count },
        mine: r.helpful
          ? (prev.mine.includes(id) ? prev.mine : [...prev.mine, id])
          : prev.mine.filter((m) => m !== id),
      }))
    } else {
      // 失敗したら見た目を戻す（押せたのに入っていない、を残さない）
      setHelpful((prev) => ({
        counts: { ...prev.counts, [id]: Math.max(0, (prev.counts[id] || 0) + (next ? -1 : 1)) },
        mine: next ? prev.mine.filter((m) => m !== id) : [...prev.mine, id],
      }))
    }
    setBusyHelpful(null)
  }, [busyHelpful, helpful.mine])
```

（`useCallback` が未importなら react の import に足す。ファイル上部の既存 import を確認すること。）

- [ ] **Step 3: カードにボタンと数を足す**

各カード内、参照回数バッジのブロック

```tsx
          {(viewCounts[c.objectID] ?? 0) >= VIEW_BADGE_MIN && (
            <p className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500">
              <Search className="w-3 h-3 shrink-0" strokeWidth={2.2} />
              これまで {viewCounts[c.objectID].toLocaleString()}回 調べられています
            </p>
          )}
```

の**直後**に追加:

```tsx
          {/* 「役に立った」。押せるのはプレミアム（本文を読める人）だけ。
              非プレミアムには数字だけ見せる（counts は公開の集計値）。 */}
          {isPremium ? (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2">
              <HelpfulButton
                pressed={helpful.mine.includes(c.objectID)}
                disabled={busyHelpful === c.objectID}
                onClick={() => toggleCardHelpful(c.objectID)}
              />
              {helpfulCountLabel(helpful.counts[c.objectID] || 0) && (
                <span className="text-[11px] text-gray-400 dark:text-gray-500">
                  {helpfulCountLabel(helpful.counts[c.objectID] || 0)}
                </span>
              )}
            </div>
          ) : (
            helpfulCountLabel(helpful.counts[c.objectID] || 0) && (
              <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
                {helpfulCountLabel(helpful.counts[c.objectID] || 0)}
              </p>
            )
          )}
```

- [ ] **Step 4: 型チェックと全テスト**

Run: `npx tsc --noEmit && npm test`
Expected: 型エラーなし。既知の1件以外 PASS

- [ ] **Step 5: コミット**

```bash
git add src/components/ResolvedCqs.tsx
git commit -m "feat: 解決済みCQカードに「役に立った」（下限3の数表示つき）"
```

---

### Task 6: admin ランキングに「役に立った」列

**Files:**
- Modify: `src/app/api/admin/cq-ranking/route.ts`
- Modify: `src/app/admin/KnowledgeRankingCard.tsx`
- Test: `src/lib/__tests__/admin-cq-ranking-route.test.ts`（新規）

**Interfaces:**
- Consumes: Task 1 のテーブル cq_reactions
- Produces: `GET /api/admin/cq-ranking` の items に `helpfulCount: number` が加わる

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/admin-cq-ranking-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { requireAdminMock, adminClientMock } = vi.hoisted(() => ({
  requireAdminMock: vi.fn(),
  adminClientMock: vi.fn(),
}))
vi.mock('@/lib/admin-guard', () => ({ requireAdmin: requireAdminMock }))
vi.mock('@/lib/supabase/server', () => ({ createAdminClient: adminClientMock }))
// タイトル解決は best-effort（no-op）。
vi.mock('algoliasearch', () => ({
  default: () => ({ initIndex: () => ({ getObjects: async () => ({ results: [] }) }) }),
}))

import { GET } from '../../app/api/admin/cq-ranking/route'

const req = () => new Request('http://localhost/api/admin/cq-ranking')

beforeEach(() => {
  vi.clearAllMocks()
  requireAdminMock.mockResolvedValue({ ok: true, email: 'owner@example.com' })
})

describe('GET /api/admin/cq-ranking', () => {
  it('参照回数ランキングに「役に立った」数を添える', async () => {
    adminClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === 'cq_views') {
          const rows = [
            { object_id: 'a', view_count: 20 },
            { object_id: 'b', view_count: 5 },
          ]
          return { select: () => ({ order: () => ({ limit: async () => ({ data: rows, error: null }) }) }) }
        }
        // cq_reactions: a に2人、b に0人
        return {
          select: () => ({
            in: async () => ({
              data: [
                { object_id: 'a' },
                { object_id: 'a' },
              ],
              error: null,
            }),
          }),
        }
      },
    })
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ready).toBe(true)
    expect(body.items).toEqual([
      { objectID: 'a', title: '', count: 20, helpfulCount: 2 },
      { objectID: 'b', title: '', count: 5, helpfulCount: 0 },
    ])
  })

  it('cq_reactions が未適用でもランキング自体は返す（helpfulCount=0）', async () => {
    adminClientMock.mockReturnValue({
      from: (table: string) => {
        if (table === 'cq_views') {
          const rows = [{ object_id: 'a', view_count: 3 }]
          return { select: () => ({ order: () => ({ limit: async () => ({ data: rows, error: null }) }) }) }
        }
        return { select: () => ({ in: async () => ({ data: null, error: { message: 'no table' } }) }) }
      },
    })
    const body = await (await GET(req())).json()
    expect(body.items).toEqual([{ objectID: 'a', title: '', count: 3, helpfulCount: 0 }])
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/lib/__tests__/admin-cq-ranking-route.test.ts`
Expected: FAIL（items に helpfulCount がない）

- [ ] **Step 3: route を修正**

`src/app/api/admin/cq-ranking/route.ts` — `if (rows.length === 0) …` の直後（タイトル解決の前）に追加:

```ts
    // 「役に立った」数（cq_reactions）をランキング対象分だけ合算して添える。
    // テーブル未適用（マイグレーション0020待ち）でもランキング自体は返す。
    const helpfulCounts = new Map<string, number>()
    try {
      const { data: reactions, error: rErr } = await admin
        .from('cq_reactions')
        .select('object_id')
        .in('object_id', rows.map((r) => r.object_id))
      if (!rErr) {
        for (const row of reactions || []) {
          const id = row.object_id as string
          helpfulCounts.set(id, (helpfulCounts.get(id) || 0) + 1)
        }
      }
    } catch {
      // 添え物。失敗しても本体（参照回数ランキング）は返す。
    }
```

items の組み立てを次に変更:

```ts
    const items = rows.map((r) => ({
      objectID: r.object_id,
      title: titles.get(r.object_id) || '',
      count: Number(r.view_count) || 0,
      helpfulCount: helpfulCounts.get(r.object_id) || 0,
    }))
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/__tests__/admin-cq-ranking-route.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 5: カードに表示を足す**

`src/app/admin/KnowledgeRankingCard.tsx`:

型を変更:

```tsx
type RankItem = { objectID: string; title: string; count: number; helpfulCount?: number }
```

import に ThumbsUp を追加:

```tsx
import { Search, ThumbsUp } from 'lucide-react'
```

行内の回数表示

```tsx
              <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400 tabular-nums">
                <Search className="w-3 h-3 shrink-0" strokeWidth={2.2} />{it.count.toLocaleString()}回
              </span>
```

の**直後**に追加（0のときは何も描かない）:

```tsx
              {(it.helpfulCount || 0) > 0 && (
                <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-teal-600 dark:text-teal-400 tabular-nums">
                  <ThumbsUp className="w-3 h-3 shrink-0" strokeWidth={2.2} />{it.helpfulCount!.toLocaleString()}
                </span>
              )}
```

あわせて SectionHeading の `help` 文言の末尾に「役に立った（cq_reactions・マイグレーション0020適用後）も並びます。」を追記する。

- [ ] **Step 6: 型チェックと全テスト**

Run: `npx tsc --noEmit && npm test`
Expected: 型エラーなし。既知の1件以外 PASS

- [ ] **Step 7: コミット**

```bash
git add src/app/api/admin/cq-ranking/route.ts src/app/admin/KnowledgeRankingCard.tsx src/lib/__tests__/admin-cq-ranking-route.test.ts
git commit -m "feat: adminランキングに「役に立った」数を添える"
```

---

## 完了後（デプロイ手順・実装タスク外）

1. migration `0020_cq_reactions.sql` を Supabase SQL Editor で手動適用（https://supabase.com/dashboard → 対象プロジェクト → SQL Editor）
2. feat/helpful-reactions → main へマージ → push で自動デプロイ
3. オーナー実機目視: リーダー末尾のボタン／解決済みCQカード／admin 分析タブのランキング列
