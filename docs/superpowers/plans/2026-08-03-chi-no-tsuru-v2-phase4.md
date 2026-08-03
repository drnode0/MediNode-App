# 知の蔓 v2 フェーズ4（葉の生え方）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 正典§9の3つを実装する——`resolved`（CQ→ナレッジ解決＝+2mm）、`attempt`（クイズで「まだ」＝穂先の芽・高さなし）、読み返しの濃度（輪郭3段階・褪せた青葉の半戻り）。

**Architecture:** `StepKind` に `resolved`/`attempt` を追加し、**葉（高さ・リプレイ・目次・枚数）はすべて「attemptを除いた地上の歩」で数える**（ヘルパー `leafSteps`）。attempt は台帳に積むが葉のスロットを持たず、**穂先の未展開葉（巻き葉）として描く**——正典§9のアセット注記「穂先の未展開葉が、そのまま『まだの芽』になる」に従う。resolved は `ingestRecords` が `knowledgeLevel` の ❓CQ→💡ナレッジ遷移を検出して積む（前回見たレベルを `TowerState.levels` に記憶）。読み返しは歩を積まず、`reader-marks` に別キーで日付と回数だけ持つ。

**Tech Stack:** Next.js / TypeScript / vitest。作業ディレクトリは `~/medical-search-public`。

## Global Constraints（正典§9・§14、引き継ぎ書の不変条件）

- 「まだ」の連打で増えない（`(id,'attempt')` は一生に1回＝既存の重複規則がそのまま守る）
- **attempt は高さ計算に入れない**——`heightMmFromLeaves` に渡す葉数は attempt を含まない
- 読み返しは**歩を積まない**（日付だけ更新）。読み返しは思い出すことより弱い——褪せた青葉は**色が半分**戻るだけで**照りは出ない**
- 知識レベルを使わない人に何も要求しない（`knowledgeLevel` 未設定＝resolvedが無いだけ。他は全員同じ）
- 芽・地下の**件数を数字でUIに出さない**。色褪せ・未読・連続日数も数えない
- 画面文言は常体・六つの禁。新しい文言は `vine-copy.ts` 経由（今回は葉シートの行為ラベル「解決した」と凡例の追記のみ＝既存パターンの直書き箇所への追記）
- 新規の個人用localStorageキーは必ず `PERSONAL_DEVICE_KEYS` へ登録する
- `VineScene` の `<svg>` viewBox=width/height 同値、`COMPOUND_START_LEAVES × COMPOUND_RATE === 1`、葉は間引かない
- ブランチ: `feat/chi-no-tsuru-v2-leaves` で作業し、完了後 main へマージ

**設計判断（蒸し返さない用）:**
- **attempt はスロット（14px）を持たない。** スロット＝高さを持つ葉、の不変条件を守る（目次 `markPositions` が「葉数＝位置」を前提にしているため、混ぜると印の位置が全部ズレる）。芽は穂先の脇に最大7個まで描く（8個目からは古い順に描画だけ省略・台帳は全部残る・数字は出さない）
- **attempt も dormant 解除に数える。** 芽は地上に「現れた」もの（正典§9「解いた事実が蔓に現れる」）。dormantIds は変更しない
- **resolved の日付は「検出した今」**（遷移した瞬間は観測できない。アプリで再会した時が地上に出る時＝正典§7と整合）
- **resolved の葉は緑・褪せない・照りなし**（生成行為の完成形。色褪せは想起系だけの性質）
- **lastReadAt は毎回更新**（recallKind の repolish 判定と同じ流儀）。90日以上あいた再読だけが濃度を+1する（上限3）

---

### Task 0: ブランチを切る

- [ ] **Step 1:**

```bash
cd ~/medical-search-public && git checkout main && git pull --ff-only && git checkout -b feat/chi-no-tsuru-v2-leaves
```

---

### Task 1: tower-steps — 新kind・leafSteps・levels・水位の葉基準化

**Files:**
- Modify: `src/lib/tower-steps.ts`
- Modify: `src/lib/__tests__/tower-steps.test.ts` / `src/lib/__tests__/tower-backfill.test.ts`（fixture に `levels: {}`）
- Modify: `src/app/dev/vine/page.tsx`（`mk` と地下3シナリオのリテラルに `levels: {}`）

**Interfaces:**
- Produces: `StepKind = 'read'|'wrote'|'recall'|'repolish'|'resolved'|'attempt'`、`leafSteps(steps: Step[]): Step[]`（attemptを除く）、`TowerState.levels: Record<string,string>`（id→最後に見たknowledgeLevel）。`planReplay`/`markSeen` は **leafSteps(above).length** 基準。

