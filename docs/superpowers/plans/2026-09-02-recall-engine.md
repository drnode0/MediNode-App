# Recall（知の球）定着エンジン 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 検証済みコーパスの主張を球に置き、忘れかけの主張だけをカードにして間隔反復する画面 Recall を、オーナー専用フラグの下で動く状態にする。

**Architecture:** 同期時に Notion 本文から主張を抽出して Supabase `recall_claims` に入れる。クライアントは主張と本人の記録を読み、純関数の配置層（フィボナッチ球面＋容量つき最近傍）と状態層（SRS の残り）を通して Canvas 2D で描く。記録は Route Handler 経由で本人の RLS 下に書く。管理画面に伏せ字候補の承認一覧を足す。

**Tech Stack:** Next.js (App Router) / TypeScript / Supabase (@supabase/ssr, RLS) / Notion API (@notionhq/client) / Canvas 2D / vitest

**Spec:** `docs/superpowers/specs/2026-09-02-recall-engine-design.md`

## Global Constraints

- 用語は 主張・残す・確かめる・定着・Recall。UI 文言に「粒」「振る」「拾う」「血肉」を使わない
- Recall は `hasFeature('recall')` が真の利用者にだけ見せる。偽なら画面・タブ・API（404）のいずれにも存在を出さない。専用 env は `RECALL_EMAILS`（フォールバック無し）。`RECALL_GA` は今回置かない
- 球に載せる主張: ✅（ok）と ⚠️（caut）の行、Essentials 形式の出典付き行。❓（unk）と参考文献DB・callout 内・見出し・署名は載せない
- ジャンル席は `GENRE_SEATS`（33席・番号順）で固定。位置は `fibPt(slot, 64)`。「その他」は slot 63。番号の振り直し禁止・追加は末尾のみ。INBOX は球に出さない
- 穴は数値のみ・同一文で上限3。語の伏せ字はしない。未承認の伏せ字候補は想起カード（全文伏せ）として出す
- SRS 段: `[1, 3, 7, 14, 30, 60, 120, 240, 365]` 日。「まだ」で段0へ。定着表示は間隔90日以上。離脱候補は残り `r < 0.28`、最大5枚
- 学習記録は Supabase。localStorage に置かない
- 配置・状態・描画を分離する。配置と状態は純関数で、実データ（`.preview/recall-corpus.json`・gitignore 済み）を通すテストを持つ。コーパス本文をリポジトリにコミットしない（公開リポ）
- 次のマイグレーション番号は 0029。`if not exists` で書く。台帳 `supabase/migrations/README.md` に行を足す
- 今日の1問の撤去は本計画に含めない（Recall がオーナー実測で動いた後に別計画で行う）
- 読む画面からの「残す」「節の読了」は本計画に含めない（Notion 落としと一体で設計する別計画）。API は本計画で用意する
- 事業数値・利用者数を、コード・コメント・コミット文に書かない
- 作業は worktree で行う（superpowers:using-git-worktrees）

---

## ファイル構成

| 種別 | パス | 責務 |
|---|---|---|
| Modify | `src/lib/feature-access.ts` | 機能 `recall` を追加 |
| Create | `src/lib/recall-flag.ts` | クライアント側の表示可否（features ミラー） |
| Create | `supabase/migrations/0029_recall.sql` | 4テーブル＋RLS |
| Modify | `supabase/migrations/README.md` | 台帳に 0029 |
| Create | `src/lib/recall/types.ts` | 型（RecallClaim・RecallProgress・RecallState など） |
| Create | `src/lib/recall/genres.ts` | 席の定義・主ジャンル・slot |
| Create | `src/lib/recall/extract-claims.ts` | Notion ブロック → 主張 |
| Create | `src/lib/recall/holes.ts` | 主張本文 → 穴の範囲 |
| Create | `src/lib/recall/sync-claims.ts` | 主張の upsert と inactive 化 |
| Modify | `src/app/api/subscription/sync/_core.ts` | 同期で主張を集めて保存 |
| Create | `src/lib/recall/layout.ts` | 配置（純関数） |
| Create | `src/lib/recall/srs.ts` | SRS・残り・状態・離脱候補（純関数） |
| Create | `src/app/api/recall/claims/route.ts` | GET 主張一覧 |
| Create | `src/app/api/recall/progress/route.ts` | GET 本人の記録 |
| Create | `src/app/api/recall/keep/route.ts` | POST 残す／外す |
| Create | `src/app/api/recall/read/route.ts` | POST 節の読了 |
| Create | `src/app/api/recall/review/route.ts` | POST 覚えた／まだ |
| Create | `src/lib/recall/guard.ts` | Recall ルートの共通ガード（404） |
| Create | `src/lib/recall/render.ts` | 描画（Canvas 2D。位置・状態・カメラを受けて描くだけ） |
| Create | `src/components/recall/useRecallData.ts` | 取得・状態計算・操作の hook |
| Create | `src/components/recall/RecallSphere.tsx` | canvas と操作（回す・寄る・タップ） |
| Create | `src/components/recall/RecallCard.tsx` | カード（伏せ字／想起、覚えた／まだ、閲覧＋残す） |
| Create | `src/components/recall/RecallScreen.tsx` | 画面（HUD・確かめる・山・凡例・レンズ） |
| Modify | `src/app/page.tsx` | タブ `recall` を追加（フラグ下） |
| Create | `src/app/api/admin/recall/cards/route.ts` | GET 候補一覧・PATCH 承認 |
| Create | `src/app/admin/RecallCardsPanel.tsx` | 承認一覧 |
| Modify | `src/app/admin/AdminLedgerClient.tsx` | パネルを置く |

テストは `src/lib/__tests__/recall-*.test.ts`。実データのテストは `.preview/recall-corpus.json` が無ければ skip する。

---

### Task 1: 機能フラグ `recall`

**Files:**
- Modify: `src/lib/feature-access.ts:12-33`
- Create: `src/lib/recall-flag.ts`
- Modify: `src/lib/settings.ts:50`（コメントに 'recall' を足すだけ）
- Test: `src/lib/__tests__/recall-flag.test.ts`

**Interfaces:**
- Produces: `hasFeature('recall', input)`（既存関数に値を足す）、`isRecallEnabled(): boolean`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/recall-flag.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { hasFeature, EARLY_ACCESS_FEATURES } from '@/lib/feature-access'

const ENV = { ...process.env }
afterEach(() => { process.env = { ...ENV } })

describe('feature recall', () => {
  it('EARLY_ACCESS_FEATURES に recall が末尾で入る', () => {
    expect(EARLY_ACCESS_FEATURES[EARLY_ACCESS_FEATURES.length - 1]).toBe('recall')
  })
  it('RECALL_EMAILS に載ったメールだけ真。EARLY_ACCESS_EMAILS には落ちない', () => {
    process.env.RECALL_EMAILS = 'owner@example.com'
    process.env.EARLY_ACCESS_EMAILS = 'monitor@example.com'
    expect(hasFeature('recall', { email: 'owner@example.com' })).toBe(true)
    expect(hasFeature('recall', { email: 'monitor@example.com' })).toBe(false)
  })
  it('RECALL_EMAILS が空のとき、EARLY_ACCESS_EMAILS にいても偽', () => {
    delete process.env.RECALL_EMAILS
    process.env.EARLY_ACCESS_EMAILS = 'monitor@example.com'
    expect(hasFeature('recall', { email: 'monitor@example.com' })).toBe(false)
  })
  it('レガシー boolean では開かない', () => {
    delete process.env.RECALL_EMAILS
    expect(hasFeature('recall', { email: 'x@example.com', ledgerEarlyAccess: true })).toBe(false)
  })
})

