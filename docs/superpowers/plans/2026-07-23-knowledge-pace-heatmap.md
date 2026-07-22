# ナレッジ投稿ペース・ヒートマップ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** /admin「🗼今日の管理」タブに、サブスク公開ナレッジ（🩺Medical Knowledge＋📚Reference Library）の投稿・更新ペースを可視化する GitHub 草グラフ風ヒートマップ＋週目標達成バー＋サマリーを 1 セクション追加する。

**Architecture:** 純粋な日次集計ロジックを `src/lib/knowledge-activity.ts` に切り出し（vitest でユニットテスト）、admin 専用 API `GET /api/admin/knowledge-activity` が Notion 2 DB を直クエリして生の作成/更新時刻を集計ロジックへ渡す。描画は依存追加なしのインライン SVG `HeatmapChart`（`AdminCharts.tsx`）。`DailyCommandCenter.tsx` がステータス帯と「今日やること」の間で fetch・描画・週目標編集を担う。

**Tech Stack:** Next.js App Router / TypeScript / `@notionhq/client` / Tailwind（既存 brand カラー）/ vitest / lucide-react。追加依存なし。

## Global Constraints

- 追加 npm 依存は入れない（チャートはインライン SVG。既存 `AdminCharts.tsx` の流儀）。
- すべての admin API はハンドラ先頭で `requireAdmin()`（`@/lib/admin-guard`）を通し、`if (!gate.ok) return gate.response`。
- 日付の区切りは JST（Asia/Tokyo）。ISO 時刻→JST 日付キーは既存 `jstDateKey`（`@/lib/admin-daily`, 引数は epoch ms、返り値 `'YYYY-MM-DD'`）を使う。
- env が未設定・テーブル未適用などは throw せず best-effort（`{ ready: false }` / 空表示）。既存 `/api/admin/daily`・`cq-ranking` に倣う。
- 色は 🩺Medical=brand グリーン系、📚Reference=amber 系。ライト/ダーク両対応（Tailwind の `dark:` バリアント）。
- 対象 DB は env: `SUBSCRIPTION_NOTION_TOKEN` / `SUBSCRIPTION_MEDICAL_DB_ID` / `SUBSCRIPTION_REFERENCE_DB_ID`（既存・新規追加なし）。
- 週は JST 月曜起点。週目標は「ナレッジ（medical）新規＋更新」の件数のみを対象（reference は目標に含めない）。
- テストは `npm test`（= `vitest run`）。純ロジックのテストは `src/lib/__tests__/` に置く。

---

### Task 1: 日次集計の純ロジック（`src/lib/knowledge-activity.ts`）

Notion ページの生タイミングから、JST 日次バケット・サマリー・週グリッドを組む純関数群。UI・fetch を含まないのでユニットテストしやすい。

**Files:**
- Create: `src/lib/knowledge-activity.ts`
- Test: `src/lib/__tests__/knowledge-activity.test.ts`

**Interfaces:**
- Consumes: `jstDateKey(ms: number): string` from `@/lib/admin-daily`。
- Produces:
  - 型 `PageTiming = { createdAt: string; lastEdited: string }`（ISO 文字列。空文字は無効として無視）
  - 型 `DayActivity = { date: string; medicalNew: number; medicalEdit: number; referenceNew: number; referenceEdit: number }`
  - 型 `ActivitySummary = { last7: { medical: number; reference: number }; last30: { medical: number; reference: number }; daysSinceLastMedical: number | null; thisWeekMedical: number }`
  - `aggregateDaily(medical: PageTiming[], reference: PageTiming[]): Map<string, DayActivity>` — 各ページの `createdAt`(JST 日) に new+1、`lastEdited`(JST 日) が created 日と異なれば edit+1。系列ごと。
  - `jstWeekdayMon0(dateKey: string): number` — `'YYYY-MM-DD'` の JST 曜日を月曜=0..日曜=6 で返す。
  - `computeSummary(daily: Map<string, DayActivity>, nowMs: number): ActivitySummary` — last7/last30 は今日を含む直近 7/30 日、`thisWeekMedical` は今週（月曜起点）の medical(new+edit)、`daysSinceLastMedical` は直近 medicalNew>0 日から今日までの日数（皆無なら null）。
  - `buildWeekGrid(daily: Map<string, DayActivity>, nowMs: number, weeks: number): { columns: DayActivity[][]; todayKey: string }` — 今週の月曜を最右列とし、`weeks` 列ぶん（各列 月..日の 7 セル、`weeks*7` 日）を 0 埋めして返す。各セルは `DayActivity`。今日より後の日も 0 埋めで含む（描画側が未来判定に `date > todayKey` を使えるよう `todayKey` も返す）。

