# 知の蔓 v2 フェーズ3（地下茎）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 持ち込んだ知識（利用開始前の日付の歩）を地下茎に分け、高さ・リプレイ・描画を地上部だけで測る。地下の知識はアプリで再会したとき地上に生まれ直す。

**Architecture:** `TowerState` に利用開始日 `joinedAt` を持たせ、純関数 `splitByJoin` で歩を地下/地上に分割する。水位（`lastSeenSteps`）・リプレイ・高さ・幾何の `total` はすべて地上の葉数に統一（＝引き継ぎ書の地雷1の解消）。地下は件数を出さず、薄墨の地下茎として一定深さだけ描く。

**Tech Stack:** Next.js (App Router) / TypeScript / vitest。作業ディレクトリは `~/medical-search-public`。

## Global Constraints（正典 spec §7・§12・§14、引き継ぎ書の不変条件）

- `VineScene` の `<svg>` は `viewBox` と `width`/`height` を同値に保つ（`w-full`/`max-w-*` 禁止）
- `COMPOUND_START_LEAVES × COMPOUND_RATE === 1`（今回は触らない）
- 葉を間引かない。1葉あたり `PX_PER_LEAF`(14px) を常に確保
- **地下の残数を数字で出さない**。地下に目盛りを打たない。色褪せ・未読・連続日数も数えない
- **持ち込みゼロの人には地下を描かない**（無いものを見せない）
- 画面文言は `vine-copy.ts` を通し `ALL_VINE_COPY` に載せる。六つの禁（説明しない・ポーズを取らない・語りかけない・褒めない・数を増やさない・感嘆符なし）。中は常体
- 既存ユーザーの `joinedAt` は「最も古い歩の翌日」ではなく**移行を実行した日**
- 台帳の歩は改変しない（日付・kindを書き換えない）。塔は縮まない
- ブランチ: `feat/chi-no-tsuru-v2-rhizome` で作業し、完了後に main へマージ

**受け入れた既知の限界（規則は緩めない）:** `(id, kind)` 一生に1回の重複規則により、利用開始前にすでに `read`/`recall` の歩があるidは、その kind では再浮上できない（`repolish` や別の kind で浮上する）。水増し防止は台帳の背骨であり、地下のために緩めない。バックフィルは `wrote` しか積まないため実影響は小さい。

---

### Task 0: ブランチを切る

- [ ] **Step 1:**

```bash
cd ~/medical-search-public && git checkout main && git pull && git checkout -b feat/chi-no-tsuru-v2-rhizome
```

---

### Task 1: 地雷1の解消 — 幾何の引数を「地上の葉数」に確定する

**Files:**
- Modify: `src/lib/vine-scroll.ts`
- Test: `src/lib/__tests__/vine-scroll.test.ts`（挙動不変・リネームのみ）

**Interfaces:**
- Produces: `leafY(index, aboveTotal)` ほか全幾何関数の第2引数（旧 `total`）が **地上の葉数** であることを名前と註釈で固定。挙動は不変。

- [ ] **Step 1: リネーム**

`vine-scroll.ts` 内のすべての `total` 引数を `aboveTotal` に変え、ファイル冒頭コメントに追記:

```ts
// ⚠️ 幾何の契約: この模块の aboveTotal は「地上の葉数」。地面の位置はこれで決まる。
// 地下茎（利用開始前の日付の歩）は含めない——含めると全y座標が静かにズレる（引き継ぎ書の地雷1）。
```

対象: `leafY` / `groundY` / `sceneHeightPx` / `visibleRange` / `markPositions` / `sceneMarks`（内部の使用箇所も）。

- [ ] **Step 2: テストが通ることを確認**

```bash
npx vitest run src/lib/__tests__/vine-scroll.test.ts
```

Expected: PASS（呼び出しは位置引数なので変更不要）

- [ ] **Step 3: コミット**

```bash
git add src/lib/vine-scroll.ts && git commit -m "知の蔓: 幾何の引数名を「地上の葉数」に確定（地雷1）"
```

---

### Task 2: TowerState に joinedAt / undergroundClearedAt

**Files:**
- Modify: `src/lib/tower-steps.ts`
- Modify: `src/app/dev/vine/page.tsx:17-19`（型を満たすだけ）
- Modify: `src/lib/__tests__/tower-steps.test.ts:21,121` / `src/lib/__tests__/tower-backfill.test.ts:6`（fixture）
- Test: `src/lib/__tests__/tower-steps.test.ts`

**Interfaces:**
- Produces: `TowerState.joinedAt: string`（''＝分割しない）、`TowerState.undergroundClearedAt: string`（''＝未到来）。`loadTowerState()` が joinedAt 未設定の保存データに「今」を刻んで保存し、`lastSeenSteps` を 0 に戻す。