- [ ] **Step 1: 失敗するテストを書く**（tower-steps.test.ts）

```ts
describe('attempt と葉の数（§9）', () => {
  it('leafSteps は attempt を除く', () => {
    const steps: Step[] = [step({ kind: 'wrote' }), step({ id: 'k2', kind: 'attempt' })]
    expect(leafSteps(steps).map((s) => s.kind)).toEqual(['wrote'])
  })
  it('attempt は一生に1回（連打で増えない）', () => {
    const s1 = addStep(empty, step({ kind: 'attempt' }))
    const s2 = addStep(s1, step({ kind: 'attempt', at: '2026-08-02T10:00:00.000Z' }))
    expect(s2).toBe(s1)
  })
  it('attempt はリプレイの葉数に入らない', () => {
    const s: TowerState = { ...empty, steps: [step({ kind: 'attempt' })] }
    expect(planReplay(s)).toEqual({ from: 0, to: 0, play: false })
  })
  it('markSeen は attempt を除いた葉数で丸める', () => {
    const s: TowerState = { ...empty, steps: [step({ kind: 'wrote' }), step({ id: 'k2', kind: 'attempt' })] }
    expect(markSeen(s, 5).lastSeenSteps).toBe(1)
  })
  it('sanitize: levels は既定で空オブジェクト・文字列以外の値は落とす', () => {
    localStorage.setItem(TOWER_KEY, JSON.stringify({ steps: [], joinedAt: 'x', levels: { a: '💡ナレッジ', b: 7 } }))
    expect(loadTowerState().levels).toEqual({ a: '💡ナレッジ' })
  })
})
```

import 行に `leafSteps` を追加。`empty` fixture と `mkState` に `levels: {}` を足す（コンパイルを通すため）。

- [ ] **Step 2: RED確認** `npx vitest run src/lib/__tests__/tower-steps.test.ts` → FAIL

- [ ] **Step 3: 実装**（tower-steps.ts）

```ts
export type StepKind = 'read' | 'wrote' | 'recall' | 'repolish' | 'resolved' | 'attempt'
```

`KINDS` 配列にも追加:

```ts
const KINDS: readonly StepKind[] = ['read', 'wrote', 'recall', 'repolish', 'resolved', 'attempt']
```

`TowerState` に追加（joinedAt の下）:

```ts
  // id→最後に見た知識レベル。❓CQ→💡ナレッジの遷移検出（resolved）に使う。レベル未設定の人には何も溜まらない。
  levels: Record<string, string>
```

ヘルパー（`addStep` の上あたり）:

```ts
// 葉＝高さを持つ歩。attempt（まだの芽）は台帳には居るが、葉ではない——
// 高さ・リプレイ・目次・枚数はすべてこの結果で数える（正典§9）。
export function leafSteps(steps: Step[]): Step[] {
  return steps.filter((s) => s.kind !== 'attempt')
}
```

`sanitize`: `emptyState` に `levels: {}` を足し、戻り値に:

```ts
    levels: sanitizeLevels(o.levels),
```

とヘルパー:

```ts
function sanitizeLevels(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === 'string') out[k] = v
  }
  return out
}
```

`loadTowerState` の catch 節のリテラルにも `levels: {}` を追加。

`markSeen` / `planReplay` の above 計算を葉基準に:

```ts
  const aboveCount = leafSteps(splitByJoin(state.steps, state.joinedAt).above).length
```

```ts
  const to = leafSteps(splitByJoin(state.steps, state.joinedAt).above).length
```

- [ ] **Step 4: fixture更新** — tower-backfill.test.ts の `empty` と dev/vine/page.tsx の `mk`＋地下3シナリオのリテラルに `levels: {}` を追加。

- [ ] **Step 5: GREEN確認** `npx vitest run src/lib/__tests__/ && npx tsc --noEmit` → PASS

- [ ] **Step 6: コミット** `git add -A && git commit -m "知の蔓: attemptとresolvedのkindを足し、葉の数をattempt抜きで数える"`

---

### Task 2: resolved の検出（ingestRecords のレベル追跡）

**Files:**
- Modify: `src/lib/tower-steps.ts`（`ingestRecords`）
- Modify: `src/lib/tower-backfill.ts`（nowIsoを渡す）
- Modify: `src/app/page.tsx:1430-1436`（ingestHits に knowledgeLevel を足す）
- Test: `src/lib/__tests__/tower-steps.test.ts`

**Interfaces:**
- Produces: `ingestRecords(state, hits, nowIso?)`。hits の型に `knowledgeLevel?: string` が増える。前回 `levels[id]` が `CQ` を含み、今回 `ナレッジ` を含むとき `resolved` の歩（at=nowIso）を積む。