describe('isRecallEnabled', () => {
  beforeEach(() => { vi.resetModules() })
  it('features ミラーに recall があれば真、無ければ偽、settings が無ければ偽', async () => {
    vi.doMock('@/lib/settings', () => ({ getSettings: () => ({ earlyAccessFeatures: ['recall'] }) }))
    expect((await import('@/lib/recall-flag')).isRecallEnabled()).toBe(true)
    vi.resetModules()
    vi.doMock('@/lib/settings', () => ({ getSettings: () => ({ earlyAccessFeatures: ['tower'] }) }))
    expect((await import('@/lib/recall-flag')).isRecallEnabled()).toBe(false)
    vi.resetModules()
    vi.doMock('@/lib/settings', () => ({ getSettings: () => null }))
    expect((await import('@/lib/recall-flag')).isRecallEnabled()).toBe(false)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/__tests__/recall-flag.test.ts`
Expected: FAIL（`recall` が型に無い／`@/lib/recall-flag` が無い）

- [ ] **Step 3: 実装する**

`src/lib/feature-access.ts` の2か所を変える。

```ts
export const EARLY_ACCESS_FEATURES = ['easy_connect', 'multi_department', 'tower', 'personal_reader', 'recall'] as const
```

`FEATURE_ENV` の末尾に追加:

```ts
  // Recall（知の球）。drnode.com 版の大型アップデートまでオーナー専用。専用リストのみ・
  // フォールバック無し（EARLY_ACCESS_EMAILS に落とすと他機能のモニターに開いてしまう）。
  // 全員開放の RECALL_GA は公開判断が下りるまで置かない。
  recall: { ga: 'RECALL_GA', emails: 'RECALL_EMAILS' },
```

`src/lib/recall-flag.ts` を作る:

```ts
// Recall（知の球）の表示可否（表示制御のみ・判定の正はサーバー）。
// サーバーが配る features ミラー（settings.earlyAccessFeatures）に 'recall' があるかを見る。
// personal-reader-flag と同型。レガシー earlyAccess(boolean) へのフォールバックはしない。
import { getSettings } from './settings'

export function isRecallEnabled(): boolean {
  try {
    const s = getSettings()
    if (!s) return false
    return Array.isArray(s.earlyAccessFeatures) && s.earlyAccessFeatures.includes('recall')
  } catch {
    return false
  }
}
```

`src/lib/settings.ts:50` のコメントを `// 値は 'easy_connect' / 'multi_department' / 'tower' / 'personal_reader' / 'recall'。` に直す。

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/lib/__tests__/recall-flag.test.ts src/lib/__tests__/feature-access.test.ts src/lib/__tests__/session-features.test.ts src/lib/__tests__/premium-status-features.test.ts src/lib/__tests__/ledger-feature-toggle.test.ts`
Expected: すべて PASS（既存テストが `EARLY_ACCESS_FEATURES.length` を固定値で見ていたら、その期待値を5に直す）

- [ ] **Step 5: env を置く（オーナー作業の案内）**

`.env.local` に `RECALL_EMAILS=<オーナーのメール>` を足す（コミットしない。`.gitignore` の `.env*` で除外済み）。Vercel の環境変数にも同じ名前で置く。これは Claude が代行しない。計画の最後にオーナーへ案内する。

- [ ] **Step 6: Commit**

```bash
git add src/lib/feature-access.ts src/lib/recall-flag.ts src/lib/settings.ts src/lib/__tests__/recall-flag.test.ts
git commit -m "feat(recall): 機能フラグ recall を追加（RECALL_EMAILS・フォールバック無し）"
```

---

### Task 2: マイグレーション 0029

**Files:**
- Create: `supabase/migrations/0029_recall.sql`
- Modify: `supabase/migrations/README.md`

**Interfaces:**
- Produces: テーブル `recall_claims` / `recall_section_reads` / `recall_progress` / `recall_review_log`

- [ ] **Step 1: SQL を書く**

```sql
-- Recall（知の球）定着エンジン。設計: docs/superpowers/specs/2026-09-02-recall-engine-design.md
--
-- recall_claims: 公開コーパスの主張（1行=主張1つ）。同期（service_role）が書き、ログイン利用者が読む。
-- recall_section_reads: 読んだ節（本人が書く）。主張ごとに行を持たない。
-- recall_progress: 残した主張の記録と SRS の状態（本人が書く）。
-- recall_review_log: 覚えた／まだ の追記ログ（本人が書く）。

create table if not exists public.recall_claims (
  claim_id         text primary key,
  page_id          text not null,
  page_title       text not null,
  page_kind        text not null default '',
  section_key      text not null default '',
  section_heading  text not null default '',
  body             text not null,
  source           text not null default '',
  confidence       text not null,              -- ok / caut / essentials
  genres           text[] not null default '{}',
  primary_genre    text not null default '',
  genre_slot       int  not null default 63,   -- 0..63。63 = その他
  holes            jsonb not null default '[]'::jsonb,
  cloze_status     text not null default 'pending',  -- pending / approved / rejected
  active           boolean not null default true,
  revised_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists recall_claims_page_id_idx on public.recall_claims (page_id);
create index if not exists recall_claims_active_idx on public.recall_claims (active);

alter table public.recall_claims enable row level security;
drop policy if exists recall_claims_select_active on public.recall_claims;
create policy recall_claims_select_active on public.recall_claims
  for select to authenticated using (active = true);
-- 書き込みは service_role のみ（ポリシー無し）。

create table if not exists public.recall_section_reads (
  user_id      uuid not null,
  page_id      text not null,
  section_key  text not null,
  read_at      timestamptz not null default now(),
  primary key (user_id, page_id, section_key)
);
alter table public.recall_section_reads enable row level security;
drop policy if exists recall_section_reads_own on public.recall_section_reads;
create policy recall_section_reads_own on public.recall_section_reads
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.recall_progress (
  user_id           uuid not null,
  claim_id          text not null,
  kept_at           timestamptz not null default now(),
  streak            int  not null default 0,
  interval_days     int  not null default 1,
  due_at            timestamptz not null default now(),
  last_reviewed_at  timestamptz,
  last_result       text,                       -- ok / ng / null
  ok_count          int  not null default 0,
  ng_count          int  not null default 0,
  removed_at        timestamptz,
  updated_at        timestamptz not null default now(),
  primary key (user_id, claim_id)
);
create index if not exists recall_progress_due_idx on public.recall_progress (user_id, due_at);
alter table public.recall_progress enable row level security;
drop policy if exists recall_progress_own on public.recall_progress;
create policy recall_progress_own on public.recall_progress
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.recall_review_log (
  id               bigserial primary key,
  user_id          uuid not null,
  claim_id         text not null,
  result           text not null,               -- ok / ng
  interval_before  int  not null,
  interval_after   int  not null,
  reviewed_at      timestamptz not null default now()
);
create index if not exists recall_review_log_user_idx on public.recall_review_log (user_id, reviewed_at);
alter table public.recall_review_log enable row level security;
drop policy if exists recall_review_log_own_select on public.recall_review_log;
create policy recall_review_log_own_select on public.recall_review_log
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists recall_review_log_own_insert on public.recall_review_log;
create policy recall_review_log_own_insert on public.recall_review_log
  for insert to authenticated with check (auth.uid() = user_id);
```

- [ ] **Step 2: 台帳に行を足す**

`supabase/migrations/README.md` の表末尾に追加:

```
| 0029 | recall | `recall_claims`, `recall_section_reads`, `recall_progress`, `recall_review_log` | ⬜ 未適用 |
```

表の直前の見出しに「0027 は欠番（採番飛び）」の1行を注記する。

- [ ] **Step 3: 本番に流す（オーナー作業）**

Supabase SQL Editor に貼って実行し、台帳の ⬜ を ✅ に変える。これは Claude が代行しない。Task 9 のルートを動かす前に必要。

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0029_recall.sql supabase/migrations/README.md
git commit -m "feat(recall): マイグレーション 0029（主張・節の読了・記録・ログ）"
```

---

### Task 3: 型とジャンル席

**Files:**
- Create: `src/lib/recall/types.ts`
- Create: `src/lib/recall/genres.ts`
- Test: `src/lib/__tests__/recall-genres.test.ts`

**Interfaces:**
- Produces:
  - `type RecallClaim = { claimId: string; pageId: string; pageTitle: string; pageKind: string; sectionKey: string; sectionHeading: string; body: string; source: string; confidence: 'ok' | 'caut' | 'essentials'; genres: string[]; primaryGenre: string; genreSlot: number; holes: [number, number][]; clozeStatus: 'pending' | 'approved' | 'rejected'; active: boolean }`
  - `type RecallProgress = { claimId: string; keptAt: string; streak: number; intervalDays: number; dueAt: string; lastReviewedAt: string | null; lastResult: 'ok' | 'ng' | null; okCount: number; ngCount: number; removedAt: string | null }`
  - `type RecallSectionRead = { pageId: string; sectionKey: string; readAt: string }`
  - `GENRE_SEATS: readonly string[]`（33件）、`GENRE_CAPACITY = 64`、`OTHER_SLOT = 63`
  - `genreSlotOf(genre: string): number`、`primaryGenreOf(genres: string[]): { genre: string; slot: number } | null`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/recall-genres.test.ts
import { describe, it, expect } from 'vitest'
import { GENRE_SEATS, GENRE_CAPACITY, OTHER_SLOT, genreSlotOf, primaryGenreOf } from '@/lib/recall/genres'

describe('ジャンル席', () => {
  it('33席が番号順に並び、収容数は64、その他は63', () => {
    expect(GENRE_SEATS).toHaveLength(33)
    expect(GENRE_SEATS[0]).toBe('01.総論')
    expect(GENRE_SEATS[32]).toBe('33.精神科')
    expect(GENRE_CAPACITY).toBe(64)
    expect(OTHER_SLOT).toBe(63)
  })
  it('番号付き・番号なし（正規化名）のどちらでも同じ席に落ちる', () => {
    expect(genreSlotOf('04.呼吸')).toBe(3)
    expect(genreSlotOf('呼吸')).toBe(3)
    expect(genreSlotOf('04．呼吸')).toBe(3)
  })
  it('未定義のジャンルは その他 に落ちる', () => {
    expect(genreSlotOf('宇宙医学')).toBe(OTHER_SLOT)
  })
  it('主ジャンルは並びの1つ目。INBOX は飛ばす。INBOX だけなら null', () => {
    expect(primaryGenreOf(['13.感染症', '04.呼吸'])).toEqual({ genre: '13.感染症', slot: 12 })
    expect(primaryGenreOf(['INBOX', '05.循環'])).toEqual({ genre: '05.循環', slot: 4 })
    expect(primaryGenreOf(['INBOX'])).toBeNull()
    expect(primaryGenreOf([])).toBeNull()
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/__tests__/recall-genres.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

```ts
// src/lib/recall/types.ts
export type RecallConfidence = 'ok' | 'caut' | 'essentials'
export type ClozeStatus = 'pending' | 'approved' | 'rejected'

export type RecallClaim = {
  claimId: string
  pageId: string
  pageTitle: string
  pageKind: string
  sectionKey: string
  sectionHeading: string
  body: string
  source: string
  confidence: RecallConfidence
  genres: string[]
  primaryGenre: string
  genreSlot: number
  holes: [number, number][]
  clozeStatus: ClozeStatus
  active: boolean
}

export type RecallProgress = {
  claimId: string
  keptAt: string
  streak: number
  intervalDays: number
  dueAt: string
  lastReviewedAt: string | null
  lastResult: 'ok' | 'ng' | null
  okCount: number
  ngCount: number
  removedAt: string | null
}

export type RecallSectionRead = { pageId: string; sectionKey: string; readAt: string }

// 4段の光。cold=未着手 / touched=読んだ / kept=残した / settled=定着
export type RecallStateKind = 'cold' | 'touched' | 'kept' | 'settled'
export type RecallState = { kind: RecallStateKind; remaining: number } // remaining 0..1（kept/settled 以外は 0）
```

```ts
// src/lib/recall/genres.ts
// ジャンル席。球の中心を決める唯一の定義。
// 番号の振り直しは禁止（球が組み替わり genreHueIndex の色も同時にずれる）。追加は末尾のみ。
// 位置は fibPt(slot, GENRE_CAPACITY) で計算するので、末尾に足しても既存の中心は動かない。
import { canonicalGenreKey } from '@/lib/genre'

export const GENRE_SEATS = [
  '01.総論', '02.医療倫理', '03.救急蘇生', '04.呼吸', '05.循環', '06.中枢神経', '07.腎',
  '08.肝・胆道系', '09.膵', '10.消化管・その他腹部', '11.血液凝固線溶系', '12.代謝内分泌',
  '13.感染症', '14.多臓器障害', '15.外傷・整形', '16.熱傷', '17.急性中毒', '18.体温異常',
  '19.妊産婦', '20.小児', '21.移植', '22.輸液・輸血・水電解質', '23.栄養', '24.画像診断',
  '25.集中治療医', '26.手技', '27.薬剤', '28.災害', '29.学会', '30.統計・研究', '31.マイナー',
  '32.リハビリ', '33.精神科',
] as const

export const GENRE_CAPACITY = 64
export const OTHER_SLOT = 63
const INBOX = 'INBOX'

const SLOT_BY_KEY = new Map<string, number>(GENRE_SEATS.map((g, i) => [canonicalGenreKey(g), i]))

export function genreSlotOf(genre: string): number {
  const slot = SLOT_BY_KEY.get(canonicalGenreKey(genre))
  return slot === undefined ? OTHER_SLOT : slot
}

// 主ジャンル＝Notion の並びの1つ目。INBOX は飛ばす。
export function primaryGenreOf(genres: string[]): { genre: string; slot: number } | null {
  for (const g of genres) {
    if (canonicalGenreKey(g).toUpperCase() === INBOX) continue
    return { genre: g, slot: genreSlotOf(g) }
  }
  return null
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/lib/__tests__/recall-genres.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/recall/types.ts src/lib/recall/genres.ts src/lib/__tests__/recall-genres.test.ts
git commit -m "feat(recall): 型とジャンル席（33席・収容64・その他63）"
```

---

### Task 4: 主張の抽出

**Files:**
- Create: `src/lib/recall/extract-claims.ts`
- Test: `src/lib/__tests__/recall-extract-claims.test.ts`

**Interfaces:**
- Consumes: `NotionBlockLite`, `blockText`（`@/lib/content-stats`）、`primaryGenreOf`（Task 3）、`detectHoles`（Task 5。ここでは呼ばず、`holes: []` で返す。Task 5 で結線する）
- Produces:
  - `type ClaimSource = { pageId: string; pageTitle: string; pageKind: string; genres: string[]; blocks: NotionBlockLite[] }`
  - `extractClaims(src: ClaimSource): RecallClaim[]`（❓は除外、INBOX のみのページは空配列）
  - `claimIdOf(pageId: string, body: string): string`
  - `normalizeBody(s: string): string`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/recall-extract-claims.test.ts
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { extractClaims, claimIdOf, normalizeBody } from '@/lib/recall/extract-claims'

const li = (text: string, children?: unknown[]) => ({
  type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ plain_text: text }] }, ...(children ? { children } : {}),
})
const h2 = (text: string) => ({ type: 'heading_2', heading_2: { rich_text: [{ plain_text: text }] } })
const callout = (children: unknown[]) => ({ type: 'callout', callout: { rich_text: [{ plain_text: '⚡ 結論' }] }, children })
const base = { pageId: 'p1', pageTitle: '💡 テスト', pageKind: '💡', genres: ['05.循環'] }

describe('extractClaims', () => {
  it('確信度マーク行を主張にし、本文と出典に分け、✅→ok ⚠️→caut、❓は除外', () => {
    const out = extractClaims({ ...base, blocks: [
      h2('1. 定義'),
      li('低血圧はショックの要件ではない。✅ ESICM 合意 2014'),
      li('乳酸値は施設で扱いが違う。⚠️ 施設差あり'),
      li('この点は不明確である。❓'),
    ] })
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ body: '低血圧はショックの要件ではない。', source: '✅ ESICM 合意 2014', confidence: 'ok', sectionKey: 'sec1', sectionHeading: '1. 定義', primaryGenre: '05.循環', genreSlot: 4 })
    expect(out[1].confidence).toBe('caut')
  })
  it('Essentials 形式（句点のあと短い出典）を essentials として拾い、普通の文は拾わない', () => {
    const out = extractClaims({ ...base, blocks: [
      li('酸素化の目標は SpO2 92〜96% とする。BTS 2017'),
      li('この節では呼吸不全の定義を扱う。'),
    ] })
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ body: '酸素化の目標は SpO2 92〜96% とする。', source: 'BTS 2017', confidence: 'essentials' })
  })
  it('callout の中（結論ボックス・署名）は拾わない。入れ子の箇条書きは拾う', () => {
    const out = extractClaims({ ...base, blocks: [
      callout([li('結論の要約。✅ 出典')]),
      li('親の主張。✅ 出典A', [li('子の主張。✅ 出典B')]),
    ] })
    expect(out.map((c) => c.body)).toEqual(['親の主張。', '子の主張。'])
  })
  it('ID はページIDと正規化本文から決まり、空白・選択子の揺れで変わらない', () => {
    expect(claimIdOf('p1', '低血圧は  要件ではない。')).toBe(claimIdOf('p1', '低血圧は 要件ではない。'))
    expect(claimIdOf('p1', 'a')).not.toBe(claimIdOf('p2', 'a'))
    expect(normalizeBody('⚠️')).toBe('⚠')
  })
  it('INBOX しかないページは主張を返さない', () => {
    expect(extractClaims({ ...base, genres: ['INBOX'], blocks: [li('x。✅ y')] })).toEqual([])
  })
})

// 実データ（gitignore 済み）。無ければ skip。
const CORPUS = '.preview/recall-corpus.json'
describe.skipIf(!existsSync(CORPUS))('extractClaims 実コーパス', () => {
  it('27ページから ✅⚠️ と Essentials の主張が 680〜700 件（❓9件を除いた基準 691 の±1.5%）', () => {
    const docs = JSON.parse(readFileSync(CORPUS, 'utf-8')) as Array<{ id: string; props: Record<string, string>; blocks: never[] }>
    const all = docs.flatMap((d) => extractClaims({
      pageId: d.id, pageTitle: d.props['名前'] || '', pageKind: '',
      genres: (d.props['ジャンル'] || '').split(',').map((s) => s.trim()).filter(Boolean), blocks: d.blocks,
    }))
    expect(all.length).toBeGreaterThanOrEqual(680)
    expect(all.length).toBeLessThanOrEqual(700)
    expect(all.filter((c) => c.confidence === 'essentials').length).toBeGreaterThanOrEqual(80)
    expect(new Set(all.map((c) => c.claimId)).size).toBe(all.length)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/__tests__/recall-extract-claims.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

```ts
// src/lib/recall/extract-claims.ts
// Notion ブロック列 → 主張。判定は前セッションの計測スクリプトと同じ2形式:
//  形式A: 行に確信度マーク（✅⚠❓）。マークより前が本文、マーク以降が出典。❓は除外
//  形式B: 句点の後ろに 2〜40字の出典断片（年号か出典語を含む）。Essentials の節末主張
// callout の中（⚡結論・署名）は拾わない。入れ子の箇条書きは拾う。
import { createHash } from 'crypto'
import { blockText, type NotionBlockLite } from '@/lib/content-stats'
import { primaryGenreOf } from './genres'
import type { RecallClaim, RecallConfidence } from './types'

export type ClaimSource = { pageId: string; pageTitle: string; pageKind: string; genres: string[]; blocks: NotionBlockLite[] }

const MARK = /[✅⚠❓]/u
const TAIL = /[。）)]\s*([^。]{2,40})$/u
const SRCWORD = /(?:19|20)\d{2}|ガイドライン|合意|提言|指針|学会|Guideline|BTS|ERS|ATS|ESICM|JAMA|NEJM|Lancet|Chest|ICM/u
const SECTION_HEAD_RE = /^(\d+)\.\s*(.+)$/

export function normalizeBody(s: string): string {
  return s.normalize('NFC').replace(/️/g, '').replace(/\s+/g, ' ').trim()
}

export function claimIdOf(pageId: string, body: string): string {
  return createHash('sha1').update(`${pageId}\n${normalizeBody(body)}`).digest('hex').slice(0, 24)
}

type Split = { body: string; source: string; confidence: RecallConfidence } | null

function splitClaim(text: string): Split {
  const s = text.trim()
  const mi = s.search(MARK)
  if (mi >= 0) {
    const mark = s[mi]
    if (mark === '❓') return null
    return { body: s.slice(0, mi).trim(), source: s.slice(mi).trim(), confidence: mark === '✅' ? 'ok' : 'caut' }
  }
  const m = s.match(TAIL)
  if (m && SRCWORD.test(m[1]) && !/。$/.test(m[1])) {
    return { body: s.slice(0, s.length - m[1].length).trim(), source: m[1].trim(), confidence: 'essentials' }
  }
  return null
}

type Ctx = { sectionKey: string; sectionHeading: string; inCallout: boolean }

export function extractClaims(src: ClaimSource): RecallClaim[] {
  const primary = primaryGenreOf(src.genres)
  if (!primary) return []
  const out: RecallClaim[] = []
  const seen = new Set<string>()

  const walk = (blocks: NotionBlockLite[], ctx: Ctx) => {
    let cur = ctx
    for (const b of blocks) {
      const text = blockText(b)
      if (b.type === 'heading_2') {
        const m = text.trim().match(SECTION_HEAD_RE)
        cur = { ...cur, sectionKey: m ? `sec${m[1]}` : cur.sectionKey, sectionHeading: text.trim() }
      }
      const isItem = b.type === 'bulleted_list_item' || b.type === 'numbered_list_item'
      if (isItem && !cur.inCallout && text.trim()) {
        const sp = splitClaim(text)
        if (sp && sp.body) {
          const claimId = claimIdOf(src.pageId, sp.body)
          if (!seen.has(claimId)) {
            seen.add(claimId)
            out.push({
              claimId, pageId: src.pageId, pageTitle: src.pageTitle, pageKind: src.pageKind,
              sectionKey: cur.sectionKey, sectionHeading: cur.sectionHeading,
              body: sp.body, source: sp.source, confidence: sp.confidence,
              genres: src.genres, primaryGenre: primary.genre, genreSlot: primary.slot,
              holes: [], clozeStatus: 'pending', active: true,
            })
          }
        }
      }
      const children = (b as { children?: NotionBlockLite[] }).children
      if (Array.isArray(children) && children.length) {
        walk(children, { ...cur, inCallout: cur.inCallout || b.type === 'callout' })
      }
    }
  }
  walk(src.blocks, { sectionKey: 'sec0', sectionHeading: '', inCallout: false })
  return out
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/lib/__tests__/recall-extract-claims.test.ts`
Expected: PASS（実コーパスの件数が範囲を外れたら、`splitClaim` を前セッションの `build-grains.mjs` と突き合わせて直す。範囲の方は動かさない）

- [ ] **Step 5: Commit**

```bash
git add src/lib/recall/extract-claims.ts src/lib/__tests__/recall-extract-claims.test.ts
git commit -m "feat(recall): Notion 本文から主張を抽出（2形式・❓除外・callout 除外）"
```

---

### Task 5: 穴の検出

**Files:**
- Create: `src/lib/recall/holes.ts`
- Modify: `src/lib/recall/extract-claims.ts`（`holes: detectHoles(sp.body)` に結線）
- Test: `src/lib/__tests__/recall-holes.test.ts`

**Interfaces:**
- Produces: `detectHoles(body: string): [number, number][]`（上限3・重なりなし・開始位置順）、`MAX_HOLES = 3`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/recall-holes.test.ts
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { detectHoles, MAX_HOLES } from '@/lib/recall/holes'

const cut = (s: string) => detectHoles(s).map(([a, b]) => s.slice(a, b))

describe('detectHoles', () => {
  it('閾値の数値を穴にし、同種が並べば上限3', () => {
    const s = '動脈性低血圧は収縮期血圧90 mmHg未満、平均動脈圧65 mmHg未満、またはベースラインから40 mmHg以上の低下と定義される。'
    expect(cut(s)).toEqual(['90 mmHg未満', '65 mmHg未満', '40 mmHg以上'])
    expect(MAX_HOLES).toBe(3)
  })
  it('範囲と単位値も穴にする', () => {
    expect(cut('SpO2 は 92〜96% を目標とする。')).toEqual(['92〜96%'])
    expect(cut('初期輸液は 30 mL/kg を3時間以内に投与する。')).toEqual(['30 mL/kg', '3時間'])
  })
  it('研究記述子・出典番号・年号は穴にしない', () => {
    expect(cut('合意率92.3%で採択された（statement 9）。')).toEqual([])
    expect(cut('死亡率は RR 0.61（95% CI 0.45〜0.82、p=0.001）であった。')).toEqual([])
    expect(cut('2021年版ガイドラインで推奨 12 に記載。')).toEqual([])
    expect(cut('n=1,234 例の RCT。')).toEqual([])
  })
  it('数値の無い主張は空', () => {
    expect(cut('代償性の血管収縮が血圧を保つ一方で、組織灌流は低下している。')).toEqual([])
  })
  it('範囲は重ならず開始位置順', () => {
    for (const s of ['体温 38.3℃以上 または 36℃未満。', '尿量 0.5 mL/kg/時 未満が 6時間。']) {
      const h = detectHoles(s)
      for (let i = 1; i < h.length; i++) expect(h[i][0]).toBeGreaterThanOrEqual(h[i - 1][1])
    }
  })
})

const CORPUS = '.preview/recall-corpus.json'
describe.skipIf(!existsSync(CORPUS))('detectHoles 実コーパス', () => {
  it('穴を持つ主張が 360〜400、穴の総数が 600〜700（基準 380／652）', async () => {
    const { extractClaims } = await import('@/lib/recall/extract-claims')
    const docs = JSON.parse(readFileSync(CORPUS, 'utf-8')) as Array<{ id: string; props: Record<string, string>; blocks: never[] }>
    const all = docs.flatMap((d) => extractClaims({
      pageId: d.id, pageTitle: d.props['名前'] || '', pageKind: '',
      genres: (d.props['ジャンル'] || '').split(',').map((s) => s.trim()).filter(Boolean), blocks: d.blocks,
    }))
    const withHoles = all.filter((c) => c.holes.length)
    expect(withHoles.length).toBeGreaterThanOrEqual(360)
    expect(withHoles.length).toBeLessThanOrEqual(400)
    const total = withHoles.reduce((n, c) => n + c.holes.length, 0)
    expect(total).toBeGreaterThanOrEqual(600)
    expect(total).toBeLessThanOrEqual(700)
    expect(all.every((c) => c.holes.length <= 3)).toBe(true)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/__tests__/recall-holes.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

```ts
// src/lib/recall/holes.ts
// 主張本文の中で伏せ字にする数値の範囲。前セッションの build-grains.mjs と同じ規則:
//  1) 研究記述子・出典番号・年号を空白でマスクする（穴にしない）
//  2) 閾値 → 範囲 → 単位値 の優先順で、最初に当たった種類だけを最大3つ取る
//     （同種の数値が同一文に並ぶときだけ複数穴。異種を混ぜると文が読めなくなる）
export const MAX_HOLES = 3

const UNIT = '%|％|mmHg|mmol\\/L|mEq\\/L|mg\\/dL|kPa|mL\\/kg\\/時|mL\\/時|mL\\/kg|mL|L\\/分|L|時間|分|秒|日|点|℃|g\\/dL|mg|kg|IU|回\\/分'

const NOISE: RegExp[] = [
  /(?:CQ|BQ|FRQ)\s*\d+(?:[-–]\d+)*/gu,
  /(?:statement|Table|Figure|表|図|推奨|Box)\s*\d+/giu,
  /第\s*\d+\s*版/gu,
  /(?:19|20)\d{2}\s*年?(?:版|度)?/gu,
  /95\s*%\s*CI[^。]{0,24}/gu,
  /[pP]\s*[=＝<＜>＞]\s*0?\.\d+/gu,
  /合意率\s*\d+(?:\.\d+)?\s*%?/gu,
  /(?:オッズ比|ハザード比|リスク比|OR|HR|RR|κ)\s*(?:は|=|＝|:|：)?\s*\d+(?:\.\d+)?/gu,
  /(?:n\s*=\s*)?\d{1,3}(?:,\d{3})*\s*(?:例|人|件|施設|試験|報|RCT)/gu,
]

const RANKED: RegExp[] = [
  new RegExp('\\d+(?:[,.]\\d+)?\\s*(?:' + UNIT + ')?\\s*(?:未満|以上|以下|超|を超え|より低|より高)', 'gu'),
  new RegExp('\\d+(?:\\.\\d+)?\\s*[〜~–—]\\s*\\d+(?:\\.\\d+)?\\s*(?:' + UNIT + ')?', 'gu'),
  new RegExp('\\d+(?:[,.]\\d+)?\\s*(?:' + UNIT + ')', 'gu'),
]

export function detectHoles(body: string): [number, number][] {
  let masked = body
  for (const re of NOISE) masked = masked.replace(re, (m) => ' '.repeat(m.length))
  for (const re of RANKED) {
    const ms = [...masked.matchAll(re)].filter((m) => m[0].trim().length > 0 && m.index !== undefined)
    if (!ms.length) continue
    return ms.slice(0, MAX_HOLES).map((m) => [m.index as number, (m.index as number) + m[0].length])
  }
  return []
}
```

`extract-claims.ts` に `import { detectHoles } from './holes'` を足し、`holes: []` を `holes: detectHoles(sp.body)` に変える。

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/lib/__tests__/recall-holes.test.ts src/lib/__tests__/recall-extract-claims.test.ts`
Expected: PASS（「初期輸液は 30 mL/kg を3時間以内」の期待が外れたら、閾値の正規表現が `3時間以内` を拾わないことを確認し、期待側を `['30 mL/kg']` に直す。優先順の規則は変えない）

- [ ] **Step 5: Commit**

```bash
git add src/lib/recall/holes.ts src/lib/recall/extract-claims.ts src/lib/__tests__/recall-holes.test.ts
git commit -m "feat(recall): 数値の穴を検出（研究記述子を除外・同種のみ上限3）"
```

---

### Task 6: 同期で主張を保存

**Files:**
- Create: `src/lib/recall/sync-claims.ts`
- Modify: `src/app/api/subscription/sync/_core.ts:155-234, 360-420`
- Test: `src/lib/__tests__/recall-sync-claims.test.ts`

**Interfaces:**
- Consumes: `extractClaims`（Task 4）、`createAdminClient`（`@/lib/supabase/server`）
- Produces: `saveRecallClaims(admin, claims: RecallClaim[]): Promise<{ upserted: number; deactivated: number }>`。`SyncResult` に `recallClaims: number` を足す

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/recall-sync-claims.test.ts
import { describe, it, expect, vi } from 'vitest'
import { saveRecallClaims } from '@/lib/recall/sync-claims'
import type { RecallClaim } from '@/lib/recall/types'

const claim = (id: string): RecallClaim => ({
  claimId: id, pageId: 'p', pageTitle: 't', pageKind: '💡', sectionKey: 'sec1', sectionHeading: '1. x',
  body: 'b', source: 's', confidence: 'ok', genres: ['05.循環'], primaryGenre: '05.循環', genreSlot: 4,
  holes: [], clozeStatus: 'pending', active: true,
})

function fakeAdmin() {
  const upsert = vi.fn(async () => ({ error: null }))
  const update = vi.fn(() => ({ eq: () => ({ not: vi.fn(async () => ({ error: null, count: 2 })) }) }))
  const admin = { from: vi.fn(() => ({ upsert, update })) }
  return { admin, upsert, update }
}

describe('saveRecallClaims', () => {
  it('主張を claim_id で upsert し、cloze_status は上書きしない。見つからなかった主張を inactive にする', async () => {
    const { admin, upsert, update } = fakeAdmin()
    const res = await saveRecallClaims(admin as never, [claim('a'), claim('b')])
    expect(upsert).toHaveBeenCalledTimes(1)
    const [rows, opts] = upsert.mock.calls[0] as unknown as [Array<Record<string, unknown>>, Record<string, unknown>]
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ claim_id: 'a', genre_slot: 4, active: true })
    expect(rows[0]).not.toHaveProperty('cloze_status')
    expect(opts).toMatchObject({ onConflict: 'claim_id' })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ active: false }))
    expect(res).toEqual({ upserted: 2, deactivated: 2 })
  })
  it('主張が0件なら何も書かない（同期失敗で全部 inactive にしない）', async () => {
    const { admin, upsert, update } = fakeAdmin()
    const res = await saveRecallClaims(admin as never, [])
    expect(upsert).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(res).toEqual({ upserted: 0, deactivated: 0 })
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/__tests__/recall-sync-claims.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

```ts
// src/lib/recall/sync-claims.ts
// 抽出した主張を recall_claims に保存する。同期のたびに全件 upsert し、今回見つからなかった
// 主張を active=false にする（行は消さない。ユーザーの記録が主張IDにぶら下がる）。
// cloze_status（承認状態）と holes 以外の列は上書きしてよいが、cloze_status は管理画面の
// 判断なので同期では触らない。holes は検出規則が変わったら更新したいので上書きする。
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RecallClaim } from './types'

const CHUNK = 200

export async function saveRecallClaims(
  admin: SupabaseClient,
  claims: RecallClaim[],
): Promise<{ upserted: number; deactivated: number }> {
  if (!claims.length) return { upserted: 0, deactivated: 0 }
  const now = new Date().toISOString()
  for (let i = 0; i < claims.length; i += CHUNK) {
    const rows = claims.slice(i, i + CHUNK).map((c) => ({
      claim_id: c.claimId, page_id: c.pageId, page_title: c.pageTitle, page_kind: c.pageKind,
      section_key: c.sectionKey, section_heading: c.sectionHeading, body: c.body, source: c.source,
      confidence: c.confidence, genres: c.genres, primary_genre: c.primaryGenre, genre_slot: c.genreSlot,
      holes: c.holes, active: true, updated_at: now,
    }))
    const { error } = await admin.from('recall_claims').upsert(rows, { onConflict: 'claim_id' })
    if (error) throw new Error(`recall_claims upsert 失敗: ${error.message}`)
  }
  const ids = claims.map((c) => c.claimId)
  const { error, count } = await admin
    .from('recall_claims')
    .update({ active: false, updated_at: now }, { count: 'exact' })
    .eq('active', true)
    .not('claim_id', 'in', `(${ids.map((id) => `"${id}"`).join(',')})`)
  if (error) throw new Error(`recall_claims inactive 化失敗: ${error.message}`)
  return { upserted: claims.length, deactivated: count ?? 0 }
}
```

`_core.ts` の変更:

1. import を足す: `import { extractClaims } from '@/lib/recall/extract-claims'`、`import { saveRecallClaims } from '@/lib/recall/sync-claims'`、`import { createAdminClient } from '@/lib/supabase/server'`、`import type { RecallClaim } from '@/lib/recall/types'`
2. `syncMedicalDb` の引数に `claims: RecallClaim[]` を足し、`records.push(record)` の直後に:

```ts
      if (blocks) {
        claims.push(...extractClaims({
          pageId: page.id, pageTitle: title, pageKind: title.trim().slice(0, 2).trim(),
          genres: extractList(props['ジャンル'] || {}), blocks,
        }))
      }
```

3. `SyncResult.synced` に `recallClaims: number` を足す
4. `runSubscriptionSync` で `const claims: RecallClaim[] = []` を作り `syncMedicalDb(notion, medicalDbId!, records, claims)` に渡す。Algolia 保存の後に:

```ts
  // Recall の主張。Supabase が未設定の環境（ローカルの Algolia だけの検証）では飛ばす。
  let recallClaims = 0
  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const saved = await saveRecallClaims(createAdminClient(), claims)
    recallClaims = saved.upserted
  }
```

戻り値の `synced` に `recallClaims` を入れる。

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/lib/__tests__/recall-sync-claims.test.ts src/lib/__tests__/admin-subscription-sync-route.test.ts`
Expected: PASS（既存の同期テストが `synced` の形を固定で比較していたら `recallClaims` を期待に足す）

- [ ] **Step 5: 実環境で1回流す（0029 適用後）**

管理画面の「サブスク同期」ボタンを押し、応答の `synced.recallClaims` が 680〜700 であることを見る。Supabase で `select count(*) from recall_claims where active` を確認する。足りなければ入れ子の箇条書きが `fetchPageBlocks` で取れていない可能性が高い（`expandChildren` はクイズ候補のみ）。その場合は `syncMedicalDb` で全ページ `expandChildren` を呼ぶ変更を追加コミットで入れる。

- [ ] **Step 6: Commit**

```bash
git add src/lib/recall/sync-claims.ts src/app/api/subscription/sync/_core.ts src/lib/__tests__/recall-sync-claims.test.ts
git commit -m "feat(recall): サブスク同期で主張を recall_claims に保存"
```

---

### Task 7: 配置（純関数）

**Files:**
- Create: `src/lib/recall/layout.ts`
- Test: `src/lib/__tests__/recall-layout.test.ts`

**Interfaces:**
- Consumes: `GENRE_CAPACITY`（Task 3）
- Produces:
  - `fibPt(i: number, n: number): [number, number, number]`
  - `seatCenter(slot: number): [number, number, number]`（= `fibPt(slot, GENRE_CAPACITY)`）
  - `layoutClaims(items: { claimId: string; genreSlot: number; pageId: string }[]): Map<string, [number, number, number]>`
  - `centroid(vs: [number, number, number][]): [number, number, number]`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/recall-layout.test.ts
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { fibPt, seatCenter, layoutClaims, centroid } from '@/lib/recall/layout'
import { GENRE_CAPACITY } from '@/lib/recall/genres'

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (v: number[]) => Math.hypot(v[0], v[1], v[2])

describe('layout', () => {
  it('fibPt は単位ベクトルで、席の中心は収容数64で決まる（席の総数に依存しない）', () => {
    expect(norm(fibPt(5, 700))).toBeCloseTo(1, 6)
    expect(seatCenter(3)).toEqual(fibPt(3, GENRE_CAPACITY))
  })
  it('同じ入力なら同じ出力。全主張が置かれ、単位球面上にある', () => {
    const items = Array.from({ length: 120 }, (_, i) => ({ claimId: `c${i}`, genreSlot: i % 5 === 0 ? 3 : 12, pageId: `p${i % 7}` }))
    const a = layoutClaims(items), b = layoutClaims(items)
    expect(a.size).toBe(120)
    for (const [id, v] of a) { expect(norm(v)).toBeCloseTo(1, 6); expect(b.get(id)).toEqual(v) }
  })
  it('席ごとの区画は自席の中心に寄る（自席の主張は他席の主張より中心との内積の平均が高い）', () => {
    const items = Array.from({ length: 300 }, (_, i) => ({ claimId: `c${i}`, genreSlot: i < 200 ? 3 : 12, pageId: 'p' }))
    const pos = layoutClaims(items)
    const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length
    const own = items.filter((x) => x.genreSlot === 3).map((x) => dot(pos.get(x.claimId)!, seatCenter(3)))
    const other = items.filter((x) => x.genreSlot === 12).map((x) => dot(pos.get(x.claimId)!, seatCenter(3)))
    expect(avg(own)).toBeGreaterThan(avg(other) + 0.3)
    // 容量つき最近傍は貪欲なので「全点で分離」は保証しない。平均の差で区画が寄っていることを見る
  })
  it('同じページの主張は隣り合う（ページ重心との内積が席全体の平均より高い）', () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ claimId: `c${i}`, genreSlot: 3, pageId: `p${Math.floor(i / 40)}` }))
    const pos = layoutClaims(items)
    const c0 = centroid(items.filter((x) => x.pageId === 'p0').map((x) => pos.get(x.claimId)!))
    const inside = items.filter((x) => x.pageId === 'p0').map((x) => dot(pos.get(x.claimId)!, c0))
    const all = items.map((x) => dot(pos.get(x.claimId)!, c0))
    const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length
    expect(avg(inside)).toBeGreaterThan(avg(all))
  })
})

const CORPUS = '.preview/recall-corpus.json'
describe.skipIf(!existsSync(CORPUS))('layout 実コーパス', () => {
  it('700件を配置しても全件が置かれ、席の数が増えても中心が動かない', async () => {
    const { extractClaims } = await import('@/lib/recall/extract-claims')
    const docs = JSON.parse(readFileSync(CORPUS, 'utf-8')) as Array<{ id: string; props: Record<string, string>; blocks: never[] }>
    const all = docs.flatMap((d) => extractClaims({
      pageId: d.id, pageTitle: d.props['名前'] || '', pageKind: '',
      genres: (d.props['ジャンル'] || '').split(',').map((s) => s.trim()).filter(Boolean), blocks: d.blocks,
    }))
    const pos = layoutClaims(all)
    expect(pos.size).toBe(all.length)
    expect(seatCenter(12)).toEqual(fibPt(12, 64)) // 席を34→35に増やしても分母は64のまま
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/__tests__/recall-layout.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

```ts
// src/lib/recall/layout.ts
// 配置（純関数・決定的）。描画を知らない。
// 1) 主張数 N のフィボナッチ球面格子（密度一様）
// 2) 使用中の席の中心へ、席ごとの主張数を容量として距離の近い順に割り当てる（容量制約つき最近傍）
// 3) 席の中ではページごとに連続した格子点を与える
// 席の中心は fibPt(slot, GENRE_CAPACITY)。分母を席の数にすると席を足すたび全中心がずれるので固定する。
import { GENRE_CAPACITY } from './genres'

export type Vec3 = [number, number, number]
const GA = Math.PI * (3 - Math.sqrt(5))

export function fibPt(i: number, n: number): Vec3 {
  const y = 1 - ((i + 0.5) / n) * 2
  const r = Math.sqrt(Math.max(0, 1 - y * y))
  const th = GA * i
  return [Math.cos(th) * r, y, Math.sin(th) * r]
}

export function seatCenter(slot: number): Vec3 {
  return fibPt(slot, GENRE_CAPACITY)
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export function centroid(vs: Vec3[]): Vec3 {
  const v: Vec3 = [0, 0, 0]
  for (const p of vs) { v[0] += p[0]; v[1] += p[1]; v[2] += p[2] }
  const L = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / L, v[1] / L, v[2] / L]
}

// 容量制約つき最近傍。近いペアから順に、容量が残っている席へ格子点を割り当てる。
function assign(points: Vec3[], centers: Vec3[], caps: number[]): number[] {
  const pairs: [number, number, number][] = []
  points.forEach((p, pi) => centers.forEach((c, ci) => pairs.push([1 - dot(p, c), pi, ci])))
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
  const out = new Array<number>(points.length).fill(-1)
  const left = caps.slice()
  let done = 0
  for (const [, pi, ci] of pairs) {
    if (out[pi] >= 0 || left[ci] <= 0) continue
    out[pi] = ci; left[ci]--; done++
    if (done === points.length) break
  }
  return out
}

export type LayoutItem = { claimId: string; genreSlot: number; pageId: string }

export function layoutClaims(items: LayoutItem[]): Map<string, Vec3> {
  const N = items.length
  const result = new Map<string, Vec3>()
  if (!N) return result
  // 入力順に依存しないよう、席→ページ→ID で安定に並べる
  const sorted = [...items].sort((a, b) => a.genreSlot - b.genreSlot || a.pageId.localeCompare(b.pageId) || a.claimId.localeCompare(b.claimId))
  const bySlot = new Map<number, LayoutItem[]>()
  for (const it of sorted) { if (!bySlot.has(it.genreSlot)) bySlot.set(it.genreSlot, []); bySlot.get(it.genreSlot)!.push(it) }
  const slots = [...bySlot.keys()].sort((a, b) => a - b)
  const lattice: Vec3[] = Array.from({ length: N }, (_, i) => fibPt(i, N))
  const centers = slots.map(seatCenter)
  const assigned = assign(lattice, centers, slots.map((s) => bySlot.get(s)!.length))
  slots.forEach((slot, si) => {
    const c = centers[si]
    const cells = lattice.map((p, i) => ({ p, i })).filter((o) => assigned[o.i] === si).sort((a, b) => dot(b.p, c) - dot(a.p, c))
    const list = bySlot.get(slot)!
    list.forEach((it, k) => result.set(it.claimId, cells[k % cells.length].p))
  })
  return result
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/lib/__tests__/recall-layout.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/recall/layout.ts src/lib/__tests__/recall-layout.test.ts
git commit -m "feat(recall): 配置の純関数（フィボナッチ球面・容量つき最近傍・席の中心は収容数64で固定）"
```

---

### Task 8: SRS と状態（純関数）

**Files:**
- Create: `src/lib/recall/srs.ts`
- Test: `src/lib/__tests__/recall-srs.test.ts`

**Interfaces:**
- Consumes: 型（Task 3）
- Produces:
  - `SRS_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60, 120, 240, 365]`、`SETTLED_MIN_DAYS = 90`、`ESCAPE_THRESHOLD = 0.28`、`MAX_CANDIDATES = 5`
  - `newProgress(claimId: string, now: Date): RecallProgress`
  - `applyResult(p: RecallProgress, result: 'ok' | 'ng', now: Date): RecallProgress`
  - `remainingOf(p: RecallProgress, now: Date): number`（0..1）
  - `stateOf(claimId, progress: RecallProgress | undefined, isRead: boolean, now: Date): RecallState`
  - `pickCandidates(progress: RecallProgress[], now: Date, max = MAX_CANDIDATES): RecallProgress[]`
  - `nextDue(progress: RecallProgress[], now: Date): { at: Date; count: number } | null`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/recall-srs.test.ts
import { describe, it, expect } from 'vitest'
import { SRS_INTERVAL_DAYS, newProgress, applyResult, remainingOf, stateOf, pickCandidates, nextDue } from '@/lib/recall/srs'

const d = (iso: string) => new Date(iso)
const day = 86400000

describe('SRS', () => {
  it('段は 1/3/7/14/30/60/120/240/365 で頭打ち', () => {
    expect(SRS_INTERVAL_DAYS).toEqual([1, 3, 7, 14, 30, 60, 120, 240, 365])
    let p = newProgress('c', d('2026-09-02T00:00:00Z'))
    expect(p.intervalDays).toBe(1)
    let t = d('2026-09-03T00:00:00Z')
    const seen: number[] = []
    for (let i = 0; i < 11; i++) { p = applyResult(p, 'ok', t); seen.push(p.intervalDays); t = new Date(t.getTime() + p.intervalDays * day) }
    expect(seen).toEqual([1, 3, 7, 14, 30, 60, 120, 240, 365, 365, 365])
    expect(p.okCount).toBe(11)
  })
  it('「まだ」で段0へ戻り、間隔1日・期限は翌日', () => {
    let p = newProgress('c', d('2026-09-02T00:00:00Z'))
    for (let i = 0; i < 4; i++) p = applyResult(p, 'ok', d('2026-09-10T00:00:00Z'))
    p = applyResult(p, 'ng', d('2026-09-20T00:00:00Z'))
    expect(p).toMatchObject({ streak: 0, intervalDays: 1, lastResult: 'ng', ngCount: 1 })
    expect(p.dueAt).toBe('2026-09-21T00:00:00.000Z')
  })
  it('残りは 1 − 経過/間隔（0..1）。残した直後は 1、期限で 0', () => {
    const p = { ...newProgress('c', d('2026-09-02T00:00:00Z')), intervalDays: 10, lastReviewedAt: '2026-09-02T00:00:00.000Z', dueAt: '2026-09-12T00:00:00.000Z' }
    expect(remainingOf(p, d('2026-09-02T00:00:00Z'))).toBeCloseTo(1)
    expect(remainingOf(p, d('2026-09-07T00:00:00Z'))).toBeCloseTo(0.5)
    expect(remainingOf(p, d('2026-09-20T00:00:00Z'))).toBe(0)
  })
  it('状態: 記録なし→cold、読んだだけ→touched、残した→kept、間隔90日以上→settled、外した→cold/touched', () => {
    const now = d('2026-09-02T00:00:00Z')
    const p = newProgress('c', now)
    expect(stateOf('c', undefined, false, now).kind).toBe('cold')
    expect(stateOf('c', undefined, true, now).kind).toBe('touched')
    expect(stateOf('c', p, false, now).kind).toBe('kept')
    expect(stateOf('c', { ...p, intervalDays: 120 }, false, now).kind).toBe('settled')
    expect(stateOf('c', { ...p, removedAt: now.toISOString() }, true, now).kind).toBe('touched')
  })
  it('離脱候補は残り<0.28 の残した主張を小さい順に最大5。定着も期限が来れば入る。外したものは入らない', () => {
    const now = d('2026-09-30T00:00:00Z')
    const mk = (id: string, intervalDays: number, reviewedDaysAgo: number, removed = false) => ({
      ...newProgress(id, now), intervalDays,
      lastReviewedAt: new Date(now.getTime() - reviewedDaysAgo * day).toISOString(),
      dueAt: new Date(now.getTime() + (intervalDays - reviewedDaysAgo) * day).toISOString(),
      removedAt: removed ? now.toISOString() : null,
    })
    const list = [mk('fresh', 10, 1), mk('due', 10, 12), mk('near', 10, 8), mk('settled-due', 120, 130), mk('removed', 10, 12, true),
      mk('a', 10, 9), mk('b', 10, 9.5), mk('c', 10, 9.9)]
    const got = pickCandidates(list, now).map((p) => p.claimId)
    expect(got).toHaveLength(5)
    expect(got[0]).toBe('due')
    expect(got).toContain('settled-due')
    expect(got).not.toContain('fresh')
    expect(got).not.toContain('removed')
  })
  it('次の期限は最も早い due_at とその日の件数', () => {
    const now = d('2026-09-02T00:00:00Z')
    const a = { ...newProgress('a', now), dueAt: '2026-09-05T00:00:00.000Z' }
    const b = { ...newProgress('b', now), dueAt: '2026-09-05T09:00:00.000Z' }
    const c = { ...newProgress('c', now), dueAt: '2026-09-09T00:00:00.000Z' }
    expect(nextDue([a, b, c], now)).toEqual({ at: d('2026-09-05T00:00:00Z'), count: 2 })
    expect(nextDue([], now)).toBeNull()
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/__tests__/recall-srs.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

```ts
// src/lib/recall/srs.ts
// 間隔反復と状態（純関数）。描画を知らない。時刻は引数で受ける（テストで日付を進めるため）。
import type { RecallProgress, RecallState } from './types'

export const SRS_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60, 120, 240, 365] as const
export const SETTLED_MIN_DAYS = 90
export const ESCAPE_THRESHOLD = 0.28
export const MAX_CANDIDATES = 5
const DAY = 86400000

export function newProgress(claimId: string, now: Date): RecallProgress {
  const iso = now.toISOString()
  return {
    claimId, keptAt: iso, streak: 0, intervalDays: 1, dueAt: new Date(now.getTime() + DAY).toISOString(),
    lastReviewedAt: iso, lastResult: null, okCount: 0, ngCount: 0, removedAt: null,
  }
}

export function applyResult(p: RecallProgress, result: 'ok' | 'ng', now: Date): RecallProgress {
  const streak = result === 'ok' ? p.streak + 1 : 0
  const intervalDays = result === 'ok'
    ? SRS_INTERVAL_DAYS[Math.min(streak, SRS_INTERVAL_DAYS.length) - 1]
    : SRS_INTERVAL_DAYS[0]
  return {
    ...p, streak, intervalDays,
    dueAt: new Date(now.getTime() + intervalDays * DAY).toISOString(),
    lastReviewedAt: now.toISOString(), lastResult: result,
    okCount: p.okCount + (result === 'ok' ? 1 : 0), ngCount: p.ngCount + (result === 'ng' ? 1 : 0),
  }
}

export function remainingOf(p: RecallProgress, now: Date): number {
  const from = new Date(p.lastReviewedAt ?? p.keptAt).getTime()
  const elapsed = (now.getTime() - from) / DAY
  return Math.max(0, Math.min(1, 1 - elapsed / Math.max(p.intervalDays, 1e-6)))
}

const isKept = (p: RecallProgress | undefined): p is RecallProgress => !!p && !p.removedAt

export function stateOf(_claimId: string, p: RecallProgress | undefined, isRead: boolean, now: Date): RecallState {
  if (isKept(p)) {
    return { kind: p.intervalDays >= SETTLED_MIN_DAYS ? 'settled' : 'kept', remaining: remainingOf(p, now) }
  }
  return { kind: isRead ? 'touched' : 'cold', remaining: 0 }
}

export function pickCandidates(progress: RecallProgress[], now: Date, max = MAX_CANDIDATES): RecallProgress[] {
  return progress
    .filter(isKept)
    .map((p) => ({ p, r: remainingOf(p, now) }))
    .filter((x) => x.r < ESCAPE_THRESHOLD)
    .sort((a, b) => a.r - b.r || a.p.claimId.localeCompare(b.p.claimId))
    .slice(0, max)
    .map((x) => x.p)
}

export function nextDue(progress: RecallProgress[], now: Date): { at: Date; count: number } | null {
  const kept = progress.filter(isKept)
  if (!kept.length) return null
  const times = kept.map((p) => new Date(p.dueAt).getTime()).sort((a, b) => a - b)
  const first = times[0]
  const dayStart = Math.floor(first / DAY) * DAY
  const count = times.filter((t) => t >= dayStart && t < dayStart + DAY).length
  void now
  return { at: new Date(first), count }
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/lib/__tests__/recall-srs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/recall/srs.ts src/lib/__tests__/recall-srs.test.ts
git commit -m "feat(recall): SRS の段・残り・状態・離脱候補（純関数）"
```

---

### Task 9: 読み取り API（主張・本人の記録）

**Files:**
- Create: `src/lib/recall/guard.ts`
- Create: `src/app/api/recall/claims/route.ts`
- Create: `src/app/api/recall/progress/route.ts`
- Test: `src/lib/__tests__/recall-read-routes.test.ts`

**Interfaces:**
- Consumes: `sessionHasFeature`（`@/lib/supabase/early-access`）、`createClient`（`@/lib/supabase/server`）
- Produces:
  - `requireRecall(): Promise<{ ok: true; supabase; userId: string } | { ok: false; response: NextResponse }>`（機能が閉じていれば 404、未ログインなら 401）
  - `GET /api/recall/claims` → `{ claims: RecallClaim[] }`（active のみ）
  - `GET /api/recall/progress` → `{ progress: RecallProgress[]; reads: RecallSectionRead[] }`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/recall-read-routes.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sessionHasFeature = vi.fn()
const getUser = vi.fn()
let rows: Record<string, unknown[]> = {}
vi.mock('@/lib/supabase/early-access', () => ({ sessionHasFeature: (f: string) => sessionHasFeature(f) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser },
    from: (table: string) => {
      const q = { eq: () => q, is: () => q, order: () => q, then: undefined as unknown }
      return { select: () => Object.assign(q, { then: (res: (v: unknown) => void) => res({ data: rows[table] ?? [], error: null }) }) }
    },
  }),
}))

const { GET: claimsGET } = await import('../../app/api/recall/claims/route')
const { GET: progressGET } = await import('../../app/api/recall/progress/route')

beforeEach(() => { sessionHasFeature.mockReset(); getUser.mockReset(); rows = {} })

describe('Recall 読み取りルート', () => {
  it('機能が閉じていれば 404（存在を見せない）', async () => {
    sessionHasFeature.mockResolvedValue(false)
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    expect((await claimsGET()).status).toBe(404)
    expect((await progressGET()).status).toBe(404)
  })
  it('未ログインは 401', async () => {
    sessionHasFeature.mockResolvedValue(true)
    getUser.mockResolvedValue({ data: { user: null } })
    expect((await claimsGET()).status).toBe(401)
  })
  it('主張は camelCase で返す', async () => {
    sessionHasFeature.mockResolvedValue(true)
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    rows.recall_claims = [{ claim_id: 'a', page_id: 'p', page_title: 't', page_kind: '💡', section_key: 'sec1', section_heading: 'h', body: 'b', source: 's', confidence: 'ok', genres: ['05.循環'], primary_genre: '05.循環', genre_slot: 4, holes: [[0, 2]], cloze_status: 'approved', active: true }]
    const res = await claimsGET()
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.claims[0]).toMatchObject({ claimId: 'a', genreSlot: 4, holes: [[0, 2]], clozeStatus: 'approved' })
  })
  it('記録は本人分だけを camelCase で返す', async () => {
    sessionHasFeature.mockResolvedValue(true)
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    rows.recall_progress = [{ claim_id: 'a', kept_at: 'k', streak: 1, interval_days: 3, due_at: 'd', last_reviewed_at: 'l', last_result: 'ok', ok_count: 1, ng_count: 0, removed_at: null }]
    rows.recall_section_reads = [{ page_id: 'p', section_key: 'sec1', read_at: 'r' }]
    const json = await (await progressGET()).json()
    expect(json.progress[0]).toMatchObject({ claimId: 'a', intervalDays: 3, removedAt: null })
    expect(json.reads[0]).toEqual({ pageId: 'p', sectionKey: 'sec1', readAt: 'r' })
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/__tests__/recall-read-routes.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装する**

```ts
// src/lib/recall/guard.ts
// Recall ルートの共通ガード。機能が閉じている利用者には 404 を返し、存在を見せない。
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sessionHasFeature } from '@/lib/supabase/early-access'
import type { RecallClaim, RecallProgress, RecallSectionRead } from './types'

export async function requireRecall(): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; userId: string }
  | { ok: false; response: NextResponse }
> {
  if (!(await sessionHasFeature('recall'))) {
    return { ok: false, response: NextResponse.json({ error: 'not_found' }, { status: 404 }) }
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'login_required' }, { status: 401 }) }
  return { ok: true, supabase, userId: user.id }
}

type Row = Record<string, unknown>
export function claimFromRow(r: Row): RecallClaim {
  return {
    claimId: String(r.claim_id), pageId: String(r.page_id), pageTitle: String(r.page_title ?? ''), pageKind: String(r.page_kind ?? ''),
    sectionKey: String(r.section_key ?? ''), sectionHeading: String(r.section_heading ?? ''), body: String(r.body), source: String(r.source ?? ''),
    confidence: r.confidence as RecallClaim['confidence'], genres: (r.genres as string[]) ?? [], primaryGenre: String(r.primary_genre ?? ''),
    genreSlot: Number(r.genre_slot ?? 63), holes: (r.holes as [number, number][]) ?? [], clozeStatus: (r.cloze_status as RecallClaim['clozeStatus']) ?? 'pending',
    active: r.active !== false,
  }
}
export function progressFromRow(r: Row): RecallProgress {
  return {
    claimId: String(r.claim_id), keptAt: String(r.kept_at), streak: Number(r.streak ?? 0), intervalDays: Number(r.interval_days ?? 1),
    dueAt: String(r.due_at), lastReviewedAt: (r.last_reviewed_at as string | null) ?? null, lastResult: (r.last_result as 'ok' | 'ng' | null) ?? null,
    okCount: Number(r.ok_count ?? 0), ngCount: Number(r.ng_count ?? 0), removedAt: (r.removed_at as string | null) ?? null,
  }
}
export function progressToRow(userId: string, p: RecallProgress): Row {
  return {
    user_id: userId, claim_id: p.claimId, kept_at: p.keptAt, streak: p.streak, interval_days: p.intervalDays, due_at: p.dueAt,
    last_reviewed_at: p.lastReviewedAt, last_result: p.lastResult, ok_count: p.okCount, ng_count: p.ngCount, removed_at: p.removedAt,
    updated_at: new Date().toISOString(),
  }
}
export function readFromRow(r: Row): RecallSectionRead {
  return { pageId: String(r.page_id), sectionKey: String(r.section_key), readAt: String(r.read_at) }
}
```

```ts
// src/app/api/recall/claims/route.ts
import { NextResponse } from 'next/server'
import { requireRecall, claimFromRow } from '@/lib/recall/guard'

export const dynamic = 'force-dynamic'

export async function GET() {
  const g = await requireRecall()
  if (!g.ok) return g.response
  const { data, error } = await g.supabase
    .from('recall_claims')
    .select('claim_id, page_id, page_title, page_kind, section_key, section_heading, body, source, confidence, genres, primary_genre, genre_slot, holes, cloze_status, active')
    .eq('active', true)
    .order('claim_id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ claims: (data ?? []).map(claimFromRow) })
}
```

```ts
// src/app/api/recall/progress/route.ts
import { NextResponse } from 'next/server'
import { requireRecall, progressFromRow, readFromRow } from '@/lib/recall/guard'

export const dynamic = 'force-dynamic'

export async function GET() {
  const g = await requireRecall()
  if (!g.ok) return g.response
  const [p, r] = await Promise.all([
    g.supabase.from('recall_progress').select('claim_id, kept_at, streak, interval_days, due_at, last_reviewed_at, last_result, ok_count, ng_count, removed_at').eq('user_id', g.userId),
    g.supabase.from('recall_section_reads').select('page_id, section_key, read_at').eq('user_id', g.userId),
  ])
  if (p.error) return NextResponse.json({ error: p.error.message }, { status: 500 })
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
  return NextResponse.json({ progress: (p.data ?? []).map(progressFromRow), reads: (r.data ?? []).map(readFromRow) })
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/lib/__tests__/recall-read-routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/recall/guard.ts src/app/api/recall/claims/route.ts src/app/api/recall/progress/route.ts src/lib/__tests__/recall-read-routes.test.ts
git commit -m "feat(recall): 主張と本人の記録を返す API（閉じている利用者には 404）"
```

---

### Task 10: 書き込み API（残す・読了・覚えた／まだ）

**Files:**
- Create: `src/app/api/recall/keep/route.ts`
- Create: `src/app/api/recall/read/route.ts`
- Create: `src/app/api/recall/review/route.ts`
- Test: `src/lib/__tests__/recall-write-routes.test.ts`

**Interfaces:**
- Consumes: `requireRecall`・`progressFromRow`・`progressToRow`（Task 9）、`newProgress`・`applyResult`（Task 8）
- Produces:
  - `POST /api/recall/keep` body `{ claimId: string; keep: boolean }` → `{ progress: RecallProgress }`
  - `POST /api/recall/read` body `{ pageId: string; sectionKey: string }` → `{ ok: true }`
  - `POST /api/recall/review` body `{ claimId: string; result: 'ok' | 'ng' }` → `{ progress: RecallProgress }`（404 if 残していない）

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/recall-write-routes.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sessionHasFeature = vi.fn()
const getUser = vi.fn()
const upsert = vi.fn(async () => ({ error: null }))
const insert = vi.fn(async () => ({ error: null }))
let existing: Record<string, unknown> | null = null
vi.mock('@/lib/supabase/early-access', () => ({ sessionHasFeature: (f: string) => sessionHasFeature(f) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({
      upsert, insert,
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existing, error: null }) }) }) }),
    }),
  }),
}))
const { POST: keepPOST } = await import('../../app/api/recall/keep/route')
const { POST: readPOST } = await import('../../app/api/recall/read/route')
const { POST: reviewPOST } = await import('../../app/api/recall/review/route')
const req = (body: unknown) => new Request('http://localhost/x', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  sessionHasFeature.mockReset().mockResolvedValue(true)
  getUser.mockReset().mockResolvedValue({ data: { user: { id: 'u1' } } })
  upsert.mockClear(); insert.mockClear(); existing = null
})

describe('Recall 書き込みルート', () => {
  it('閉じていれば 404', async () => {
    sessionHasFeature.mockResolvedValue(false)
    expect((await keepPOST(req({ claimId: 'a', keep: true }))).status).toBe(404)
  })
  it('残す: 新規なら間隔1日・期限翌日で upsert。既存の外し済みは removed_at を null に戻し記録を保つ', async () => {
    let json = await (await keepPOST(req({ claimId: 'a', keep: true }))).json()
    expect(json.progress).toMatchObject({ claimId: 'a', intervalDays: 1, streak: 0, removedAt: null })
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u1', claim_id: 'a' }), { onConflict: 'user_id,claim_id' })
    existing = { claim_id: 'a', kept_at: 'k', streak: 3, interval_days: 14, due_at: 'd', last_reviewed_at: 'l', last_result: 'ok', ok_count: 3, ng_count: 0, removed_at: 'x' }
    json = await (await keepPOST(req({ claimId: 'a', keep: true }))).json()
    expect(json.progress).toMatchObject({ streak: 3, intervalDays: 14, removedAt: null })
  })
  it('外す: removed_at を入れる。残していなければ 404', async () => {
    expect((await keepPOST(req({ claimId: 'a', keep: false }))).status).toBe(404)
    existing = { claim_id: 'a', kept_at: 'k', streak: 0, interval_days: 1, due_at: 'd', last_reviewed_at: 'l', last_result: null, ok_count: 0, ng_count: 0, removed_at: null }
    const json = await (await keepPOST(req({ claimId: 'a', keep: false }))).json()
    expect(json.progress.removedAt).toBeTruthy()
  })
  it('読了: 節を upsert', async () => {
    expect((await readPOST(req({ pageId: 'p', sectionKey: 'sec1' }))).status).toBe(200)
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'u1', page_id: 'p', section_key: 'sec1' }), { onConflict: 'user_id,page_id,section_key' })
  })
  it('覚えた: 段を進めて upsert しログを insert。残していなければ 404。result が不正なら 400', async () => {
    expect((await reviewPOST(req({ claimId: 'a', result: 'ok' }))).status).toBe(404)
    existing = { claim_id: 'a', kept_at: 'k', streak: 1, interval_days: 3, due_at: 'd', last_reviewed_at: 'l', last_result: 'ok', ok_count: 1, ng_count: 0, removed_at: null }
    const json = await (await reviewPOST(req({ claimId: 'a', result: 'ok' }))).json()
    expect(json.progress).toMatchObject({ streak: 2, intervalDays: 7 })
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ claim_id: 'a', result: 'ok', interval_before: 3, interval_after: 7 }))
    expect((await reviewPOST(req({ claimId: 'a', result: 'maybe' }))).status).toBe(400)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/__tests__/recall-write-routes.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装する**

