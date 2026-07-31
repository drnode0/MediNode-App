# アカウントタブ「人が主役」再設計 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** /admin アカウントタブを、CQ投稿・投票・カード登録・アクティブ度が1人1行で分かる縦積みリストに組み替える。

**Architecture:** (1) CQ投稿を Supabase `cq_submissions` に全件記録（best-effort・service_role専用）、(2) 台帳APIが投稿/投票を集計して行に載せ、(3) UIは10列テーブルを「コンパクト行＋展開詳細」に置き換える。判定・整形は純関数 `src/lib/ledger-people.ts` に切り出して vitest で守る。

**Tech Stack:** Next.js App Router / Supabase (service_role) / Notion API / vitest / Tailwind / lucide-react

**Spec:** `docs/superpowers/specs/2026-07-31-ledger-people-view-design.md`

## Global Constraints

- ブランチ `feat/ledger-people-view` で作業（main 直コミット禁止）。
- **UIの装飾アイコンは lucide 統一・絵文字は使わない**（確立済み方針）。設計モックの絵文字は次の対応で置換: 🔥→`Flame`、🌙→`Moon`、💤→`MoonStar`(なければ`BedDouble`か`CircleDashed`)、⚪→`Circle`、❓→`MessageCircleQuestion`、👍→`ThumbsUp`、💳→`CreditCard`。
- cq_submissions への書き込み・読み出しが失敗しても、投稿と台帳表示は必ず生き残る（try/catchで握る）。
- cq_submissions の内容を /admin 以外のいかなる画面・APIにも出さない。
- 生CSSのダークは `.dark` 基準（`@media (prefers-color-scheme)` 禁止）。Tailwindの `dark:` は可。
- 既存 521 テストを壊さない。コミットは `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>` を付ける。

---

### Task 1: 純ロジック `ledger-people.ts`（アクティブ度・相対日付・並び替え）

**Files:**
- Create: `src/lib/ledger-people.ts`
- Test: `src/lib/__tests__/ledger-people.test.ts`

**Interfaces:**
- Produces（後続タスクが使う正確な形）:
  - `type ActivityBand = 'week' | 'month' | 'older' | 'never'`
  - `lastSeenMs(r: { lastUsedAt: string | null; lastSignInAt: string | null; settingsUpdatedAt: string | null }): number`（形跡なし=0）
  - `activityBand(seenMs: number, nowMs: number): ActivityBand`
  - `fmtRelative(seenMs: number, nowMs: number): string`（0なら `'—'`）
  - `contributionScore(r: { cqCount: number; voteCount: number }): number`
  - `type PeopleSortMode = 'newest' | 'active' | 'contribution'`
  - `comparePeople(mode: PeopleSortMode, a: PersonSortable, b: PersonSortable): number` / `type PersonSortable = { createdAt: string | null; cqCount: number; voteCount: number; lastUsedAt: string | null; lastSignInAt: string | null; settingsUpdatedAt: string | null }`

- [ ] **Step 1: ブランチ作成**

```bash
cd ~/medical-search-public && git checkout -b feat/ledger-people-view
```

- [ ] **Step 2: 失敗するテストを書く**

