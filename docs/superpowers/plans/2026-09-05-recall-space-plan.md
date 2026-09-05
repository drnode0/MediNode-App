# Recall「さらに宇宙へ」（隠しコマンド第2段）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 分野ページの紋章で浮き出る球（隠しコマンド D5）の下に「さらに宇宙へ」を置き、押すと 7 族ごとの星団に散らばった惑星が自転しながら浮く宇宙（遠景）へ引く。宇宙で惑星を押すとその球へ飛べる。

**Architecture:** 既存の `RecallField`（canvas・カメラ・操作）をそのまま使い、席の位置を返す純関数に3つ目の配置モード `'cluster'` を足す。覆い `RecallLift` は状態（球／宇宙／宇宙から入った球）を持ち、`RecallField` の `backToFar` と `onStage` で行き来する。設計書: `docs/superpowers/specs/2026-09-05-recall-space-design.md`。

**Tech Stack:** Next.js（App Router）・React・TypeScript・canvas 2D・vitest・Python playwright（導入済み・chromium あり。Node 側の playwright は無い）

## Global Constraints

- 公開リポジトリ。事業数値・税務・健康・家族に関することをファイル・コミット文・コメントに書かない
- push は毎回 tatsuki さんの承認を取る。コミットは自由
- **worktree で作業する**。dev server は worktree 内で `npm run dev -- -p 3216` を別ポートで立てる（Browser pane は worktree の変更を映さない）
- **段0（dev ハーネスのラフ）で tatsuki さんの承認を取ってから Task 4 以降へ進む**（記憶 recall-seven-cores「見た目の案は絵でなく回るコードで出す」）。承認の観点: 7つの星団が見分けられるか／惑星が重なっていないか／スマホ幅で惑星が小さすぎないか／自転の速さ
- 設計の決定 S1〜S6（設計書 §1）を変えない。宇宙の「戻る」は覆いを閉じて分野ページへ（S5）。帯・視点B・改訂の旗・一覧の紋章から球を出すことは範囲外
- 使わない語（画面・コメント）: 振る・拾う・血肉・落ちる・定着・輪（宇宙の文脈では「星団」「宇宙」）。長いダッシュ（二重の横線）を使わない
- 族名は英語（Flow / Exchange / Signal / Invasion / Structure / Regulation / System）。`coreEnglishOf(kind)`（`genre-en.ts`）が返す
- コミット文の末尾: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`
- テストの実行: `npx vitest run <file>`。全件は `npm test`

## ファイル構成

| ファイル | 役割 | タスク |
|---|---|---|
| `src/lib/recall/field-cluster.ts` | 新規。族の中心 7 点と席の位置（純関数・描画を知らない） | 1 |
| `src/lib/recall/field.ts` | `FieldMode` に `'cluster'`。`ringPointOf` の分岐 | 2 |
| `src/lib/recall/field-render.ts` | 遠景のときだけ星団の名前を描く（`clusterLabels`） | 3 |
| `src/components/recall/RecallField.tsx` | `mode` prop・`backToFar()`・星団の名前を渡す | 3 |
| `src/app/dev/recall-field/page.tsx` | 「配置: 輪／星団」「宇宙へ」（段0のラフ） | 3 |
| `src/lib/recall/lift-phase.ts` | 新規。覆いの状態遷移（純関数） | 4 |
| `src/components/recall/useFieldData.ts` | 星団配置の `clusterPlanets` も返す | 5 |
| `src/components/recall/RecallLift.tsx` | 「さらに宇宙へ」・宇宙の「戻る」・見出しの出し分け | 5 |
| `src/components/recall/RecallScreen.tsx` | `RecallLift` に `clusterPlanets` を渡す | 5 |
| `src/lib/__tests__/recall-field-cluster.test.ts` | 1・2 のテスト | 1・2 |
| `src/lib/__tests__/recall-field-render.test.ts` | 3 のテスト | 3 |
| `src/lib/__tests__/recall-lift-phase.test.ts` | 4 のテスト | 4 |

---

### Task 0: worktree と dev server

- [ ] **Step 1: worktree**

```bash
cd ~/MediNode-本体 && git worktree add .claude/worktrees/recall-space -b recall-space main && cd .claude/worktrees/recall-space && npm install --no-audit --no-fund 2>&1 | tail -2 && npm test 2>&1 | tail -3
```

Expected: 全件 PASS（`admin-engagement-route.test.ts` が日本時間 0〜9 時に落ちるのは既知）

- [ ] **Step 2: dev server（`run_in_background`）**

Run: `npm run dev -- -p 3216`
確認: `curl -s -o /dev/null -w '%{http_code}' http://localhost:3216/dev/recall-field` が 200

---

### Task 1: 星団の配置（純関数）

**Files:**
- Create: `src/lib/recall/field-cluster.ts`
- Test: `src/lib/__tests__/recall-field-cluster.test.ts`

**Interfaces:**
- Produces:
  - `CLUSTER_KINDS: CoreKind[]`（7族の順）
  - `CLUSTER_SPREAD = 0.3`（族の中心から惑星までの距離）
  - `clusterCenterOf(kind: CoreKind): Vec3`（族の中心。単位球の上、上下は 0.55 倍に潰す）
  - `clusterPointOf(slot: number): Vec3`（席の位置。同じ族の席は中心のまわりの小さな円に席番号順で等間隔・ごく小さなずれ）
  - `clusterLabelsOf(): Array<{ kind: CoreKind; at: Vec3; text: string }>`（星団の名前。`text` は英語の族名）

