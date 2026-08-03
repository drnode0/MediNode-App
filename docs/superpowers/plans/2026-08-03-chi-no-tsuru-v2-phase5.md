# 知の蔓 v2 フェーズ5（時間の点景）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to実装 this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 実時間に紐づく季節の出来事（点景）を蔓に記録し（正典§7の二層の下段）、右レーンの描画を1本の関数に統合する（地雷2）。あわせて地雷4（ラベルの右端切れ）と地雷5（間引かれた印へ目次から飛ぶと何も無い）を解消する。

**Architecture:** 新モジュール `vine-scenery.ts` が暦（12項目・固定月日）と `sceneryMarks`（歩の履歴→点景の位置）を持つ。`vine-scroll.ts` の `sceneMarks`（描画用間引き）を廃止し、実物の印・点景・地下が尽きた日を**1本の `laneMarks` が優先度つきで整列**する——ラベルは間引いても**刻み（tick）は全件残す**（地雷5）。ラベルは右端アンカー（`textAnchor="end"`）で切れなくする（地雷4）。空と住人のスプライトはアセット差し替えフェーズへ送り、本フェーズは**構造と仮アートの点**まで。

**Tech Stack:** Next.js / TypeScript / vitest。作業ディレクトリは `~/medical-search-public`。

## Global Constraints（正典§7・§14）

- **点景は通知しない**——開いたときに見つけるもの（何も実装しないことで守る。push系のコードに触れない）
- 点景は蔓に記録する。**葉が伸びなかった期間は点景が重なって、空白が空白として読める**
- 点景の件数・「何回起きたか」を数字でUIに出さない
- 画面に出る点景の名前は名詞だけ（六つの禁）。`ALL_VINE_COPY` に載せて禁の走査に通す
- 縦位置は葉の番号が基準（正典§3）。点景は**葉と葉の間**に時間割合で置く（14pxの中に収まる＝重なりは仕様）
- `VineScene` の svg 1:1・葉を間引かない・aboveTotal＝地上の葉数、は不変
- ブランチ: `feat/chi-no-tsuru-v2-scenery`。完了後 main へマージ

**設計判断（蒸し返さない用）:**
- **暦は固定月日12項目**（下表）。年10〜14回の帯の中。満月は毎月起きて印が安売りになるので**名月（9/15）だけ**。人工物・行事は世界の嘘になるので自然物のみ（流れ星=ペルセウス群8/12は自然物）。正典§15「点景の暦は実装計画で詰める」の回答
- **`sceneryMarks` は vine-scenery.ts に置く**（正典§11はvine-scroll想定だが、暦と一体で持つほうが責務が締まる。幾何は leafY を import して共有）
- **最初の葉より前の点景は描かない**（蔓の記録が始まる前は蔓に無い）。最後の葉より新しい点景は、穂先の上1葉ぶん（14px）に圧縮して置く——**止まった人にも何かが起きる**の実装
- 点景の描画は**薄墨の小さな点＋名前**。絵（空・住人）はアセットフェーズ

### 暦（SCENERY_ALMANAC）

| 月日 | kind | label |
|---|---|---|
| 1/1 | hatsuhinode | 初日の出 |
| 2/20 | ume | 梅 |
| 3/28 | sakura | 桜 |
| 4/20 | tsubame | つばめ |
| 5/20 | wakaba | 若葉 |
| 6/15 | hotaru | 蛍 |
| 7/20 | semi | 蝉しぐれ |
| 8/12 | nagareboshi | 流れ星 |
| 9/15 | meigetsu | 名月 |
| 10/15 | kari | 雁 |
| 11/15 | momiji | 紅葉 |
| 12/10 | hatsuyuki | 初雪 |

日付はJST（`+09:00`）で解釈する（日本の季節の暦のため）。

---

### Task 0: ブランチ

- [ ] `cd ~/medical-search-public && git checkout main && git pull --ff-only && git checkout -b feat/chi-no-tsuru-v2-scenery`

---

### Task 1: vine-scenery.ts — 暦と点景の位置

**Files:**
- Create: `src/lib/vine-scenery.ts`
- Test: `src/lib/__tests__/vine-scenery.test.ts`