`src/lib/__tests__/ledger-people.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  lastSeenMs,
  activityBand,
  fmtRelative,
  contributionScore,
  comparePeople,
} from '../ledger-people'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-07-31T12:00:00+09:00').getTime()
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

describe('lastSeenMs', () => {
  it('最終利用・最終ログイン・設定同期の最新値を採る', () => {
    const r = { lastUsedAt: iso(3 * DAY), lastSignInAt: iso(1 * DAY), settingsUpdatedAt: iso(10 * DAY) }
    expect(lastSeenMs(r)).toBe(NOW - 1 * DAY)
  })
  it('全て null なら 0（形跡なし）', () => {
    expect(lastSeenMs({ lastUsedAt: null, lastSignInAt: null, settingsUpdatedAt: null })).toBe(0)
  })
})

describe('activityBand', () => {
  it('ちょうど7日前は week（既存「最終利用の内訳」と同じ包含判定）', () => {
    expect(activityBand(NOW - 7 * DAY, NOW)).toBe('week')
  })
  it('7日と1msを超えたら month', () => {
    expect(activityBand(NOW - 7 * DAY - 1, NOW)).toBe('month')
  })
  it('ちょうど30日前は month・超えたら older', () => {
    expect(activityBand(NOW - 30 * DAY, NOW)).toBe('month')
    expect(activityBand(NOW - 30 * DAY - 1, NOW)).toBe('older')
  })
  it('0 は never', () => {
    expect(activityBand(0, NOW)).toBe('never')
  })
})

describe('fmtRelative', () => {
  it('0は—、当日・昨日・日数・週・月を段階表示', () => {
    expect(fmtRelative(0, NOW)).toBe('—')
    expect(fmtRelative(NOW - 2 * 60 * 60 * 1000, NOW)).toBe('今日')
    expect(fmtRelative(NOW - 1 * DAY, NOW)).toBe('昨日')
    expect(fmtRelative(NOW - 5 * DAY, NOW)).toBe('5日前')
    expect(fmtRelative(NOW - 20 * DAY, NOW)).toBe('2週間前')
    expect(fmtRelative(NOW - 100 * DAY, NOW)).toBe('3か月前')
  })
})

describe('comparePeople', () => {
  const base = { lastUsedAt: null, lastSignInAt: null, settingsUpdatedAt: null }
  it('contribution: 合計降順・同数は最終利用が新しい順', () => {
    const a = { ...base, createdAt: iso(1 * DAY), cqCount: 2, voteCount: 0, lastUsedAt: iso(10 * DAY) }
    const b = { ...base, createdAt: iso(2 * DAY), cqCount: 1, voteCount: 1, lastUsedAt: iso(1 * DAY) }
    // 同数(2)なので lastSeen の新しい b が先
    expect(comparePeople('contribution', a, b)).toBeGreaterThan(0)
    const c = { ...base, createdAt: iso(3 * DAY), cqCount: 3, voteCount: 0, lastUsedAt: null }
    expect(comparePeople('contribution', c, a)).toBeLessThan(0)
  })
  it('active: 形跡なしは最後尾', () => {
    const active = { ...base, createdAt: iso(1 * DAY), cqCount: 0, voteCount: 0, lastUsedAt: iso(1 * DAY) }
    const never = { ...base, createdAt: iso(0), cqCount: 0, voteCount: 0 }
    expect(comparePeople('active', never, active)).toBeGreaterThan(0)
  })
  it('newest: 登録日降順・nullは最後尾', () => {
    const newer = { ...base, createdAt: iso(1 * DAY), cqCount: 0, voteCount: 0 }
    const older = { ...base, createdAt: iso(9 * DAY), cqCount: 0, voteCount: 0 }
    const noDate = { ...base, createdAt: null, cqCount: 0, voteCount: 0 }
    expect(comparePeople('newest', newer, older)).toBeLessThan(0)
    expect(comparePeople('newest', noDate, older)).toBeGreaterThan(0)
  })
})

describe('contributionScore', () => {
  it('CQ数と投票数の単純合計', () => {
    expect(contributionScore({ cqCount: 2, voteCount: 3 })).toBe(5)
  })
})
```

- [ ] **Step 3: 失敗を確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/ledger-people.test.ts`
Expected: FAIL（`../ledger-people` が存在しない）

- [ ] **Step 4: 実装**

`src/lib/ledger-people.ts`:

```ts
// アカウントタブ「人が主役」リストの純ロジック（vitest対象・fetchなし）。
//
// アクティブ度の判定は既存「最終利用の内訳」（AdminLedgerClient の activity useMemo）と
// 同じ規則: 最終利用・最終ログイン・設定同期の最新値で、7日以内/30日以内/それ以上/形跡なし。
// 境界は「以内」（<=）。ここに切り出して一覧の行バッジと内訳グラフの判定ズレを防ぐ。

export type ActivityBand = 'week' | 'month' | 'older' | 'never'

export type PersonActivity = {
  lastUsedAt: string | null
  lastSignInAt: string | null
  settingsUpdatedAt: string | null
}

const DAY = 24 * 60 * 60 * 1000

// 「最後に見た形跡」。0 = 形跡なし。
export function lastSeenMs(r: PersonActivity): number {
  return Math.max(
    ...[r.lastUsedAt, r.lastSignInAt, r.settingsUpdatedAt]
      .filter((v): v is string => !!v)
      .map((v) => new Date(v).getTime()),
    0,
  )
}

export function activityBand(seenMs: number, nowMs: number): ActivityBand {
  if (seenMs === 0) return 'never'
  const ago = nowMs - seenMs
  if (ago <= 7 * DAY) return 'week'
  if (ago <= 30 * DAY) return 'month'
  return 'older'
}

// 行に出す相対日付。細かい正確さより「一目の把握」を優先した粗い段階表示。
// 正確な日時は詳細（展開側）の絶対表示が担う。
export function fmtRelative(seenMs: number, nowMs: number): string {
  if (seenMs === 0) return '—'
  const days = Math.floor((nowMs - seenMs) / DAY)
  if (days <= 0) return '今日'
  if (days === 1) return '昨日'
  if (days < 7) return `${days}日前`
  if (days < 30) return `${Math.floor(days / 7)}週間前`
  return `${Math.floor(days / 30)}か月前`
}

export function contributionScore(r: { cqCount: number; voteCount: number }): number {
  return r.cqCount + r.voteCount
}

export type PeopleSortMode = 'newest' | 'active' | 'contribution'

export type PersonSortable = PersonActivity & {
  createdAt: string | null
  cqCount: number
  voteCount: number
}

// 3プリセットの比較関数。返り値は Array.prototype.sort 互換（負= a が先）。
export function comparePeople(mode: PeopleSortMode, a: PersonSortable, b: PersonSortable): number {
  if (mode === 'newest') {
    const av = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const bv = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return bv - av
  }
  const aSeen = lastSeenMs(a)
  const bSeen = lastSeenMs(b)
  if (mode === 'active') return bSeen - aSeen
  // contribution: 合計降順 → 同数は最終利用の新しい順
  const diff = contributionScore(b) - contributionScore(a)
  return diff !== 0 ? diff : bSeen - aSeen
}
```

- [ ] **Step 5: テスト通過を確認**

Run: `npx vitest run src/lib/__tests__/ledger-people.test.ts`
Expected: PASS（全件）

- [ ] **Step 6: コミット**

```bash
git add src/lib/ledger-people.ts src/lib/__tests__/ledger-people.test.ts
git commit -m "feat(admin): 人が主役リストの純ロジック（アクティブ度・相対日付・並び替え）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: migration 0019 `cq_submissions`