- [ ] **Step 1: 失敗するテストを書く**（tower-steps.test.ts に追加。`TOWER_KEY` は import 済み）

```ts
describe('joinedAt の移行スタンプ', () => {
  it('joinedAtが無い保存データには移行を実行した日を刻み、水位を0へ戻して保存する', () => {
    localStorage.setItem(TOWER_KEY, JSON.stringify({
      steps: [step()], lastSeenSteps: 1, lastSeenAt: '', backfilledAt: 'x',
    }))
    const s1 = loadTowerState()
    expect(s1.joinedAt).not.toBe('')
    expect(s1.lastSeenSteps).toBe(0)
    const s2 = loadTowerState()
    expect(s2.joinedAt).toBe(s1.joinedAt) // 保存済みなので刻み直さない
  })
  it('undergroundClearedAt は既定で空文字に整形される', () => {
    localStorage.setItem(TOWER_KEY, JSON.stringify({ steps: [] }))
    expect(loadTowerState().undergroundClearedAt).toBe('')
  })
})
```

- [ ] **Step 2: 落ちることを確認** `npx vitest run src/lib/__tests__/tower-steps.test.ts` → FAIL

- [ ] **Step 3: 実装**

型:

```ts
export type TowerState = {
  steps: Step[]; lastSeenSteps: number; lastSeenAt: string; backfilledAt: string
  // 利用開始日。これより古い日付の歩は地下（splitByJoin）。''は「分割しない」＝全部地上（旧データ・devハーネス互換）。
  joinedAt: string
  // 地下が尽きた日＝持ち込んだ知識がすべて地上に芽を出した日。一度きり。''は未到来。
  undergroundClearedAt: string
}
```

`sanitize` の `emptyState` と戻り値、`loadTowerState` の catch 節に両フィールドを追加（`typeof o.joinedAt === 'string' ? o.joinedAt : ''` 形式）。`loadTowerState` を差し替え:

```ts
export function loadTowerState(): TowerState {
  let state: TowerState
  try {
    state = sanitize(JSON.parse(localStorage.getItem(TOWER_KEY) || 'null'))
  } catch {
    return { steps: [], lastSeenSteps: 0, lastSeenAt: '', backfilledAt: '', joinedAt: '', undergroundClearedAt: '' }
  }
  // 初回移行: 利用開始日は「移行を実行した日」（最も古い歩の翌日ではない＝正典§12）。
  // 既存の歩はこの瞬間すべて地下になるので、リプレイの水位も0へ戻す。
  // 保存が効かない環境では joinedAt が毎回進む＝常に全歩が地下になるが、
  // その環境では歩の保存自体も効いていないため実害はない。
  if (!state.joinedAt) {
    state = { ...state, joinedAt: new Date().toISOString(), lastSeenSteps: 0 }
    saveTowerState(state)
  }
  return state
}
```

fixture 3箇所に `joinedAt: '', undergroundClearedAt: ''` を足す。`dev/vine/page.tsx` の `mk` にも同じ2フィールドを足す。

- [ ] **Step 4: 通す** `npx vitest run src/lib/__tests__/tower-steps.test.ts src/lib/__tests__/tower-backfill.test.ts && npx tsc --noEmit` → PASS

- [ ] **Step 5: コミット** `git add -A && git commit -m "知の蔓: TowerState に利用開始日と地下が尽きた日を持たせる"`

---

### Task 3: splitByJoin / dormantIds（純関数）

**Files:**
- Modify: `src/lib/vine-scroll.ts`
- Test: `src/lib/__tests__/vine-scroll.test.ts`

**Interfaces:**
- Consumes: `type Step`（tower-steps。type-only import なので循環しない）
- Produces: `splitByJoin(steps: Step[], joinedIso: string): { underground: Step[]; above: Step[] }`、`dormantIds(steps: Step[], joinedIso: string): string[]`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { splitByJoin, dormantIds } from '../vine-scroll'
import type { Step } from '../tower-steps'

const st = (id: string, at: string, kind: Step['kind'] = 'wrote'): Step =>
  ({ id, kind, at, genre: '', title: '' })