- [ ] **Step 1: 失敗するテストを書く**

```ts
describe('resolved の検出（§9: ❓CQ→💡ナレッジ）', () => {
  const hit = (level: string) => [{
    objectID: 'cq1', title: '昇圧薬の選択', genre: '循環器',
    createdAt: '2026-07-01T00:00:00.000Z', owner: 'personal', knowledgeLevel: level,
  }]
  const now = '2026-08-02T09:00:00.000Z'

  it('初見が❓CQ→次に💡ナレッジで resolved を1歩積む（atは検出時刻）', () => {
    const s1 = ingestRecords(empty, hit('❓CQ'), now)
    expect(s1.steps.filter((s) => s.kind === 'resolved')).toHaveLength(0)
    expect(s1.levels['cq1']).toBe('❓CQ')
    const s2 = ingestRecords(s1, hit('💡ナレッジ'), '2026-08-03T09:00:00.000Z')
    const resolved = s2.steps.filter((s) => s.kind === 'resolved')
    expect(resolved).toHaveLength(1)
    expect(resolved[0].at).toBe('2026-08-03T09:00:00.000Z')
    expect(s2.levels['cq1']).toBe('💡ナレッジ')
  })
  it('初見からナレッジなら積まない（遷移を観測していない）', () => {
    const s1 = ingestRecords(empty, hit('💡ナレッジ'), now)
    expect(s1.steps.filter((s) => s.kind === 'resolved')).toHaveLength(0)
  })
  it('二度目のナレッジ観測では積み直さない（(id,resolved)は一生に1回）', () => {
    let s = ingestRecords(empty, hit('❓CQ'), now)
    s = ingestRecords(s, hit('💡ナレッジ'), now)
    s = ingestRecords(s, hit('💡ナレッジ'), now)
    expect(s.steps.filter((k) => k.kind === 'resolved')).toHaveLength(1)
  })
  it('レベル未設定の人には何も起きない・何も溜まらない', () => {
    const s = ingestRecords(empty, [{ objectID: 'x', owner: 'personal', createdAt: '2026-07-01T00:00:00.000Z' }], now)
    expect(s.levels).toEqual({})
    expect(s.steps.every((k) => k.kind === 'wrote')).toBe(true)
  })
})
```

- [ ] **Step 2: RED確認** → FAIL

- [ ] **Step 3: 実装**（`ingestRecords` を差し替え）

```ts
// 検索やタブに流れてきた自分のレコードを「書いた」として取り込む（作成日で遡って積める）。
// 併せて knowledgeLevel を levels に記憶し、前回❓CQ→今回💡ナレッジの遷移を見つけたら
// resolved（CQを育てて解決した＝+2mm）を積む（正典§9）。遷移の瞬間は観測できないので
// at は検出した今——アプリで再会した時が地上に出る時（正典§7と同じ思想）。
type IngestHit = {
  objectID: string; title?: string; genre?: string; createdAt?: string
  owner?: string; knowledgeLevel?: string
}
export function ingestRecords(
  state: TowerState, hits: IngestHit[], nowIso: string = new Date().toISOString(),
): TowerState {
  let next = state
  for (const h of hits) {
    if (!h.objectID || h.owner !== 'personal') continue
    const prevLevel = next.levels[h.objectID]
    const curLevel = h.knowledgeLevel || ''
    if (prevLevel && prevLevel.includes('CQ') && curLevel.includes('ナレッジ')) {
      next = addStep(next, {
        id: h.objectID, kind: 'resolved', at: nowIso,
        genre: h.genre || '', title: h.title || '',
      })
    }
    if (curLevel && curLevel !== prevLevel) {
      next = { ...next, levels: { ...next.levels, [h.objectID]: curLevel } }
    }
    if (!h.createdAt) continue
    next = addStep(next, {
      id: h.objectID, kind: 'wrote', at: h.createdAt,
      genre: h.genre || '', title: h.title || '',
    })
  }
  return next
}
```

`tower-backfill.ts` の `applyBackfill`:

```ts
  const ingested = ingestRecords(state, records as Parameters<typeof ingestRecords>[1], nowIso)
```

`page.tsx` の ingestHits（1430行付近）に1行追加:

```ts
            knowledgeLevel: h.knowledgeLevel,
```

- [ ] **Step 4: GREEN確認** `npx vitest run src/lib/__tests__/ && npx tsc --noEmit` → PASS

- [ ] **Step 5: コミット** `git add -A && git commit -m "知の蔓: CQ→ナレッジの解決を検出してresolvedの歩を積む"`