**Files:**
- Create: `supabase/migrations/0019_cq_submissions.sql`
- Modify: `supabase/migrations/README.md`（表の末尾に1行追記）

**Interfaces:**
- Produces: テーブル `public.cq_submissions`（列: id, user_id, notion_page_id, question, role, years, departments, created_at）。RLSポリシーなし＝service_role専用。

- [ ] **Step 1: SQLを書く**

`supabase/migrations/0019_cq_submissions.sql`:

```sql
-- アプリ内CQ投稿の管理用記録（/admin アカウント台帳の「誰が投稿してくれたか」表示用）。
--
-- 方針変更（2026-07-31・オーナー決定）: 従来は通知同意者のみNotionにIDを残していたが、
-- 全投稿の userId をここに記録する。ユーザーへの公開面の約束は「実名は表示されません」
-- （表示の約束）であり、本テーブルは /admin 以外のどこにも出さないことで約束を守る。
create table if not exists public.cq_submissions (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  notion_page_id text,          -- 受付DBのページ参照（台帳から追跡用）
  question text not null,        -- 疑問文の先頭200字（一覧表示用）
  role text,                     -- 職種
  years text,                    -- 経験年数
  departments text,              -- 診療科・立場（医師のみ・カンマ結合）
  created_at timestamptz not null default now()
);
alter table public.cq_submissions enable row level security;  -- ポリシーなし＝service_role専用
create index if not exists cq_submissions_user_idx on public.cq_submissions (user_id);
-- バックフィルの二重実行防止（upsert の衝突キー）。NULL同士は衝突しない仕様なので
-- notion_page_id が取れなかった行があっても挿入は妨げない。
create unique index if not exists cq_submissions_notion_page_uidx
  on public.cq_submissions (notion_page_id);
```

- [ ] **Step 2: README台帳に追記**

`supabase/migrations/README.md` の表の `| 0018 | ... |` 行の直後に追加:

```markdown
| 0019 | cq_submissions | `cq_submissions` | ⬜ 未適用 |
```

- [ ] **Step 3: コミット**

```bash
git add supabase/migrations/0019_cq_submissions.sql supabase/migrations/README.md
git commit -m "feat(db): CQ投稿の管理用記録テーブル（migration 0019・適用は手動）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: 投稿時の記録 `cq-submission-log.ts` と `/api/cq/submit` の配線

**Files:**
- Create: `src/lib/cq-submission-log.ts`
- Modify: `src/app/api/cq/submit/route.ts:95-99`（pages.create の戻り値を受けて記録）
- Modify: `src/lib/cq-submit.ts:224` 付近のコメント（方針変更を反映）
- Test: `src/lib/__tests__/cq-submission-log.test.ts`

**Interfaces:**
- Consumes: `CqSubmission`（`src/lib/cq-submit.ts` の既存型）
- Produces: `logCqSubmission(admin: SupabaseClient, entry: { userId: string; notionPageId: string | null; value: Pick<CqSubmission, 'question' | 'occupation' | 'experience' | 'departments'> }): Promise<void>`（絶対にthrowしない）

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/cq-submission-log.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { logCqSubmission } from '../cq-submission-log'
import type { SupabaseClient } from '@supabase/supabase-js'

function mockAdmin(insert: ReturnType<typeof vi.fn>): SupabaseClient {
  return { from: vi.fn(() => ({ insert })) } as unknown as SupabaseClient
}

const value = {
  question: 'あ'.repeat(300),
  occupation: '医師',
  experience: '4〜6年目',
  departments: ['集中治療科', '指導医・専門医'],
}

describe('logCqSubmission', () => {
  it('疑問文は200字に切り、属性はそのまま・診療科はカンマ結合で insert する', async () => {
    const insert = vi.fn(async () => ({ error: null }))
    await logCqSubmission(mockAdmin(insert), { userId: 'u-1', notionPageId: 'p-1', value })
    expect(insert).toHaveBeenCalledWith({
      user_id: 'u-1',
      notion_page_id: 'p-1',
      question: 'あ'.repeat(200),
      role: '医師',
      years: '4〜6年目',
      departments: '集中治療科, 指導医・専門医',
    })
  })
  it('未選択（空文字・空配列）は null で保存する', async () => {
    const insert = vi.fn(async () => ({ error: null }))
    await logCqSubmission(mockAdmin(insert), {
      userId: 'u-2',
      notionPageId: null,
      value: { question: 'Q', occupation: '', experience: '', departments: [] },
    })
    expect(insert).toHaveBeenCalledWith({
      user_id: 'u-2',
      notion_page_id: null,
      question: 'Q',
      role: null,
      years: null,
      departments: null,
    })
  })
  it('insert が例外を投げても throw しない（投稿を殺さない）', async () => {
    const insert = vi.fn(async () => {
      throw new Error('db down')
    })
    await expect(
      logCqSubmission(mockAdmin(insert), { userId: 'u-3', notionPageId: null, value }),
    ).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/lib/__tests__/cq-submission-log.test.ts`