describe('地下茎と地上部の分割（§7）', () => {
  const joined = '2026-08-01T00:00:00.000Z'
  it('利用開始日より前の日付の歩は地下、それ以降が地上', () => {
    const r = splitByJoin([st('a', '2026-07-01T00:00:00.000Z'), st('b', '2026-08-02T00:00:00.000Z')], joined)
    expect(r.underground.map((s) => s.id)).toEqual(['a'])
    expect(r.above.map((s) => s.id)).toEqual(['b'])
  })
  it('joinedIsoが空なら分割しない（全部地上＝旧データ・devハーネス互換）', () => {
    const steps = [st('a', '2026-07-01T00:00:00.000Z')]
    expect(splitByJoin(steps, '')).toEqual({ underground: [], above: steps })
  })
  it('オフセット付きISO（Notion由来）と toISOString が混在しても日付で分ける', () => {
    const r = splitByJoin([
      st('n', '2026-07-31T23:00:00.000+09:00'), // = 7/31 14:00Z → 地下
      st('m', '2026-08-01T09:30:00.000+09:00'), // = 8/1 00:30Z → 地上
    ], joined)
    expect(r.underground.map((s) => s.id)).toEqual(['n'])
    expect(r.above.map((s) => s.id)).toEqual(['m'])
  })
  it('解釈できない日付は地上へ倒す（見えなくなる側に倒さない）', () => {
    expect(splitByJoin([st('x', 'garbage')], joined).above).toHaveLength(1)
  })
})

describe('まだ芽を出していない知識（dormantIds）', () => {
  const joined = '2026-08-01T00:00:00.000Z'
  it('地下にあり、地上にどのkindの歩も無いidだけを返す', () => {
    const steps = [
      st('a', '2026-07-01T00:00:00.000Z'), st('b', '2026-07-02T00:00:00.000Z'),
      st('a', '2026-08-02T00:00:00.000Z', 'read'), // aは芽を出した
    ]
    expect(dormantIds(steps, joined)).toEqual(['b'])
  })
  it('地下が無ければ空', () => {
    expect(dormantIds([st('a', '2026-08-02T00:00:00.000Z')], joined)).toEqual([])
  })
})
```

- [ ] **Step 2: 落ちることを確認** → FAIL（splitByJoin is not exported）

- [ ] **Step 3: 実装**（vine-scroll.ts 末尾に追加）

```ts
import type { Step } from './tower-steps' // ファイル冒頭のimport群へ（type-onlyなので実行時循環なし）

// 地下茎と地上部の分割（正典§7）。利用開始日より前の日付の歩は地下、それ以降が地上。
// 高さ・リプレイ・幾何はすべて above だけで測る。joinedIso が空なら分割しない
// （旧データとdevハーネスの互換）。日付は Date で比較する——Notion由来のオフセット付きISOと
// toISOString が混在するため、文字列比較は使えない。
export function splitByJoin(steps: Step[], joinedIso: string): { underground: Step[]; above: Step[] } {
  if (!joinedIso) return { underground: [], above: steps }
  const joined = new Date(joinedIso).getTime()
  const underground: Step[] = []
  const above: Step[] = []
  for (const s of steps) {
    const t = new Date(s.at).getTime()
    // 解釈できない日付は地上へ倒す（見えなくなる側に倒さない）
    if (Number.isFinite(t) && t < joined) underground.push(s)
    else above.push(s)
  }
  return { underground, above }
}