```ts
// src/app/api/recall/keep/route.ts
import { NextResponse } from 'next/server'
import { requireRecall, progressFromRow, progressToRow } from '@/lib/recall/guard'
import { newProgress } from '@/lib/recall/srs'

const COLS = 'claim_id, kept_at, streak, interval_days, due_at, last_reviewed_at, last_result, ok_count, ng_count, removed_at'

export async function POST(req: Request) {
  const g = await requireRecall()
  if (!g.ok) return g.response
  const body = (await req.json().catch(() => null)) as { claimId?: unknown; keep?: unknown } | null
  if (!body || typeof body.claimId !== 'string' || typeof body.keep !== 'boolean') {
    return NextResponse.json({ error: 'claimId と keep が必要です' }, { status: 400 })
  }
  const { data, error } = await g.supabase.from('recall_progress').select(COLS).eq('user_id', g.userId).eq('claim_id', body.claimId).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const now = new Date()
  let next
  if (body.keep) {
    next = data ? { ...progressFromRow(data), removedAt: null } : newProgress(body.claimId, now)
  } else {
    if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    next = { ...progressFromRow(data), removedAt: now.toISOString() }
  }
  const up = await g.supabase.from('recall_progress').upsert(progressToRow(g.userId, next), { onConflict: 'user_id,claim_id' })
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 })
  return NextResponse.json({ progress: next })
}
```