Expected: FAIL（`../cq-submission-log` が存在しない）

- [ ] **Step 3: 実装**

`src/lib/cq-submission-log.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CqSubmission } from './cq-submit'

// CQ投稿の管理用記録（/admin アカウント台帳の「誰が投稿してくれたか」表示用）。
//
// 方針（2026-07-31・オーナー決定）: 全投稿の userId を記録する。ユーザーへの約束は
// 「実名は表示されません」（表示の約束）なので、/admin 以外に出さないことで守る。
// 記録失敗で投稿本体を止めない（admin-audit と同じ best-effort）。
export async function logCqSubmission(
  admin: SupabaseClient,
  entry: {
    userId: string
    notionPageId: string | null
    value: Pick<CqSubmission, 'question' | 'occupation' | 'experience' | 'departments'>
  },
): Promise<void> {
  try {
    await admin.from('cq_submissions').insert({
      user_id: entry.userId,
      notion_page_id: entry.notionPageId,
      question: entry.value.question.slice(0, 200),
      role: entry.value.occupation || null,
      years: entry.value.experience || null,
      departments: entry.value.departments.length > 0 ? entry.value.departments.join(', ') : null,
    })
  } catch {
    // テーブル未適用・DB不調でも投稿は成功のまま（台帳の数字が一時的に欠けるだけ）。
  }
}
```

- [ ] **Step 4: テスト通過を確認**

Run: `npx vitest run src/lib/__tests__/cq-submission-log.test.ts`
Expected: PASS（3件）

- [ ] **Step 5: `/api/cq/submit` に配線**

`src/app/api/cq/submit/route.ts` — import に追加:

```ts
import { createAdminClient } from '@/lib/supabase/server'
import { logCqSubmission } from '@/lib/cq-submission-log'
```

同ファイルの `await notion.pages.create({...})` 呼び出し（95-98行）を次に置き換え:

```ts
    const created = await notion.pages.create({
      parent: { database_id: env.dbId },
      properties: built.properties as Parameters<typeof notion.pages.create>[0]['properties'],
    })

    // 管理用記録（best-effort）。createAdminClient は env 不足で throw しうるので中で握る。
    try {
      await logCqSubmission(createAdminClient(), {
        userId,
        notionPageId: (created as { id?: string }).id ?? null,
        value: validated.value,
      })
    } catch {
      // 記録できなくても投稿は成立している。
    }
```

- [ ] **Step 6: 旧方針コメントの書き換え**

`src/lib/cq-submit.ts` の 224 行付近:

```ts
  // 通知先は本人の同意（notify）があるときだけ残す。同意なしにIDを保存しない。
```

を次に置き換え:

```ts
  // Notion受付DB側の通知先IDは、本人の同意（notify）があるときだけ残す（解決通知の宛先）。
  // 投稿者の管理用記録は同意と無関係に Supabase cq_submissions が持つ（2026-07-31方針変更・
  // /admin 専用で公開面には出さない。cq-submission-log.ts 参照）。
```

- [ ] **Step 7: 全テスト＋型チェック**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 型エラーなし・既存テスト含め全件PASS

- [ ] **Step 8: コミット**

```bash
git add src/lib/cq-submission-log.ts src/lib/__tests__/cq-submission-log.test.ts src/app/api/cq/submit/route.ts src/lib/cq-submit.ts
git commit -m "feat(cq): 投稿時に管理用記録を残す（全件userId・best-effort・/admin専用）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: 台帳APIに cqCount / cqList / voteCount を追加

**Files:**
- Modify: `src/app/api/admin/ledger/route.ts`（友達紹介ブロックの直後・行の組み立て）

**Interfaces:**
- Consumes: テーブル `cq_submissions`（Task 2）・既存 `cq_votes`
- Produces: 各行に `cqCount: number` / `cqList: Array<{ question: string; role: string | null; createdAt: string }>` / `voteCount: number`（Task 6-7 のUIが読む）

- [ ] **Step 1: 集計ブロックを追加**

`src/app/api/admin/ledger/route.ts` の友達紹介ブロック（`referralCountByUser` の try/catch、158行付近）の直後に追加:

```ts
    // CQ投稿の管理用記録（0019 未適用ならテーブルが無いので空のまま続行）。
    // 新しい順で返す（詳細表示がそのまま使う）。
    const cqByUser = new Map<string, Array<{ question: string; role: string | null; createdAt: string }>>()
    try {
      const { data: cqs } = await admin
        .from('cq_submissions')
        .select('user_id, question, role, created_at')
        .order('created_at', { ascending: false })
        .limit(5000)
      for (const c of cqs ?? []) {
        const uid = c.user_id as string
        const list = cqByUser.get(uid) ?? []
        list.push({
          question: String(c.question),
          role: (c.role as string | null) ?? null,
          createdAt: String(c.created_at),
        })
        cqByUser.set(uid, list)
      }
    } catch {
      // テーブル未作成なら空のまま。
    }

    // 「みんなの臨床疑問」への投票数（0017）。
    const voteCountByUser = new Map<string, number>()
    try {
      const { data: votes } = await admin.from('cq_votes').select('user_id').limit(20000)
      for (const v of votes ?? []) {
        const uid = v.user_id as string
        voteCountByUser.set(uid, (voteCountByUser.get(uid) ?? 0) + 1)
      }
    } catch {
      // テーブル未作成なら空のまま。
    }