// まだ地上に芽を出していない知識のid（地下で眠っている分）。
// ⚠️ 件数をUIに出さない——「未読200件」は負債台帳そのもの（正典§7の必須条件2）。
export function dormantIds(steps: Step[], joinedIso: string): string[] {
  const { underground, above } = splitByJoin(steps, joinedIso)
  const surfaced = new Set(above.map((s) => s.id))
  return [...new Set(underground.map((s) => s.id))].filter((id) => !surfaced.has(id))
}
```

- [ ] **Step 4: 通す** `npx vitest run src/lib/__tests__/vine-scroll.test.ts` → PASS

- [ ] **Step 5: コミット** `git add -A && git commit -m "知の蔓: 地下茎と地上部を分ける純関数（splitByJoin / dormantIds）"`

---

### Task 4: 水位・リプレイを地上基準へ＋地下が尽きた日のスタンプ

**Files:**
- Modify: `src/lib/tower-steps.ts`（`addStep` / `markSeen` / `planReplay`）
- Test: `src/lib/__tests__/tower-steps.test.ts`

**Interfaces:**
- Consumes: `splitByJoin` / `dormantIds`（Task 3）
- Produces: `planReplay` の `to` ＝地上の葉数。`markSeen` は地上の葉数で丸める。`addStep` は地下が尽きた瞬間に `undergroundClearedAt = step.at` を一度だけ刻む。

- [ ] **Step 1: 失敗するテストを書く**

```ts
describe('地下と水位・リプレイ（§7）', () => {
  const joined = '2026-08-01T00:00:00.000Z'
  const old = (id: string) => step({ id, kind: 'wrote', at: '2026-07-01T00:00:00.000Z' })

  it('地下の歩はリプレイに乗せない（toは地上の葉数）', () => {
    const s: TowerState = {
      ...empty, joinedAt: joined,
      steps: [old('u1'), step({ id: 'u1', kind: 'read', at: '2026-08-02T00:00:00.000Z' })],
    }
    expect(planReplay(s)).toEqual({ from: 0, to: 1, play: true })
  })

  it('markSeen は地上の葉数で丸める', () => {
    const s: TowerState = { ...empty, joinedAt: joined, steps: [old('u1'), old('u2')] }
    expect(markSeen(s, 2).lastSeenSteps).toBe(0)
  })

  it('地下の知識がすべて芽を出した瞬間、undergroundClearedAt を一度だけ刻む', () => {
    const base: TowerState = { ...empty, joinedAt: joined }
    let s = addStep(base, old('a'))
    s = addStep(s, old('b'))
    s = addStep(s, step({ id: 'a', kind: 'read', at: '2026-08-02T00:00:00.000Z' }))
    expect(s.undergroundClearedAt).toBe('') // bがまだ地下
    s = addStep(s, step({ id: 'b', kind: 'read', at: '2026-08-03T00:00:00.000Z' }))
    expect(s.undergroundClearedAt).toBe('2026-08-03T00:00:00.000Z')
  })

  it('持ち込みゼロ（地下なし）では刻まない', () => {
    const s = addStep({ ...empty, joinedAt: joined }, step({ at: '2026-08-02T00:00:00.000Z' }))
    expect(s.undergroundClearedAt).toBe('')
  })

  it('一度刻んだら、後から地下に歩が増えても刻み直さない', () => {
    const cleared: TowerState = { ...empty, joinedAt: joined, undergroundClearedAt: '2026-08-03T00:00:00.000Z' }
    let s = addStep(cleared, old('late'))
    s = addStep(s, step({ id: 'late', kind: 'read', at: '2026-08-04T00:00:00.000Z' }))
    expect(s.undergroundClearedAt).toBe('2026-08-03T00:00:00.000Z')
  })
})
```

- [ ] **Step 2: 落ちることを確認** → FAIL

- [ ] **Step 3: 実装**（tower-steps.ts。冒頭に `import { splitByJoin, dormantIds } from './vine-scroll'`）

```ts
export function addStep(state: TowerState, step: Step): TowerState {
  if (isDuplicate(state.steps, step)) return state
  const steps = [...state.steps, step]
  if (steps.length > MAX_STEPS) steps.splice(0, steps.length - MAX_STEPS)
  // 地下が尽きた日: 持ち込んだ知識がすべて地上に芽を出した瞬間を一度だけ刻む（正典§7の節目）。
  // 持ち込みゼロの人には起きない（hadDormantが常にfalse）。刻み直しもしない（一度きり）。
  let undergroundClearedAt = state.undergroundClearedAt
  if (state.joinedAt && !undergroundClearedAt) {
    const hadDormant = dormantIds(state.steps, state.joinedAt).length > 0
    if (hadDormant && dormantIds(steps, state.joinedAt).length === 0) {
      undergroundClearedAt = step.at
    }
  }
  return { ...state, steps, undergroundClearedAt }
}

export function markSeen(state: TowerState, uptoCount: number): TowerState {
  // 水位は地上の葉数で数える。地下の歩（持ち込み）は「見た」の対象ではない。
  const aboveCount = splitByJoin(state.steps, state.joinedAt).above.length
  const upto = Math.max(state.lastSeenSteps, Math.min(uptoCount, aboveCount))
  return { ...state, lastSeenSteps: upto, lastSeenAt: new Date().toISOString() }
}

export function planReplay(state: TowerState): { from: number; to: number; play: boolean } {
  // 伸びるのは地上だけ（正典§7）。地下の歩はリプレイに乗せない。
  const to = splitByJoin(state.steps, state.joinedAt).above.length
  const from = Math.min(state.lastSeenSteps, to)
  return { from, to, play: to > from }
}
```

- [ ] **Step 4: 通す** `npx vitest run src/lib/__tests__/tower-steps.test.ts` → PASS（既存テストは joinedAt='' なので挙動不変）

- [ ] **Step 5: コミット** `git add -A && git commit -m "知の蔓: 水位とリプレイを地上基準にし、地下が尽きた日を刻む"`

---

### Task 5: applyBackfill の水位を地上数に

**Files:**
- Modify: `src/lib/tower-backfill.ts`
- Test: `src/lib/__tests__/tower-backfill.test.ts`

**Interfaces:**
- Consumes: `splitByJoin`（Task 3）、`markSeen`（Task 4）

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('持ち込み分は地下に入るので、水位は地上の葉数のまま（0）', () => {
  const withJoin: TowerState = { ...empty, joinedAt: '2026-08-01T00:00:00.000Z' }
  const records = [{ objectID: 'r1', owner: 'personal', createdAt: '2026-07-01T00:00:00.000Z' }]
  const next = applyBackfill(withJoin, records, '2026-08-02T00:00:00.000Z')
  expect(next.steps).toHaveLength(1)
  expect(next.lastSeenSteps).toBe(0)
})
```