---

### Task 3: 読み返しの記録（reader-marks）

**Files:**
- Modify: `src/lib/reader-marks.ts`
- Modify: `src/lib/personal-data.ts`（キー登録）
- Modify: `src/components/reader/ReaderMarksProvider.tsx`（markReadで touchReread）
- Test: `src/lib/__tests__/reader-marks.test.ts`（既存が無ければ新規。既存があれば追記）

**Interfaces:**
- Produces: `REREADS_KEY = 'medinode_reader_rereads_v1'`、`type Reread = { count: number; lastAt: string }`、`loadRereads(): Record<string, Reread>`、`touchReread(id: string, nowIso: string): void`、純関数 `nextReread(cur: Reread | undefined, nowIso: string): Reread`。

- [ ] **Step 1: 失敗するテストを書く**（純関数 `nextReread` を軸に）

```ts
import { nextReread, REREAD_GAP_DAYS } from '../reader-marks'

describe('読み返しの濃度（§9: 90日以上あけた再読だけ数える・歩は積まない）', () => {
  it('初読は count 0 で日付だけ持つ', () => {
    expect(nextReread(undefined, '2026-08-01T00:00:00.000Z')).toEqual({ count: 0, lastAt: '2026-08-01T00:00:00.000Z' })
  })
  it('90日未満の再読は日付だけ更新（濃くならない）', () => {
    const r = nextReread({ count: 0, lastAt: '2026-08-01T00:00:00.000Z' }, '2026-09-01T00:00:00.000Z')
    expect(r).toEqual({ count: 0, lastAt: '2026-09-01T00:00:00.000Z' })
  })
  it('90日以上あけた再読で1段濃くなる', () => {
    const r = nextReread({ count: 0, lastAt: '2026-01-01T00:00:00.000Z' }, '2026-08-01T00:00:00.000Z')
    expect(r.count).toBe(1)
  })
  it('3で頭打ち（3段階=1・2・3以上）', () => {
    const r = nextReread({ count: 3, lastAt: '2025-01-01T00:00:00.000Z' }, '2026-08-01T00:00:00.000Z')
    expect(r.count).toBe(3)
  })
})
```

- [ ] **Step 2: RED確認** `npx vitest run src/lib/__tests__/reader-marks.test.ts` → FAIL

- [ ] **Step 3: 実装**（reader-marks.ts 末尾に追加）

```ts
// 読み返しの記録（正典§9）。歩は積まない——日付と「90日以上あけた再読の回数」だけを持つ。
// 蔓側で輪郭の線の濃さ（3段階）と、褪せた青葉の半戻りに使う。
// lastAt は毎回更新する（recallKind の repolish 判定と同じ流儀＝間隔をあけない読み返しは弱い）。
export const REREADS_KEY = 'medinode_reader_rereads_v1'
export const REREAD_GAP_DAYS = 90
export const MAX_REREADS = 500
export type Reread = { count: number; lastAt: string }

export function nextReread(cur: Reread | undefined, nowIso: string): Reread {
  if (!cur) return { count: 0, lastAt: nowIso }
  const gapMs = Date.parse(nowIso) - Date.parse(cur.lastAt)
  const qualifies = Number.isFinite(gapMs) && gapMs >= REREAD_GAP_DAYS * 86_400_000
  return { count: qualifies ? Math.min(3, cur.count + 1) : cur.count, lastAt: nowIso }
}

export function loadRereads(): Record<string, Reread> {
  try {
    const raw = JSON.parse(localStorage.getItem(REREADS_KEY) || '{}')
    if (!raw || typeof raw !== 'object') return {}
    const out: Record<string, Reread> = {}
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const r = v as Reread
      if (r && typeof r === 'object' && typeof r.count === 'number' && typeof r.lastAt === 'string') out[k] = r
    }
    return out
  } catch { return {} }
}

export function touchReread(id: string, nowIso: string): void {
  try {
    const m = loadRereads()
    m[id] = nextReread(m[id], nowIso)
    // 暴走ガード: 古い順に間引く（通常運用では届かない）
    const keys = Object.keys(m)
    if (keys.length > MAX_REREADS) {
      keys.sort((a, b) => m[a].lastAt.localeCompare(m[b].lastAt))
      for (const k of keys.slice(0, keys.length - MAX_REREADS)) delete m[k]
    }
    localStorage.setItem(REREADS_KEY, JSON.stringify(m))
  } catch {}
}
```

`personal-data.ts` の `PERSONAL_DEVICE_KEYS` に追加:

```ts
  'medinode_reader_rereads_v1', // リーダーの読み返し（蔓の輪郭の濃度）
```