```

- [ ] **Step 2: 行の組み立てに3項目追加**

同ファイルの `rows = users.map((u) => { ... return { ... } })` 内、`hasStripe:` の行の直前に追加:

```ts
          // アプリ内CQ投稿（cq_submissions・/admin専用の管理記録）と投票数。
          cqCount: (cqByUser.get(u.id) ?? []).length,
          cqList: cqByUser.get(u.id) ?? [],
          voteCount: voteCountByUser.get(u.id) ?? 0,
```

- [ ] **Step 3: 型チェック＋テスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS

- [ ] **Step 4: コミット**

```bash
git add src/app/api/admin/ledger/route.ts
git commit -m "feat(admin): 台帳APIにCQ投稿・投票の集計を追加（テーブル欠損時は空で続行）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: 過去分バックフィルスクリプト

**Files:**
- Create: `scripts/backfill-cq-submissions.ts`

**Interfaces:**
- Consumes: env `CQ_INTAKE_NOTION_TOKEN` / `CQ_INTAKE_DB_ID` / `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`（`.env.local` を dotenv 読みせず、実行時に `set -a && . ./.env.local` で渡す運用）
- Produces: 受付DBの「通知先ユーザーID」入り行を `cq_submissions` へ upsert（`notion_page_id` 衝突時は無視＝二重実行安全）

- [ ] **Step 1: スクリプトを書く**

`scripts/backfill-cq-submissions.ts`:

```ts
// 過去のCQ投稿のうち「通知先ユーザーID」が残っている行（通知同意者のみ）を
// cq_submissions へ一度だけ取り込む。同意なしの過去分は誰の投稿か情報自体が
// 存在しないため遡れない（台帳UIの注記に明示済み）。
//
// 実行: cd ~/medical-search-public && set -a && . ./.env.local && set +a \
//        && npx tsx scripts/backfill-cq-submissions.ts
// 二重実行OK（notion_page_id の unique index に衝突したら ignore）。

import { Client } from '@notionhq/client'
import { createClient } from '@supabase/supabase-js'

async function main() {
  const token = process.env.CQ_INTAKE_NOTION_TOKEN
  const dbId = process.env.CQ_INTAKE_DB_ID
  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!token || !dbId || !supaUrl || !supaKey) {
    console.error('env不足: CQ_INTAKE_NOTION_TOKEN / CQ_INTAKE_DB_ID / NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }
  const notion = new Client({ auth: token })
  const supa = createClient(supaUrl, supaKey)

  type Prop = {
    title?: Array<{ plain_text?: string }>
    rich_text?: Array<{ plain_text?: string }>
    select?: { name?: string } | null
    multi_select?: Array<{ name?: string }>
  }
  const text = (p?: Prop) =>
    ((p?.title ?? p?.rich_text ?? []).map((t) => t.plain_text ?? '').join('') || '').trim()

  let cursor: string | undefined
  let scanned = 0
  let inserted = 0
  let skipped = 0
  do {
    const res = await notion.databases.query({
      database_id: dbId,
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    })
    for (const page of res.results as Array<{
      id: string
      created_time?: string
      properties?: Record<string, Prop>
    }>) {
      scanned++
      const props = page.properties ?? {}
      const userId = text(props['通知先ユーザーID'])
      if (!userId) {
        skipped++
        continue
      }
      // タイトル列は受付DB側の名前が変わりうるので type=title の列を探す。
      const titleProp = Object.values(props).find((p) => Array.isArray(p.title))
      const question = text(titleProp).slice(0, 200)
      if (!question) {
        skipped++
        continue
      }
      const role = props['職種']?.select?.name ?? text(props['投稿者職種']) ?? null
      const years = props['経験年数']?.select?.name ?? null
      const departments =
        (props['診療科・立場']?.multi_select ?? []).map((o) => o.name ?? '').filter(Boolean).join(', ') || null

      const { error } = await supa.from('cq_submissions').upsert(
        {
          user_id: userId,
          notion_page_id: page.id,
          question,
          role: role || null,
          years,
          departments,
          created_at: page.created_time ?? new Date().toISOString(),
        },
        { onConflict: 'notion_page_id', ignoreDuplicates: true },
      )
      if (error) {
        console.error(`  失敗 ${page.id}: ${error.message}`)
      } else {
        inserted++
      }
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)

  console.log(`走査 ${scanned} 件 / 取り込み対象 ${inserted} 件 / 同意なし等スキップ ${skipped} 件`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: コミット**

```bash
git add scripts/backfill-cq-submissions.ts
git commit -m "feat(scripts): CQ投稿の過去分バックフィル（通知同意分のみ・二重実行安全）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

（実行は Task 8。migration 0019 適用後でないと失敗する）

---