**Interfaces:**
- Consumes: `leafY`・`PX_PER_LEAF`（vine-scroll）、`type Step`（tower-steps）
- Produces: `SCENERY_ALMANAC: readonly { m; d; kind; label }[]`、`eventsBetween(fromIso, toIso): { kind; label; at }[]`、`type SceneryMark = { kind: string; label: string; at: string; leafIndex: number; y: number }`、`sceneryMarks(leaves: Step[], nowIso: string): SceneryMark[]`（⚠️ leaves は leafSteps済み・地上のみが契約）

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, expect, it } from 'vitest'
import type { Step } from '../tower-steps'
import { PX_PER_LEAF, leafY } from '../vine-scroll'
import { SCENERY_ALMANAC, eventsBetween, sceneryMarks } from '../vine-scenery'

const leaf = (at: string): Step => ({ id: `k-${at}`, kind: 'recall', at, genre: '', title: '' })

describe('暦', () => {
  it('12項目・すべて名詞ラベル', () => {
    expect(SCENERY_ALMANAC).toHaveLength(12)
  })
  it('期間内の出来事を年をまたいで列挙する（JST解釈）', () => {
    const evs = eventsBetween('2025-12-01T00:00:00.000Z', '2026-02-28T00:00:00.000Z')
    expect(evs.map((e) => e.kind)).toEqual(['hatsuyuki', 'hatsuhinode', 'ume'])
  })
  it('期間外は含めない', () => {
    expect(eventsBetween('2026-06-16T00:00:00.000Z', '2026-07-01T00:00:00.000Z')).toEqual([])
  })
})

describe('sceneryMarks（点景の位置＝葉と葉の間に時間割合で置く）', () => {
  const NOW = '2026-08-01T00:00:00.000Z'
  it('最初の葉より前の点景は置かない', () => {
    const leaves = [leaf('2026-07-01T00:00:00.000Z'), leaf('2026-07-30T00:00:00.000Z')]
    const marks = sceneryMarks(leaves, NOW)
    expect(marks.map((m) => m.kind)).toEqual(['semi']) // 7/20だけ。6/15の蛍は蔓が始まる前
  })
  it('葉が伸びなかった期間の点景は同じ葉間に重なる（leafIndexが同じ）', () => {
    const leaves = [leaf('2026-03-01T00:00:00.000Z'), leaf('2026-07-30T00:00:00.000Z')]
    const marks = sceneryMarks(leaves, NOW)
    // 3/28 桜・4/20 つばめ・5/20 若葉・6/15 蛍・7/20 蝉——全部 葉1と葉2の間
    expect(marks).toHaveLength(5)
    expect(new Set(marks.map((m) => m.leafIndex))).toEqual(new Set([1]))
    // yは葉1と葉2の間（14pxの帯の中）で単調（新しいほど上=小さい）
    const ys = marks.map((m) => m.y)
    expect(Math.max(...ys)).toBeLessThanOrEqual(leafY(1, 2))
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(leafY(2, 2) - PX_PER_LEAF)
    expect([...ys].sort((a, b) => b - a)).toEqual(ys)
  })
  it('最後の葉より新しい点景は穂先の上1葉ぶんに圧縮して置く', () => {
    const leaves = [leaf('2026-06-01T00:00:00.000Z')]
    const marks = sceneryMarks(leaves, NOW) // 6/15 蛍・7/20 蝉が葉より新しい
    expect(marks.map((m) => m.kind)).toEqual(['hotaru', 'semi'])
    for (const m of marks) {
      expect(m.y).toBeLessThan(leafY(1, 1))
      expect(m.y).toBeGreaterThanOrEqual(leafY(1, 1) - PX_PER_LEAF)
    }
  })
  it('葉0なら空', () => {
    expect(sceneryMarks([], NOW)).toEqual([])
  })
})
```

- [ ] **Step 2: RED確認** `npx vitest run src/lib/__tests__/vine-scenery.test.ts` → FAIL

- [ ] **Step 3: 実装**（新規 `src/lib/vine-scenery.ts`）

```ts
// 時間の点景（正典§7の二層の下段）。実時間に紐づく季節の出来事で、誰にでも訪れる。
// 高さの印（実物ラダー）が年1〜8回の「稀で大きい」出会いなのに対し、点景は年12回の小さな出会い。
// 通知はしない——開いたときに見つけるもの。件数を数字でUIに出さない。
// 暦は固定月日・自然物のみ（行事・人工物は世界の嘘になる）。満月は毎月あって印が安売りになるので名月だけ。
import type { Step } from './tower-steps'
import { leafY, PX_PER_LEAF } from './vine-scroll'