`ReaderMarksProvider.tsx` の `markRead`（import に `touchReread` を追加）:

```ts
  const markRead = useCallback((id: string) => {
    recordRead(id)
    touchReread(id, new Date().toISOString()) // 読み返しの濃度（歩は積まない・正典§9）
    if (isTowerEnabled()) recordTowerEvent({ id, kind: 'read' }) // 知の塔: 初めて読んだ知識は1歩（重複は台帳側で弾く）
    setReads((prev) => {
      if (prev[0] === id) return prev
      return pushRead(prev, id)
    })
  }, [])
```

- [ ] **Step 4: GREEN確認** `npx vitest run src/lib/__tests__/reader-marks.test.ts && npx tsc --noEmit` → PASS

- [ ] **Step 5: コミット** `git add -A && git commit -m "知の蔓: 読み返しを日付と回数だけで記録する（歩は積まない）"`

---

### Task 4: vine-leaves — resolved・輪郭の濃度・半戻り・まだの芽

**Files:**
- Modify: `src/lib/vine-leaves.ts`
- Test: `src/lib/__tests__/vine-leaves.test.ts`

**Interfaces:**
- Consumes: `Reread`（Task 3）
- Produces: `LeafVisual = { form: 'outline'|'futaba'|'green'; fade: number; teri: boolean; line: 0|1|2|3 }`、`buildLeafVisuals(steps, stats, nowIso, rereads?: Record<string, Reread>)`、`pendingBudIds(steps: Step[]): string[]`。
- ⚠️ `buildLeafVisuals` に渡す steps は **leafSteps 済み（attemptなし）** が契約。

- [ ] **Step 1: 失敗するテストを書く**

```ts
// 既存importに Reread / pendingBudIds を追加
it('resolved は緑・褪せない・照りなし（生成行為の完成形）', () => {
  const v = buildLeafVisuals([st('a', 'resolved')], {}, NOW)
  expect(v[0]).toMatchObject({ form: 'green', fade: 0, teri: false })
})

describe('読み返しの濃度と半戻り（§9）', () => {
  it('輪郭の線は再読回数で濃くなる（0〜3）', () => {
    const rereads = { a: { count: 2, lastAt: NOW } }
    const v = buildLeafVisuals([st('a', 'read')], {}, NOW, rereads)
    expect(v[0].line).toBe(2)
    expect(buildLeafVisuals([st('a', 'read')], {}, NOW)[0].line).toBe(0)
  })
  it('褪せた青葉は最後のクイズより新しい再読で色が半分戻る・照りは出ない', () => {
    const stats = { a: { ok: 1, ng: 0, last: '2026-01-01T00:00:00.000Z', lastResult: 'ok' as const } }
    const faded = buildLeafVisuals([st('a', 'recall')], stats, NOW)[0]
    expect(faded.fade).toBe(1)
    const rereads = { a: { count: 1, lastAt: '2026-07-01T00:00:00.000Z' } }
    const half = buildLeafVisuals([st('a', 'recall')], stats, NOW, rereads)[0]
    expect(half.fade).toBe(0.5)
    expect(half.teri).toBe(false)
  })
  it('最後のクイズより古い再読では戻らない', () => {
    const stats = { a: { ok: 1, ng: 0, last: '2026-01-01T00:00:00.000Z', lastResult: 'ok' as const } }
    const rereads = { a: { count: 1, lastAt: '2025-12-01T00:00:00.000Z' } }
    expect(buildLeafVisuals([st('a', 'recall')], stats, NOW, rereads)[0].fade).toBe(1)
  })
})

describe('まだの芽（§9: attemptは穂先の未展開葉）', () => {
  it('attemptだけのidが芽。recall/repolishが来たら開いた（=芽から消える）', () => {
    const steps = [st('a', 'attempt'), st('b', 'attempt'), st('b', 'recall'), st('c', 'read')]
    expect(pendingBudIds(steps)).toEqual(['a'])
  })
  it('同じidの芽は1つ', () => {
    expect(pendingBudIds([st('a', 'attempt'), st('a', 'attempt')])).toEqual(['a'])
  })
})
```

（`st(id, kind)`・`NOW` は既存テストのヘルパー流儀に合わせる。無ければ `const NOW = '2026-08-01T00:00:00.000Z'`、`const st = (id: string, kind: Step['kind']): Step => ({ id, kind, at: '2026-06-01T00:00:00.000Z', genre: '', title: '' })` をファイル内に足す）

- [ ] **Step 2: RED確認** → FAIL

- [ ] **Step 3: 実装**