### Task 6: PersonRow コンポーネント（コンパクト行＋展開詳細の器）

**Files:**
- Create: `src/app/admin/PersonRow.tsx`

**Interfaces:**
- Consumes: `ActivityBand` / `fmtRelative` は使わず、**表示済みの文字列を受け取る**（純表示コンポーネント）
- Produces（Task 7 が使う props）:

```ts
export type PersonRowProps = {
  email: string | null
  userId: string
  kindBadge: React.ReactNode   // 既存の区分バッジJSXをそのまま渡す
  hasStripe: boolean
  band: 'week' | 'month' | 'older' | 'never'
  lastSeenLabel: string        // fmtRelative の結果（'3日前' 等）
  cqCount: number
  voteCount: number
  expanded: boolean
  onToggle: () => void
  detail: React.ReactNode      // 展開時に出す中身（Task 7 が既存JSXを移して渡す）
}
```

- [ ] **Step 1: 実装**

`src/app/admin/PersonRow.tsx`:

```tsx
'use client'

// アカウント一覧の1人分。常時表示は「メール・区分・カード・アクティブ度・貢献」だけに
// 絞り、残りは展開（detail）へ。PC/スマホ共通の縦積み構造（幅分岐コードを書かない）。
// 判定・整形は呼び出し側（AdminLedgerClient）が済ませ、ここは純表示に徹する。

import type { ReactNode } from 'react'
import {
  Flame,
  Moon,
  CircleDashed,
  Circle,
  CreditCard,
  MessageCircleQuestion,
  ThumbsUp,
  ChevronDown,
} from 'lucide-react'

export type PersonRowProps = {
  email: string | null
  userId: string
  kindBadge: ReactNode
  hasStripe: boolean
  band: 'week' | 'month' | 'older' | 'never'
  lastSeenLabel: string
  cqCount: number
  voteCount: number
  expanded: boolean
  onToggle: () => void
  detail: ReactNode
}

// アクティブ度のアイコンと色（🔥→Flame 等・絵文字はUI装飾に使わない方針）。
const BAND_UI = {
  week: { Icon: Flame, cls: 'text-orange-500 dark:text-orange-400', label: '7日以内に利用' },
  month: { Icon: Moon, cls: 'text-sky-500 dark:text-sky-400', label: '30日以内に利用' },
  older: { Icon: CircleDashed, cls: 'text-gray-400 dark:text-gray-500', label: '31日以上前' },
  never: { Icon: Circle, cls: 'text-gray-300 dark:text-gray-600', label: '利用形跡なし' },
} as const

export function PersonRow(props: PersonRowProps) {
  const { Icon, cls, label } = BAND_UI[props.band]
  return (
    <li className="border-b border-gray-100 dark:border-gray-700/60 last:border-b-0">
      <button
        type="button"
        onClick={props.onToggle}
        aria-expanded={props.expanded}
        className="w-full px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-left hover:bg-gray-50 dark:hover:bg-gray-700/40"
      >
        {/* 1段目: アクティブ度＋メール＋区分＋カード */}
        <span className={`inline-flex items-center gap-1 shrink-0 ${cls}`} title={label}>
          <Icon className="w-4 h-4" aria-hidden />
          <span className="text-xs tabular-nums">{props.lastSeenLabel}</span>
        </span>
        <span className="font-medium text-sm text-gray-900 dark:text-gray-100 truncate min-w-0 flex-1">
          {props.email ?? '（メールなし）'}
        </span>
        {props.kindBadge}
        {props.hasStripe && (
          <span
            className="inline-flex items-center text-emerald-600 dark:text-emerald-400 shrink-0"
            title="カード登録あり（Stripe顧客）"
          >
            <CreditCard className="w-4 h-4" aria-hidden />
          </span>
        )}
        {/* 貢献: 0 は出さず行を静かに保つ */}
        {props.cqCount > 0 && (
          <span
            className="inline-flex items-center gap-0.5 text-xs text-purple-600 dark:text-purple-400 shrink-0"
            title={`CQ投稿 ${props.cqCount}件`}
          >
            <MessageCircleQuestion className="w-3.5 h-3.5" aria-hidden />
            {props.cqCount}
          </span>
        )}
        {props.voteCount > 0 && (
          <span
            className="inline-flex items-center gap-0.5 text-xs text-teal-600 dark:text-teal-400 shrink-0"
            title={`投票 ${props.voteCount}件`}
          >
            <ThumbsUp className="w-3.5 h-3.5" aria-hidden />
            {props.voteCount}
          </span>
        )}
        <ChevronDown
          className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${props.expanded ? 'rotate-180' : ''}`}
          aria-hidden
        />
      </button>
      {props.expanded && (
        <div className="px-3 pb-3 pt-1 bg-gray-50/60 dark:bg-gray-900/30">{props.detail}</div>
      )}
    </li>
  )
}
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし（未使用warningは無視）。lucide に `CircleDashed` が無い場合は `Circle` に落として `strokeDasharray` は使わず、`title` の文言だけで区別する。

- [ ] **Step 3: コミット**