export type SceneryEvent = { m: number; d: number; kind: string; label: string }
export const SCENERY_ALMANAC: readonly SceneryEvent[] = [
  { m: 1, d: 1, kind: 'hatsuhinode', label: '初日の出' },
  { m: 2, d: 20, kind: 'ume', label: '梅' },
  { m: 3, d: 28, kind: 'sakura', label: '桜' },
  { m: 4, d: 20, kind: 'tsubame', label: 'つばめ' },
  { m: 5, d: 20, kind: 'wakaba', label: '若葉' },
  { m: 6, d: 15, kind: 'hotaru', label: '蛍' },
  { m: 7, d: 20, kind: 'semi', label: '蝉しぐれ' },
  { m: 8, d: 12, kind: 'nagareboshi', label: '流れ星' },
  { m: 9, d: 15, kind: 'meigetsu', label: '名月' },
  { m: 10, d: 15, kind: 'kari', label: '雁' },
  { m: 11, d: 15, kind: 'momiji', label: '紅葉' },
  { m: 12, d: 10, kind: 'hatsuyuki', label: '初雪' },
]

const pad2 = (n: number) => String(n).padStart(2, '0')

// 期間内（from < t <= to）の点景を古い順に。日付はJSTで解釈する（日本の季節の暦）。
export function eventsBetween(fromIso: string, toIso: string): { kind: string; label: string; at: string }[] {
  const from = Date.parse(fromIso)
  const to = Date.parse(toIso)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return []
  const out: { kind: string; label: string; at: string; t: number }[] = []
  const y0 = new Date(from).getUTCFullYear() - 1
  const y1 = new Date(to).getUTCFullYear() + 1
  for (let y = y0; y <= y1; y++) {
    for (const e of SCENERY_ALMANAC) {
      const at = `${y}-${pad2(e.m)}-${pad2(e.d)}T00:00:00+09:00`
      const t = Date.parse(at)
      if (t > from && t <= to) out.push({ kind: e.kind, label: e.label, at, t })
    }
  }
  return out.sort((a, b) => a.t - b.t).map(({ kind, label, at }) => ({ kind, label, at }))
}

export type SceneryMark = { kind: string; label: string; at: string; leafIndex: number; y: number }

// 点景の位置。葉kと葉k+1の間に、時間割合で置く（縦位置は葉の番号が基準＝正典§3を崩さない）。
// 葉が伸びなかった期間は同じ14pxの帯に重なる——空白が空白として読める（正典§7）。
// 最初の葉より前は置かない（蔓の記録が始まる前は蔓に無い）。
// 最後の葉より新しい分は穂先の上1葉ぶんに圧縮する——止まった人にも何かが起きる。
// ⚠️ leaves は leafSteps 済み（地上・attempt抜き）が契約。
export function sceneryMarks(leaves: Step[], nowIso: string): SceneryMark[] {
  const total = leaves.length
  if (total === 0) return []
  const times = leaves.map((s) => Date.parse(s.at)).filter(Number.isFinite).sort((a, b) => a - b)
  if (times.length === 0) return []
  const now = Date.parse(nowIso)
  const events = eventsBetween(new Date(times[0]).toISOString(), nowIso)
  return events.map((e) => {
    const t = Date.parse(e.at)
    let k = 0
    while (k < times.length && times[k] <= t) k++
    // k = tより古い葉の数（>=1。最初の葉より前はeventsBetweenが弾いている）
    let fraction: number
    if (k >= times.length) {
      const span = now - times[times.length - 1]
      fraction = span > 0 ? Math.max(0, Math.min(1, (t - times[times.length - 1]) / span)) : 0.5
    } else {
      const span = times[k] - times[k - 1]
      fraction = span > 0 ? (t - times[k - 1]) / span : 0.5
    }
    const kIndex = Math.min(k, total)
    return { kind: e.kind, label: e.label, at: e.at, leafIndex: kIndex, y: leafY(kIndex, total) - fraction * PX_PER_LEAF }
  })
}
```

- [ ] **Step 4: GREEN確認** → PASS
- [ ] **Step 5: コミット** `git add -A && git commit -m "知の蔓: 季節の暦と点景の位置（vine-scenery）"`

---

### Task 2: 文言の禁に暦を通す

**Files:**
- Modify: `src/lib/vine-copy.ts`
- Test: `src/lib/__tests__/vine-copy.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { SCENERY_ALMANAC } from '../vine-scenery'
// describe('文言') 内に追加:
  it('点景の名前がすべて禁の走査対象に載っている', () => {
    for (const e of SCENERY_ALMANAC) expect(ALL_VINE_COPY).toContain(e.label)
  })