- [ ] **Step 2: 落ちることを確認** → Task 4 の markSeen 丸めで既に通る可能性が高い。通る場合はテストだけ足して次へ（実装は意図の明示に留める）。

- [ ] **Step 3: 実装**（意図を明示）

```ts
import { splitByJoin } from './vine-scroll' // 冒頭へ

export function applyBackfill(state: TowerState, records: unknown[], nowIso: string): TowerState {
  const ingested = ingestRecords(state, records as Parameters<typeof ingestRecords>[1])
  // 水位は地上の葉数まで。持ち込み分は地下に入るため、地上0ならリプレイも起きない。
  const above = splitByJoin(ingested.steps, ingested.joinedAt).above.length
  return markSeen({ ...ingested, backfilledAt: nowIso }, above)
}
```

- [ ] **Step 4: 通す** `npx vitest run src/lib/__tests__/tower-backfill.test.ts` → PASS

- [ ] **Step 5: コミット** `git add -A && git commit -m "知の蔓: バックフィルの水位を地上の葉数で刻む"`

---

### Task 6: 幾何 — 地下の深さ

**Files:**
- Modify: `src/lib/vine-scroll.ts`（`RHIZOME_DEPTH` / `sceneHeightPx` / `visibleRange`）
- Test: `src/lib/__tests__/vine-scroll.test.ts`

**Interfaces:**
- Produces: `RHIZOME_DEPTH = 150`、`sceneHeightPx(aboveTotal, undergroundDepth = 0)`、`visibleRange(scrollTop, viewportH, aboveTotal, undergroundDepth = 0)`

- [ ] **Step 1: 失敗するテストを書く**

```ts
describe('地下の深さ', () => {
  it('地下があるときだけ、その深さぶんシーンが下へ伸びる', () => {
    expect(sceneHeightPx(100, RHIZOME_DEPTH)).toBe(sceneHeightPx(100) + RHIZOME_DEPTH)
    expect(sceneHeightPx(100, 0)).toBe(sceneHeightPx(100))
  })
  it('地下ぶん深くスクロールしても窓は地面ぎわの葉を保持する', () => {
    const deep = sceneHeightPx(50, RHIZOME_DEPTH) - 700
    const r = visibleRange(deep, 700, 50, RHIZOME_DEPTH)
    expect(r.from).toBe(1)
  })
})
```

- [ ] **Step 2: 落ちることを確認** → FAIL

- [ ] **Step 3: 実装**

```ts
// 地下茎ゾーンの深さ（持ち込みがあるときだけシーンの下端に足す）。
// 深さでは測らない——地下に目盛りは打たない（正典§7）。定数なのは件数に比例させないため。
export const RHIZOME_DEPTH = 150

export function sceneHeightPx(aboveTotal: number, undergroundDepth = 0): number {
  return groundY(aboveTotal) + SCENE_BOTTOM_PAD + undergroundDepth
}

export function visibleRange(
  scrollTop: number, viewportH: number, aboveTotal: number, undergroundDepth = 0,
): { from: number; to: number } {
  ...
  const maxScroll = Math.max(0, sceneHeightPx(aboveTotal, undergroundDepth) - viewportH)
  ...（残りは現行のまま）
```

- [ ] **Step 4: 通す** `npx vitest run src/lib/__tests__/vine-scroll.test.ts` → PASS

- [ ] **Step 5: コミット** `git add -A && git commit -m "知の蔓: シーンの幾何に地下の深さを足す"`

---

### Task 7: 文言 — 地下が尽きた日

**Files:**
- Modify: `src/lib/vine-copy.ts`
- Test: `src/lib/__tests__/vine-copy.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
it('地下が尽きた日は、起きたことだけを置く（名詞も数字も足さない）', () => {
  expect(undergroundDoneLine()).toBe('みな芽を出した')
})
```

- [ ] **Step 2: 落ちることを確認** → FAIL

- [ ] **Step 3: 実装**

```ts
// 地下が尽きた日（持ち込んだ知識がすべて地上に芽を出した）。地下茎の脇に置くので
// 場所が主語を語る——名詞を足さず、起きたことだけを常体で置く。
export function undergroundDoneLine(): string {
  return 'みな芽を出した'
}
```

`ALL_VINE_COPY` に `undergroundDoneLine(),` を追加。

- [ ] **Step 4: 通す** `npx vitest run src/lib/__tests__/vine-copy.test.ts` → PASS（六つの禁の走査も通ること）

- [ ] **Step 5: コミット** `git add -A && git commit -m "知の蔓: 地下が尽きた日の文言"`

---

### Task 8: VineScene — 地下茎の薄墨描画・芽・高さ表示のガード・節目の印

**Files:**
- Modify: `src/components/vine/VineScene.tsx`