```bash
git add src/app/admin/PersonRow.tsx
git commit -m "feat(admin): アカウント一覧の1人分コンポーネント（純表示・PC/スマホ共通）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: AdminLedgerClient の組み替え（テーブル→リスト・プリセット・チップ・CSV）

**Files:**
- Modify: `src/app/admin/AdminLedgerClient.tsx`
  - `LedgerRow` 型（77行）に3項目追加
  - テーブルブロック（1385〜1620行の `<table>`〜`</table>` とその外側の `overflow-x-auto` ラッパー）を `<ul>`＋`PersonRow` に置き換え
  - ソートUI（`SortableTh`・`sortKey`/`sortDir`）をプリセット3ボタンに置き換え
  - 「区分ごとの人数」セクション（1282行付近）をフィルタチップに変換して一覧直上へ移動
  - CSV（590行 `downloadCsv`）に3列追加

**Interfaces:**
- Consumes: `PersonRow`（Task 6）・`lastSeenMs`/`activityBand`/`fmtRelative`/`comparePeople`/`PeopleSortMode`（Task 1）・APIの `cqCount`/`cqList`/`voteCount`（Task 4）

- [ ] **Step 1: 型と import**

`LedgerRow` 型（77行）の `hasStripe: boolean` の直前に追加:

```ts
  cqCount: number
  cqList: Array<{ question: string; role: string | null; createdAt: string }>
  voteCount: number
```

import に追加:

```ts
import { PersonRow } from './PersonRow'
import { lastSeenMs, activityBand, fmtRelative, comparePeople, type PeopleSortMode } from '@/lib/ledger-people'
```

- [ ] **Step 2: ソート状態の置き換え**

`const [sortKey, setSortKey] = useState<SortKey>('createdAt')` と `const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')`（361-362行）を削除し、次に置き換え:

```ts
  const [sortMode, setSortMode] = useState<PeopleSortMode>('newest')
  const [kindFilter, setKindFilter] = useState<MemberKind | 'all'>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)
```

`sorted` の useMemo（700行付近）を次に置き換え（`filtered` はそのまま使う）:

```ts
  const sorted = useMemo(() => {
    if (!filtered) return []
    const base = kindFilter === 'all' ? filtered : filtered.filter((r) => r.kind === kindFilter)
    return [...base].sort((a, b) => comparePeople(sortMode, a, b))
  }, [filtered, sortMode, kindFilter])
```

`SortableTh` コンポーネント（303-334行）と `SortKey`/`SORT_LABEL` 定義、`onSort` ハンドラは削除する（参照が残ると型エラーになるので tsc で拾う）。

- [ ] **Step 3: プリセット3ボタンとフィルタチップのJSX**

一覧の直上（旧「区分ごとの人数」セクションの位置）に配置:

```tsx
            {/* 並び替えプリセット */}
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {(
                [
                  ['newest', '新着順'],
                  ['active', 'アクティブ順'],
                  ['contribution', '貢献順'],
                ] as Array<[PeopleSortMode, string]>
              ).map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setSortMode(mode)}
                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                    sortMode === mode
                      ? 'bg-brand-600 text-white border-brand-600'
                      : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600 hover:border-brand-400'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {/* 区分フィルタチップ（旧「区分ごとの人数」セクションを吸収） */}
            <div className="flex flex-wrap items-center gap-1.5 mb-3">
              <button
                type="button"
                onClick={() => setKindFilter('all')}
                className={`px-2.5 py-1 rounded-full text-[11px] border ${
                  kindFilter === 'all'
                    ? 'bg-gray-800 text-white border-gray-800 dark:bg-gray-200 dark:text-gray-900 dark:border-gray-200'
                    : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600'
                }`}
              >
                すべて {rows?.length ?? 0}
              </button>
              {(Object.keys(MEMBER_KIND_LABEL) as MemberKind[]).map((k) => {
                const n = counts[k] ?? 0
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKindFilter(kindFilter === k ? 'all' : k)}
                    className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                      kindFilter === k
                        ? 'bg-brand-600 text-white border-brand-600'
                        : n === 0
                          ? 'bg-white dark:bg-gray-800 text-gray-300 dark:text-gray-600 border-gray-100 dark:border-gray-700'
                          : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-600 hover:border-brand-400'
                    }`}
                  >
                    {MEMBER_KIND_LABEL[k]} {n}
                  </button>
                )
              })}
            </div>