```

- [ ] **Step 2: RED確認** → FAIL

- [ ] **Step 3: 実装**（vine-copy.ts）

```ts
import { SCENERY_ALMANAC } from './vine-scenery' // 冒頭へ
// ALL_VINE_COPY 末尾に:
  ...SCENERY_ALMANAC.map((e) => e.label),
```

- [ ] **Step 4: GREEN確認**（六つの禁の4走査も通ること） → PASS
- [ ] **Step 5: コミット** `git add -A && git commit -m "知の蔓: 点景の名前を六つの禁の走査に載せる"`

---

### Task 3: laneMarks — 右レーンを1本に統合（地雷2・4・5）

**Files:**
- Modify: `src/lib/vine-scroll.ts`（`sceneMarks` を削除し `laneMarks` を新設）
- Test: `src/lib/__tests__/vine-scroll.test.ts`（sceneMarksのdescribeを差し替え）

**Interfaces:**
- Produces:

```ts
export const MIN_SCENERY_GAP = 12
export type LaneMark =
  | { type: 'milestone'; y: number; milestone: Milestone; withLabel: boolean }
  | { type: 'scenery'; y: number; label: string; withLabel: boolean }
  | { type: 'undergroundDone'; y: number; withLabel: true }
export function laneMarks(
  aboveTotal: number,
  scenery: { y: number; label: string }[],
  undergroundDoneY: number | null,
): LaneMark[]
```

優先度: undergroundDone ＞ 実物の印 ＞ 点景。**間引くのはラベルだけで、印そのもの（tick/点）は全件返す**（地雷5：目次から飛んだ先に必ず刻みがある）。

- [ ] **Step 1: 失敗するテストを書く**（`sceneMarks` の describe を丸ごと以下に差し替え）

```ts
describe('右レーンの統合（laneMarks・地雷2/4/5）', () => {
  it('実物の印は全件返る（ラベルを間引いても刻みは消えない）', () => {
    const lane = laneMarks(200, [], null)
    const ms = lane.filter((m) => m.type === 'milestone')
    expect(ms.length).toBe(markPositions(200).length) // 8件全部
  })
  it('密集した組では古いほう（アリ）のラベルが落ち、新しいほう（テントウムシ）が残る', () => {
    const lane = laneMarks(200, [], null)
    const byLabel = (label: string) =>
      lane.find((m) => m.type === 'milestone' && m.milestone.label === label) as { withLabel: boolean }
    expect(byLabel('アリ').withLabel).toBe(false)
    expect(byLabel('テントウムシ').withLabel).toBe(true)
  })
  it('ラベル付きの実物の印どうしはMIN_MARK_GAP以上あく', () => {
    const labeled = laneMarks(200, [], null).filter((m) => m.type === 'milestone' && m.withLabel)
    for (let i = 1; i < labeled.length; i++) {
      expect(Math.abs(labeled[i].y - labeled[i - 1].y)).toBeGreaterThanOrEqual(MIN_MARK_GAP)
    }
  })
  it('点景のラベルは実物の印のラベルに近すぎると落ちる（点は残る）', () => {
    const suzumeY = leafY(50, 60) // スズメの位置
    const lane = laneMarks(60, [{ y: suzumeY + 4, label: '蛍' }], null)
    const sc = lane.find((m) => m.type === 'scenery') as { withLabel: boolean }
    expect(sc).toBeDefined()
    expect(sc.withLabel).toBe(false)
  })
  it('離れた点景はラベルつき・点景どうしもMIN_SCENERY_GAPで間引く', () => {
    const lane = laneMarks(60, [
      { y: 300, label: '蛍' }, { y: 306, label: '蝉しぐれ' }, { y: 340, label: '名月' },
    ], null)
    const scs = lane.filter((m) => m.type === 'scenery')
    expect(scs.map((m) => m.withLabel)).toEqual([true, false, true])
  })
  it('地下が尽きた日のラベルは常に残り、近い点景のラベルが譲る', () => {
    const lane = laneMarks(10, [{ y: 500, label: '初雪' }], 504)
    expect(lane.find((m) => m.type === 'undergroundDone')).toBeDefined()
    const sc = lane.find((m) => m.type === 'scenery') as { withLabel: boolean }
    expect(sc.withLabel).toBe(false)
  })
  it('yの昇順（新しい順）で返る', () => {
    const lane = laneMarks(60, [{ y: 300, label: '蛍' }], 900)
    const ys = lane.map((m) => m.y)
    expect([...ys].sort((a, b) => a - b)).toEqual(ys)
  })
})
```

import 行に `laneMarks, MIN_SCENERY_GAP` を追加し `sceneMarks` を外す。

- [ ] **Step 2: RED確認** → FAIL

- [ ] **Step 3: 実装**（vine-scroll.ts の `MIN_MARK_GAP`〜`sceneMarks` を差し替え）

```ts
// 印は1つにつき2行の文字を持つので、これ未満に近づくと重なる。
export const MIN_MARK_GAP = 28
// 点景のラベルは1行なので狭くてよい。
export const MIN_SCENERY_GAP = 12