**設計:** 族の中心は黄金角の螺旋で 7 点を球面に置く（互いに離れる近似）。同じ族の席は、中心を通る面（中心方向を法線にした面）の上の半径 `CLUSTER_SPREAD` の円に等間隔で置く。円が中心方向を向くので、正面の星団は円に見え、横の星団は細く見えて奥行きが出る。席番号のハッシュで法線方向に ±0.04 ずらし、きれいすぎる円にしない。乱数は使わず、同じ入力で同じ位置。

- [ ] **Step 1: テストを書く**

`src/lib/__tests__/recall-field-cluster.test.ts`:

```ts
// 宇宙（隠しコマンド第2段）の星団配置。描画はテストできないので位置の判断だけをここで確かめる。
// 設計: docs/superpowers/specs/2026-09-05-recall-space-design.md §3
import { describe, it, expect } from 'vitest'
import {
  CLUSTER_KINDS, CLUSTER_SPREAD, clusterCenterOf, clusterPointOf, clusterLabelsOf,
} from '@/lib/recall/field-cluster'
import { GENRE_SEATS, isRetiredSeat } from '@/lib/recall/genres'
import { coreKindOf } from '@/lib/recall/cores'

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const liveSlots = GENRE_SEATS.map((_, i) => i).filter((s) => !isRetiredSeat(s))

describe('族の中心', () => {
  it('7族ぶんあり、互いに 0.75 以上離れている', () => {
    expect(CLUSTER_KINDS.length).toBe(7)
    for (let i = 0; i < 7; i++) for (let j = i + 1; j < 7; j++) {
      expect(dist(clusterCenterOf(CLUSTER_KINDS[i]), clusterCenterOf(CLUSTER_KINDS[j]))).toBeGreaterThan(0.75)
    }
  })
  it('原点から 0.7〜1.0 の距離にある（見る先＝原点から極端に遠くならない）', () => {
    for (const k of CLUSTER_KINDS) {
      const r = dist(clusterCenterOf(k), [0, 0, 0])
      expect(r).toBeGreaterThan(0.7)
      expect(r).toBeLessThanOrEqual(1.0 + 1e-9)
    }
  })
})

describe('席の位置', () => {
  it('同じ入力で同じ位置（開くたびに変わらない）', () => {
    for (const s of liveSlots) expect(clusterPointOf(s)).toEqual(clusterPointOf(s))
  })
  it('自分の族の中心から CLUSTER_SPREAD + 0.05 以内', () => {
    for (const s of liveSlots) {
      expect(dist(clusterPointOf(s), clusterCenterOf(coreKindOf(s)))).toBeLessThan(CLUSTER_SPREAD + 0.05)
    }
  })
  it('どの2席も 0.2 以上離れている（fitScale で惑星が縮みすぎない）', () => {
    for (let i = 0; i < liveSlots.length; i++) for (let j = i + 1; j < liveSlots.length; j++) {
      expect(dist(clusterPointOf(liveSlots[i]), clusterPointOf(liveSlots[j]))).toBeGreaterThan(0.2)
    }
  })
})

describe('星団の名前', () => {
  it('7つ。英語の族名で、位置は族の中心', () => {
    const labels = clusterLabelsOf()
    expect(labels.map((l) => l.text)).toEqual(['Flow', 'Exchange', 'Signal', 'Invasion', 'Structure', 'Regulation', 'System'])
    for (const l of labels) expect(l.at).toEqual(clusterCenterOf(l.kind))
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/recall-field-cluster.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装**

`src/lib/recall/field-cluster.ts`:

```ts
// 宇宙（隠しコマンド第2段）の星団配置（純関数）。canvas を知らない。
//
// 7族の中心を球面に散らし、同じ族の席はその中心のまわりの小さな円に席番号順で置く。
// 乱数は使わない（同じ入力で同じ位置。開くたびに惑星が動かない）。
// 設計: docs/superpowers/specs/2026-09-05-recall-space-design.md §3
import type { Vec3 } from './layout'
import { coreKindOf, type CoreKind } from './cores'
import { GENRE_SEATS, isRetiredSeat } from './genres'
import { coreEnglishOf } from './genre-en'

export const CLUSTER_KINDS: CoreKind[] = ['flow', 'exchange', 'signal', 'invasion', 'structure', 'regulation', 'system']

// 族の中心から惑星までの距離。族の中心どうしの最短距離（≈ 0.8）の 0.35 倍程度。
// 大きくすると星団が混ざり、小さくすると fitScale（field.ts）が惑星を縮める。
export const CLUSTER_SPREAD = 0.3
// 上下方向の潰し。見下ろす傾き（RING_PITCH）で帯に潰れず、上下に散りすぎない値。
const FLATTEN_Y = 0.55
// 席ごとの法線方向のずれ。きれいすぎる円にしないための小さな値。
const WOBBLE = 0.04
const GOLDEN = 2.399963

const norm = (v: Vec3): Vec3 => {
  const L = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / L, v[1] / L, v[2] / L]
}
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