```

※ `counts` は既存 useMemo（区分別集計）をそのまま使う。旧「区分ごとの人数」セクション（`SectionHeading title="区分ごとの人数"` のブロック）は削除。

- [ ] **Step 4: テーブル→リストの置き換え**

`<table className="w-full text-sm">`〜`</table>`（1385〜1620行）とその `overflow-x-auto` ラッパーを次の構造に置き換える:

```tsx
            <ul className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 divide-y-0">
              {sorted.map((r) => {
                const seen = lastSeenMs(r)
                return (
                  <PersonRow
                    key={r.userId}
                    email={r.email}
                    userId={r.userId}
                    kindBadge={/* 旧テーブルの区分バッジJSX（<td>内で kind を色付き表示していた要素）をそのまま */}
                    hasStripe={r.hasStripe}
                    band={activityBand(seen, Date.now())}
                    lastSeenLabel={fmtRelative(seen, Date.now())}
                    cqCount={r.cqCount}
                    voteCount={r.voteCount}
                    expanded={expandedId === r.userId}
                    onToggle={() => setExpandedId(expandedId === r.userId ? null : r.userId)}
                    detail={
                      <div className="space-y-3 text-sm">
                        {/* --- 基本情報（旧テーブルの列を definition list に移す） --- */}
                        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
                          {/* 登録日・最終ログイン・最終利用・設定同期・期限・プレミアム利用・
                              流入元・紹介 の8項目。旧 <td> の表示ロジック（fmtDateTime、
                              effectiveSource、referral表示、期限の comp='無期限' 分岐）を
                              そのまま <dt>ラベル</dt><dd>値</dd> に移植する */}
                        </dl>
                        {/* --- 投稿CQ一覧（新規） --- */}
                        {r.cqList.length > 0 && (
                          <div>
                            <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">
                              投稿してくれた臨床疑問（{r.cqCount}件）
                            </p>
                            <ul className="space-y-1">
                              {r.cqList.map((cq, i) => (
                                <li key={i} className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
                                  <span className="text-gray-400 dark:text-gray-500 mr-1.5 tabular-nums">
                                    {cq.createdAt.slice(0, 10)}
                                  </span>
                                  {cq.question}
                                  {cq.role && (
                                    <span className="ml-1.5 text-[10px] text-gray-400">（{cq.role}）</span>
                                  )}
                                </li>
                              ))}
                            </ul>
                            <p className="mt-1 text-[10px] text-gray-400 dark:text-gray-500">
                              2026-07-31以前の投稿は通知同意分のみ表示（それ以外は記録が存在しません）
                            </p>
                          </div>
                        )}
                        {/* --- 操作（旧テーブル「操作」列のボタン群をそのまま移す） --- */}
                        <div className="flex flex-wrap gap-2 pt-1 border-t border-gray-200 dark:border-gray-700">
                          {/* comp付与/取消・モニター指定・オーナー指定・メモ編集・
                              early access・削除 の既存ボタンJSXとハンドラ呼び出しを無改変で移植 */}
                        </div>
                      </div>
                    }
                  />
                )
              })}
            </ul>
```

**移植の作法**: コメント位置に旧 `<td>` 内のJSXを**ロジック無改変で**移す。表示条件（`r.kind === 'comp' ? '無期限' : ...` 等）・ハンドラ（`grantComp(r.userId)` 等）・確認ダイアログはそのまま。削るのは `<td>` ラッパーだけ。

- [ ] **Step 5: CSVに3列追加**

`downloadCsv`（590行）の `header` 配列の `'紹介経由',` の直後に `'CQ投稿', '投票', 'カード',` を挿入。`lines` の対応位置（`csvCell(r.viaReferral ? '紹介経由' : '—'),` の直後）に挿入:

```ts
        csvCell(String(r.cqCount)),
        csvCell(String(r.voteCount)),
        csvCell(r.hasStripe ? 'カードあり' : '—'),
```

- [ ] **Step 6: 型チェック＋全テスト＋ビルド**

Run: `npx tsc --noEmit && npx vitest run && npm run build`
Expected: すべて成功。`SortableTh`・`SORT_LABEL` 等の消し残し参照があれば tsc が指摘するので削除。

- [ ] **Step 7: コミット**

```bash
git add src/app/admin/AdminLedgerClient.tsx
git commit -m "feat(admin): アカウント一覧を人が主役のリストへ組み替え（プリセット・チップ・CSV3列）

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: 統合検証・マージ・本番反映

**Files:** なし（運用手順）

- [ ] **Step 1: ローカル確認（プレビュー）**

preview_start（launch.json の dev サーバー）→ `/admin` を開き、アカウントタブで:
- リストが出る・展開できる・並び替え3ボタンが効く・チップで絞れる
- `resize_window` で 375px（iPhone幅）にし、横スクロールが出ないことをスクショで確認

- [ ] **Step 2: main へマージ・push**

```bash
git checkout main && git merge --no-ff feat/ledger-people-view -m "Merge branch 'feat/ledger-people-view'" && git push origin main
```

- [ ] **Step 3: migration 0019 をオーナーが適用**

Supabase SQL Editor（https://supabase.com/dashboard/project/_/sql/new）で `0019_cq_submissions.sql` を実行してもらう。適用後、RESTで実在確認し、`supabase/migrations/README.md` の 0019 行を ✅ に更新してコミット。

- [ ] **Step 4: バックフィル実行**

```bash
cd ~/medical-search-public && set -a && . ./.env.local && set +a && npx tsx scripts/backfill-cq-submissions.ts
```

Expected: 「走査 N 件 / 取り込み対象 M 件 / スキップ K 件」。M は通知同意者の投稿数と一致。

- [ ] **Step 5: 本番実測**

- 本番 `/admin` のアカウントタブでCQ件数・投票・カードバッジが実データで出ることを確認（オーナー目視依頼）
- `GET /api/admin/ledger` は管理者ガードがあるため、目視確認をもって完了とする

- [ ] **Step 6: 記憶の更新**

memory `medinode-admin-daily-command-center` 等に台帳再設計の完了を追記（別ファイル新設でも可）。