export type LaneMark =
  | { type: 'milestone'; y: number; milestone: Milestone; withLabel: boolean }
  | { type: 'scenery'; y: number; label: string; withLabel: boolean }
  | { type: 'undergroundDone'; y: number; withLabel: true }

// 右レーン（蔓の脇の印の帯）を1本で整列する（地雷2の解消）。
// 実物の印・時間の点景・地下が尽きた日は同じ余白に住むので、置けるラベルをここで一元に決める。
// 優先度: 地下が尽きた日 ＞ 実物の印（新しい側優先） ＞ 点景（新しい側優先）。
// ⚠️ 間引くのはラベルだけ。印そのもの（刻み・点）は全件返す——目次から飛んだ先には必ず刻みがある（地雷5）。
export function laneMarks(
  aboveTotal: number,
  scenery: { y: number; label: string }[],
  undergroundDoneY: number | null,
): LaneMark[] {
  const labeledYs: { y: number; gap: number }[] = []
  const canPlace = (y: number, gap: number) => labeledYs.every((l) => Math.abs(l.y - y) >= Math.max(gap, l.gap))
  const place = (y: number, gap: number) => labeledYs.push({ y, gap })

  const out: LaneMark[] = []
  if (undergroundDoneY !== null) {
    place(undergroundDoneY, MIN_MARK_GAP)
    out.push({ type: 'undergroundDone', y: undergroundDoneY, withLabel: true })
  }
  // 実物の印: 新しい側（yが小さい側）からラベルを配る
  const ms = markPositions(aboveTotal)
  for (let i = ms.length - 1; i >= 0; i--) {
    const m = ms[i]
    const withLabel = canPlace(m.y, MIN_MARK_GAP)
    if (withLabel) place(m.y, MIN_MARK_GAP)
    out.push({ type: 'milestone', y: m.y, milestone: m.milestone, withLabel })
  }
  // 点景: 新しい側からラベルを配る（実物の印より弱い）
  const sc = [...scenery].sort((a, b) => a.y - b.y)
  for (const s of sc) {
    const withLabel = canPlace(s.y, MIN_SCENERY_GAP)
    if (withLabel) place(s.y, MIN_SCENERY_GAP)
    out.push({ type: 'scenery', y: s.y, label: s.label, withLabel })
  }
  return out.sort((a, b) => a.y - b.y)
}
```

- [ ] **Step 4: GREEN確認**（vine-scroll全テスト） → PASS
- [ ] **Step 5: コミット** `git add -A && git commit -m "知の蔓: 右レーンをlaneMarksに統合（地雷2・5）"`

---

### Task 4: 画面の配線（VineScene / VineScreen）

**Files:**
- Modify: `src/components/vine/VineScene.tsx`
- Modify: `src/components/vine/VineScreen.tsx`

**Interfaces:**
- Consumes: `laneMarks`・`LaneMark`（Task 3）、`sceneryMarks`（Task 1）
- Produces: VineScene 新prop `scenery: { y: number; label: string }[]`

- [ ] **Step 1: VineScene**

import を差し替え: `sceneMarks` → `laneMarks`。props に `scenery: { y: number; label: string }[]` を追加。

`const marks = useMemo(() => sceneMarks(to), [to])` を:

```ts
  // 右レーンは1本の関数が整列する（地雷2）。実物の印・点景・地下が尽きた日が同じ余白に住む。
  const doneY = undergroundClearedAt && undergroundCount > 0 ? gY + 18 : null
  const lane = useMemo(() => laneMarks(to, scenery, doneY), [to, scenery, doneY])