// 席番号から決まる 0..1。乱数ではない（同じ席は同じ値）。
function hash01(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  h ^= h >>> 13
  h = Math.imul(h, 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

// 族の中心。黄金角の螺旋で 7 点を球面に置き、上下を潰す。
export function clusterCenterOf(kind: CoreKind): Vec3 {
  const i = Math.max(0, CLUSTER_KINDS.indexOf(kind))
  const n = CLUSTER_KINDS.length
  const y = 1 - (2 * (i + 0.5)) / n
  const r = Math.sqrt(1 - y * y)
  const a = i * GOLDEN
  return [r * Math.cos(a), y * FLATTEN_Y, r * Math.sin(a)]
}

// 同じ族の席（退役席を除く）を席番号順に。
function membersOf(kind: CoreKind): number[] {
  const out: number[] = []
  for (let s = 0; s < GENRE_SEATS.length; s++) {
    if (isRetiredSeat(s)) continue
    if (coreKindOf(s) === kind) out.push(s)
  }
  return out
}

// 席の位置。族の中心を通り中心方向を法線とする面の上の円に、等間隔で置く。
export function clusterPointOf(slot: number): Vec3 {
  const kind = coreKindOf(slot)
  const c = clusterCenterOf(kind)
  const members = membersOf(kind)
  const k = Math.max(0, members.indexOf(slot))
  const m = Math.max(1, members.length)
  const nrm = norm(c)
  const up: Vec3 = Math.abs(nrm[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
  const t1 = norm(cross(nrm, up))
  const t2 = cross(nrm, t1)
  const a = (k / m) * Math.PI * 2 + hash01(slot) * 0.3
  const w = (hash01(slot * 7 + 3) - 0.5) * 2 * WOBBLE
  return [
    c[0] + CLUSTER_SPREAD * (Math.cos(a) * t1[0] + Math.sin(a) * t2[0]) + nrm[0] * w,
    c[1] + CLUSTER_SPREAD * (Math.cos(a) * t1[1] + Math.sin(a) * t2[1]) + nrm[1] * w,
    c[2] + CLUSTER_SPREAD * (Math.cos(a) * t1[2] + Math.sin(a) * t2[2]) + nrm[2] * w,
  ]
}

// 星団の名前（遠景でだけ描く）。位置は族の中心、文字は英語の族名。
export function clusterLabelsOf(): Array<{ kind: CoreKind; at: Vec3; text: string }> {
  return CLUSTER_KINDS.map((kind) => ({ kind, at: clusterCenterOf(kind), text: coreEnglishOf(kind) }))
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/recall-field-cluster.test.ts`
Expected: PASS。「互いに 0.75 以上」「どの2席も 0.2 以上」が落ちたら、値を見て `FLATTEN_Y`（0.55→0.7）か `CLUSTER_SPREAD`（0.3→0.26）を動かす。しきい値そのものは緩めない（星団が混ざる・惑星が縮む、のどちらかが起きる）

- [ ] **Step 5: コミット**

```bash
git add src/lib/recall/field-cluster.ts src/lib/__tests__/recall-field-cluster.test.ts
git commit -m "feat(recall): 宇宙の星団配置（族ごとの中心と席の位置）を純関数で足す

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 配置モード `'cluster'`

**Files:**
- Modify: `src/lib/recall/field.ts:24`（`FieldMode`）・`:53-57`（`ringPointOf`）
- Test: `src/lib/__tests__/recall-field-cluster.test.ts`

**Interfaces:**
- Produces: `FieldMode = 'ring' | 'sphere' | 'cluster'`。`fieldLayout(counts, 'cluster')` が全席（退役席を除く）を星団配置で返す。`focusPointOf('cluster', …)` は原点（既存の「ring 以外は原点」のまま）

- [ ] **Step 1: テストを足す**

`recall-field-cluster.test.ts` に:

```ts
import { fieldLayout, focusPointOf } from '@/lib/recall/field'
import { R_RING_OUTER } from '@/lib/recall/field-layout'

describe("fieldLayout(counts, 'cluster')", () => {
  const counts = new Array(GENRE_SEATS.length).fill(0)
  counts[2] = 34; counts[3] = 178; counts[12] = 97; counts[21] = 30
  const seats = fieldLayout(counts, 'cluster')

  it('退役席を除く全席が星団の位置で返る', () => {
    expect(seats.map((s) => s.slot)).toEqual(liveSlots)
    for (const s of seats) expect(s.at).toEqual(clusterPointOf(s.slot))
  })
  it('fitScale の後で惑星どうしが重ならない', () => {
    for (let i = 0; i < seats.length; i++) for (let j = i + 1; j < seats.length; j++) {
      const a = seats[i], b = seats[j]
      expect(dist(a.at, b.at)).toBeGreaterThanOrEqual((a.r + b.r) * R_RING_OUTER * 0.98 - 1e-9)
    }
  })
  it('見る先は原点', () => {
    expect(focusPointOf('cluster', 1.2)).toEqual([0, 0, 0])
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/recall-field-cluster.test.ts`
Expected: FAIL（型エラーか、位置が輪のまま）

- [ ] **Step 3: 実装**

`src/lib/recall/field.ts`:

```ts
import { clusterPointOf } from './field-cluster'
…
// 並べ方。ring が既定（09-03 決定）。sphere は球の配置をそのまま使う逃げ道。
// cluster は宇宙（隠しコマンド第2段・2026-09-05）: 族ごとの星団に散らす。
export type FieldMode = 'ring' | 'sphere' | 'cluster'
…
export function ringPointOf(slot: number, total: number, mode: FieldMode = 'ring'): Vec3 {
  if (mode === 'sphere') return seatCenter(slot)
  if (mode === 'cluster') return clusterPointOf(slot)
  const a = (slot / total) * Math.PI * 2
  return [Math.cos(a), 0, Math.sin(a)]
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/recall-field-cluster.test.ts src/lib/__tests__/recall-field-camera.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/recall/field.ts src/lib/__tests__/recall-field-cluster.test.ts
git commit -m "feat(recall): 配置モード cluster（星団）を fieldLayout に足す

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: RecallField に `mode`・`backToFar`・星団の名前。dev ハーネスで段0のラフ

**Files:**
- Modify: `src/lib/recall/field-render.ts:146-161`（`FieldFrameArgs`）・`:230-`（`drawField` の末尾）
- Modify: `src/components/recall/RecallField.tsx`（props・handle・カメラ呼び出し・frame）
- Modify: `src/app/dev/recall-field/page.tsx`
- Test: `src/lib/__tests__/recall-field-render.test.ts`

**Interfaces:**
- Consumes: `clusterLabelsOf()`（Task 1）・`FieldMode`（Task 2）
- Produces:
  - `FieldFrameArgs.clusterLabels?: Array<{ at: Vec3; text: string }>`（渡されて、かつ遠景＝`cam.zoom < STAGE_ZOOM_EDGE`・視点A のときだけ描く）
  - `RecallField` の props に `mode?: FieldMode`（既定 `'ring'`）
  - `FieldHandle.backToFar(): void`

- [ ] **Step 1: 名前の描画のテストを書く**

`recall-field-render.test.ts` の `recorder()` に `fillText` の記録を足す（既存の `fillText() {}` を置き換え）:

```ts
  const texts: string[] = []
  const ctx = {
    …（既存のまま）
    fillText(t: string) { texts.push(t) },
    …
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills, texts }
```

describe を足す:

```ts
import { FAR_ZOOM, MID_ZOOM } from '@/lib/recall/field-camera'

describe('星団の名前（宇宙・遠景）', () => {
  const labels = [{ at: [1, 0, 0] as [number, number, number], text: 'Flow' }]
  it('遠景では描き、中景では描かない', () => {
    const planet = planetWithDots([])
    const far = recorder()
    const frameFar = { ...frameOf(planet, DARK_PALETTE), clusterLabels: labels }
    frameFar.cam = { ...frameFar.cam, zoom: FAR_ZOOM }
    drawField(far.ctx, frameFar)
    expect(far.texts).toContain('FLOW')

    const mid = recorder()
    const frameMid = { ...frameOf(planet, DARK_PALETTE), clusterLabels: labels }
    frameMid.cam = { ...frameMid.cam, zoom: MID_ZOOM }
    drawField(mid.ctx, frameMid)
    expect(mid.texts).not.toContain('FLOW')
  })
  it('渡さなければ描かない', () => {
    const r = recorder()
    const frame = frameOf(planetWithDots([]), DARK_PALETTE)
    frame.cam = { ...frame.cam, zoom: FAR_ZOOM }
    drawField(r.ctx, frame)
    expect(r.texts).not.toContain('FLOW')
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/recall-field-render.test.ts`
Expected: FAIL（型エラー: `clusterLabels` が無い）

- [ ] **Step 3: field-render に名前の描画を足す**

`field-render.ts`。import に `STAGE_ZOOM_EDGE` を足す（`from './field-camera'`）と `CLUSTER_SPREAD`（`from './field-cluster'`）。`FieldFrameArgs` に:

```ts
  clusterLabels?: Array<{ at: Vec3; text: string }>  // 星団の名前（宇宙）。遠景でだけ描く
```

`drawField` の、惑星のループが終わって `return hits` の直前に:

```ts
  // 星団の名前（宇宙・隠しコマンド第2段）。遠景でだけ、星団の下に英語の族名を薄く出す。
  // 中景・近景では惑星の名前が担うので出さない。視点B は宇宙で使わない。
  if (a.clusterLabels && !inside && cam.zoom < STAGE_ZOOM_EDGE) {
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.font = '500 10px "Zen Kaku Gothic New",sans-serif'
    ctx.fillStyle = pal.label
    for (const l of a.clusterLabels) {
      const q = project(l.at)
      if (!q) continue
      const depth = 0.45 + 0.55 * ((1 - q.Z) / 2)
      ctx.globalAlpha = 0.4 * depth
      ctx.fillText(l.text.toUpperCase(), q.X, q.Y + q.k * (CLUSTER_SPREAD + 0.14))
    }
    ctx.textBaseline = 'alphabetic'
    ctx.globalAlpha = 1
  }
```

Run: `npx vitest run src/lib/__tests__/recall-field-render.test.ts`
Expected: PASS

- [ ] **Step 4: RecallField に `mode` と `backToFar` を足す**

`RecallField.tsx`:

(a) import:

```ts
import { clusterLabelsOf } from '@/lib/recall/field-cluster'
import type { FieldMode } from '@/lib/recall/field'
```

(b) `FieldHandle` に `backToFar: () => void` を足す。

(c) `Props` に:

```ts
  mode?: FieldMode             // 並べ方。既定は輪。宇宙（隠しコマンド第2段）は 'cluster'
```

(d) `useImperativeHandle` に `backToFar: () => { goStage('far', null) },` を足し、`jumpTo` の `cameraFor(cam.current, latest.current.center, …, null)` を `cameraFor(cam.current, latest.current.center, …, null, latest.current.mode ?? 'ring')` にする。

(e) `goStage` の `startFly(cameraFor(cam.current, P.center, next, seatOf(nearSlot.current)), FLY_MS)` を `startFly(cameraFor(cam.current, P.center, next, seatOf(nearSlot.current), P.mode ?? 'ring'), FLY_MS)` にする。

(f) 初期化の effect: `const initial = initialCamera(seats)` → `initialCamera(seats, props.mode ?? 'ring')`、`cameraFor(initial, props.center, 'near', nearSeat)` → `cameraFor(initial, props.center, 'near', nearSeat, props.mode ?? 'ring')`。視点切り替えの effect の `cameraFor(...)` にも `props.mode ?? 'ring'` を足す。

(g) frame の中景: `c.focus = focusPointOf('ring', c.rotY)` → `c.focus = focusPointOf(P.mode ?? 'ring', c.rotY)`。

(h) `drawField` の引数に:

```ts
        clusterLabels: P.mode === 'cluster' ? CLUSTER_LABELS : undefined,
```

（`const CLUSTER_LABELS = clusterLabelsOf()` をモジュール直下で1回だけ作る。位置は固定なので毎フレーム作らない）

Run: `npx tsc --noEmit -p . 2>&1 | head -5`
Expected: エラーなし

- [ ] **Step 5: dev ハーネスに「配置」と「宇宙へ」を足す（段0のラフ）**

`src/app/dev/recall-field/page.tsx`:

```tsx
import type { FieldCenter, FieldStage, FieldMode } from '@/lib/recall/field'
…
  const [mode, setMode] = useState<FieldMode>('ring')
…
  const planets: Planet[] = useMemo(() => {
    …
    return fieldLayout(counts, mode).map((seat) => {
    …
  }, [mode])
…
      <RecallField ref={field} key={`${initialNear ?? 'none'}-${mode}`}
        planets={planets} center={center} reduced={reduced} initialNear={initialNear} mode={mode}
        …
```

ボタンの列に:

```tsx
        <button type="button" className={btn} data-testid="mode-toggle"
          onClick={() => setMode((m) => (m === 'ring' ? 'cluster' : 'ring'))}>
          配置: {mode === 'ring' ? '輪' : '星団'}
        </button>
        <button type="button" className={btn} onClick={() => field.current?.backToFar()}>宇宙へ（遠景）</button>
```

- [ ] **Step 6: ラフを撮る**

`<scratchpad>/space.py`:

```python
import asyncio
from playwright.async_api import async_playwright
OUT = '.'
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for name, vp, mobile in [('pc', {'width': 1280, 'height': 820}, False), ('sp', {'width': 390, 'height': 844}, True)]:
            ctx = await b.new_context(viewport=vp, device_scale_factor=2, is_mobile=mobile, has_touch=mobile)
            pg = await ctx.new_page()
            await pg.goto('http://localhost:3216/dev/recall-field', wait_until='networkidle')
            await pg.evaluate("document.documentElement.classList.add('dark')")
            await pg.get_by_test_id('mode-toggle').click()
            await pg.wait_for_timeout(600)
            await pg.get_by_role('button', name='宇宙へ（遠景）').click()
            await pg.wait_for_timeout(1500)
            await pg.screenshot(path=f'{OUT}/space-{name}-far-dark.png')
            await pg.evaluate("document.documentElement.classList.remove('dark')")
            await pg.wait_for_timeout(600)
            await pg.screenshot(path=f'{OUT}/space-{name}-far-light.png')
            await pg.evaluate("document.documentElement.classList.add('dark')")
            # 3 秒後（自転が見える）
            await pg.wait_for_timeout(3000)
            await pg.screenshot(path=f'{OUT}/space-{name}-far-dark-3s.png')
            # 中景へ寄る（ホイール上）
            await pg.mouse.move(vp['width'] // 2, vp['height'] // 2)
            for _ in range(8):
                await pg.mouse.wheel(0, -300); await pg.wait_for_timeout(60)
            await pg.wait_for_timeout(1200)
            await pg.screenshot(path=f'{OUT}/space-{name}-mid-dark.png')
            await ctx.close()
        await b.close()
asyncio.run(main())
```

Run: `python3 space.py`
撮った 8 枚を Read で開き、次を自分で先に見る:
- 7 つの星団が見分けられる（名前が下に出ている）
- 惑星が重なっていない。スマホ幅で主張のある惑星の半径が 5px 以上（`FAR_ZOOM` 1.5 で足りなければ `field-camera.ts` に `CLUSTER_FAR_ZOOM = 2.2` を足し、`cameraFor` の far で `mode === 'cluster'` のときだけ使う。ラフの段階で決める）
- 3 秒後の1枚で全体が少し回っている

- [ ] **Step 7: tatsuki さんに見せて承認を取る（ここで止まる）**

`SendUserFile` で 8 枚を送り、「7つの星団の見分け／重なり／スマホ幅の大きさ／自転の速さ」の4点について、直す点があるかを1問で聞く。**承認が出るまで Task 4 へ進まない。** 直しが出たら `CLUSTER_SPREAD`・`FLATTEN_Y`・`FAR_ZOOM`（星団用）を動かして撮り直す。

- [ ] **Step 8: コミット**

```bash
git add src/lib/recall/field-render.ts src/components/recall/RecallField.tsx src/app/dev/recall-field/page.tsx src/lib/__tests__/recall-field-render.test.ts
git commit -m "feat(recall): RecallField に配置モードと backToFar、遠景の星団の名前。dev ハーネスに星団の切り替え

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 覆いの状態遷移（純関数）

**Files:**
- Create: `src/lib/recall/lift-phase.ts`
- Test: `src/lib/__tests__/recall-lift-phase.test.ts`

**Interfaces:**
- Produces:
  - `type LiftPhase = 'lift' | 'space' | 'spaceNear'`（球／宇宙／宇宙から入った球）
  - `type LiftAction = 'none' | 'close' | 'toFar'`
  - `onFieldStage(phase, prevStage, stage): { phase: LiftPhase; action: LiftAction }`（`RecallField` の `onStage` を受けて、次の状態と覆いがすべきこと）
  - `onBack(phase): { phase: LiftPhase; action: LiftAction }`（「戻る」）
  - `onDeeper(phase): { phase: LiftPhase; action: LiftAction }`（「さらに宇宙へ」）

- [ ] **Step 1: テストを書く**

```ts
// 隠しコマンドの覆い（RecallLift）の状態遷移。設計 2026-09-05「さらに宇宙へ」§2・§5
import { describe, it, expect } from 'vitest'
import { onFieldStage, onBack, onDeeper } from '@/lib/recall/lift-phase'

describe('球（lift）', () => {
  it('「さらに宇宙へ」で宇宙へ引く', () => {
    expect(onDeeper('lift')).toEqual({ phase: 'space', action: 'toFar' })
  })
  it('「戻る」で覆いを閉じる', () => {
    expect(onBack('lift')).toEqual({ phase: 'lift', action: 'close' })
  })
  it('近景の背景タップ（near→mid）で覆いを閉じる（D5 のまま）', () => {
    expect(onFieldStage('lift', 'near', 'mid')).toEqual({ phase: 'lift', action: 'close' })
  })
})

describe('宇宙（space）', () => {
  it('惑星を押して近景になったら spaceNear', () => {
    expect(onFieldStage('space', 'far', 'near')).toEqual({ phase: 'spaceNear', action: 'none' })
  })
  it('far⇄mid は寄る引くなので何もしない', () => {
    expect(onFieldStage('space', 'far', 'mid')).toEqual({ phase: 'space', action: 'none' })
    expect(onFieldStage('space', 'mid', 'far')).toEqual({ phase: 'space', action: 'none' })
  })
  it('「戻る」で覆いを閉じる（S5）', () => {
    expect(onBack('space')).toEqual({ phase: 'space', action: 'close' })
  })
  it('「さらに宇宙へ」はもう無い（押されても何もしない）', () => {
    expect(onDeeper('space')).toEqual({ phase: 'space', action: 'none' })
  })
})

describe('宇宙から入った球（spaceNear）', () => {
  it('「戻る」で宇宙へ引く', () => {
    expect(onBack('spaceNear')).toEqual({ phase: 'space', action: 'toFar' })
  })
  it('背景タップ（near→mid）でも宇宙へ引く', () => {
    expect(onFieldStage('spaceNear', 'near', 'mid')).toEqual({ phase: 'space', action: 'toFar' })
  })
  it('toFar の結果として届く mid→far では何もしない（二重に引かない）', () => {
    expect(onFieldStage('space', 'mid', 'far')).toEqual({ phase: 'space', action: 'none' })
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/recall-lift-phase.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装**

`src/lib/recall/lift-phase.ts`:

```ts
// 隠しコマンドの覆い（RecallLift）の状態遷移（純関数）。画面を知らない。
//
//   lift      … 分野ページの紋章から浮き出た球（D5）
//   space     … 「さらに宇宙へ」で引いた宇宙（遠景〜中景）
//   spaceNear … 宇宙で惑星を押して寄った球
//
// 設計: docs/superpowers/specs/2026-09-05-recall-space-design.md §2（動線）・§5（操作）
import type { FieldStage } from './field-camera'

export type LiftPhase = 'lift' | 'space' | 'spaceNear'
export type LiftAction = 'none' | 'close' | 'toFar'
export type LiftStep = { phase: LiftPhase; action: LiftAction }

const stay = (phase: LiftPhase): LiftStep => ({ phase, action: 'none' })

// RecallField の onStage を受ける。prev は直前の段（覆いが自分で控えておく）。
export function onFieldStage(phase: LiftPhase, prev: FieldStage, stage: FieldStage): LiftStep {
  if (stage === 'near') return phase === 'lift' ? stay('lift') : { phase: 'spaceNear', action: 'none' }
  // 近景から外へ出た（背景タップ・ホイール下・ピンチイン）
  if (prev === 'near') {
    if (phase === 'lift') return { phase: 'lift', action: 'close' }
    if (phase === 'spaceNear') return { phase: 'space', action: 'toFar' }
  }
  // 宇宙の far⇄mid は寄る引くなので、そのまま
  return stay(phase)
}

export function onBack(phase: LiftPhase): LiftStep {
  if (phase === 'spaceNear') return { phase: 'space', action: 'toFar' }
  return { phase, action: 'close' }
}

export function onDeeper(phase: LiftPhase): LiftStep {
  if (phase === 'lift') return { phase: 'space', action: 'toFar' }
  return stay(phase)
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/recall-lift-phase.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/recall/lift-phase.ts src/lib/__tests__/recall-lift-phase.test.ts
git commit -m "feat(recall): 隠しコマンドの覆いの状態遷移（球・宇宙・宇宙から入った球）を純関数に

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: 覆いに「さらに宇宙へ」を繋ぐ

**Files:**
- Modify: `src/components/recall/useFieldData.ts:56-60`（seats）・`:79-104`（planets）・戻り値
- Modify: `src/components/recall/RecallLift.tsx`
- Modify: `src/components/recall/RecallScreen.tsx:259-262`

**Interfaces:**
- Consumes: `onFieldStage`／`onBack`／`onDeeper`（Task 4）・`RecallField` の `mode`・`backToFar`（Task 3）
- Produces: `useFieldData()` の戻り値に `clusterPlanets: Planet[]`

- [ ] **Step 1: useFieldData に星団配置の planets を足す**

`useFieldData.ts`。`seats` の memo を席数の配列と2つの配置に分ける:

```ts
  const seatCounts = useMemo(() => {
    const counts = new Array(GENRE_SEATS.length).fill(0)
    for (const [slot, list] of bySlot) if (slot < counts.length) counts[slot] = list.length
    return counts
  }, [bySlot])
  const seats: FieldSeat[] = useMemo(() => fieldLayout(seatCounts), [seatCounts])
  // 宇宙（隠しコマンド第2段）用。同じ席数から星団配置で並べる。
  const clusterSeats: FieldSeat[] = useMemo(() => fieldLayout(seatCounts, 'cluster'), [seatCounts])
```

`planets` の memo の中身を関数に出し、2回使う:

```ts
  const planetsOf = useCallback((list: FieldSeat[]): Planet[] => list.map((seat) => {
    const claims = bySlot.get(seat.slot) ?? []
    const fan = fans.get(seat.slot)
    const keptRemainings: number[] = []
    let escaping = 0
    const dots: ClaimDot[] = claims.map((c) => {
      const state = stateById.get(c.claimId) ?? { kind: 'cold' as const, remaining: 0 }
      if (state.kind === 'kept' || state.kind === 'settled') keptRemainings.push(state.remaining)
      if (isEscaping(state.kind, state.remaining)) escaping++
      const h = hashOf(c.claimId)
      return {
        claimId: c.claimId,
        pageId: c.pageId,
        state,
        angle: fan?.angles.get(c.claimId) ?? 0,
        jitter: (h - 0.5) * 0.14,
        phase: h * Math.PI * 2,
      }
    })
    return {
      seat,
      summary: planetSummary({ total: claims.length, keptRemainings, escaping }),
      dots,
      pages: fan?.pages,
    }
  }), [bySlot, fans, stateById])

  const planets: Planet[] = useMemo(() => planetsOf(seats), [planetsOf, seats])
  const clusterPlanets: Planet[] = useMemo(() => planetsOf(clusterSeats), [planetsOf, clusterSeats])
```

（`useCallback` を import に足す。）戻り値に `clusterPlanets` を足す。

Run: `npx tsc --noEmit -p . 2>&1 | head -3 && npx vitest run src/lib/__tests__/recall-data-hook.test.ts`
Expected: 緑

- [ ] **Step 2: RecallLift に状態と2つ目のボタンを足す**

`RecallLift.tsx` を次の形にする（既存の出方・戻り・Esc・visibilitychange・`NO_SHELF` はそのまま。変えるのは `RecallField` の呼び出し・見出し・ボタン）:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { RecallField, type FieldHandle } from './RecallField'
import type { Planet } from '@/lib/recall/field-render'
import type { FieldStage } from '@/lib/recall/field-camera'
import { genreEnglishOf } from '@/lib/recall/genre-en'
import { onFieldStage, onBack, onDeeper, type LiftPhase, type LiftStep } from '@/lib/recall/lift-phase'
import { useReducedMotion } from './useReducedMotion'
…
export function RecallLift({ slot, planets, origin, cardOpen, onClose, onCloseCard, onDotTap }: Props) {
  const reduced = useReducedMotion()
  const field = useRef<FieldHandle>(null)
  // 覆いの状態（球／宇宙／宇宙から入った球）。判断は lift-phase.ts。
  // onStage は RecallField から同期で届くので、state と同じ値を ref にも持つ。
  const [phase, setPhase] = useState<LiftPhase>('lift')
  const phaseRef = useRef<LiftPhase>('lift')
  const prevStage = useRef<FieldStage>('near')
  // 見出しに出す分野（球のとき）。宇宙では出さない。
  const [nearSlot, setNearSlot] = useState<number | null>(slot)
  …（lensPageId・entered・closing・closeTimer・出方・戻り・Esc・visibilitychange は既存のまま）

  const apply = useCallback((step: LiftStep) => {
    phaseRef.current = step.phase
    setPhase(step.phase)
    if (step.action === 'close') close()
    if (step.action === 'toFar') field.current?.backToFar()
  }, [close])

  const onStage = useCallback((stage: FieldStage, s: number | null) => {
    const prev = prevStage.current
    prevStage.current = stage
    if (stage === 'near') setNearSlot(s)
    apply(onFieldStage(phaseRef.current, prev, stage))
  }, [apply])

  const seat = planets.find((p) => p.seat.slot === nearSlot)?.seat ?? null
  const label = phase === 'space' ? '' : seat?.label ?? ''
  const en = phase === 'space' || nearSlot === null ? '' : genreEnglishOf(nearSlot)
  …
      <RecallField ref={field}
        planets={planets} center="outside" reduced={reduced} initialNear={slot} mode="cluster"
        shelf={NO_SHELF} again={NO_AGAIN} lensPageId={lensPageId} cardOpen={cardOpen}
        onFront={() => {}}
        onStage={onStage}
        onDotTap={onDotTap}
        onShelfTap={() => {}}
        onLens={setLensPageId}
        onCloseCard={onCloseCard}
      />

      {/* 上に小さく和名・英名（球のときだけ。宇宙はどの分野の画面でもないので出さない）。 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 pt-[max(14px,env(safe-area-inset-top))] text-center">
        <p className="text-[13px] tracking-[.08em] text-slate-700 dark:text-[#F2F5F1]">{label}</p>
        <p className="mt-0.5 text-[10px] tracking-[.14em] uppercase text-slate-500 dark:text-slate-400">{en}</p>
      </div>

      {/* 下のボタン。球: 戻る・さらに宇宙へ／宇宙: 戻る／宇宙から入った球: 戻る（宇宙へ）。 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center gap-3 pb-[max(18px,env(safe-area-inset-bottom))]">
        <button type="button" onClick={() => apply(onBack(phaseRef.current))} className={BTN}>
          戻る
        </button>
        {phase === 'lift' && (
          <button type="button" onClick={() => apply(onDeeper(phaseRef.current))} className={BTN} data-testid="lift-deeper">
            さらに宇宙へ
          </button>
        )}
      </div>
```

`BTN` は既存の「戻る」の className をモジュール直下の定数に出したもの（2つのボタンで同じ見た目）。既存の `onStage={(stage) => { if (stage !== 'near') close() }}` は `onStage` に置き換わる（lift のときの near→mid が close になるのは `onFieldStage` が担う）。

Run: `npx tsc --noEmit -p . 2>&1 | head -5`
Expected: エラーなし

- [ ] **Step 3: RecallScreen で星団配置の planets を渡す**

`RecallScreen.tsx`:

```tsx
      {lift && (
        <RecallLift slot={lift.slot} planets={data.clusterPlanets} origin={lift.origin} cardOpen={card !== null}
          onClose={closeLift} onCloseCard={closeCard} onDotTap={onLiftDotTap} />
      )}
```

`claimStateById`（点のタップの振り分け）は `data.planets` から作っているが、主張の集合は同じなのでそのままでよい。

Run: `npx tsc --noEmit -p . 2>&1 | head -3 && npm test 2>&1 | tail -3`
Expected: 緑

- [ ] **Step 4: 実画面で動線を通す**

`<scratchpad>/lift.py`（`/dev/recall-screen`・スマホ幅・ダーク）:

```python
import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        ctx = await b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = await ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        await pg.goto('http://localhost:3216/dev/recall-screen', wait_until='networkidle')
        await pg.evaluate("document.documentElement.classList.add('dark')")
        await pg.get_by_role('button', name='呼吸').first.click(); await pg.wait_for_timeout(500)
        await pg.get_by_role('button', name='球体を浮き出す').click(); await pg.wait_for_timeout(900)
        await pg.screenshot(path='lift-1-ball.png')
        await pg.get_by_test_id('lift-deeper').click(); await pg.wait_for_timeout(1500)
        await pg.screenshot(path='lift-2-space.png')
        # 宇宙で惑星を押す: 画面中央付近を何点か試し、近景に入ったら止める
        entered = False
        for (x, y) in [(195, 420), (150, 400), (240, 440), (195, 380), (120, 460), (270, 400)]:
            await pg.mouse.click(x, y); await pg.wait_for_timeout(1300)
            header = (await pg.locator('.pointer-events-none.absolute.inset-x-0.top-0 p').first.inner_text()).strip()
            if await pg.get_by_test_id('lift-deeper').count() == 0 and header:
                entered = True; break
        print('entered near from space:', entered)
        await pg.screenshot(path='lift-3-space-near.png')
        await pg.get_by_role('button', name='戻る').click(); await pg.wait_for_timeout(1500)
        await pg.screenshot(path='lift-4-back-to-space.png')
        await pg.get_by_role('button', name='戻る').click(); await pg.wait_for_timeout(700)
        await pg.screenshot(path='lift-5-closed.png')
        print('overlay left:', await pg.get_by_role('button', name='戻る').count(), 'errors:', errors)
        await b.close()
asyncio.run(main())
```

Run: `python3 lift.py`
Expected: `entered near from space: True`、`overlay left: 1`（分野ページの「戻る」だけが残る）、`errors: []`。5枚を Read で開く: 1 球（見出しに呼吸）・2 宇宙（見出し無し・星団の名前・ボタンは「戻る」だけ）・3 宇宙から入った球（見出しにその分野）・4 宇宙・5 分野ページ

- [ ] **Step 5: Esc とカードの譲り合いを確かめる**

`lift.py` の末尾を変えて: 宇宙 → 惑星を押して球 → 点を押してカードを開く（`pg.mouse.click` を球の輪の上）→ `Escape` でカードだけ閉じる（覆いは残る）→ もう一度 `Escape` で覆いが閉じる。`get_by_role('dialog', name='主張のカード').count()` と「戻る」の数で確かめる

- [ ] **Step 6: コミット**

```bash
git add src/components/recall/useFieldData.ts src/components/recall/RecallLift.tsx src/components/recall/RecallScreen.tsx
git commit -m "feat(recall): 球の画面に「さらに宇宙へ」。星団に散らばった惑星の宇宙へ引き、惑星を押すと球へ寄る

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: 仕上げ

- [ ] **Step 1: 全テスト・型・本番ビルド**

Run: `npm test 2>&1 | tail -3 && npx tsc --noEmit -p . 2>&1 | head -3 && npm run build 2>&1 | tail -5`
Expected: 緑・ビルド成功

- [ ] **Step 2: 動きを減らす設定**

`lift.py` の `new_context(..., reduced_motion='reduce')` で同じ動線を通し、覆いが出る・宇宙へ引ける（遷移なしで即座）・閉じることを確かめる

- [ ] **Step 3: 設計書の「実装」節を足す**

`docs/superpowers/specs/2026-09-05-recall-space-design.md` の末尾に「## 11. 実装（日付）」として、段0で決めた値（`CLUSTER_SPREAD`・`FLATTEN_Y`・星団用の far zoom を足したか）と、実装中に設計から変えた点を書く。

- [ ] **Step 4: main へ merge（push はしない）**

```bash
cd ~/MediNode-本体 && git merge --no-ff recall-space -m "merge: Recall「さらに宇宙へ」（隠しコマンド第2段・族ごとの星団）

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

push は tatsuki さんに「push してよいですか」と1行で聞く。承認後 `git push origin main`。本番は Vercel の画面か `vercel ls` で Ready を確かめる（マージ＝デプロイではない）

- [ ] **Step 5: worktree を片づける**

```bash
cd ~/MediNode-本体 && git worktree remove .claude/worktrees/recall-space && git branch -d recall-space
```