- [ ] **Step 1: 失敗するテストを書く（aggregateDaily の new/edit 判定）**

`src/lib/__tests__/knowledge-activity.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  aggregateDaily,
  computeSummary,
  buildWeekGrid,
  jstWeekdayMon0,
} from '@/lib/knowledge-activity'

// JST 2026-07-23 12:00 = UTC 2026-07-23T03:00:00Z
const NOW = Date.parse('2026-07-23T03:00:00.000Z')

describe('aggregateDaily', () => {
  it('作成日に new、別日の最終更新に edit を系列ごとに加算する', () => {
    const daily = aggregateDaily(
      [
        // 作成と更新が同日 → new のみ
        { createdAt: '2026-07-20T01:00:00.000Z', lastEdited: '2026-07-20T05:00:00.000Z' },
        // 作成後、別日に更新 → 作成日に new、更新日に edit
        { createdAt: '2026-07-20T01:00:00.000Z', lastEdited: '2026-07-22T05:00:00.000Z' },
      ],
      [
        { createdAt: '2026-07-21T01:00:00.000Z', lastEdited: '2026-07-21T01:00:00.000Z' },
      ],
    )
    expect(daily.get('2026-07-20')).toEqual({
      date: '2026-07-20', medicalNew: 2, medicalEdit: 0, referenceNew: 0, referenceEdit: 0,
    })
    expect(daily.get('2026-07-22')).toEqual({
      date: '2026-07-22', medicalNew: 0, medicalEdit: 1, referenceNew: 0, referenceEdit: 0,
    })
    expect(daily.get('2026-07-21')).toEqual({
      date: '2026-07-21', medicalNew: 0, medicalEdit: 0, referenceNew: 1, referenceEdit: 0,
    })
  })

  it('UTC→JST の日跨ぎを JST 日付で割り当てる', () => {
    // UTC 2026-07-20T16:00Z = JST 2026-07-21 01:00 → 21日に new
    const daily = aggregateDaily(
      [{ createdAt: '2026-07-20T16:00:00.000Z', lastEdited: '2026-07-20T16:00:00.000Z' }],
      [],
    )
    expect(daily.get('2026-07-21')?.medicalNew).toBe(1)
    expect(daily.has('2026-07-20')).toBe(false)
  })

  it('空文字の時刻は無視する', () => {
    const daily = aggregateDaily([{ createdAt: '', lastEdited: '' }], [])
    expect(daily.size).toBe(0)
  })
})

describe('jstWeekdayMon0', () => {
  it('月曜=0, 日曜=6 を返す', () => {
    expect(jstWeekdayMon0('2026-07-20')).toBe(0) // 月
    expect(jstWeekdayMon0('2026-07-23')).toBe(3) // 木
    expect(jstWeekdayMon0('2026-07-26')).toBe(6) // 日
  })
})

describe('computeSummary', () => {
  it('直近7/30日・今週medical・最終投稿からの日数を出す', () => {
    const daily = aggregateDaily(
      [
        { createdAt: '2026-07-21T01:00:00.000Z', lastEdited: '2026-07-21T01:00:00.000Z' }, // 今週 new
        { createdAt: '2026-06-30T01:00:00.000Z', lastEdited: '2026-06-30T01:00:00.000Z' }, // 30日内(new)・7日外
      ],
      [{ createdAt: '2026-07-22T01:00:00.000Z', lastEdited: '2026-07-22T01:00:00.000Z' }],
    )
    const s = computeSummary(daily, NOW)
    expect(s.last7.medical).toBe(1)
    expect(s.last7.reference).toBe(1)
    expect(s.last30.medical).toBe(2)
    expect(s.thisWeekMedical).toBe(1)
    expect(s.daysSinceLastMedical).toBe(2) // 7/21 → 7/23
  })

  it('medical新規が皆無なら daysSinceLastMedical は null', () => {
    const daily = aggregateDaily([], [{ createdAt: '2026-07-22T01:00:00.000Z', lastEdited: '2026-07-22T01:00:00.000Z' }])
    expect(computeSummary(daily, NOW).daysSinceLastMedical).toBe(null)
  })
})

describe('buildWeekGrid', () => {
  it('weeks 列ぶんを月曜起点で0埋めし、今週月曜を最右列にする', () => {
    const daily = aggregateDaily(
      [{ createdAt: '2026-07-21T01:00:00.000Z', lastEdited: '2026-07-21T01:00:00.000Z' }],
      [],
    )
    const grid = buildWeekGrid(daily, NOW, 4)
    expect(grid.columns).toHaveLength(4)
    expect(grid.columns.every((col) => col.length === 7)).toBe(true)
    expect(grid.todayKey).toBe('2026-07-23')
    // 最右列は今週（月曜=2026-07-20〜）。火曜(index1)=2026-07-21 に medicalNew=1
    const lastCol = grid.columns[3]
    expect(lastCol[0].date).toBe('2026-07-20')
    expect(lastCol[1].date).toBe('2026-07-21')
    expect(lastCol[1].medicalNew).toBe(1)
  })
})
```