```ts
import type { Reread } from './reader-marks'

export type LeafForm = 'outline' | 'futaba' | 'green'
// line=読み返しの濃度（輪郭の葉のみ意味を持つ・0〜3）
export type LeafVisual = { form: LeafForm; fade: number; teri: boolean; line: 0 | 1 | 2 | 3 }

export function buildLeafVisuals(
  steps: Step[], stats: Record<string, QuizStat>, nowIso: string,
  rereads?: Record<string, Reread>,
): LeafVisual[] {
  const repolished = new Set(steps.filter((s) => s.kind === 'repolish').map((s) => s.id))
  return steps.map((s) => {
    if (s.kind === 'read') {
      const line = Math.max(0, Math.min(3, rereads?.[s.id]?.count ?? 0)) as 0 | 1 | 2 | 3
      return { form: 'outline' as const, fade: 0, teri: false, line }
    }
    // wrote=双葉、resolved=本葉（緑）。どちらも生成行為なので褪せない・照りは想起系だけの性質
    if (s.kind === 'wrote') return { form: 'futaba' as const, fade: 0, teri: false, line: 0 as const }
    if (s.kind === 'resolved') return { form: 'green' as const, fade: 0, teri: false, line: 0 as const }
    let fade = fadeLevel(stats[s.id], nowIso)
    // 褪せた青葉は、最後のクイズより新しい読み返しで色が半分戻る（照りは出ない＝正典§9）。
    // 読み返しは思い出すことより弱い——全快はさせない。
    const rr = rereads?.[s.id]
    if (fade > 0 && rr && stats[s.id]?.last && Date.parse(rr.lastAt) > Date.parse(stats[s.id].last)) {
      fade = fade / 2
    }
    return { form: 'green' as const, fade, teri: fade === 0 && repolished.has(s.id), line: 0 as const }
  })
}

// まだの芽（正典§9）。クイズに挑んで「まだ」だったが、まだ思い出せていない知識。
// 穂先の未展開葉として描く（スロット＝高さを持つ葉、の不変条件を守るため葉の列には入れない）。
// 思い出せたら（recall/repolish）芽はひらいて葉になる＝ここからは消える。
export function pendingBudIds(steps: Step[]): string[] {
  const opened = new Set(steps.filter((s) => s.kind === 'recall' || s.kind === 'repolish').map((s) => s.id))
  return [...new Set(steps.filter((s) => s.kind === 'attempt').map((s) => s.id))].filter((id) => !opened.has(id))
}
```

⚠️ `buildLeafVisuals` の既存呼び出しは第4引数省略で挙動不変（`line: 0`）。

- [ ] **Step 4: GREEN確認** `npx vitest run src/lib/__tests__/vine-leaves.test.ts && npx tsc --noEmit` → PASS

- [ ] **Step 5: コミット** `git add -A && git commit -m "知の蔓: 葉の状態機械にresolved・読み返しの濃度・まだの芽を足す"`

---

### Task 5: クイズの「まだ」で attempt を積む

**Files:**
- Modify: `src/components/QuizCard.tsx:21-29`
- Modify: `src/components/DailyQuestionCard.tsx:106-112`

- [ ] **Step 1: QuizCard の `answer` を差し替え**

```ts
  const answer = (ok: boolean) => {
    if (isTowerEnabled()) {
      if (ok) {
        // 知の塔: recordQuizResultより先に判定する（記録後だと「いま初めてok」が読めない）
        const kind = recallKind(getQuizStat(hit.objectID), new Date().toISOString())
        if (kind) recordTowerEvent({ id: hit.objectID, kind, genre: Array.isArray(hit.genre) ? hit.genre[0] : hit.genre || '', title: hit.title })
      } else {
        // 知の蔓: 「まだ」は芽（高さなし・正典§9）。(id,'attempt')は一生に1回＝連打で増えない
        recordTowerEvent({ id: hit.objectID, kind: 'attempt', genre: Array.isArray(hit.genre) ? hit.genre[0] : hit.genre || '', title: hit.title })
      }
    }
    recordQuizResult(hit.objectID, ok)
    setAnswered(ok ? 'ok' : 'ng')
  }
```

- [ ] **Step 2: DailyQuestionCard の `answer` の同じ箇所を同じ形に差し替え**（`hit`→`q`。`recordQuizResult` 以降の既存処理は触らない）