```ts
// src/app/api/recall/read/route.ts
import { NextResponse } from 'next/server'
import { requireRecall } from '@/lib/recall/guard'

export async function POST(req: Request) {
  const g = await requireRecall()
  if (!g.ok) return g.response
  const body = (await req.json().catch(() => null)) as { pageId?: unknown; sectionKey?: unknown } | null
  if (!body || typeof body.pageId !== 'string' || typeof body.sectionKey !== 'string') {
    return NextResponse.json({ error: 'pageId と sectionKey が必要です' }, { status: 400 })
  }
  const { error } = await g.supabase.from('recall_section_reads').upsert(
    { user_id: g.userId, page_id: body.pageId, section_key: body.sectionKey, read_at: new Date().toISOString() },
    { onConflict: 'user_id,page_id,section_key' },
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

```ts
// src/app/api/recall/review/route.ts
import { NextResponse } from 'next/server'
import { requireRecall, progressFromRow, progressToRow } from '@/lib/recall/guard'
import { applyResult } from '@/lib/recall/srs'

const COLS = 'claim_id, kept_at, streak, interval_days, due_at, last_reviewed_at, last_result, ok_count, ng_count, removed_at'

export async function POST(req: Request) {
  const g = await requireRecall()
  if (!g.ok) return g.response
  const body = (await req.json().catch(() => null)) as { claimId?: unknown; result?: unknown } | null
  if (!body || typeof body.claimId !== 'string' || (body.result !== 'ok' && body.result !== 'ng')) {
    return NextResponse.json({ error: 'claimId と result（ok/ng）が必要です' }, { status: 400 })
  }
  const { data, error } = await g.supabase.from('recall_progress').select(COLS).eq('user_id', g.userId).eq('claim_id', body.claimId).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.removed_at) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const before = progressFromRow(data)
  const now = new Date()
  const next = applyResult(before, body.result, now)
  const up = await g.supabase.from('recall_progress').upsert(progressToRow(g.userId, next), { onConflict: 'user_id,claim_id' })
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 })
  const log = await g.supabase.from('recall_review_log').insert({
    user_id: g.userId, claim_id: next.claimId, result: body.result,
    interval_before: before.intervalDays, interval_after: next.intervalDays, reviewed_at: now.toISOString(),
  })
  if (log.error) console.error('[recall/review] ログ追記失敗', log.error.message)
  return NextResponse.json({ progress: next })
}
```

- [ ] **Step 4: テストを通す**

Run: `npx vitest run src/lib/__tests__/recall-write-routes.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/recall/keep/route.ts src/app/api/recall/read/route.ts src/app/api/recall/review/route.ts src/lib/__tests__/recall-write-routes.test.ts
git commit -m "feat(recall): 残す・節の読了・覚えた／まだ の API"
```

---

### Task 11: 描画層とデータ hook

**Files:**
- Create: `src/lib/recall/render.ts`
- Create: `src/components/recall/useRecallData.ts`
- Test: `src/lib/__tests__/recall-render.test.ts`（投影と選択の純関数のみ）

**Interfaces:**
- Consumes: `layoutClaims`・`centroid`（Task 7）、`stateOf`・`pickCandidates`・`nextDue`（Task 8）
- Produces:
  - `type Camera = { rotY: number; rotX: number; zoom: number }`
  - `type Sprite = { claimId: string; home: Vec3; state: RecallState; phase: number }`
  - `project(v: Vec3, cam: Camera, R: number, cx: number, cy: number): { X: number; Y: number; Z: number; persp: number }`
  - `pickAt(sprites: Sprite[], cam: Camera, R: number, cx: number, cy: number, mx: number, my: number, radius: number): Sprite | null`
  - `drawFrame(ctx: CanvasRenderingContext2D, args: { W: number; H: number; cam: Camera; sprites: Sprite[]; flying: Map<string, number>; marks: Mark[]; t: number; reduced: boolean; dimmed: boolean; lens: LensMode })`
  - `type Mark = { text: string; v: Vec3; level: 'genre' | 'page'; n: number }`
  - `type LensMode = 'all' | 'kept'`
  - hook `useRecallData(): { loading; error; claims: RecallClaim[]; sprites: Sprite[]; marks: Mark[]; progressById: Map<string, RecallProgress>; candidates: RecallProgress[]; nextDue; counts: { kept; touched; cold; settled }; keep(claimId, keep): Promise<void>; review(claimId, result): Promise<void>; refresh(): Promise<void> }`

- [ ] **Step 1: 失敗するテストを書く（純関数部分）**

```ts
// src/lib/__tests__/recall-render.test.ts
import { describe, it, expect } from 'vitest'
import { project, pickAt, type Sprite } from '@/lib/recall/render'