- [ ] **Step 2: テストを実行して落ちることを確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/knowledge-activity.test.ts`
Expected: FAIL（`knowledge-activity` を解決できない / 関数未定義）

- [ ] **Step 3: 最小実装を書く**

`src/lib/knowledge-activity.ts`:

```ts
// ナレッジ投稿ペースの純ロジック（/admin 今日の管理）。
// Notion ページの作成/最終更新時刻から JST 日次バケット・サマリー・週グリッドを組む。
// fetch も描画も含まない純関数群（vitest 対象）。
//
// 既知の制約: Notion からは「最後に触った日」しか取れないため、1ページの多重更新履歴は
// 最終更新日1点に畳まれる。直近の活動は正確に残る。

import { jstDateKey } from '@/lib/admin-daily'

export type PageTiming = { createdAt: string; lastEdited: string }

export type DayActivity = {
  date: string
  medicalNew: number
  medicalEdit: number
  referenceNew: number
  referenceEdit: number
}

export type ActivitySummary = {
  last7: { medical: number; reference: number }
  last30: { medical: number; reference: number }
  daysSinceLastMedical: number | null
  thisWeekMedical: number
}

const DAY_MS = 86_400_000

function emptyDay(date: string): DayActivity {
  return { date, medicalNew: 0, medicalEdit: 0, referenceNew: 0, referenceEdit: 0 }
}

// ISO → JST 日付キー。無効・空は null。
function isoToJstKey(iso: string): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return jstDateKey(ms)
}

function addSeries(
  daily: Map<string, DayActivity>,
  pages: PageTiming[],
  newKey: 'medicalNew' | 'referenceNew',
  editKey: 'medicalEdit' | 'referenceEdit',
): void {
  for (const p of pages) {
    const created = isoToJstKey(p.createdAt)
    if (created) {
      const d = daily.get(created) ?? emptyDay(created)
      d[newKey] += 1
      daily.set(created, d)
    }
    const edited = isoToJstKey(p.lastEdited)
    if (edited && edited !== created) {
      const d = daily.get(edited) ?? emptyDay(edited)
      d[editKey] += 1
      daily.set(edited, d)
    }
  }
}

export function aggregateDaily(
  medical: PageTiming[],
  reference: PageTiming[],
): Map<string, DayActivity> {
  const daily = new Map<string, DayActivity>()
  addSeries(daily, medical, 'medicalNew', 'medicalEdit')
  addSeries(daily, reference, 'referenceNew', 'referenceEdit')
  return daily
}

// 'YYYY-MM-DD' の曜日を月曜=0..日曜=6 で返す（カレンダー日付として TZ 非依存に算出）。
export function jstWeekdayMon0(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=Sun..6=Sat
  return (dow + 6) % 7
}