**Interfaces:**
- Consumes: `RHIZOME_DEPTH`（Task 6）、`undergroundDoneLine`（Task 7）
- Produces: 新props `undergroundCount: number` / `undergroundClearedAt: string`

- [ ] **Step 1: props と幾何**

props型に `undergroundCount: number; undergroundClearedAt: string` を追加し、分割代入にも足す。幾何を差し替え:

```ts
import { leafY, groundY, sceneHeightPx, visibleRange, sceneMarks, RHIZOME_DEPTH } from '@/lib/vine-scroll'
import { nextObjectLine, undergroundDoneLine } from '@/lib/vine-copy'
...
const depth = undergroundCount > 0 ? RHIZOME_DEPTH : 0
const H = sceneHeightPx(to, depth)
...
const win = visibleRange(scrollTop, viewportH, to, depth)
```

- [ ] **Step 2: 地下茎を描く**（地面のpathの直後に追加。仮アート＝筆線。淡さ30%・幅70%・下端をグラデーションで溶かす——`rhizome-test.html` で決めた値）

```tsx
{/* 地下茎（持ち込んだ知識の寝床）。持ち込みゼロなら描かない——無いものを見せない（正典§7）。
    件数も目盛りも出さない。下端はグラデーションで溶かす（根が切れて見えると図解になる）。
    地上の蔓は芽の真上（BASE_X）から立つ（正典§12）。 */}
{undergroundCount > 0 && (
  <>
    <defs>
      <linearGradient id="rhizomeFade" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0.42" stopColor="#fff" />
        <stop offset="0.78" stopColor="#444" />
        <stop offset="1" stopColor="#000" />
      </linearGradient>
      <mask id="rhizomeMask">
        <rect x={0} y={gY} width={W} height={RHIZOME_DEPTH} fill="url(#rhizomeFade)" />
      </mask>
    </defs>
    <g mask="url(#rhizomeMask)" opacity={0.3}>
      {/* 横に這う本体の帯（幅はカードの70%） */}
      <path
        d={`M${BASE_X - W * 0.35},${gY + 30} C ${BASE_X - W * 0.12},${gY + 20} ${BASE_X + W * 0.1},${gY + 36} ${BASE_X + W * 0.35},${gY + 26}`}
        fill="none" stroke={INK} strokeWidth={14} strokeLinecap="round"
      />
      {/* 節（鱗片葉の名残り。地下に本葉は生えない） */}
      <line x1={BASE_X - W * 0.18} y1={gY + 18} x2={BASE_X - W * 0.18} y2={gY + 32} stroke={INK} strokeWidth={2} />
      <line x1={BASE_X + W * 0.12} y1={gY + 24} x2={BASE_X + W * 0.12} y2={gY + 38} stroke={INK} strokeWidth={2} />
      {/* 下へ降りる根 */}
      <path d={`M${BASE_X - W * 0.2},${gY + 30} C ${BASE_X - W * 0.22},${gY + 60} ${BASE_X - W * 0.16},${gY + 90} ${BASE_X - W * 0.19},${gY + 130}`} fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
      <path d={`M${BASE_X + W * 0.05},${gY + 34} C ${BASE_X + W * 0.02},${gY + 70} ${BASE_X + W * 0.09},${gY + 100} ${BASE_X + W * 0.06},${gY + 140}`} fill="none" stroke={INK} strokeWidth={3} strokeLinecap="round" />
      {/* 芽の首（地下茎から地面へ。地上の蔓の真下） */}
      <path d={`M${BASE_X},${gY + 26} C ${BASE_X - 2},${gY + 14} ${BASE_X + 2},${gY + 6} ${BASE_X},${gY - 2}`} fill="none" stroke={INK} strokeWidth={6} strokeLinecap="round" />
    </g>
  </>
)}
```

- [ ] **Step 3: 節目の印**（同じ区画に続けて。実物の印（朱）とは別種なので薄墨）

```tsx
{/* 地下が尽きた日（一度きりの節目・正典§7）。朱ではなく薄墨——実物の印とは別種の出来事 */}
{undergroundClearedAt && undergroundCount > 0 && (
  <g opacity={0.85}>
    <text x={W - 92} y={gY + 18} fontSize={9} fill={USUZUMI}>{undergroundDoneLine()}</text>
    <text x={W - 92} y={gY + 30} fontSize={8} fill={USUZUMI}>{kanjiDate(new Date(undergroundClearedAt))}</text>
  </g>
)}
```

- [ ] **Step 4: 地上0のガード**（初日の画面＝地下茎の上に小さな芽。数字を出さない）

いまの高さ表示（`{formatHeight(heightMmFromLeaves(...))}` の `<text>`）を `{to > 0 && (...)}` で包む。40pxの蔓の断片（`vineH` の既定値）がそのまま「小さな芽」になる——追加描画はしない。