const sp = (id: string, home: [number, number, number]): Sprite => ({ claimId: id, home, state: { kind: 'kept', remaining: 1 }, phase: 0 })

describe('render 純関数', () => {
  it('回転ゼロなら手前（z=-1）の点は画面中央に、奥（z=+1）は隠れる側に投影される', () => {
    const cam = { rotY: 0, rotX: 0, zoom: 1 }
    const front = project([0, 0, -1], cam, 100, 200, 300)
    expect(front.X).toBeCloseTo(200); expect(front.Y).toBeCloseTo(300); expect(front.Z).toBeLessThan(0)
    expect(project([0, 0, 1], cam, 100, 200, 300).Z).toBeGreaterThan(0)
  })
  it('pickAt は半径内で最も近い手前の主張を返し、奥の主張は選ばない', () => {
    const cam = { rotY: 0, rotX: 0, zoom: 1 }
    const near = sp('near', [0, 0, -1]), back = sp('back', [0, 0, 1])
    expect(pickAt([near, back], cam, 100, 200, 300, 203, 302, 20)?.claimId).toBe('near')
    expect(pickAt([back], cam, 100, 200, 300, 200, 300, 20)).toBeNull()
    expect(pickAt([near], cam, 100, 200, 300, 260, 300, 20)).toBeNull()
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/__tests__/recall-render.test.ts`
Expected: FAIL

- [ ] **Step 3: 描画層を実装する**

モック `.preview/sphere-mock.html` の描画部分を移植する。状態名は `cold / touched / kept / settled`、明るさは `0.55 + 0.45 × remaining`、薄れ（remaining < 0.28）はゆらぎを付ける。

```ts
// src/lib/recall/render.ts
// 描画層。位置・状態・カメラを受けて Canvas 2D に描くだけ。配置と状態を知らない（差し替え可能にする）。
import type { Vec3 } from './layout'
import type { RecallState } from './types'
import { ESCAPE_THRESHOLD } from './srs'

export type Camera = { rotY: number; rotX: number; zoom: number }
export type Sprite = { claimId: string; home: Vec3; state: RecallState; phase: number }
export type Mark = { text: string; v: Vec3; level: 'genre' | 'page'; n: number }
export type LensMode = 'all' | 'kept'

export function project(v: Vec3, cam: Camera, R: number, cx: number, cy: number) {
  const x = v[0] * R, y = v[1] * R, z = v[2] * R
  const cyaw = Math.cos(cam.rotY), syaw = Math.sin(cam.rotY), cpit = Math.cos(cam.rotX), spit = Math.sin(cam.rotX)
  const X = x * cyaw + z * syaw
  let Z = -x * syaw + z * cyaw
  const Y = y * cpit - Z * spit
  Z = y * spit + Z * cpit
  const persp = 1 / (1 + Z / (R * 4))
  return { X: cx + X * persp, Y: cy + Y * persp, Z, persp }
}

export function pickAt(sprites: Sprite[], cam: Camera, R: number, cx: number, cy: number, mx: number, my: number, radius: number): Sprite | null {
  let best: Sprite | null = null, bd = radius
  for (const s of sprites) {
    const p = project(s.home, cam, R, cx, cy)
    if (p.Z > R * 0.6) continue
    const d = Math.hypot(p.X - mx, p.Y - my)
    if (d < bd) { bd = d; best = s }
  }
  return best
}

// 状態ごとのスプライト（事前描画）。フレーム内は drawImage だけにする。
const COLORS: Record<RecallState['kind'], { color: string; glow: number; size: number; alpha: number }> = {
  settled: { color: 'rgba(234,247,253,1)', glow: 1, size: 10, alpha: 0.95 },
  kept:    { color: 'rgba(191,233,245,1)', glow: 0.95, size: 9, alpha: 0.95 },
  touched: { color: 'rgba(178,202,216,1)', glow: 0.92, size: 7.2, alpha: 0.92 },
  cold:    { color: 'rgba(66,80,96,.9)', glow: 0.55, size: 4.8, alpha: 0.55 },
}
let spriteCache: Record<string, HTMLCanvasElement> | null = null
function sprites(): Record<string, HTMLCanvasElement> {
  if (spriteCache) return spriteCache
  const make = (color: string, glow: number) => {
    const c = document.createElement('canvas'); c.width = c.height = 64
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, color); grad.addColorStop(0.22, color); grad.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grad; g.globalAlpha = glow; g.fillRect(0, 0, 64, 64)
    return c
  }
  spriteCache = Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [k, make(v.color, v.glow)]))
  return spriteCache
}

function noise(v: Vec3, t: number, ph: number) {
  return Math.sin(v[0] * 2.1 + t * 0.7 + ph) * 0.5 + Math.sin(v[1] * 2.7 + t * 0.9) * 0.3 + Math.sin(v[2] * 3.3 + t * 0.5 + ph) * 0.2
}

export const MAX_ZOOM = 3.4
export const LABEL_GENRE_ZOOM = 1.25
export const LABEL_PAGE_ZOOM = 2.0
export const HERE_ZOOM = 1.8

export type FrameArgs = {
  W: number; H: number; cam: Camera; sprites: Sprite[]
  flying: Map<string, number>   // claimId → 0..1（離脱の進み）。山の並び順は挿入順
  marks: Mark[]; t: number; reduced: boolean; dimmed: boolean; lens: LensMode
}

// 描いたあと、山に並んだ主張の画面位置を返す（タップ判定に使う）
export function drawFrame(ctx: CanvasRenderingContext2D, a: FrameArgs): Map<string, { X: number; Y: number }> {
  const { W, H, cam, t } = a
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#05080e'; ctx.fillRect(0, 0, W, H)
  const R = Math.min(W, H) * 0.34 * cam.zoom
  const cx = W / 2, cy = H / 2 - 14 - (a.flying.size ? 46 : 0)
  const SP = sprites()
  const ds = Math.max(0.4, Math.sqrt(520 / Math.max(a.sprites.length, 520)))
  const flyOrder = [...a.flying.keys()]
  const deckPos = new Map<string, { X: number; Y: number }>()
  type Item = { X: number; Y: number; Z: number; persp: number; s: Sprite; depth: number; fly: number }
  const list: Item[] = []
  for (const s of a.sprites) {
    const wob = a.reduced ? 0 : noise(s.home, t, s.phase) * 0.05
    const fading = (s.state.kind === 'kept' || s.state.kind === 'settled') && s.state.remaining < ESCAPE_THRESHOLD
    const rr = 1 + wob + (fading ? Math.sin(t * 1.6 + s.phase) * 0.012 : 0)
    const v: Vec3 = [s.home[0] * rr, s.home[1] * rr, s.home[2] * rr]
    const pr = project(v, cam, R, cx, cy)
    let X = pr.X, Y = pr.Y
    const fly = a.flying.get(s.claimId) ?? 0
    if (fly > 0) {
      const e = 1 - Math.pow(1 - fly, 2.2)
      const k = flyOrder.indexOf(s.claimId), span = Math.min(W * 0.3, 150)
      const mid = (flyOrder.length - 1) / 2, u = (k - mid) / Math.max(mid, 1)
      const tx = W / 2 + u * span, ty = H - 104 + u * u * 14
      X = pr.X + (tx - pr.X) * e; Y = pr.Y + (ty - pr.Y) * e - Math.sin(fly * Math.PI) * 90
      if (fly >= 1) deckPos.set(s.claimId, { X, Y })
    }
    const depth = (1 - pr.Z / (R * 1.4)) * 0.5 + 0.5
    list.push({ X, Y, Z: fly > 0 ? -9999 : pr.Z, persp: pr.persp, s, depth, fly })
  }
  list.sort((p, q) => q.Z - p.Z)
  for (const d of list) {
    const k = d.s.state.kind
    const c = COLORS[k]
    let size: number, alpha: number
    if (d.fly > 0) { size = 9.5 * ds * (1 + d.fly * 0.5); alpha = 0.5 + d.fly * 0.5 }
    else {
      size = c.size * ds * d.persp * (0.55 + d.depth * 0.75)
      alpha = c.alpha * Math.pow(d.depth, cam.zoom > 1.4 ? 3.2 : 1.7)
      if (k === 'kept' || k === 'settled') alpha *= 0.55 + 0.45 * d.s.state.remaining // 明るさ＝記憶の残り
      if (a.lens === 'kept' && k !== 'kept' && k !== 'settled') alpha *= 0.25
    }
    ctx.globalAlpha = Math.min(1, alpha + 0.05) * (a.dimmed && d.fly === 0 ? 0.42 : 1)
    ctx.drawImage(SP[k], d.X - size, d.Y - size, size * 2, size * 2)
    if (k === 'settled') { ctx.globalAlpha = 0.12 * d.depth; ctx.drawImage(SP[k], d.X - size * 2.2, d.Y - size * 2.2, size * 4.4, size * 4.4) }
  }
  if (a.flying.size) {
    const gy = H - 100
    const g2 = ctx.createRadialGradient(W / 2, gy, 0, W / 2, gy, Math.min(W * 0.42, 220))
    g2.addColorStop(0, 'rgba(111,215,232,.08)'); g2.addColorStop(1, 'rgba(111,215,232,0)')
    ctx.globalAlpha = 1; ctx.fillStyle = g2; ctx.fillRect(0, gy - 90, W, 190)
  }
  // 目印（寄ったときだけ）
  if (cam.zoom > LABEL_GENRE_ZOOM) {
    ctx.textAlign = 'center'
    for (const m of a.marks) {
      const show = m.level === 'genre' ? cam.zoom < LABEL_PAGE_ZOOM : cam.zoom >= LABEL_PAGE_ZOOM
      if (!show) continue
      const p = project(m.v, cam, R, cx, cy)
      if (p.Z > -R * 0.15) continue
      if (p.X < 40 || p.X > W - 40 || p.Y < 50 || p.Y > H - 150) continue
      const fade = Math.min(1, (cam.zoom - LABEL_GENRE_ZOOM) * 2.2)
      ctx.globalAlpha = 0.55 * fade; ctx.fillStyle = '#9fd8e6'
      ctx.font = (m.level === 'genre' ? '500 15px' : '400 12px') + ' "Zen Kaku Gothic New",sans-serif'
      ctx.fillText(m.text, p.X, p.Y - 14)
      ctx.globalAlpha = 0.3 * fade; ctx.font = '400 10px "Zen Kaku Gothic New",sans-serif'
      ctx.fillText(`${m.n}主張`, p.X, p.Y + 2)
    }
  }
  ctx.globalAlpha = 1
  return deckPos
}

// 「いま見ている区画」: 画面中央に最も近い手前のページ目印
export function hereMark(marks: Mark[], cam: Camera, W: number, H: number): Mark | null {
  if (cam.zoom < HERE_ZOOM) return null
  const R = Math.min(W, H) * 0.34 * cam.zoom
  let best: Mark | null = null, bd = Infinity
  for (const m of marks) {
    if (m.level !== 'page') continue
    const p = project(m.v, cam, R, W / 2, H / 2 - 14)
    if (p.Z > 0) continue
    const d = Math.hypot(p.X - W / 2, p.Y - H / 2)
    if (d < bd) { bd = d; best = m }
  }
  return best
}
```

- [ ] **Step 4: データ hook を実装する**

```ts
// src/components/recall/useRecallData.ts
'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RecallClaim, RecallProgress, RecallSectionRead } from '@/lib/recall/types'
import { layoutClaims, centroid, type Vec3 } from '@/lib/recall/layout'
import { stateOf, pickCandidates, nextDue } from '@/lib/recall/srs'
import type { Sprite, Mark } from '@/lib/recall/render'
import { GENRE_SEATS, OTHER_SLOT } from '@/lib/recall/genres'

export function useRecallData() {
  const [claims, setClaims] = useState<RecallClaim[]>([])
  const [progress, setProgress] = useState<RecallProgress[]>([])
  const [reads, setReads] = useState<RecallSectionRead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  const refresh = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([fetch('/api/recall/claims'), fetch('/api/recall/progress')])
      if (!c.ok || !p.ok) throw new Error(`読み込みに失敗しました（${c.status}/${p.status}）`)
      const cj = (await c.json()) as { claims: RecallClaim[] }
      const pj = (await p.json()) as { progress: RecallProgress[]; reads: RecallSectionRead[] }
      setClaims(cj.claims); setProgress(pj.progress); setReads(pj.reads); setError(null); setNow(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const positions = useMemo(() => layoutClaims(claims), [claims])
  const progressById = useMemo(() => new Map(progress.map((p) => [p.claimId, p])), [progress])
  const readSet = useMemo(() => new Set(reads.map((r) => `${r.pageId}#${r.sectionKey}`)), [reads])

  const sprites: Sprite[] = useMemo(() => claims.map((c, i) => ({
    claimId: c.claimId, home: positions.get(c.claimId) as Vec3,
    state: stateOf(c.claimId, progressById.get(c.claimId), readSet.has(`${c.pageId}#${c.sectionKey}`), now),
    phase: (i % 628) / 100,
  })), [claims, positions, progressById, readSet, now])

  const marks: Mark[] = useMemo(() => {
    const byPage = new Map<string, Vec3[]>(), bySlot = new Map<number, Vec3[]>()
    for (const c of claims) {
      const v = positions.get(c.claimId)!
      if (!byPage.has(c.pageId)) byPage.set(c.pageId, []); byPage.get(c.pageId)!.push(v)
      if (!bySlot.has(c.genreSlot)) bySlot.set(c.genreSlot, []); bySlot.get(c.genreSlot)!.push(v)
    }
    const titleOf = new Map(claims.map((c) => [c.pageId, c.pageTitle]))
    const pages: Mark[] = [...byPage].map(([id, vs]) => ({ text: (titleOf.get(id) ?? '').replace(/^[^\s]*\s/, '').slice(0, 22), v: centroid(vs), level: 'page', n: vs.length }))
    const genres: Mark[] = [...bySlot].map(([slot, vs]) => ({ text: slot === OTHER_SLOT ? 'その他' : GENRE_SEATS[slot].replace(/^\d+\./, ''), v: centroid(vs), level: 'genre', n: vs.length }))
    return [...pages, ...genres]
  }, [claims, positions])

  const counts = useMemo(() => {
    const c = { kept: 0, touched: 0, cold: 0, settled: 0 }
    for (const s of sprites) c[s.state.kind]++
    return c
  }, [sprites])

  const candidates = useMemo(() => pickCandidates(progress, now), [progress, now])
  const due = useMemo(() => nextDue(progress, now), [progress, now])

  const keep = useCallback(async (claimId: string, keepIt: boolean) => {
    const res = await fetch('/api/recall/keep', { method: 'POST', body: JSON.stringify({ claimId, keep: keepIt }) })
    if (!res.ok) throw new Error('保存に失敗しました')
    const { progress: p } = (await res.json()) as { progress: RecallProgress }
    setProgress((prev) => [...prev.filter((x) => x.claimId !== claimId), p]); setNow(new Date())
  }, [])

  const review = useCallback(async (claimId: string, result: 'ok' | 'ng') => {
    const res = await fetch('/api/recall/review', { method: 'POST', body: JSON.stringify({ claimId, result }) })
    if (!res.ok) throw new Error('保存に失敗しました')
    const { progress: p } = (await res.json()) as { progress: RecallProgress }
    setProgress((prev) => [...prev.filter((x) => x.claimId !== claimId), p]); setNow(new Date())
  }, [])

  return { loading, error, claims, sprites, marks, progressById, candidates, nextDue: due, counts, keep, review, refresh }
}
```

- [ ] **Step 5: テストを通す**

Run: `npx vitest run src/lib/__tests__/recall-render.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/recall/render.ts src/components/recall/useRecallData.ts src/lib/__tests__/recall-render.test.ts
git commit -m "feat(recall): 描画層（Canvas 2D）とデータ hook"
```

---

### Task 12: 画面（球・カード・確かめる）

**Files:**
- Create: `src/components/recall/RecallSphere.tsx`
- Create: `src/components/recall/RecallCard.tsx`
- Create: `src/components/recall/RecallScreen.tsx`

**Interfaces:**
- Consumes: `useRecallData`・`drawFrame`・`pickAt`・`hereMark`・定数（Task 11）
- Produces: `<RecallScreen />`（ホームのタブから描く。props なし）

- [ ] **Step 1: RecallSphere（canvas と操作）**

```tsx
// src/components/recall/RecallSphere.tsx
'use client'
// 球の canvas。回す（ドラッグ・慣性）、寄る（ホイール・ピンチ 1.0〜3.4倍）、タップ（主張を選ぶ）。
// 描画は drawFrame に委ね、ここは操作と RAF だけを持つ。タブ非表示のときは RAF を止める。
import { useEffect, useRef } from 'react'
import { drawFrame, pickAt, hereMark, MAX_ZOOM, type Camera, type Sprite, type Mark, type LensMode } from '@/lib/recall/render'

type Props = {
  sprites: Sprite[]; marks: Mark[]; flying: Map<string, number>; dimmed: boolean; lens: LensMode; shakeUntil: number
  onPick: (claimId: string | null, at: { x: number; y: number }) => void
  onDeckTap: (claimId: string) => void
  onHere: (text: string | null) => void
  onZoom: (zoom: number) => void
}

export function RecallSphere({ sprites, marks, flying, dimmed, lens, shakeUntil, onPick, onDeckTap, onHere, onZoom }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const cam = useRef<Camera>({ rotY: 0, rotX: -0.12, zoom: 1 })
  const vel = useRef({ vy: 0.0013, vx: 0 })
  const drag = useRef<{ x: number; y: number; moved: number } | null>(null)
  const ptrs = useRef(new Map<number, [number, number]>())
  const pinch = useRef<{ d: number; z: number } | null>(null)
  const deckPos = useRef(new Map<string, { X: number; Y: number }>())
  const latest = useRef({ sprites, marks, flying, dimmed, lens, shakeUntil, onHere, onZoom })
  latest.current = { sprites, marks, flying, dimmed, lens, shakeUntil, onHere, onZoom }

  useEffect(() => {
    const cv = ref.current!
    const ctx = cv.getContext('2d')!
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    let W = 0, H = 0
    const size = () => {
      const DPR = Math.min(devicePixelRatio || 1, 2)
      W = cv.clientWidth; H = cv.clientHeight
      cv.width = W * DPR; cv.height = H * DPR; ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
    }
    size()
    const ro = new ResizeObserver(size); ro.observe(cv)
    let raf = 0, last = performance.now(), lastHere: string | null = null
    const frame = (now: number) => {
      const dt = Math.min(now - last, 50); last = now
      const c = cam.current, v = vel.current
      if (!drag.current) {
        c.rotY += v.vy * dt; c.rotX += v.vx * dt; v.vx *= 0.98
        const base = reduced ? 0 : 0.0001
        if (Math.abs(v.vy) > base) v.vy *= 0.985; else v.vy = base * Math.sign(v.vy || 1)
      }
      c.rotX = Math.max(-1.2, Math.min(1.2, c.rotX))
      const L = latest.current
      const shake = now < L.shakeUntil ? Math.sin(now * 0.05) * ((L.shakeUntil - now) / 420) * 0.28 : 0
      ctx.save(); ctx.translate(shake * 8, 0)
      deckPos.current = drawFrame(ctx, { W, H, cam: c, sprites: L.sprites, flying: L.flying, marks: L.marks, t: now * 0.001, reduced, dimmed: L.dimmed, lens: L.lens })
      ctx.restore()
      const here = hereMark(L.marks, c, W, H)
      const hereText = here ? `いま見ている区画　${here.text}　${here.n}主張` : null
      if (hereText !== lastHere) { lastHere = hereText; L.onHere(hereText) }
      raf = requestAnimationFrame(frame)
    }
    const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else { last = performance.now(); raf = requestAnimationFrame(frame) } }
    document.addEventListener('visibilitychange', onVis)
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', onVis) }
  }, [])

  const setZoom = (z: number) => { cam.current.zoom = Math.max(1, Math.min(MAX_ZOOM, z)); latest.current.onZoom(cam.current.zoom) }

  const onWheel = (e: React.WheelEvent) => { e.preventDefault(); setZoom(cam.current.zoom * (1 - e.deltaY * 0.0016)) }
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY])
    if (ptrs.current.size === 2) {
      const v = [...ptrs.current.values()]
      pinch.current = { d: Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]), z: cam.current.zoom }; drag.current = null; return
    }
    drag.current = { x: e.clientX, y: e.clientY, moved: 0 }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, [e.clientX, e.clientY])
    if (ptrs.current.size === 2 && pinch.current) {
      const v = [...ptrs.current.values()]
      setZoom(pinch.current.z * Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]) / pinch.current.d); return
    }
    const d = drag.current; if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    d.moved += Math.abs(dx) + Math.abs(dy)
    vel.current = { vy: dx * 0.00035, vx: dy * 0.00025 }
    cam.current.rotY += dx * 0.005; cam.current.rotX += dy * 0.004
    d.x = e.clientX; d.y = e.clientY
  }
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    ptrs.current.delete(e.pointerId)
    if (ptrs.current.size < 2) pinch.current = null
    const d = drag.current; drag.current = null
    if (!d || d.moved >= 6) return
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left, my = e.clientY - rect.top
    for (const [id, p] of deckPos.current) if (Math.hypot(p.X - mx, p.Y - my) < 26) { onDeckTap(id); return }
    const W = rect.width, H = rect.height, c = cam.current
    const R = Math.min(W, H) * 0.34 * c.zoom
    const hit = pickAt(latest.current.sprites.filter((s) => !latest.current.flying.has(s.claimId)), c, R, W / 2, H / 2 - 14 - (latest.current.flying.size ? 46 : 0), mx, my, c.zoom > 1.4 ? 26 : 20)
    onPick(hit?.claimId ?? null, { x: mx, y: my })
  }

  return (
    <canvas ref={ref} className="absolute inset-0 w-full h-full touch-none cursor-grab active:cursor-grabbing"
      onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
  )
}
```

- [ ] **Step 2: RecallCard（伏せ字／想起／閲覧）**

```tsx
// src/components/recall/RecallCard.tsx
'use client'
// 1主張1枚。mode='quiz' は確かめるのカード（表: 穴か全文伏せ、裏: 原文＋出典、覚えた／まだ）。
// mode='view' は閲覧カード（原文＋出典＋残す／外す）。AI の解説は付けない。選択肢は出さない。
import { useState } from 'react'
import type { RecallClaim } from '@/lib/recall/types'
import { CONFIDENCE_MARKS } from '@/lib/reader-confidence'