// dateKey に days 日足した 'YYYY-MM-DD'（JST カレンダー加算）。
function shiftKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const base = Date.UTC(y, m - 1, d)
  const shifted = new Date(base + days * DAY_MS)
  const yy = shifted.getUTCFullYear()
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(shifted.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

export function computeSummary(
  daily: Map<string, DayActivity>,
  nowMs: number,
): ActivitySummary {
  const todayKey = jstDateKey(nowMs)
  const last7 = { medical: 0, reference: 0 }
  const last30 = { medical: 0, reference: 0 }
  // 今週の月曜キー
  const weekMonday = shiftKey(todayKey, -jstWeekdayMon0(todayKey))
  let thisWeekMedical = 0
  let lastMedicalNewKey: string | null = null

  for (const [key, d] of daily) {
    const medical = d.medicalNew + d.medicalEdit
    const reference = d.referenceNew + d.referenceEdit
    // 直近30/7日（今日含む）
    if (key <= todayKey && key > shiftKey(todayKey, -30)) {
      last30.medical += medical
      last30.reference += reference
    }
    if (key <= todayKey && key > shiftKey(todayKey, -7)) {
      last7.medical += medical
      last7.reference += reference
    }
    if (key >= weekMonday && key <= todayKey) thisWeekMedical += medical
    if (d.medicalNew > 0 && (!lastMedicalNewKey || key > lastMedicalNewKey)) {
      lastMedicalNewKey = key
    }
  }

  const daysSinceLastMedical =
    lastMedicalNewKey == null
      ? null
      : Math.round(
          (Date.UTC(...(todayKey.split('-').map(Number) as [number, number, number])) -
            Date.UTC(...(lastMedicalNewKey.split('-').map(Number) as [number, number, number]))) /
            DAY_MS,
        )

  return { last7, last30, daysSinceLastMedical, thisWeekMedical }
}

export function buildWeekGrid(
  daily: Map<string, DayActivity>,
  nowMs: number,
  weeks: number,
): { columns: DayActivity[][]; todayKey: string } {
  const todayKey = jstDateKey(nowMs)
  const weekMonday = shiftKey(todayKey, -jstWeekdayMon0(todayKey))
  // 最右列 = 今週。最左列の月曜 = 今週月曜 -(weeks-1)週。
  const firstMonday = shiftKey(weekMonday, -(weeks - 1) * 7)
  const columns: DayActivity[][] = []
  for (let w = 0; w < weeks; w++) {
    const colMonday = shiftKey(firstMonday, w * 7)
    const col: DayActivity[] = []
    for (let day = 0; day < 7; day++) {
      const key = shiftKey(colMonday, day)
      col.push(daily.get(key) ?? emptyDay(key))
    }
    columns.push(col)
  }
  return { columns, todayKey }
}
```

- [ ] **Step 4: テストを実行して通ることを確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/knowledge-activity.test.ts`
Expected: PASS（全ケース）

- [ ] **Step 5: コミット**

```bash
cd ~/medical-search-public && git add src/lib/knowledge-activity.ts src/lib/__tests__/knowledge-activity.test.ts && git commit -m "feat(admin): ナレッジ投稿ペースの日次集計ロジック"
```

---

### Task 2: 集計 API ルート（`GET /api/admin/knowledge-activity`）

Notion の Medical / Reference 2 DB を直クエリし、Task 1 のロジックで日次バケット・サマリー・週グリッドを返す。admin 限定・best-effort。

**Files:**
- Create: `src/app/api/admin/knowledge-activity/route.ts`

**Interfaces:**
- Consumes: `requireAdmin` from `@/lib/admin-guard`; `aggregateDaily`, `computeSummary`, `buildWeekGrid`, type `PageTiming` from `@/lib/knowledge-activity`; `Client` from `@notionhq/client`。
- Produces: HTTP JSON
  - 未設定/失敗時: `{ ready: false }`
  - 正常時: `{ ready: true, weeks: number, columns: DayActivity[][], todayKey: string, summary: ActivitySummary }`

- [ ] **Step 1: ルートを実装**

`src/app/api/admin/knowledge-activity/route.ts`:

```ts
// ナレッジ投稿ペース（/admin 今日の管理）。管理者専用・best-effort。
//
//   GET /api/admin/knowledge-activity?weeks=12
//     … サブスク公開の Medical / Reference 2 DB を Notion 直クエリし、
//       created_time / last_edited_time を JST 日次で集計して週グリッドとサマリーを返す。
//
// env 未設定なら { ready:false }（UIは静かな未設定表示）。

import { NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { requireAdmin } from '@/lib/admin-guard'
import {
  aggregateDaily,
  computeSummary,
  buildWeekGrid,
  type PageTiming,
} from '@/lib/knowledge-activity'

export const dynamic = 'force-dynamic'

const ALLOWED_WEEKS = new Set([12, 26, 52])

// 指定 DB を last_edited_time 降順でページングし、since より古くなったら打ち切って
// { createdAt, lastEdited } を集める。since は ISO 文字列（この時刻以降の更新だけ拾う）。
async function fetchTimings(notion: Client, dbId: string, sinceIso: string): Promise<PageTiming[]> {
  const out: PageTiming[] = []
  let cursor: string | undefined = undefined
  do {
    const res = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
      sorts: [{ timestamp: 'last_edited_time', direction: 'descending' }],
    })
    let reachedOld = false
    for (const page of res.results) {
      if (page.object !== 'page') continue
      const p = page as Record<string, unknown>
      const lastEdited = (p.last_edited_time as string) || ''
      const createdAt = (p.created_time as string) || ''
      if (lastEdited && lastEdited < sinceIso) {
        reachedOld = true
        break
      }
      out.push({ createdAt, lastEdited })
    }
    if (reachedOld) break
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)
  return out
}

export async function GET(req: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.response

  const weeksParam = Number(new URL(req.url).searchParams.get('weeks'))
  const weeks = ALLOWED_WEEKS.has(weeksParam) ? weeksParam : 12

  const token = process.env.SUBSCRIPTION_NOTION_TOKEN
  const medicalDbId = process.env.SUBSCRIPTION_MEDICAL_DB_ID
  const referenceDbId = process.env.SUBSCRIPTION_REFERENCE_DB_ID
  if (!token || !medicalDbId) {
    return NextResponse.json({ ready: false })
  }

  try {
    const notion = new Client({ auth: token })
    const nowMs = Date.now()
    // グリッド最左列の月曜より前は不要。安全側に weeks*7 + 7 日ぶん遡る。
    const sinceIso = new Date(nowMs - (weeks * 7 + 7) * 86_400_000).toISOString()

    const medical = await fetchTimings(notion, medicalDbId, sinceIso)
    const reference = referenceDbId ? await fetchTimings(notion, referenceDbId, sinceIso) : []

    const daily = aggregateDaily(medical, reference)
    const grid = buildWeekGrid(daily, nowMs, weeks)
    // サマリーは直近30日基準なので daily 全体（sinceは十分過去）で足りる。
    const summary = computeSummary(daily, nowMs)

    return NextResponse.json({
      ready: true,
      weeks,
      columns: grid.columns,
      todayKey: grid.todayKey,
      summary,
    })
  } catch {
    return NextResponse.json({ ready: false })
  }
}
```

- [ ] **Step 2: 型チェック（新規ファイルがビルドを壊さないこと）**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし（既存の型エラーが無い前提。もし本ファイル起因のエラーが出たら修正）

- [ ] **Step 3: コミット**

```bash
cd ~/medical-search-public && git add src/app/api/admin/knowledge-activity/route.ts && git commit -m "feat(admin): ナレッジ投稿ペース集計API /api/admin/knowledge-activity"
```

---

### Task 3: ヒートマップ描画部品（`HeatmapChart`）

依存追加なしのインライン SVG。曜日(縦7)×週(横)の 2 色グリッド。セルを左右分割し、左=medical(グリーン階調)・右=reference(アンバー階調)。ホバーで内訳ツールチップ。

**Files:**
- Modify: `src/app/admin/AdminCharts.tsx`（末尾に追加）

**Interfaces:**
- Consumes: type `DayActivity` from `@/lib/knowledge-activity`。
- Produces: `HeatmapChart({ columns, todayKey }: { columns: DayActivity[][]; todayKey: string }): JSX.Element`

- [ ] **Step 1: `HeatmapChart` を追加**

`src/app/admin/AdminCharts.tsx` の末尾に追記（先頭付近の import に型を足す）:

```tsx
// 先頭の import 群に追加：
import type { DayActivity } from '@/lib/knowledge-activity'
```

ファイル末尾に追加：

```tsx
// ---- 投稿ペース・ヒートマップ（2色・週グリッド） --------------------------
//
// セル左半分=🩺Medical(グリーン階調)、右半分=📚Reference(アンバー階調)。
// 階調は件数 0/1-2/3-4/5+ の4段。今日より後のセルは薄く（未来）。

const HEAT_CELL = 14
const HEAT_GAP = 3
const HEAT_PAD_TOP = 16 // 週ラベル用
const HEAT_PAD_LEFT = 22 // 曜日ラベル用
const WEEKDAY_LABELS = ['月', '火', '水', '木', '金', '土', '日']

function heatLevel(count: number): 0 | 1 | 2 | 3 {
  if (count <= 0) return 0
  if (count <= 2) return 1
  if (count <= 4) return 2
  return 3
}

// 系列ごとの階調 fill クラス（Tailwind。ライト/ダーク対応）。level0 はグレー。
const MEDICAL_FILL = [
  'fill-gray-100 dark:fill-gray-700/50',
  'fill-emerald-200 dark:fill-emerald-900/50',
  'fill-emerald-400 dark:fill-emerald-700',
  'fill-emerald-600 dark:fill-emerald-500',
]
const REFERENCE_FILL = [
  'fill-gray-100 dark:fill-gray-700/50',
  'fill-amber-200 dark:fill-amber-900/50',
  'fill-amber-400 dark:fill-amber-700',
  'fill-amber-600 dark:fill-amber-500',
]

export function HeatmapChart({
  columns,
  todayKey,
}: {
  columns: DayActivity[][]
  todayKey: string
}) {
  const [hover, setHover] = useState<{ x: number; y: number; day: DayActivity } | null>(null)
  const weeks = columns.length
  const width = HEAT_PAD_LEFT + weeks * (HEAT_CELL + HEAT_GAP)
  const height = HEAT_PAD_TOP + 7 * (HEAT_CELL + HEAT_GAP)

  return (
    <div className="relative overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="max-w-full"
        role="img"
        aria-label="ナレッジ投稿ペースのヒートマップ"
      >
        {/* 曜日ラベル（月・水・金・日だけ間引き表示） */}
        {WEEKDAY_LABELS.map((wd, i) =>
          i % 2 === 0 ? (
            <text
              key={wd}
              x={0}
              y={HEAT_PAD_TOP + i * (HEAT_CELL + HEAT_GAP) + HEAT_CELL - 2}
              className="fill-gray-400 dark:fill-gray-500"
              fontSize={9}
            >
              {wd}
            </text>
          ) : null,
        )}
        {columns.map((col, ci) =>
          col.map((day, ri) => {
            const x = HEAT_PAD_LEFT + ci * (HEAT_CELL + HEAT_GAP)
            const y = HEAT_PAD_TOP + ri * (HEAT_CELL + HEAT_GAP)
            const future = day.date > todayKey
            const medical = day.medicalNew + day.medicalEdit
            const reference = day.referenceNew + day.referenceEdit
            const opacity = future ? 0.25 : 1
            return (
              <g
                key={day.date}
                opacity={opacity}
                onMouseEnter={() => !future && setHover({ x: x + HEAT_CELL, y, day })}
                onMouseLeave={() => setHover(null)}
              >
                {/* 左=medical */}
                <rect
                  x={x}
                  y={y}
                  width={HEAT_CELL / 2}
                  height={HEAT_CELL}
                  rx={1}
                  className={MEDICAL_FILL[heatLevel(medical)]}
                />
                {/* 右=reference */}
                <rect
                  x={x + HEAT_CELL / 2}
                  y={y}
                  width={HEAT_CELL / 2}
                  height={HEAT_CELL}
                  rx={1}
                  className={REFERENCE_FILL[heatLevel(reference)]}
                />
              </g>
            )
          }),
        )}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-md bg-gray-900 px-2 py-1 text-xs text-white shadow-lg dark:bg-gray-700"
          style={{ left: hover.x + 4, top: hover.y }}
        >
          <div className="font-semibold">{fmtShort(hover.day.date)}</div>
          <div>
            🩺 新規{hover.day.medicalNew}・更新{hover.day.medicalEdit}
          </div>
          <div>
            📚 新規{hover.day.referenceNew}・更新{hover.day.referenceEdit}
          </div>
        </div>
      )}
      {/* 凡例 */}
      <div className="mt-2 flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm bg-emerald-500" /> ナレッジ
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm bg-amber-500" /> 参考文献
        </span>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 型チェック**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし（`fmtShort` は同ファイル上部で定義済み・`useState` は import 済み）

- [ ] **Step 3: コミット**

```bash
cd ~/medical-search-public && git add src/app/admin/AdminCharts.tsx && git commit -m "feat(admin): 2色ヒートマップ部品 HeatmapChart"
```

---

### Task 4: 今日の管理への組み込み（fetch・サマリー・週目標バー・週切替）

`DailyCommandCenter` に「📈 ナレッジ投稿ペース」セクションを追加。ステータス帯と「今日やること」の間に置く。

**Files:**
- Modify: `src/app/admin/DailyCommandCenter.tsx`

**Interfaces:**
- Consumes: `HeatmapChart` from `./AdminCharts`; types `DayActivity`, `ActivitySummary` from `@/lib/knowledge-activity`。
- Produces: UI のみ（外部 IF なし）。localStorage キー `medinode.admin.pace.weeklyGoal`（整数・既定 3）。

- [ ] **Step 1: import と型・定数を追加**

`src/app/admin/DailyCommandCenter.tsx` の import 群に追加：

```tsx
import { HeatmapChart } from './AdminCharts'
import type { DayActivity, ActivitySummary } from '@/lib/knowledge-activity'
```

`checksKey` 定義の近く（L84 付近）に追加：

```tsx
type PaceData = {
  ready: boolean
  weeks?: number
  columns?: DayActivity[][]
  todayKey?: string
  summary?: ActivitySummary
}
const PACE_GOAL_KEY = 'medinode.admin.pace.weeklyGoal'
const DEFAULT_WEEKLY_GOAL = 3
const PACE_WEEK_OPTIONS = [12, 26, 52] as const
```

- [ ] **Step 2: state と fetch を `DailyCommandCenter` 内に追加**

L383（`const [copied, ...]` の直後）に追加：

```tsx
  const [pace, setPace] = useState<PaceData | null>(null)
  const [paceWeeks, setPaceWeeks] = useState<number>(12)
  const [weeklyGoal, setWeeklyGoal] = useState<number>(DEFAULT_WEEKLY_GOAL)
```

`load` の `useEffect`（L399）の後に追加：

```tsx
  // 投稿ペース（台帳・daily とは独立の best-effort fetch）。週切替で再取得。
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/admin/knowledge-activity?weeks=${paceWeeks}`, { cache: 'no-store' })
        if (alive && res.ok) setPace((await res.json()) as PaceData)
      } catch {
        // best-effort。
      }
    })()
    return () => {
      alive = false
    }
  }, [paceWeeks])

  // 週目標（localStorage）。
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PACE_GOAL_KEY)
      const n = raw ? Number(raw) : NaN
      if (Number.isFinite(n) && n > 0) setWeeklyGoal(n)
    } catch {
      // 既定値のまま。
    }
  }, [])

  const updateGoal = useCallback((n: number) => {
    const v = Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 99) : DEFAULT_WEEKLY_GOAL
    setWeeklyGoal(v)
    try {
      localStorage.setItem(PACE_GOAL_KEY, String(v))
    } catch {
      // 保存不可でも UI は効く。
    }
  }, [])
```

- [ ] **Step 3: セクション JSX をステータス帯と「今日やること」の間に挿入**

L596（ステータス帯 `)}` の閉じ）と L598（`{/* B. 今日やること */}`）の間に挿入：

```tsx
        {/* 投稿ペース（ナレッジ＋参考文献） */}
        {pace?.ready && pace.columns && pace.summary && pace.todayKey && (
          <div className="mb-5">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                📈 ナレッジ投稿ペース
              </h3>
              <div className="flex items-center gap-1">
                {PACE_WEEK_OPTIONS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setPaceWeeks(w)}
                    className={`px-2 py-0.5 text-xs rounded-md border ${
                      paceWeeks === w
                        ? 'border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-900/30 dark:text-brand-300'
                        : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {w}週
                  </button>
                ))}
              </div>
            </div>

            {/* サマリー行 */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300 mb-2">
              <span>
                直近7日 <b className="text-gray-900 dark:text-gray-100">ナレッジ{pace.summary.last7.medical}・文献{pace.summary.last7.reference}</b>
              </span>
              <span>
                30日 <b className="text-gray-900 dark:text-gray-100">ナレッジ{pace.summary.last30.medical}・文献{pace.summary.last30.reference}</b>
              </span>
              <span>
                最終投稿から{' '}
                <b className="text-gray-900 dark:text-gray-100">
                  {pace.summary.daysSinceLastMedical == null ? '—' : `${pace.summary.daysSinceLastMedical}日`}
                </b>
              </span>
            </div>

            {/* 週目標バー */}
            <div className="flex items-center gap-2 mb-3 text-xs">
              <span className="text-gray-500 dark:text-gray-400">今週のナレッジ</span>
              <div className="relative h-2 w-32 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    pace.summary.thisWeekMedical >= weeklyGoal ? 'bg-brand-500' : 'bg-brand-300 dark:bg-brand-700'
                  }`}
                  style={{ width: `${Math.min(100, Math.round((pace.summary.thisWeekMedical / Math.max(1, weeklyGoal)) * 100))}%` }}
                />
              </div>
              <span className="text-gray-700 dark:text-gray-200">
                {pace.summary.thisWeekMedical}/
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={weeklyGoal}
                  onChange={(e) => updateGoal(Number(e.target.value))}
                  className="w-10 mx-0.5 px-1 py-0 text-xs text-center rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800"
                  aria-label="週目標件数"
                />
                件
              </span>
              {pace.summary.thisWeekMedical < weeklyGoal && (
                <span className="text-amber-600 dark:text-amber-400">
                  あと{weeklyGoal - pace.summary.thisWeekMedical}件
                </span>
              )}
            </div>

            <HeatmapChart columns={pace.columns} todayKey={pace.todayKey} />
          </div>
        )}
```