- [ ] **Step 5: 型検査** `npx tsc --noEmit` → VineScreen 側が未配線なので新propsのエラーが出るのは正常（Task 9で解消）。VineScene単体の構文エラーが無いことだけ確認。

- [ ] **Step 6: コミットは Task 9 と一緒に行う**（propsが揃うまでビルドが赤のため）

---

### Task 9: VineScreen — 分割の配線

**Files:**
- Modify: `src/components/vine/VineScreen.tsx`

**Interfaces:**
- Consumes: `splitByJoin`（Task 3）、VineScene 新props（Task 8）

- [ ] **Step 1: 分割を1箇所で作る**

```ts
import { leafY, markPositions, splitByJoin } from '@/lib/vine-scroll'
...
// 地下茎と地上部（正典§7）。表示・リプレイ・高さはすべて above だけを見る。
const split = useMemo(() => splitByJoin(state.steps, state.joinedAt), [state.steps, state.joinedAt])
```

置き場所は `const marks = useMemo(...)` の直前。

- [ ] **Step 2: 使用箇所を above へ差し替え**

- `buildLeafVisuals(state.steps, ...)` → `buildLeafVisuals(split.above, ...)`
- `spotlightFaded(state.steps, ...)` → `spotlightFaded(split.above, ...)`
- `const todayLeaf = state.steps[to - 1]` → `const todayLeaf = split.above[to - 1]`
- `const openLeaf = leafOpen != null ? state.steps[leafOpen] : null` → `split.above[leafOpen]`
- `<VineScene ... steps={state.steps}` → `steps={split.above}` とし、`undergroundCount={split.underground.length} undergroundClearedAt={state.undergroundClearedAt}` を追加

（`planReplay`/`markSeen` は Task 4 で地上基準になっているため `snapshot`・`commitSeen` は変更不要）

- [ ] **Step 3: 地上0のヘッダは数字を出さない**（「0mm」「ぜんぶで 0枚」は最初の一画面を数字の0で語ってしまう）

```tsx
<div className="text-[11px] tracking-[.35em] text-[#7d6f52]">知　の　蔓</div>
{to > 0 && <div className="text-2xl font-semibold">{formatHeight(hMm)}</div>}
{to > 0 && <div className="mt-0.5 text-[11px] text-[#8b8272]">{leafCountLine(newLeaves, to)}</div>}
```

- [ ] **Step 4: 型検査・全テスト** `npx tsc --noEmit && npm test` → PASS

- [ ] **Step 5: コミット** `git add -A && git commit -m "知の蔓: 地下茎を描き、表示とリプレイを地上部だけで測る"`

---

### Task 10: TowerCard — 地上基準と入口の維持

**Files:**
- Modify: `src/components/tower/TowerCard.tsx`

**注意:** 現行は `count === 0` でカード自体を消す。移行直後のオーナーは地上0になるため、そのままだと**蔓への入口が消えて再会の道が断たれる**。地下があるなら出す。

- [ ] **Step 1: 実装**

```ts
import { loadTowerState, TOWER_EVENT } from '@/lib/tower-steps'
import { splitByJoin } from '@/lib/vine-scroll'
...
const [underground, setUnderground] = useState(0)
...
const refresh = () => {
  const s = loadTowerState()
  const split = splitByJoin(s.steps, s.joinedAt)
  setCount(split.above.length)
  setUnderground(split.underground.length)
  setWeek(stepsThisWeek(split.above, new Date().toISOString()))
}
...
// 地上0でも地下（持ち込み）があるなら入口は残す——消すと再会の道が断たれる
if (!isTowerEnabled() || (count === 0 && underground === 0)) return null
```

表示部（数字の0を並べない）:

```tsx
<span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-200">
  {count > 0 ? (
    <>
      <span className="font-bold text-gray-900 dark:text-gray-50">{formatHeight(heightMmFromLeaves(count))}</span>
      <span className="ml-2 text-gray-500 dark:text-gray-400">今週 +{week}</span>
      {remainMm > 0 && (
        <span className="ml-2 text-brand dark:text-brand-300">
          {next.label}まで あと{formatHeight(remainMm)}
        </span>
      )}
    </>
  ) : (
    <span className="font-bold text-gray-900 dark:text-gray-50">知の蔓</span>
  )}
</span>
```

- [ ] **Step 2: 型検査** `npx tsc --noEmit` → PASS

- [ ] **Step 3: コミット** `git add -A && git commit -m "知の蔓: ホームカードを地上基準にし、地下だけの端末でも入口を残す"`

---

### Task 11: devハーネスに地下シナリオ

**Files:**
- Modify: `src/app/dev/vine/page.tsx`

- [ ] **Step 1: シナリオ追加**（`mk` は Task 2 で型対応済み。以下を追記）