type Props = {
  claim: RecallClaim; mode: 'quiz' | 'view'; kept: boolean
  onAnswer?: (result: 'ok' | 'ng') => void
  onKeep?: (keep: boolean) => void
  onClose: () => void
}

function markOf(c: RecallClaim) {
  return c.confidence === 'ok' ? CONFIDENCE_MARKS.ok : c.confidence === 'caut' ? CONFIDENCE_MARKS.caut : '📚'
}

// 伏せ字は承認済みの穴だけ。未承認は想起カード（全文伏せ）。
function hasCloze(claim: RecallClaim) {
  return claim.clozeStatus === 'approved' && claim.holes.length > 0
}

export function RecallCard({ claim, mode, kept, onAnswer, onKeep, onClose }: Props) {
  const [revealed, setRevealed] = useState(mode === 'view')
  const cloze = hasCloze(claim)

  const body = () => {
    if (mode === 'view' || revealed) {
      if (!cloze) return <span>{claim.body}</span>
      const parts: React.ReactNode[] = []; let last = 0
      claim.holes.forEach(([a, b], i) => {
        parts.push(claim.body.slice(last, a))
        parts.push(<span key={i} className="inline-block min-w-[74px] text-center border-b-[1.5px] border-cyan-400/40 text-cyan-300 mx-[3px]">{claim.body.slice(a, b)}</span>)
        last = b
      })
      parts.push(claim.body.slice(last))
      return <>{parts}</>
    }
    if (cloze) {
      const parts: React.ReactNode[] = []; let last = 0
      claim.holes.forEach(([a, b], i) => {
        parts.push(claim.body.slice(last, a))
        parts.push(<span key={i} className="inline-block min-w-[74px] border-b-[1.5px] border-cyan-400 text-transparent mx-[3px]" aria-label="伏せ字">{claim.body.slice(a, b)}</span>)
        last = b
      })
      parts.push(claim.body.slice(last))
      return <>{parts}</>
    }
    return <span className="text-slate-400">この節の主張を思い出す</span>
  }

  const answer = (r: 'ok' | 'ng') => { setRevealed(true); setTimeout(() => onAnswer?.(r), 900) }

  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[22px] z-30 w-[min(520px,calc(100vw-32px))] rounded-2xl border border-slate-600/40 border-t-cyan-400/50 bg-[rgba(10,16,24,.96)] p-6 text-slate-100 shadow-[0_-10px_60px_rgba(111,215,232,.10),0_20px_60px_rgba(0,0,0,.6)]"
      style={{ transformOrigin: '50% 0%', animation: 'recall-card-rise .62s cubic-bezier(.16,.9,.3,1)' }} role="dialog" aria-label="主張のカード">
      <div className="text-[10.5px] tracking-widest text-cyan-300 mb-1">{claim.pageTitle}</div>
      <div className="text-[11px] text-slate-400 mb-3">{claim.sectionHeading} {markOf(claim)}</div>
      <div className="text-[15px] leading-[1.95] font-light">{body()}</div>
      {(mode === 'view' || revealed) && <div className="mt-4 text-[11px] text-slate-400">{claim.source}</div>}
      <div className="flex gap-2.5 mt-4">
        {mode === 'quiz' && !revealed && (
          <>
            <button type="button" className="flex-1 rounded-full border border-slate-600/40 py-3 text-[12.5px] hover:border-cyan-400" onClick={() => answer('ok')}>覚えた</button>
            <button type="button" className="flex-1 rounded-full border border-slate-600/40 py-3 text-[12.5px] hover:border-cyan-400" onClick={() => answer('ng')}>まだ</button>
          </>
        )}
        {mode === 'view' && (
          <>
            <button type="button" className="flex-1 rounded-full border border-cyan-400/60 text-cyan-300 py-3 text-[12.5px]" onClick={() => onKeep?.(!kept)}>{kept ? '残すのをやめる' : '残す'}</button>
            <button type="button" className="rounded-full border border-slate-600/40 px-5 py-3 text-[12.5px]" onClick={onClose}>閉じる</button>
          </>
        )}
      </div>
      <style jsx global>{`@keyframes recall-card-rise{from{opacity:0;transform:translateX(-50%) translateY(-6px) scaleY(.04)}to{opacity:1;transform:translateX(-50%) translateY(0) scaleY(1)}}`}</style>
    </div>
  )
}
```

- [ ] **Step 3: RecallScreen（HUD・確かめる・山・凡例・レンズ）**

```tsx
// src/components/recall/RecallScreen.tsx
'use client'
// Recall 画面。球＋上部の内訳＋下部の「確かめる」。
// 確かめる: 離脱候補（最大5）が順に離脱して山になる。球は退いて42%に暗くなる。
// 山をタップ→カード→覚えた／まだ→主張が光として元の位置へ帰る。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRecallData } from './useRecallData'
import { RecallSphere } from './RecallSphere'
import { RecallCard } from './RecallCard'
import type { LensMode } from '@/lib/recall/render'
import { GENRE_SEATS, OTHER_SLOT } from '@/lib/recall/genres'