- [ ] **Step 4: 型チェック**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 5: 全テスト実行**

Run: `cd ~/medical-search-public && npm test`
Expected: PASS（既存＋新規 knowledge-activity）

- [ ] **Step 6: preview で目視確認**

`.claude/launch.json` の dev サーバを起動 → `/admin` → 「今日の管理」タブ。ステータス帯の下に「📈 ナレッジ投稿ペース」が出て、週切替（12/26/52）・サマリー・週目標編集（値が localStorage に残る）・ヒートマップのホバー内訳・ライト/ダーク表示を確認。env 未設定のローカルなら pace.ready=false でセクション非表示（＝正常）を確認。

- [ ] **Step 7: コミット**

```bash
cd ~/medical-search-public && git add src/app/admin/DailyCommandCenter.tsx && git commit -m "feat(admin): 今日の管理にナレッジ投稿ペースを表示"
```

---

## Self-Review

- **Spec coverage:** 対象2DB（Task2 env）／new+edit数え方（Task1 aggregateDaily）／JST（jstDateKey・jstWeekdayMon0）／配置＝ステータス帯と今日やることの間（Task4 Step3）／サマリー行・週目標バー・2色12週グリッド＋26/52切替（Task3・Task4）／Notion直クエリ（Task2 fetchTimings）／Algolia不採用（未実装＝OK）／localStorage週目標（Task4）／requireAdmin（Task2）／追加依存なし（インラインSVG）— すべてタスクに対応済み。
- **Placeholder scan:** TBD/TODO なし。全コードブロックに実体あり。
- **Type consistency:** `PageTiming`/`DayActivity`/`ActivitySummary` は Task1 で定義し Task2/3/4 で同名利用。API レスポンス `{ ready, weeks, columns, todayKey, summary }`（Task2）を Task4 の `PaceData` が同キーで受ける。`HeatmapChart({ columns, todayKey })` は Task3 定義＝Task4 呼び出し一致。
- **既知の制約明記:** Task1 冒頭コメントと spec に「多重更新は最終更新日に畳まれる」を記載済み。