```ts
// 地下シナリオ用: joined より古い wrote（持ち込み）と、joined 後の read（芽を出した分）
const JOINED = new Date(Date.now() - 30 * 86_400_000).toISOString()
function mkOld(n: number): Step[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `old-${i}`, kind: 'wrote' as const,
    at: new Date(new Date(JOINED).getTime() - (n - i) * 86_400_000).toISOString(),
    genre: 'dev', title: `持ち込みの知識 ${i + 1}`,
  }))
}
function mkSurfaced(ids: string[]): Step[] {
  return ids.map((id, i) => ({
    id, kind: 'read' as const,
    at: new Date(new Date(JOINED).getTime() + (i + 1) * 3_600_000).toISOString(),
    genre: 'dev', title: `芽を出した ${i + 1}`,
  }))
}
```

`SCENARIOS` に3つ追加:

```ts
'持ち込みの朝（地下274・地上0）': {
  steps: mkOld(274), lastSeenSteps: 0, lastSeenAt: '', backfilledAt: 'dev',
  joinedAt: JOINED, undergroundClearedAt: '',
},
'地下から芽吹く（地上8・+5枚）': {
  steps: [...mkOld(40), ...mkSurfaced(['old-0','old-1','old-2','old-3','old-4','old-5','old-6','old-7'])],
  lastSeenSteps: 3, lastSeenAt: '', backfilledAt: 'dev',
  joinedAt: JOINED, undergroundClearedAt: '',
},
'地下が尽きた日': {
  steps: [...mkOld(6), ...mkSurfaced(['old-0','old-1','old-2','old-3','old-4','old-5'])],
  lastSeenSteps: 5, lastSeenAt: '', backfilledAt: 'dev',
  joinedAt: JOINED, undergroundClearedAt: new Date(new Date(JOINED).getTime() + 6 * 3_600_000).toISOString(),
},
```

- [ ] **Step 2: 目視**（development で確認できる範囲だけ。`npm run dev` → `/dev/vine`）

- 持ち込みの朝: 地下茎＋小さな蔓の断片だけ・数字が一切出ない・カード類が「0」を言わない
- 芽吹く: 地上8枚が下から並び、リプレイ+5枚・地下茎が下に見える
- 尽きた日: 地面ぎわに「みな芽を出した」と漢数字の日付

- [ ] **Step 3: コミット** `git add -A && git commit -m "知の蔓: devハーネスに地下茎の3シナリオ"`

---

### Task 12: 総検証・引き継ぎ更新・ブランチ仕舞い

- [ ] **Step 1: 全部**

```bash
npx tsc --noEmit && npm test && npm run build 2>&1 | tail -5
```

Expected: すべて成功（テストは 747+新規）

- [ ] **Step 2: 引き継ぎ書を更新**（`docs/superpowers/HANDOFF-chi-no-tsuru-v2.md`）

- 現在地表: フェーズ3 → ✅
- オーナー確認事項に追記: **移行直後は蔓が「地下茎＋芽」へ戻って見える（高さ0）——これは正典§7の意図した挙動で、記録は1件も減っていない**。ホームカードが「知の蔓」表示になること・読み返し/クイズで芽が地上に出ること・地下の残数がどこにも数字で出ていないこと
- 既知の限界（(id,kind)一生に1回と地下の再浮上）を記載
- 地雷1を解消済みに更新。地雷2〜5は残置
- 気づき: TowerCard の「あと◯◯」数字は蔓の外（ホームカード）に現存。§7の「伸びているときだけ」もカードには未適用。変えるかはオーナー判断

- [ ] **Step 3: main へマージして push**（フェーズ1・2と同じ運用）

```bash
git checkout main && git merge --no-ff feat/chi-no-tsuru-v2-rhizome -m "Merge branch 'feat/chi-no-tsuru-v2-rhizome'" && git push
```

---

## 検証について（正直な限界）

コンポーネントテストの基盤が無く、蔓はフラグの内側にあるため、実機の見た目確認はオーナーにしかできない。機械で守れるのは: 分割・水位・節目スタンプ・幾何の純関数テスト、文言の禁の走査、型検査とビルド。**残るのはオーナーの実機確認**: 移行直後の「地下茎＋芽」の絵、地下茎の淡さ・深さ、芽吹きのリプレイ、節目の印。

## このあとの計画（引き継ぎ書のフェーズ表より）

| # | 内容 | spec |
|---|---|---|
| 3（この計画） | 地下茎 | §7 |
| 4 | 葉の生え方（`resolved` / `attempt` / 読み返しの濃度） | §9 |
| 5 | 時間の点景（`sceneryMarks` / 空と住人）※地雷2: 右レーンを1本の関数に統合 | §7 |
| — | アセット差し替え（筆致PNG）・雲の先（§8「測るのをやめる」＝地雷3） | §8 |