const FLY_MS = 900

export function RecallScreen() {
  const data = useRecallData()
  const [flying, setFlying] = useState<Map<string, number>>(new Map())
  const [deck, setDeck] = useState<string[]>([])
  const [shakeUntil, setShakeUntil] = useState(0)
  const [card, setCard] = useState<{ claimId: string; mode: 'quiz' | 'view' } | null>(null)
  const [tip, setTip] = useState<{ claimId: string; x: number; y: number } | null>(null)
  const [here, setHere] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [lens, setLens] = useState<LensMode>('all')
  const [notice, setNotice] = useState<string | null>(null)
  const raf = useRef(0)

  const claimById = useMemo(() => new Map(data.claims.map((c) => [c.claimId, c])), [data.claims])

  // 離脱アニメーション（0→1 を FLY_MS で進める）
  useEffect(() => {
    if (![...flying.values()].some((v) => v < 1)) return
    let last = performance.now()
    const step = (now: number) => {
      const dt = now - last; last = now
      setFlying((prev) => { const n = new Map(prev); for (const [k, v] of n) if (v < 1) n.set(k, Math.min(1, v + dt / FLY_MS)); return n })
      raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [flying])

  const check = useCallback(() => {
    const cands = data.candidates.map((p) => p.claimId).filter((id) => claimById.has(id))
    if (!cands.length) {
      const d = data.nextDue
      setNotice(d ? `いま確かめる主張はありません。次は ${Math.max(1, Math.ceil((d.at.getTime() - Date.now()) / 86400000))} 日後に ${d.count} 件` : 'まだ残した主張がありません。球の主張を開いて「残す」を押すと、ここから確かめられます')
      setTimeout(() => setNotice(null), 4000); return
    }
    setShakeUntil(performance.now() + 420)
    setDeck(cands)
    cands.forEach((id, k) => setTimeout(() => setFlying((prev) => new Map(prev).set(id, 0.001)), 120 + k * 55))
  }, [data.candidates, data.nextDue, claimById])

  const reset = () => { setFlying(new Map()); setDeck([]); setCard(null) }

  const onAnswer = async (claimId: string, result: 'ok' | 'ng') => {
    try { await data.review(claimId, result) } catch { setNotice('保存に失敗しました。通信を確かめてもう一度'); setTimeout(() => setNotice(null), 4000) }
    setCard(null)
    setFlying((prev) => { const n = new Map(prev); n.delete(claimId); return n })
    setDeck((prev) => result === 'ok' ? prev.filter((x) => x !== claimId) : [...prev.filter((x) => x !== claimId), claimId])
    if (result === 'ng') setTimeout(() => setFlying((prev) => new Map(prev).set(claimId, 0.001)), 300)
  }

  const kept = (id: string) => { const p = data.progressById.get(id); return !!p && !p.removedAt }
  const cardClaim = card ? claimById.get(card.claimId) : undefined
  const tipClaim = tip ? claimById.get(tip.claimId) : undefined
  const dimmed = flying.size > 0

  return (
    <div className="fixed inset-0 z-20 bg-[#05080e] text-slate-100 overflow-hidden" style={{ fontFamily: '"Zen Kaku Gothic New",-apple-system,"Hiragino Sans",sans-serif' }}>
      <RecallSphere sprites={data.sprites} marks={data.marks} flying={flying} dimmed={dimmed} lens={lens} shakeUntil={shakeUntil}
        onPick={(id, at) => setTip(id ? { claimId: id, ...at } : null)}
        onDeckTap={(id) => { setTip(null); setCard({ claimId: id, mode: 'quiz' }) }}
        onHere={setHere} onZoom={setZoom} />

      <div className="absolute top-6 left-7 pointer-events-none">
        <h1 className="text-[21px] tracking-[.14em] font-semibold" style={{ fontFamily: '"Shippori Mincho",serif' }}>Recall</h1>
        <p className="mt-1.5 text-[11px] font-light tracking-[.08em] text-slate-400">検証済みの主張 {data.claims.length}　明るさは、思い出せる度合い</p>
      </div>
      <div className="absolute top-7 right-7 text-right pointer-events-none">
        <div className="text-[28px] font-light tabular-nums">{data.claims.length}<small className="text-[11px] text-slate-400 tracking-widest ml-1.5">主張</small></div>
        <p className="text-[10.5px] text-slate-400 tracking-[.1em] mt-1">残した {data.counts.kept + data.counts.settled} ／ 読んだ {data.counts.touched} ／ 未着手 {data.counts.cold}</p>
      </div>
      {here && <div className="absolute top-[22px] left-1/2 -translate-x-1/2 text-[12.5px] tracking-[.06em] text-cyan-200 pointer-events-none">{here}</div>}

      <div className="absolute left-7 bottom-7 text-[10.5px] text-slate-400 leading-8 tracking-[.06em] pointer-events-none max-[680px]:hidden">
        <div><i className="inline-block w-2 h-2 rounded-full mr-2 align-[1px]" style={{ background: '#eaf7fd', boxShadow: '0 0 8px #bfe9f5' }} />定着した</div>
        <div><i className="inline-block w-2 h-2 rounded-full mr-2 align-[1px]" style={{ background: '#bfe9f5' }} />残した（明るいほど思い出せる）</div>
        <div><i className="inline-block w-2 h-2 rounded-full mr-2 align-[1px]" style={{ background: '#5b6a7a' }} />読んだ節の主張</div>
        <div><i className="inline-block w-2 h-2 rounded-full mr-2 align-[1px]" style={{ background: '#2b333d' }} />未着手</div>
      </div>
      <div className="absolute right-7 bottom-7 text-[10.5px] text-slate-400 tracking-[.08em] pointer-events-none">ホイール／ピンチで寄る　<b className="text-cyan-300 font-medium">{zoom.toFixed(1)}x</b></div>

      {deck.length > 0 && !card && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[148px] text-[11px] tracking-[.1em] text-slate-400">薄れている主張が <b className="text-cyan-300 font-medium tabular-nums">{deck.length}</b>　山をタップで開く</div>
      )}
      {notice && <div className="absolute left-1/2 -translate-x-1/2 bottom-[148px] text-[12px] tracking-[.06em] text-cyan-200 bg-[rgba(12,20,30,.9)] border border-slate-600/40 rounded-full px-4 py-2">{notice}</div>}

      <div className="absolute left-1/2 -translate-x-1/2 bottom-6 flex gap-2.5 items-center">
        <button type="button" onClick={check} className="rounded-full border border-slate-600/40 bg-[rgba(12,20,30,.9)] px-5 py-[11px] text-[12.5px] tracking-[.08em] hover:border-cyan-400 backdrop-blur">確かめる</button>
        <div className="flex rounded-full border border-slate-600/40 bg-[rgba(12,20,30,.9)] overflow-hidden">
          <button type="button" onClick={() => setLens('all')} className={`px-3.5 py-[11px] text-[11.5px] ${lens === 'all' ? 'text-cyan-300' : ''}`}>すべて</button>
          <button type="button" onClick={() => setLens('kept')} className={`px-3.5 py-[11px] text-[11.5px] ${lens === 'kept' ? 'text-cyan-300' : ''}`}>残したものだけ</button>
        </div>
        {deck.length > 0 && <button type="button" onClick={reset} className="rounded-full border border-slate-600/40 bg-[rgba(12,20,30,.9)] px-5 py-[11px] text-[12.5px] tracking-[.08em]">戻す</button>}
      </div>

      {tip && tipClaim && !card && (
        <button type="button" className="absolute z-30 max-w-[290px] text-left bg-[rgba(10,16,24,.96)] border border-slate-600/40 rounded-[10px] px-3.5 py-2.5 text-[12px] leading-relaxed"
          style={{ left: Math.max(12, Math.min(window.innerWidth - 302, tip.x - 145)), top: Math.max(12, tip.y - 90) }}
          onClick={() => { setCard({ claimId: tip.claimId, mode: 'view' }); setTip(null) }}>
          <div className="text-[10px] text-cyan-300 tracking-[.12em] mb-0.5">{(tipClaim.genreSlot === OTHER_SLOT ? 'その他' : GENRE_SEATS[tipClaim.genreSlot])} ／ {tipClaim.sectionHeading}</div>
          <div>{tipClaim.body.slice(0, 80)}{tipClaim.body.length > 80 ? '…' : ''}　タップで開く</div>
        </button>
      )}

      {card && cardClaim && (
        <RecallCard claim={cardClaim} mode={card.mode} kept={kept(cardClaim.claimId)}
          onAnswer={(r) => void onAnswer(cardClaim.claimId, r)}
          onKeep={async (k) => { try { await data.keep(cardClaim.claimId, k) } catch { setNotice('保存に失敗しました'); setTimeout(() => setNotice(null), 4000) } }}
          onClose={() => setCard(null)} />
      )}
      {data.loading && <div className="absolute inset-0 grid place-items-center text-slate-400 text-sm">読み込んでいます</div>}
      {data.error && <div className="absolute inset-0 grid place-items-center text-rose-300 text-sm">{data.error}</div>}
    </div>
  )
}
```

- [ ] **Step 4: 型チェック**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: エラーなし（`window` を参照する行は `'use client'` 配下なので型は通る。`style jsx` が型エラーになるなら `<style>{...}</style>` に置き換え、キーフレームはグローバル CSS `src/app/globals.css` の末尾に移す）

- [ ] **Step 5: Commit**

```bash
git add src/components/recall
git commit -m "feat(recall): 画面（球・カード・確かめる・レンズ）"
```

---

### Task 13: ホームにタブを置く（フラグ下）

**Files:**
- Modify: `src/app/page.tsx:117`（`Tab` 型）、`:3027-3036`（tabs 配列）、`:3160-3167`（描画・Notion モード）、`:3270-3280`（描画・Algolia モード）

**Interfaces:**
- Consumes: `isRecallEnabled()`（Task 1）、`<RecallScreen />`（Task 12）

- [ ] **Step 1: 変更する**

`Tab` 型に `'recall'` を足す:

```ts
type Tab = 'search' | 'recent' | 'browse' | 'quiz' | 'reference' | 'manual' | 'recall'
```

import を足す（`lucide-react` の `Orbit` と2つのモジュール）:

```ts
import { Orbit } from 'lucide-react'   // 既存の lucide import 行に追加する
import { isRecallEnabled } from '@/lib/recall-flag'
import { RecallScreen } from '@/components/recall/RecallScreen'
```

tabs 配列の `manual` の行の直後:

```ts
    // Recall（知の球）。機能フラグが開いている人にだけタブを出す（判定の正はサーバー。ここは表示制御のみ）。
    ...(isRecallEnabled() ? [{ id: 'recall' as Tab, label: 'Recall', Icon: Orbit }] : []),
```

タブ描画の2か所（Notion モード `:3167` の `manual` の行の直後、Algolia モード `:3279` の同じ位置）に:

```tsx
          {activeTab === 'recall' && <RecallScreen />}
```

`tabTone`（`:3024` 付近の色の辞書）に `recall: 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300',` を足す。

- [ ] **Step 2: 手で確かめる**

`.env.local` に `RECALL_EMAILS` を置いた状態で `preview_start` の `medical-search-public` を起動し、オーナーでログインしてタブ「Recall」が出ること、球が描かれること、主張タップ→閲覧カード→「残す」→内訳の「残した」が1増えることを見る。別のアカウント（または `RECALL_EMAILS` を外して）ではタブが出ず、`/api/recall/claims` が 404 を返すことを見る。

- [ ] **Step 3: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat(recall): ホームに Recall タブ（機能フラグが開いている人だけ）"
```

---

### Task 14: 管理画面の承認一覧（篩）

**Files:**
- Create: `src/app/api/admin/recall/cards/route.ts`
- Create: `src/app/admin/RecallCardsPanel.tsx`
- Modify: `src/app/admin/AdminLedgerClient.tsx`（`SpreadCard` の隣に置く。`:1066` 付近）
- Test: `src/lib/__tests__/admin-recall-cards-route.test.ts`

**Interfaces:**
- Consumes: `requireAdmin`（`@/lib/admin-guard`）、`createAdminClient`、`claimFromRow`（Task 9）
- Produces:
  - `GET /api/admin/recall/cards?status=pending|approved|rejected|all` → `{ cards: RecallClaim[] }`（holes が空でない主張のみ）
  - `PATCH /api/admin/recall/cards` body `{ claimId: string; clozeStatus?: 'approved' | 'rejected' | 'pending'; holes?: [number, number][] }` → `{ ok: true }`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/admin-recall-cards-route.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireAdmin = vi.fn()
const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }))
let rows: unknown[] = []
vi.mock('@/lib/admin-guard', () => ({ requireAdmin: () => requireAdmin() }))
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({
    from: () => ({
      update,
      select: () => { const q = { eq: () => q, neq: () => q, order: () => q, then: (res: (v: unknown) => void) => res({ data: rows, error: null }) }; return q },
    }),
  }),
}))
const { GET, PATCH } = await import('../../app/api/admin/recall/cards/route')

beforeEach(() => { requireAdmin.mockReset(); update.mockClear(); rows = [] })

describe('admin recall cards', () => {
  it('管理者でなければガードの応答を返す', async () => {
    requireAdmin.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) })
    expect((await GET(new Request('http://localhost/api/admin/recall/cards'))).status).toBe(403)
  })
  it('GET は穴を持つ主張だけを返す', async () => {
    requireAdmin.mockResolvedValue({ ok: true, email: 'o@example.com' })
    rows = [
      { claim_id: 'a', page_id: 'p', page_title: 't', body: 'b', holes: [[0, 1]], cloze_status: 'pending', confidence: 'ok', genres: [], genre_slot: 4, active: true },
      { claim_id: 'b', page_id: 'p', page_title: 't', body: 'b', holes: [], cloze_status: 'pending', confidence: 'ok', genres: [], genre_slot: 4, active: true },
    ]
    const json = await (await GET(new Request('http://localhost/api/admin/recall/cards?status=pending'))).json()
    expect(json.cards.map((c: { claimId: string }) => c.claimId)).toEqual(['a'])
  })
  it('PATCH は cloze_status と holes を更新し、不正な値は 400', async () => {
    requireAdmin.mockResolvedValue({ ok: true, email: 'o@example.com' })
    const ok = await PATCH(new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ claimId: 'a', clozeStatus: 'approved', holes: [[0, 2]] }) }))
    expect(ok.status).toBe(200)
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ cloze_status: 'approved', holes: [[0, 2]] }))
    const bad = await PATCH(new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ claimId: 'a', clozeStatus: 'maybe' }) }))
    expect(bad.status).toBe(400)
    const tooMany = await PATCH(new Request('http://localhost/x', { method: 'PATCH', body: JSON.stringify({ claimId: 'a', holes: [[0, 1], [2, 3], [4, 5], [6, 7]] }) }))
    expect(tooMany.status).toBe(400)
  })
})
```

- [ ] **Step 2: 失敗を確認する**

Run: `npx vitest run src/lib/__tests__/admin-recall-cards-route.test.ts`
Expected: FAIL

- [ ] **Step 3: ルートを実装する**

```ts
// src/app/api/admin/recall/cards/route.ts
// 篩の承認。伏せ字候補（holes が空でない主張）を一覧し、出す／出さない／穴を直す。
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { createAdminClient } from '@/lib/supabase/server'
import { claimFromRow } from '@/lib/recall/guard'
import { MAX_HOLES } from '@/lib/recall/holes'

const STATUSES = ['pending', 'approved', 'rejected'] as const
const COLS = 'claim_id, page_id, page_title, page_kind, section_key, section_heading, body, source, confidence, genres, primary_genre, genre_slot, holes, cloze_status, active'

export async function GET(req: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const status = new URL(req.url).searchParams.get('status') ?? 'pending'
  let q = createAdminClient().from('recall_claims').select(COLS).eq('active', true).order('page_title').order('section_key').order('claim_id')
  if ((STATUSES as readonly string[]).includes(status)) q = q.eq('cloze_status', status)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const cards = (data ?? []).map(claimFromRow).filter((c) => c.holes.length > 0)
  return NextResponse.json({ cards })
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const body = (await req.json().catch(() => null)) as { claimId?: unknown; clozeStatus?: unknown; holes?: unknown } | null
  if (!body || typeof body.claimId !== 'string') return NextResponse.json({ error: 'claimId が必要です' }, { status: 400 })
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.clozeStatus !== undefined) {
    if (!(STATUSES as readonly unknown[]).includes(body.clozeStatus)) return NextResponse.json({ error: 'clozeStatus が不正です' }, { status: 400 })
    patch.cloze_status = body.clozeStatus
  }
  if (body.holes !== undefined) {
    const h = body.holes
    const valid = Array.isArray(h) && h.length <= MAX_HOLES && h.every((x) => Array.isArray(x) && x.length === 2 && Number.isInteger(x[0]) && Number.isInteger(x[1]) && x[0] >= 0 && x[1] > x[0])
    if (!valid) return NextResponse.json({ error: `holes は [start,end] の配列（最大${MAX_HOLES}）です` }, { status: 400 })
    patch.holes = h
  }
  const { error } = await createAdminClient().from('recall_claims').update(patch).eq('claim_id', body.claimId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
```

- [ ] **Step 4: パネルを実装する**

```tsx
// src/app/admin/RecallCardsPanel.tsx
'use client'
// Recall の篩。伏せ字候補をページ順に並べ、表の見え方・裏・出典を出す。操作は3つ:
// 出す（approved）／出さない（rejected）／穴を直す（範囲をタップで外す。足すのは本文の数値をドラッグ選択）。
// 既定は未承認（pending）。未承認は想起カードとして球に出ているので、ここで承認しなくても Recall は止まらない。
import { useEffect, useState } from 'react'
import { SectionHeading } from './SectionHeading'
import type { RecallClaim } from '@/lib/recall/types'

type Status = 'pending' | 'approved' | 'rejected'

export function RecallCardsPanel() {
  const [status, setStatus] = useState<Status>('pending')
  const [cards, setCards] = useState<RecallClaim[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)

  const load = async (s: Status) => {
    setLoading(true)
    const res = await fetch(`/api/admin/recall/cards?status=${s}`)
    setCards(res.ok ? ((await res.json()) as { cards: RecallClaim[] }).cards : [])
    setLoading(false)
  }
  useEffect(() => { void load(status) }, [status])

  const patch = async (claimId: string, body: Record<string, unknown>) => {
    setBusy(claimId)
    await fetch('/api/admin/recall/cards', { method: 'PATCH', body: JSON.stringify({ claimId, ...body }) })
    setCards((prev) => prev.filter((c) => c.claimId !== claimId || body.holes !== undefined))
    if (body.holes !== undefined) setCards((prev) => prev.map((c) => (c.claimId === claimId ? { ...c, holes: body.holes as [number, number][] } : c)))
    setBusy(null)
  }

  const front = (c: RecallClaim) => {
    const parts: React.ReactNode[] = []; let last = 0
    c.holes.forEach(([a, b], i) => {
      parts.push(c.body.slice(last, a))
      parts.push(
        <button key={i} type="button" title="この穴を外す" className="inline-block min-w-[60px] border-b-2 border-cyan-500 text-cyan-700 dark:text-cyan-300 mx-0.5 hover:line-through"
          onClick={() => void patch(c.claimId, { holes: c.holes.filter((_, j) => j !== i) })}>{c.body.slice(a, b)}</button>,
      )
      last = b
    })
    parts.push(c.body.slice(last))
    return parts
  }

  const addHole = (c: RecallClaim, el: HTMLElement) => {
    const sel = window.getSelection()
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return
    const range = sel.getRangeAt(0)
    if (!el.contains(range.commonAncestorContainer)) return
    const pre = range.cloneRange(); pre.selectNodeContents(el); pre.setEnd(range.startContainer, range.startOffset)
    const start = pre.toString().length, end = start + range.toString().length
    if (c.holes.length >= 3 || c.holes.some(([a, b]) => start < b && end > a)) return
    void patch(c.claimId, { holes: [...c.holes, [start, end] as [number, number]].sort((x, y) => x[0] - y[0]) })
    sel.removeAllRanges()
  }

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 mb-4">
      <SectionHeading title="Recall のカード（伏せ字の承認）" caption="数値の穴が作れた主張の一覧。出す／出さないを決め、穴が変なら直す。未承認は想起カード（全文伏せ）として出ています。" help="recall_claims.cloze_status。承認すると Recall の確かめるで伏せ字カードになります。穴はタップで外し、裏の本文を範囲選択すると足せます（最大3）。" />
      <div className="flex gap-2 mb-3 text-xs">
        {(['pending', 'approved', 'rejected'] as Status[]).map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)} className={`px-3 py-1 rounded-full border ${status === s ? 'border-cyan-500 text-cyan-700 dark:text-cyan-300' : 'border-gray-300 dark:border-gray-600'}`}>
            {s === 'pending' ? '未承認' : s === 'approved' ? '出す' : '出さない'}
          </button>
        ))}
        <span className="ml-auto text-gray-500">{cards.length} 件</span>
      </div>
      {loading ? <p className="text-sm text-gray-500">読み込んでいます</p> : cards.length === 0 ? <p className="text-sm text-gray-500">該当なし</p> : (
        <ul className="divide-y divide-gray-100 dark:divide-gray-700">
          {cards.map((c) => (
            <li key={c.claimId} className="py-3 text-sm">
              <div className="text-[11px] text-gray-500 mb-1">{c.pageTitle}　{c.sectionHeading}</div>
              <div className="leading-7 mb-1">{front(c)}</div>
              <div className="text-xs text-gray-600 dark:text-gray-300 leading-6 select-text cursor-text" onMouseUp={(e) => addHole(c, e.currentTarget)} title="数値を範囲選択すると穴に足せます">{c.body}</div>
              <div className="text-[11px] text-gray-500 mt-1">{c.source}</div>
              <div className="flex gap-2 mt-2">
                {status !== 'approved' && <button type="button" disabled={busy === c.claimId} onClick={() => void patch(c.claimId, { clozeStatus: 'approved' })} className="px-3 py-1 rounded-full border border-cyan-500 text-cyan-700 dark:text-cyan-300 text-xs">出す</button>}
                {status !== 'rejected' && <button type="button" disabled={busy === c.claimId} onClick={() => void patch(c.claimId, { clozeStatus: 'rejected' })} className="px-3 py-1 rounded-full border border-gray-300 dark:border-gray-600 text-xs">出さない</button>}
                {status !== 'pending' && <button type="button" disabled={busy === c.claimId} onClick={() => void patch(c.claimId, { clozeStatus: 'pending' })} className="px-3 py-1 rounded-full border border-gray-300 dark:border-gray-600 text-xs">未承認に戻す</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
```

`AdminLedgerClient.tsx` で `import { RecallCardsPanel } from './RecallCardsPanel'` を足し、`<SpreadCard />`（`:1066`）の直後に `<RecallCardsPanel />` を置く。

- [ ] **Step 5: テストを通す**

Run: `npx vitest run src/lib/__tests__/admin-recall-cards-route.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS・型エラーなし

- [ ] **Step 6: Commit**

```bash
git add src/app/api/admin/recall/cards/route.ts src/app/admin/RecallCardsPanel.tsx src/app/admin/AdminLedgerClient.tsx src/lib/__tests__/admin-recall-cards-route.test.ts
git commit -m "feat(recall): 管理画面に伏せ字の承認一覧（出す／出さない／穴を直す）"
```

---

### Task 15: 実物で確かめる（オーナー実測）

**Files:** なし（記録は Notion の作業ログ）

- [ ] **Step 1: 全テストと型**

Run: `npx vitest run && npx tsc --noEmit -p tsconfig.json`
Expected: すべて PASS

- [ ] **Step 2: ブラウザで動線を通す**

`preview_start` の `medical-search-public` を起動し、ブラウザペインを表示状態にして（非表示だとアニメーションが進まない）:

1. Recall タブ → 球が描かれ、内訳が「残した 0 ／ 読んだ 0 ／ 未着手 N」
2. 寄る（ホイール）→ 1.25倍でジャンル名、1.8倍で「いま見ている区画」、2.0倍でページ名
3. 主張タップ → 吹き出し → 閲覧カード → 「残す」 → 内訳の「残した」が 1
4. 「確かめる」 → 候補0なら「次は1日後に1件」の案内
5. Supabase で `recall_progress` の `due_at` を過去に書き換え → リロード → 「確かめる」 → 離脱 → 山タップ → カード → 「覚えた」 → 光として戻る、`interval_days` が 3
6. 管理画面 → Recall のカード → 1件「出す」 → その主張の due を過去にして確かめる → 伏せ字カードになる
7. 別アカウント（または `RECALL_EMAILS` を外す）→ タブが無い、`/api/recall/claims` が 404

- [ ] **Step 3: 描画時間を測る**

DevTools の Performance で 700 主張のフレーム時間を記録する。実機 iPhone でも同じページを開いて、回す・寄るが滑らかかを見る。値は Notion の作業ログ「MediNode アプリ開発」2026-09 の節に書く（コードやコミット文には書かない）。

- [ ] **Step 4: 完了の報告**

superpowers:finishing-a-development-branch に従い、worktree のブランチを main に合流する。push はオーナーの承認を取る。

---

## 実装後に別計画で行うこと

- **今日の1問の撤去**（設計書「今日の1問の撤去範囲」）。Recall がオーナー実測で動いた後に、独立した計画として起こす
- **読む画面からの「残す」と節の読了**、Notion への落とし（拾う＋Notion DB の設計セッション）。API `/api/recall/keep` と `/api/recall/read` は本計画で用意済み
- **WebGL 描画層**（active な主張が 2,500 を超えたとき）
- **RECALL_GA** と `daily_question_log` の drop（drnode.com の公開判断のとき）

## オーナーにお願いする作業（Claude が代行しない）

1. `.env.local` と Vercel に `RECALL_EMAILS=<オーナーのメール>` を置く（Task 1）
2. Supabase SQL Editor で `0029_recall.sql` を流し、台帳を ✅ にする（Task 2）
3. 管理画面で「サブスク同期」を1回押す（Task 6 Step 5）