```ts
    if (isTowerEnabled()) {
      if (ok) {
        const kind = recallKind(getQuizStat(q.objectID), new Date().toISOString())
        if (kind) recordTowerEvent({ id: q.objectID, kind, genre: Array.isArray(q.genre) ? q.genre[0] : q.genre || '', title: q.title })
      } else {
        // 知の蔓: 「まだ」は芽（高さなし・正典§9）。(id,'attempt')は一生に1回＝連打で増えない
        recordTowerEvent({ id: q.objectID, kind: 'attempt', genre: Array.isArray(q.genre) ? q.genre[0] : q.genre || '', title: q.title })
      }
    }
```

- [ ] **Step 3: 型検査** `npx tsc --noEmit` → PASS

- [ ] **Step 4: コミット** `git add -A && git commit -m "知の蔓: クイズの「まだ」を芽として台帳に積む"`

---

### Task 6: 画面の配線（VineScreen / VineScene / TowerCard）

**Files:**
- Modify: `src/components/vine/VineScreen.tsx`
- Modify: `src/components/vine/VineScene.tsx`
- Modify: `src/components/tower/TowerCard.tsx`

**Interfaces:**
- Consumes: `leafSteps`（Task 1）、`pendingBudIds`・`buildLeafVisuals` 第4引数・`LeafVisual.line`（Task 4）、`loadRereads`（Task 3）
- Produces: VineScene 新prop `pendingBuds: number`

- [ ] **Step 1: VineScreen**

import へ `leafSteps` / `loadRereads` / `pendingBudIds` を追加し、`split` の直後に:

```ts
  // 葉＝attemptを除いた地上の歩（正典§9）。芽（attempt）は枚数・高さに入れない
  const aboveLeaves = useMemo(() => leafSteps(split.above), [split.above])
  const buds = useMemo(() => pendingBudIds(split.above), [split.above])
  const rereads = useMemo(() => loadRereads(), [])
```

`split.above` を使っていた表示系を `aboveLeaves` へ差し替え:

- `buildLeafVisuals(aboveLeaves, stats, nowIso, rereads)`（依存配列も更新）
- `spotlightFaded(aboveLeaves, stats, nowIso)`
- `const todayLeaf = aboveLeaves[to - 1]`
- `const openLeaf = leafOpen != null ? aboveLeaves[leafOpen] : null`
- `<VineScene ... steps={aboveLeaves} ... pendingBuds={buds.length} />`

葉シートの行為ラベルに resolved を追加（既存ternaryを置き換え）:

```tsx
              {openLeaf.kind === 'read' ? '読んだ' : openLeaf.kind === 'wrote' ? '書いた'
                : openLeaf.kind === 'resolved' ? '解決した'
                : openLeaf.kind === 'recall' ? '即答できた' : '磨き直した'}
```

凡例の1行を更新:

```tsx
            葉＝学びのひとつ（読んだ・書いた・解決した・即答できた・磨き直した）・色＝いま即答できるか
```

- [ ] **Step 2: VineScene — 輪郭の濃度と、穂先のまだの芽**

props に `pendingBuds: number` を追加。輪郭の線色を濃度で変える（`leafFill` の下にヘルパー）:

```ts
// 輪郭の葉の線。読み返しの回数（0〜3）で薄墨→墨に濃くなる（正典§9の3段階）。
const LINE_INKS = ['#8b8272', '#6f675a', '#4f483d', '#2c2a22'] as const
function leafStroke(v: LeafVisual): string {
  if (v.form !== 'outline') return INK
  return LINE_INKS[v.line]
}
```

葉の `<path>` の `stroke` を差し替え:

```tsx
                  fill={leafFill(v)} stroke={leafStroke(v)}
```

穂先のまだの芽（「穂先（伸びている間だけ）」ブロックの直後に追加）:

```tsx
      {/* まだの芽（正典§9）。クイズで「まだ」だった知識が穂先の未展開葉として現れる。
          高さは生まない。数字は出さない——描くのは新しい側から7個まで（台帳は全部残る）。
          思い出せたら芽はひらいて葉になる＝ここから消える。 */}
      {Array.from({ length: Math.min(pendingBuds, 7) }, (_, i) => {
        const side = i % 2 === 0 ? 1 : -1
        const y = leafY(to, to) - 12 - i * 11
        const x = stemXAt(Math.max(1, to)) + side * 7
        return (
          <g key={`bud-${i}`} transform={`translate(${x} ${y}) scale(${side} 1)`} opacity={0.75}>
            <path d="M0,6 C1,2 2,0 4,-1" fill="none" stroke="#39442c" strokeWidth={1.3} />
            <path d="M4,-1 c5,-4 9,-1 6,3 c-2,3 -6,2 -6,-3" fill="none" stroke="#55603f" strokeWidth={1.8} strokeLinecap="round" />
          </g>
        )
      })}
```