```

実物の印の描画ブロック（`{marks.map((m) => (...))}`）を lane 全体の描画に差し替え:

```tsx
      {/* 右レーン: 越えた印（§4）・時間の点景（§7）・地下が尽きた日。laneMarksが一元整列。
          ラベルは間引かれても刻み・点は全件描く——目次から飛んだ先には必ず何かがある。
          ラベルは右端アンカー（textAnchor=end）＝長い名前でも右で切れない（地雷4）。 */}
      {lane.map((m, i) => {
        if (m.type === 'milestone') {
          return (
            <g key={`lane-${i}`}>
              <line x1={24} x2={24} y1={m.y - 5} y2={m.y + 5} stroke={SHU} strokeWidth={2.2} />
              {m.withLabel && (
                <>
                  <line x1={24} x2={W - 96} y1={m.y} y2={m.y} stroke={SHU} strokeWidth={1.2} strokeDasharray="5 4" opacity={0.75} />
                  <text x={W - 8} y={m.y + 3.5} fontSize={10} fill={SHU} textAnchor="end">
                    {m.milestone.label} {m.milestone.sizeLabel}
                  </text>
                  <text x={W - 8} y={m.y + 15} fontSize={8} fill={USUZUMI} textAnchor="end">{m.milestone.measure}</text>
                </>
              )}
            </g>
          )
        }
        if (m.type === 'scenery') {
          return (
            <g key={`lane-${i}`} opacity={0.8}>
              <circle cx={W - 14} cy={m.y} r={2} fill={USUZUMI} />
              {m.withLabel && (
                <text x={W - 22} y={m.y + 2.5} fontSize={8} fill={USUZUMI} textAnchor="end">{m.label}</text>
              )}
            </g>
          )
        }
        return (
          <g key={`lane-${i}`} opacity={0.85}>
            <text x={W - 8} y={m.y} fontSize={9} fill={USUZUMI} textAnchor="end">{undergroundDoneLine()}</text>
            <text x={W - 8} y={m.y + 12} fontSize={8} fill={USUZUMI} textAnchor="end">
              {kanjiDate(new Date(undergroundClearedAt))}
            </text>
          </g>
        )
      })}
```

旧・地下が尽きた日の描画ブロック（地下茎の `<>` 内の `{undergroundClearedAt && (...)}`）は**削除**（レーンに移った）。

朱の刻み（crossedNow）の `marks[marks.length - 1].y` は、間引き前の全印の最新へ:

```tsx
      {crossedNow && lane.some((m) => m.type === 'milestone') && (
        <text
          x={18}
          y={(lane.find((m) => m.type === 'milestone') as { y: number }).y - 8}
          fontSize={9} fill={SHU}
          style={{ writingMode: 'vertical-rl' as const }}
        >
          {kanjiDate(new Date())}
        </text>
      )}
```

（laneはy昇順なので `find` が最も新しい＝最上の実物の印）

- [ ] **Step 2: VineScreen**

import に `sceneryMarks`（`@/lib/vine-scenery`）を追加し、`rereads` の下に:

```ts
  // 時間の点景（正典§7）。実時間に紐づく小さな出会い。通知はしない——開いたとき見つけるもの
  const scenery = useMemo(() => sceneryMarks(aboveLeaves, nowIso), [aboveLeaves, nowIso])