⚠️ `to === 0`（地上0）のときは `stemXAt(1)` が使われ、芽は蔓の断片の上に出る——意図どおり（地下しかない人が「まだ」を押した場合も、解いた事実が現れる）。

- [ ] **Step 3: TowerCard — 枚数と今週を葉基準に**

import へ `leafSteps` を追加し、`refresh` 内:

```ts
      const split = splitByJoin(s.steps, s.joinedAt)
      const leaves = leafSteps(split.above)
      setCount(leaves.length)
      setUnderground(split.underground.length)
      setWeek(stepsThisWeek(leaves, new Date().toISOString()))
```

- [ ] **Step 4: 型検査・全テスト** `npx tsc --noEmit && npx vitest run src/lib/__tests__/` → PASS

- [ ] **Step 5: コミット** `git add -A && git commit -m "知の蔓: 芽と濃度を画面に配線し、枚数を葉基準に統一する"`

---

### Task 7: devハーネス＋目視

**Files:**
- Modify: `src/app/dev/vine/page.tsx`

- [ ] **Step 1: シナリオ追加**（SCENARIOS に。`mkSteps`/`mkOld`/`mkSurfaced` は既存）

```ts
  '芽と解決と濃い輪郭': {
    steps: [
      ...mkSteps(10),
      { id: 'dev-0', kind: 'resolved', at: new Date(Date.now() - 3_600_000).toISOString(), genre: 'dev', title: 'CQを解決した知識' },
      { id: 'bud-1', kind: 'attempt', at: new Date(Date.now() - 7_200_000).toISOString(), genre: 'dev', title: 'まだの知識 一' },
      { id: 'bud-2', kind: 'attempt', at: new Date(Date.now() - 3_600_000).toISOString(), genre: 'dev', title: 'まだの知識 二' },
      { id: 'bud-3', kind: 'attempt', at: new Date(Date.now() - 1_800_000).toISOString(), genre: 'dev', title: 'まだの知識 三' },
    ],
    lastSeenSteps: 9, lastSeenAt: '', backfilledAt: 'dev',
    joinedAt: '', undergroundClearedAt: '', levels: {},
  },
```

- [ ] **Step 2: 目視**（`.claude/launch.json` の `medinode-3031` を preview_start → `localhost:3031/dev/vine`）

- 芽と解決: 穂先の脇に巻き葉が3つ・resolvedの葉が緑で1枚増える（リプレイ+2枚：resolved+10枚目）・ヘッダの枚数に芽が入っていない（ぜんぶで 11枚）
- 既存シナリオが崩れていない（ふつうの日・持ち込みの朝）

- [ ] **Step 3: コミット** `git add -A && git commit -m "知の蔓: devハーネスに芽と解決のシナリオ"`

---

### Task 8: 総検証・引き継ぎ更新・ブランチ仕舞い

- [ ] **Step 1:** `npx tsc --noEmit && npm test 2>&1 | grep -E "Tests " && npm run build 2>&1 | tail -3` → すべて成功

- [ ] **Step 2: 引き継ぎ書更新**（`docs/superpowers/HANDOFF-chi-no-tsuru-v2.md`）— フェーズ4を✅に。オーナー確認事項へ追記: クイズで「まだ」→穂先に巻き葉が出るか／CQをナレッジに昇格→次にアプリでそのレコードが検索に流れてきた時に resolved の葉が生えるか（**遷移は検索/バックフィルで再会した時に検出される＝即時ではない**）／読み返しの濃度は90日必要なので当面見えない

- [ ] **Step 3: マージとpush**（フェーズ1〜3と同じ運用）

```bash
git checkout main && git pull --ff-only && git merge --no-ff feat/chi-no-tsuru-v2-leaves -m "Merge branch 'feat/chi-no-tsuru-v2-leaves'" && npx vitest run src/lib/__tests__/ 2>&1 | grep "Tests " && git push && git branch -d feat/chi-no-tsuru-v2-leaves
```

---

## 検証について（正直な限界）

- resolved の実発火はオーナーの実データ（CQ昇格→再検索）でしか確かめられない。純関数テストが遷移検出を守る
- 読み返しの濃度は90日の間隔が要るため、実機ではすぐ見えない。devハーネスと純関数テストが守る
- attempt の実発火はクイズの「まだ」1タップで確認できる（オーナー実機）

## このあと

| # | 内容 | spec |
|---|---|---|
| 5 | 時間の点景（`sceneryMarks` / 空と住人）※地雷2: 右レーン統合（節目の印も含む） | §7 |
| — | アセット差し替え（筆致PNG・芽は leaf_young_furled のクロスフェード）・雲の先（§8「測るのをやめる」＝地雷3） | §8 |