```

⚠️ `nowIso` の useMemo 宣言は `scenery` より上に移動が必要なら移動する（現状 `nowIso` は marks の下にあるので、`scenery` はその後に置けばよい）。

`<VineScene ...>` に `scenery={scenery.map((s) => ({ y: s.y, label: s.label }))}` を追加。

- [ ] **Step 3: 型検査・全テスト** `npx tsc --noEmit && npx vitest run src/lib/__tests__/` → PASS
- [ ] **Step 4: コミット** `git add -A && git commit -m "知の蔓: 時間の点景を右レーンに描く"`

---

### Task 5: devハーネス＋目視

**Files:**
- Modify: `src/app/dev/vine/page.tsx`

- [ ] **Step 1: シナリオ追加**（休みの空白に点景が重なる形）

```ts
function mkSpread(spec: { daysAgo: number; n: number }[]): Step[] {
  const out: Step[] = []
  let i = 0
  for (const { daysAgo, n } of spec) {
    for (let j = 0; j < n; j++) {
      out.push({
        id: `sp-${i}`, kind: 'recall',
        at: new Date(Date.now() - (daysAgo - j) * 86_400_000).toISOString(),
        genre: 'dev', title: `季節の知識 ${++i}`,
      })
    }
  }
  return out
}
```

SCENARIOSに:

```ts
  '点景の一年（4ヶ月の休みつき）': {
    steps: mkSpread([{ daysAgo: 400, n: 20 }, { daysAgo: 120, n: 15 }]),
    lastSeenSteps: 35, lastSeenAt: '', backfilledAt: 'dev',
    joinedAt: '', undergroundClearedAt: '', levels: {},
  },
```

（400〜380日前に20枚 → 約8ヶ月の空白 → 120〜105日前に15枚 → 今日まで約3ヶ月の空白。空白部に点景の点が連なって見えるはず）

- [ ] **Step 2: 目視**（`medinode-3031` を preview_start → `/dev/vine`）

- 点景の一年: 空白区間に薄墨の点が並び、余裕がある所は名前つき・密集所は点だけ
- 大量バックフィル（+80枚）: 実物の印のラベルが右端で切れていない・アリの位置に刻みだけ残る
- 地下が尽きた日: 「みな芽を出した」が右端アンカーで出る

- [ ] **Step 3: コミット** `git add -A && git commit -m "知の蔓: devハーネスに点景の一年"`

---

### Task 6: 総検証・引き継ぎ更新・ブランチ仕舞い

- [ ] **Step 1:** `npx tsc --noEmit && npm test 2>&1 | grep "Tests " && npm run build 2>&1 | tail -3` → すべて成功
- [ ] **Step 2: HANDOFF更新** — フェーズ5を✅・地雷2/4/5を解消済みに・点景の暦（12項目表）とsceneryMarksの契約（leafSteps済みを渡す）を追記。オーナー確認事項: 蔓の右レーンに季節の点が出るか（葉が2枚以上・数ヶ月分の記録がある端末で）・実物の印のラベルが読めるか
- [ ] **Step 3: マージとpush**

```bash
git checkout main && git pull --ff-only && git merge --no-ff feat/chi-no-tsuru-v2-scenery -m "Merge branch 'feat/chi-no-tsuru-v2-scenery'" && npx vitest run src/lib/__tests__/ 2>&1 | grep "Tests " && git push && git branch -d feat/chi-no-tsuru-v2-scenery
```

---

## 検証について（正直な限界）

点景の見た目（空白との重なり・ラベルの間引き）はdevハーネスで確認できる。実データでの密度感（年12回が多すぎないか）はオーナーの実機でしか分からない。空と住人の絵はアセットフェーズ送り——点景はそれまで薄墨の点。

## このあと

| # | 内容 | spec |
|---|---|---|
| — | アセット差し替え（筆致PNG・芽のクロスフェード・点景の絵＝空と住人）・雲の先（§8「測るのをやめる」＝地雷3が残存） | §8・発注書 |
