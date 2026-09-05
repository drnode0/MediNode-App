# Recall 隠しコマンドの段（再計画 計画B）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 隠しコマンドを「その惑星だけの球（案4）→ さらに宇宙へ（族ごとの星団・遠景）→ 惑星を押すと中央に寄る → もう一度押すと球」の段に切り直す。宇宙の文字は族名だけ、空の席はガス、書体は Jost 300 と Noto Sans JP 300。

**Architecture:** 配置・カメラ・描画の判断は `src/lib/recall/`（`field-cluster.ts` 新規・`field.ts`・`field-render.ts`・`lift-phase.ts` 新規）の純関数に置き、`RecallField.tsx` は操作と RAF、`RecallLift.tsx` は段の出し分けだけを持つ。**試作の差分が `docs/superpowers/specs/assets/2026-09-05-recall-replan-proto/` にある**（本番コードの写しに当てたもの）。各タスクはその差分を本番へ移す形で進めるが、試作にある「案1〜3の切り替え」「族名の常時表示」「惑星名の常時表示」「粒（drawHaze）の切り替え」は本番へ持ち込まない（採らなかった案）。

**Tech Stack:** Next.js 16 / React / Canvas 2D / vitest（DOM 無し。偽 ctx で描画の判断を記録する作法は `recall-field-render.test.ts` を見る）/ Python playwright

設計書: `docs/superpowers/specs/2026-09-05-recall-replan-design.md`（§1 R5〜R12・§4・§5・§6）。回る試作: https://claude.ai/code/artifact/6edaa62f-4975-4a21-84eb-da048ed522ae

## Global Constraints

- 公開リポジトリ。事業数値を書かない
- 使わない語: 振る・拾う・血肉・落ちる・定着・輪（宇宙の文脈では「星団」「宇宙」）。族の動きの言葉（閉じて戻る 等）は画面に出さない。長いダッシュを使わない
- 描画は線画。**面を塗る例外はガス（`drawNebula`）だけ**（R8）
- 定数（試作で決めた値。設計 §4.3）: `FAMILY_R = 0.5`／`CLUSTER_SPREAD = 0.3`／`CLUSTER_ZOOM = 2.4`／`CLUSTER_PITCH = -0.55`／`CLUSTER_MID_ZOOM = 5`／族を押したときの倍率 `3.4`／族の表示 `3200ms`（最後の 600ms で薄れる）／扇形の弧 `2600ms`（最後の 600ms で薄れる）／ガス 1席2枚・不透明度 `0.07`・毎秒 `0.04` rad
- 星団では `fitScale` を掛けない（R8 の隣・§4.3）
- 宇宙で空の席（`seat.n === 0`）は押せない。惑星の点（主張）は押せない
- 段0（Task 5）で playwright のスクショを出し、**オーナー承認が出るまで Task 6 以降へ進まない**
- 作業は worktree で。`.preview/grains.json` を共有チェックアウトから写す。dev server は別ポート（例 3216）。Browser pane は使わない
- 計画A（`2026-09-05-recall-plate-page-plan.md`）と独立。どちらが先でもよいが、同じファイル（`RecallDot`・`dex.ts`）は触らない

---

### Task 1: 星団の配置（`field-cluster.ts`）

**Files:**
- Create: `src/lib/recall/field-cluster.ts`（写す元: `docs/superpowers/specs/assets/2026-09-05-recall-replan-proto/field-cluster.ts`）
- Test: `src/lib/__tests__/recall-field-cluster.test.ts`

**Interfaces:**
- Consumes: `coreKindOf`・`CoreKind`（`cores.ts`）、`Vec3`（`layout.ts`）、`GENRE_SEATS`・`isRetiredSeat`（`genres.ts`）
- Produces:
  - `FAMILY_ORDER: CoreKind[]`（計画A の `families.ts` と同じ並び。計画A が先に入っていればそちらを import し、無ければここで定義して後で寄せる）
  - `familyCenter(i: number): Vec3`／`clusterPointOf(slot: number): Vec3`
  - 定数 `FAMILY_R`・`CLUSTER_SPREAD`・`CLUSTER_ZOOM`・`CLUSTER_PITCH`・`CLUSTER_MID_ZOOM`・`FAMILY_FOCUS_ZOOM = 3.4`

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, it, expect } from 'vitest'
import { familyCenter, clusterPointOf, FAMILY_ORDER, FAMILY_R, CLUSTER_SPREAD } from '@/lib/recall/field-cluster'
import { GENRE_SEATS, isRetiredSeat, OTHER_SLOT } from '@/lib/recall/genres'
import { coreKindOf } from '@/lib/recall/cores'

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

describe('族ごとの星団', () => {
  it('同じ席は何度呼んでも同じ位置（決定性）', () => {
    expect(clusterPointOf(3)).toEqual(clusterPointOf(3))
  })
  it('7族の中心は互いに 0.5 以上離れている', () => {
    for (let i = 0; i < 7; i++) for (let j = i + 1; j < 7; j++) expect(dist(familyCenter(i), familyCenter(j))).toBeGreaterThan(0.5)
  })
  it('族の中心は半径 FAMILY_R の球面の近く（縦は潰していない）', () => {
    for (let i = 0; i < 7; i++) expect(Math.hypot(...familyCenter(i))).toBeCloseTo(FAMILY_R, 1)
  })
  it('各席は自分の族の中心から CLUSTER_SPREAD 以内', () => {
    for (let slot = 0; slot < GENRE_SEATS.length; slot++) {
      if (!GENRE_SEATS[slot] || slot === OTHER_SLOT || isRetiredSeat(slot)) continue
      const c = familyCenter(FAMILY_ORDER.indexOf(coreKindOf(slot)))
      expect(dist(clusterPointOf(slot), c)).toBeLessThanOrEqual(CLUSTER_SPREAD + 1e-9)
    }
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/lib/__tests__/recall-field-cluster.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装**

試作の `field-cluster.ts` をそのまま `src/lib/recall/` へ写し、import を `./layout`・`./cores` に直す。中身:

```ts
// 族ごとの星団（純関数）。設計 2026-09-05 再計画 §4.3。
// 族の中心7点＝黄金角の螺旋で半径 FAMILY_R の球面に置く。惑星＝中心＋席番号のハッシュで決まる固定のずれ。
// 開くたびに変わらない（席番号だけから決まる）。
import type { Vec3 } from './layout'
import { coreKindOf, type CoreKind } from './cores'

export const FAMILY_ORDER: CoreKind[] = ['flow', 'exchange', 'signal', 'invasion', 'structure', 'regulation', 'system']
export const FAMILY_R = 0.5
export const CLUSTER_SPREAD = 0.3
export const CLUSTER_ZOOM = 2.4
export const CLUSTER_PITCH = -0.55
export const CLUSTER_MID_ZOOM = 5
export const FAMILY_FOCUS_ZOOM = 3.4

export function familyCenter(i: number): Vec3 {
  const n = FAMILY_ORDER.length
  const y = 1 - (2 * (i + 0.5)) / n
  const r = Math.sqrt(1 - y * y)
  const a = i * Math.PI * (3 - Math.sqrt(5))
  return [Math.cos(a) * r * FAMILY_R, y * FAMILY_R, Math.sin(a) * r * FAMILY_R]
}

const hash = (a: number, b: number) => {
  let x = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) >>> 0
  x = (x ^ (x >>> 13)) >>> 0
  x = Math.imul(x, 1274126177) >>> 0
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

export function clusterPointOf(slot: number): Vec3 {
  const c = familyCenter(FAMILY_ORDER.indexOf(coreKindOf(slot)))
  const th = hash(slot, 1) * Math.PI * 2
  const ph = Math.acos(2 * hash(slot, 2) - 1)
  const rr = CLUSTER_SPREAD * Math.cbrt(hash(slot, 3))
  return [c[0] + Math.sin(ph) * Math.cos(th) * rr, c[1] + Math.cos(ph) * rr * 0.6, c[2] + Math.sin(ph) * Math.sin(th) * rr]
}
```

（`Math.hypot(...familyCenter(i))` のテストは `y` を潰していないので `FAMILY_R` に一致する。`clusterPointOf` の y だけ 0.6 倍で薄くする。）

- [ ] **Step 4: 通す**

Run: `npx vitest run src/lib/__tests__/recall-field-cluster.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/recall/field-cluster.ts src/lib/__tests__/recall-field-cluster.test.ts
git commit -m "feat(recall): 族ごとの星団の配置（純関数）"
```

---

### Task 2: `field.ts` に星団モードを足す（配置・カメラ・fitScale なし）

**Files:**
- Modify: `src/lib/recall/field.ts`（`FieldMode`・`ringPointOf`・`fieldLayout`・`cameraFor`）
- Test: `src/lib/__tests__/recall-field-camera.test.ts`（既存ファイルに describe を足す）

**Interfaces:**
- Consumes: Task 1
- Produces: `fieldLayout(counts, 'cluster')`／`cameraFor(cam, center, 'far' | 'mid', seat, 'cluster')`

- [ ] **Step 1: 失敗するテストを書く**（`recall-field-camera.test.ts` 末尾）

```ts
import { CLUSTER_ZOOM, CLUSTER_PITCH, CLUSTER_MID_ZOOM, clusterPointOf } from '@/lib/recall/field-cluster'
import { planetRadius } from '@/lib/recall/field-layout'

describe('星団の配置とカメラ（再計画 §4.3）', () => {
  it('席の位置が clusterPointOf と一致し、半径は planetRadius のまま（fitScale を掛けない）', () => {
    const c = counts()
    const max = Math.max(...c)
    const seats = fieldLayout(c, 'cluster')
    for (const s of seats) {
      expect(s.at).toEqual(clusterPointOf(s.slot))
      near(s.r, planetRadius(s.n, max))
    }
  })
  it('遠景は原点を見て倍率 2.4・見下ろし −0.55', () => {
    const seats = fieldLayout(counts(), 'cluster')
    const cam = cameraFor(initialCamera(seats, 'cluster'), 'outside', 'far', null, 'cluster')
    expect(cam.zoom).toBe(CLUSTER_ZOOM); expect(cam.rotX).toBe(CLUSTER_PITCH); expect(cam.focus).toEqual([0, 0, 0])
  })
  it('中景は寄せた惑星を見て倍率 5', () => {
    const seats = fieldLayout(counts(), 'cluster')
    const seat = seats.find((s) => s.slot === 3)!
    const cam = cameraFor(initialCamera(seats, 'cluster'), 'outside', 'mid', seat, 'cluster')
    expect(cam.zoom).toBe(CLUSTER_MID_ZOOM); expect(cam.focus).toEqual(seat.at)
  })
  it('輪の配置は今までどおり（fitScale が効く・カメラも既存値）', () => {
    const seats = fieldLayout(counts())
    const cam = cameraFor(initialCamera(seats), 'outside', 'far', null)
    expect(cam.zoom).toBe(FAR_ZOOM); expect(cam.rotX).toBe(RING_PITCH)
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/lib/__tests__/recall-field-camera.test.ts -t 星団`
Expected: FAIL（`'cluster'` が型に無い／位置が輪）

- [ ] **Step 3: 実装**（試作 `field.ts` の差分そのまま）

```ts
import { clusterPointOf, CLUSTER_ZOOM, CLUSTER_PITCH, CLUSTER_MID_ZOOM } from './field-cluster'
export type FieldMode = 'ring' | 'sphere' | 'cluster'
// ringPointOf:
  if (mode === 'sphere') return seatCenter(slot)
  if (mode === 'cluster') return clusterPointOf(slot)
// fieldLayout の末尾:
  const k = mode === 'cluster' ? 1 : fitScale(seats)   // 星団では一律縮小を掛けない（掛けると惑星が 5px になる。設計 §4.3）
// cameraFor:
  if (stage === 'far') {
    if (mode === 'cluster') return { ...next, rotX: CLUSTER_PITCH, zoom: CLUSTER_ZOOM, focus: [0, 0, 0] }
    return { ...next, rotX: OUTSIDE_STAGE.far.rotX, zoom: OUTSIDE_STAGE.far.zoom, focus: [0, 0, 0] }
  }
  if (mode === 'cluster') {
    return { ...next, rotX: CLUSTER_PITCH, zoom: CLUSTER_MID_ZOOM, focus: seat ? [...seat.at] as Vec3 : [0, 0, 0] }
  }
```

- [ ] **Step 4: 通す**

Run: `npx vitest run src/lib/__tests__/recall-field-camera.test.ts src/lib/__tests__/recall-field-layout.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/recall/field.ts src/lib/__tests__/recall-field-camera.test.ts
git commit -m "feat(recall): 配置モード cluster（星団の位置・遠景と中景のカメラ・一律縮小なし）"
```

---

### Task 3: `field-render.ts`（描く物の出し分け・ガス・族名・押したときの名前・書体）

**Files:**
- Modify: `src/lib/recall/field-render.ts`（写す元: `assets/.../field-render.ts`。差分は `FieldFrameArgs.show / familyLabels / familyFocus`、`FieldHits.families`、`drawNebula`、惑星名ブロック、族名ブロック、`FONT_LATIN / FONT_JP`）
- Test: `src/lib/__tests__/recall-field-render.test.ts`（既存の偽 ctx に `fillText`・`createRadialGradient` の記録を足す）

**Interfaces:**
- Consumes: Task 1・2
- Produces:
  - `FieldFrameArgs.show?: { edgeLabels?; edgeCircles?; fans?; pageLabels?; planetLabels?; labelMinR?; nebula?; fanAlpha? }`（省略は今までどおり全部出す・粒）
  - `FieldFrameArgs.familyLabels?: Array<{ text: string; sub: string; kind: CoreKind; at: Vec3 }>`／`familyFocus?: { kind: CoreKind; until: number } | null`（`until` は `performance.now()` の ms。`a.t` は秒なので描画側で `a.t * 1000` と比べる）
  - `FieldHits.families: Array<{ kind; x; y; w; h }>`
  - `export const FONT_LATIN = '300 11px Jost, "Helvetica Neue", sans-serif'`／`FONT_JP = '300 10.5px "Noto Sans JP", sans-serif'`

- [ ] **Step 1: 失敗するテストを書く**

`recorder()` に `texts: string[]` と `gradients: number` を足す（`fillText(t){ texts.push(t) }`・`createRadialGradient(){ gradients++; return { addColorStop() {} } }`）。`(ctx as any).letterSpacing` は代入されるだけなので偽 ctx のままでよい。

```ts
describe('描く物の出し分け（再計画 §4.2・§4.3）', () => {
  it('show.planetLabels=false なら惑星名を描かない（既定は描く）', () => {
    const planet = planetWithDots([dot('a', 'kept', 1)])   // 既存ヘルパー。summary.outline などは既存どおり
    const a = frameOf(planet, DARK_PALETTE)
    a.cam = { ...a.cam, zoom: 8 }            // 中景（S > LABEL_MIN_R）
    const r1 = recorder(); drawField(r1.ctx, a)
    expect(r1.texts.some((t) => t.includes(planet.seat.label))).toBe(true)
    const r2 = recorder(); drawField(r2.ctx, { ...a, show: { planetLabels: false } })
    expect(r2.texts.some((t) => t.includes(planet.seat.label))).toBe(false)
  })
  it('familyFocus の族の惑星だけ、名前が一時的に出る', () => {
    const planet = planetWithDots([dot('a', 'kept', 1)])
    const a = { ...frameOf(planet, DARK_PALETTE), show: { planetLabels: false }, t: 1, familyFocus: { kind: planet.seat.kind, until: 3000 } }
    const r = recorder(); drawField(r.ctx, a)
    expect(r.texts).toContain(planet.seat.label)
    const r2 = recorder(); drawField(r2.ctx, { ...a, familyFocus: { kind: planet.seat.kind, until: 500 } })  // 期限切れ
    expect(r2.texts).not.toContain(planet.seat.label)
  })
  it('空の席は show.nebula でガス（放射状グラデーション）、既定は粒（グラデーション無し）', () => {
    const empty: Planet = { ...planetWithDots([]), summary: { face: 'empty', haze: true, core: false, outline: false, outlineAlpha: 0, halos: 0 } }
    const a = frameOf(empty, DARK_PALETTE)
    const r1 = recorder(); drawField(r1.ctx, a); expect(r1.gradients).toBe(0)
    const r2 = recorder(); drawField(r2.ctx, { ...a, show: { nebula: true } }); expect(r2.gradients).toBe(2)
  })
  it('族名は familyLabels を渡したときだけ。押した族の sub は familyFocus の間だけ', () => {
    const a = { ...frameOf(planetWithDots([]), DARK_PALETTE), t: 1, familyLabels: [{ text: 'Flow', sub: '名詞', kind: 'flow' as const, at: [0, 0.2, 0] as [number, number, number] }] }
    const r1 = recorder(); drawField(r1.ctx, a)
    expect(r1.texts).toContain('FLOW'); expect(r1.texts).not.toContain('名詞')
    const r2 = recorder(); drawField(r2.ctx, { ...a, familyFocus: { kind: 'flow', until: 3000 } })
    expect(r2.texts).toContain('名詞')
  })
  it('fanAlpha=0 なら扇形を描かない', () => {
    // planet.pages を1つ持たせ nearSlot=slot にして stroke 回数を比べる（recorder に strokes カウンタを足す）
  })
})
```

（最後の it は `strokes` カウンタを足して `show: { fanAlpha: 0 }` と `{ fanAlpha: 1 }` で `strokes` が減ることを見る。書く。）

`PlanetSummary.face` の値名は `field-layout.ts` を見て合わせる。

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/lib/__tests__/recall-field-render.test.ts`
Expected: FAIL（`show` が無視される・`createRadialGradient` が呼ばれない）

- [ ] **Step 3: 実装**

試作の `field-render.ts` から次を写す（**試作の `labelMinR < LABEL_MIN_R` で文字を大きくする分岐は持ち込まない**。本番は惑星名を常時出さないため）:

1. `FieldFrameArgs` に `show`・`familyLabels`・`familyFocus`。`FieldHits` に `families`
2. `drawField` 冒頭で `const show = { edgeLabels: true, edgeCircles: true, fans: true, pageLabels: true, planetLabels: true, labelMinR: LABEL_MIN_R, nebula: false, fanAlpha: 1, ...(a.show ?? {}) }`
3. 境目の円: `for (const r of show.edgeCircles ? EDGE_CIRCLES : [])`。境目の名前: `show.edgeLabels ? EDGE_LABELS : []`
4. 扇形: `if (isNear && planet.pages?.length && show.fans && show.fanAlpha > 0)`。弧の alpha に `* show.fanAlpha`。記事名: `show.pageLabels` のときだけ `onRing(..., ARC_LABEL_R)` を取る
5. 空の席: `if (show.nebula) drawNebula(...) else drawHaze(...)`。`drawNebula` は試作の関数（1席2枚・`0.07`・毎秒 `0.04` rad・`reduced` では `t` が 0 なので止まる）
6. 惑星名（`!isNear`）: `show.planetLabels ? S > show.labelMinR : nameAlpha > 0` かつ `seat.n > 0`。`nameAlpha` は `familyFocus` の族なら `(until - a.t*1000)/600` を 0..1 に丸める。フォントは `FONT_JP`・`letterSpacing '0.12em'`・位置 `Y + min(S×2.1, 64) + 12`。**件数と「離れかけ n」は描かない**（R6。今の `${seat.label}　${seat.n}` と `離れかけ ${sum.halos}` の2行は、輪の配置（`show` 省略）でも出さなくてよいか → 輪の配置は本番の主動線に無いので消してよい。ただし `/dev/recall-field` の輪の確認用に `show.planetLabels` が true のときは今までどおり件数つきで出す）
7. 族名: 試作の `familyLabels` ブロック（`FONT_LATIN`・`letterSpacing '0.32em'`・大文字・alpha 0.55×奥行き・`hits.families` に当たり判定 `{ x: X - w/2, y: Y - 12, w, h: 34 }`）。`sub` は `familyFocus` の族だけ `0.7 × fade`。試作の `f.always`（常時）は持ち込まない
8. `FONT_LATIN`・`FONT_JP` を export し、既存の `'400 10.5px "Zen Kaku Gothic New"…'`（3か所）を `FONT_JP` に置き換える
9. `letterSpacing` は `(ctx as unknown as { letterSpacing: string }).letterSpacing = …` で書き、描いたら `'0px'` に戻す

- [ ] **Step 4: 通す**

Run: `npx vitest run src/lib/__tests__/recall-field-render.test.ts src/lib/__tests__/recall-field-camera.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/recall/field-render.ts src/lib/__tests__/recall-field-render.test.ts
git commit -m "feat(recall): 描く物の出し分け・空の席のガス・族名と押したときの名前・書体（宇宙の描画）"
```

---

### Task 4: `RecallField.tsx`（球の自由回転・段の固定・星団の操作）

**Files:**
- Modify: `src/components/recall/RecallField.tsx`（写す元: `assets/.../RecallField.tsx`）
- Test: DOM を持たないので純関数側（Task 2・3）で担保。動作は Task 5 の dev ハーネスで確かめる

**Interfaces:**
- Consumes: Task 1〜3
- Produces（props に足す。全部省略可。省略時は今までどおり）:
  - `mode?: 'ring' | 'cluster'`／`initialStage?: FieldStage`（`'far'` で開く）／`free?: boolean`（縦の頭打ちなし）／`lockNear?: boolean`（近景から出ない）／`fanOnTouch?: boolean`（触れてから 2600ms 扇形）／`show?: FieldFrameArgs['show']`／`familyLabels?: FieldFrameArgs['familyLabels']`／`onPlanetTap?: (slot) => void`／`onFamilyTap?: (kind) => void`
  - `FieldHandle.backToFar(): void`
  - `onStage(stage, slot)` の `slot` は、`'mid'` のとき星団で寄せた惑星（`midSlot`）、`'near'` のとき `nearSlot`、`'far'` のとき `null`

- [ ] **Step 1: 差分を写す**（試作の `RecallField.tsx` と本番の差を `diff` で出し、次の9点を移す）

1. `useRef`: `touchedAt`（触れた時刻）・`midSlot`（星団で寄せた惑星）・`farFocus`（族を押したときの焦点と倍率）・`familyFocus`（`{ kind, until }`）
2. `goStage`: `lockNear && stage==='near' && next!=='near'` なら `false`。`'mid'` へ行くとき `midSlot.current = slot`。`cameraFor(..., P.mode ?? 'ring')` に mode を通し、`seat` は `next==='near' ? nearSlot : midSlot`。`onStage(next, next==='near' ? nearSlot.current : midSlot.current)`
3. `useImperativeHandle` に `backToFar: () => { goStage('far', null) }`
4. 初期化: `initialCamera(seats, mode)`。`initialStage==='far'` なら `cam = cameraFor(initial, center, 'far', null, mode)`・`stage='far'`
5. frame: `'mid'` は `c.rotX = mode==='cluster' ? CLUSTER_PITCH : RING_PITCH`、焦点は `cluster && midSlot` なら `seat.at`。`'far'` は `farFocus ? farFocus.at : [0,0,0]`
6. `drawField` の引数: `show: fanOnTouch ? { ...show, fans: true, fanAlpha: clamp((2600 - (now - touchedAt)) / 600) } : show`、`familyLabels: stage==='far' ? familyLabels : undefined`、`familyFocus`
7. `onDown`: `touchedAt.current = performance.now()`
8. `onMove` の縦: `free ? rotX + dragPitch(dy) : clampPitchOutside(...)`
9. `onUp` のタップ:
   - `stage==='far'` で `hits.families` に当たれば: `farFocus = { at: [fl.at[0], fl.at[1] - 0.2, fl.at[2]], zoom: FAMILY_FOCUS_ZOOM }`、`familyFocus = { kind, until: now + 3200 }`、`startFly({ ...cam, focus, zoom: 3.4 }, FLY_MS)`、`onFamilyTap?.(kind)`、return
   - `stage==='far'` で何にも当たらず `farFocus` があれば: `farFocus = null`、原点・`CLUSTER_ZOOM` へ `startFly`、return
   - `pickPlanet` の結果が `seatOf(slot)?.n === 0` なら **何もしない**（空の席は押せない）
   - `mode==='cluster'`: `stage==='mid' && midSlot===slot` なら `onPlanetTap ? onPlanetTap(slot) : goStage('near', slot)`、それ以外は `goStage('mid', slot)`
   - `mode!=='cluster'`: 今までどおり（`onPlanetTap` があればそれ）
10. ホイール・ピンチで `stageOfZoom` が `'far'` になったら `midSlot = null`

`FieldHits` の初期値に `families: []` を足す（型エラーになる）。

- [ ] **Step 2: 型と既存テスト**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: 型エラーなし・全 PASS

- [ ] **Step 3: コミット**

```bash
git add src/components/recall/RecallField.tsx
git commit -m "feat(recall): RecallField に星団モード・自由回転・段の固定・族と惑星のタップを足す"
```

---

### Task 5: 段0＝dev ハーネスで撮って承認を取る（**関門**）

**Files:**
- Modify: `src/app/dev/recall-field/page.tsx`（切り替え: 配置 輪／星団・段 球／宇宙・空席 粒／ガス は本番では使わないので付けない。**球＝1惑星だけ・案4**／**宇宙＝星団・遠景**の2つと、テーマ）
- Modify: `src/components/recall/useFieldData.ts`（`clusterPlanets` を返す。`seats` と同じ作りで `fieldLayout(counts, 'cluster')`。dev ハーネスは自前の仮データで作ってよい）

**Interfaces:**
- Produces: `useFieldData().clusterPlanets: Planet[]`（`planets` と同じ dots・summary・pages、席の位置だけ星団）

- [ ] **Step 1: dev ハーネスに「球（案4）」「宇宙」の切り替えを足す**

試作の `entry.tsx` の `App` を参考に、`RecallField` を2通りで置く:
- 球: `planets={cluster.filter(slot)}` `initialNear={slot}` `free lockNear fanOnTouch show={{ edgeLabels: false, edgeCircles: false, fans: false, pageLabels: false, nebula: true }}`
- 宇宙: `planets={cluster}` `mode="cluster"` `initialStage="far"` `show={{ planetLabels: false, nebula: true }}` `familyLabels={FAMILY_ORDER.map((k, i) => ({ text: coreEnglishOf(k), sub: FAMILY_NOUN[k], kind: k, at: [c[0], c[1] + 0.2, c[2]] }))}`（`c = familyCenter(i)`。計画A の `FAMILY_NOUN` が無ければ `''`）`onPlanetTap={(slot) => 球へ}` `onStage={(s, slot) => 中景なら slot を控える}`
- 中景の名前: `onStage` で控えた slot の和名・英名を DOM で `top: 61%` に出す（試作の `.caption`）

- [ ] **Step 2: playwright で撮る**

`/dev/recall-field` をスマホ幅（390×844・dpr 2）とPC幅（1280×820）で。ライト・ダーク。場面: 球（触れる前／触れた直後）・宇宙の遠景・族名を押した直後・惑星を押した中景・中景から球へ。**合計 8〜12 枚**。1コマの描画時間を `performance.now()` 差で 30 コマ測り、最大が 8ms 以下であることを数字で出す。

- [ ] **Step 3: 承認**

スクショと数字を tatsukiさんに送り、**承認が出るまで Task 6 へ進まない**。直しがあれば Task 1〜4 の定数を変えて撮り直す（定数の変更は設計書 §4.3 にも反映する）。

- [ ] **Step 4: コミット**

```bash
git add src/app/dev/recall-field/page.tsx src/components/recall/useFieldData.ts
git commit -m "feat(recall): dev ハーネスに球（案4）と宇宙（星団）の切り替え。段0の承認用"
```

---

### Task 6: 覆いの状態機械（`lift-phase.ts`）

**Files:**
- Create: `src/lib/recall/lift-phase.ts`
- Test: `src/lib/__tests__/recall-lift-phase.test.ts`

**Interfaces:**
- Produces:

```ts
export type LiftPhase =
  | { kind: 'sphere'; slot: number; from: 'page' }
  | { kind: 'space'; focus: number | null }
  | { kind: 'sphere'; slot: number; from: 'space' }
export type LiftEvent =
  | { type: 'toSpace' } | { type: 'back' } | { type: 'planetTap'; slot: number }
  | { type: 'stage'; stage: 'far' | 'mid'; slot: number | null }
export function liftOpen(slot: number): LiftPhase
// 返り値 null ＝ 覆いを閉じる
export function liftNext(phase: LiftPhase, ev: LiftEvent): LiftPhase | null
export function liftButtons(phase: LiftPhase): { back: '戻る' | '宇宙へ戻る'; toSpace: boolean }
export function liftCaption(phase: LiftPhase): { top: number | null; below: number | null }  // 上に出す和名の slot／惑星の下に出す slot
```

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, it, expect } from 'vitest'
import { liftOpen, liftNext, liftButtons, liftCaption } from '@/lib/recall/lift-phase'

describe('覆いの段（再計画 §4.1）', () => {
  it('分野ページから開くと球。戻るで閉じる', () => {
    const p = liftOpen(3)
    expect(p).toEqual({ kind: 'sphere', slot: 3, from: 'page' })
    expect(liftNext(p, { type: 'back' })).toBeNull()
    expect(liftButtons(p)).toEqual({ back: '戻る', toSpace: true })
    expect(liftCaption(p)).toEqual({ top: 3, below: null })
  })
  it('さらに宇宙へ → 宇宙（焦点なし）。宇宙の戻るで閉じる', () => {
    const s = liftNext(liftOpen(3), { type: 'toSpace' })!
    expect(s).toEqual({ kind: 'space', focus: null })
    expect(liftButtons(s)).toEqual({ back: '戻る', toSpace: false })
    expect(liftCaption(s)).toEqual({ top: null, below: null })
    expect(liftNext(s, { type: 'back' })).toBeNull()
  })
  it('宇宙で中景に寄ると焦点。名前は惑星の下。遠景に戻ると消える', () => {
    const s = liftNext(liftOpen(3), { type: 'toSpace' })!
    const m = liftNext(s, { type: 'stage', stage: 'mid', slot: 5 })!
    expect(m).toEqual({ kind: 'space', focus: 5 })
    expect(liftCaption(m)).toEqual({ top: null, below: 5 })
    expect(liftNext(m, { type: 'stage', stage: 'far', slot: null })).toEqual({ kind: 'space', focus: null })
  })
  it('中景で惑星を押すと球（宇宙から）。その戻るは宇宙へ', () => {
    const m = { kind: 'space', focus: 5 } as const
    const b = liftNext(m, { type: 'planetTap', slot: 5 })!
    expect(b).toEqual({ kind: 'sphere', slot: 5, from: 'space' })
    expect(liftButtons(b)).toEqual({ back: '宇宙へ戻る', toSpace: false })
    expect(liftNext(b, { type: 'back' })).toEqual({ kind: 'space', focus: 5 })
  })
  it('球では stage の合図を無視する（lockNear で出ないため）', () => {
    const p = liftOpen(3)
    expect(liftNext(p, { type: 'stage', stage: 'mid', slot: null })).toEqual(p)
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/lib/__tests__/recall-lift-phase.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装**

```ts
// 隠しコマンドの覆いの段（純関数）。設計 2026-09-05 再計画 §4.1 の遷移表。
export type LiftPhase =
  | { kind: 'sphere'; slot: number; from: 'page' }
  | { kind: 'space'; focus: number | null }
  | { kind: 'sphere'; slot: number; from: 'space' }
export type LiftEvent =
  | { type: 'toSpace' } | { type: 'back' } | { type: 'planetTap'; slot: number }
  | { type: 'stage'; stage: 'far' | 'mid'; slot: number | null }

export const liftOpen = (slot: number): LiftPhase => ({ kind: 'sphere', slot, from: 'page' })

export function liftNext(phase: LiftPhase, ev: LiftEvent): LiftPhase | null {
  if (phase.kind === 'sphere') {
    if (ev.type === 'back') return phase.from === 'space' ? { kind: 'space', focus: phase.slot } : null
    if (ev.type === 'toSpace') return { kind: 'space', focus: null }
    return phase
  }
  if (ev.type === 'back') return null
  if (ev.type === 'planetTap') return { kind: 'sphere', slot: ev.slot, from: 'space' }
  if (ev.type === 'stage') return { kind: 'space', focus: ev.stage === 'mid' ? ev.slot : null }
  return phase
}

export const liftButtons = (p: LiftPhase) =>
  p.kind === 'sphere' ? { back: p.from === 'space' ? '宇宙へ戻る' : '戻る', toSpace: p.from === 'page' } : { back: '戻る', toSpace: false }

export const liftCaption = (p: LiftPhase) =>
  p.kind === 'sphere' ? { top: p.slot, below: null } : { top: null, below: p.focus }
```

（`liftButtons` の `toSpace`: 宇宙から入った球にも「さらに宇宙へ」は要らない。「宇宙へ戻る」が同じ役目。）

- [ ] **Step 4: 通す・コミット**

Run: `npx vitest run src/lib/__tests__/recall-lift-phase.test.ts` → PASS

```bash
git add src/lib/recall/lift-phase.ts src/lib/__tests__/recall-lift-phase.test.ts
git commit -m "feat(recall): 覆いの段の遷移表（球→宇宙→中景→球）を純関数に"
```

---

### Task 7: `RecallLift.tsx` を段で出し分け・`RecallScreen` の配線

**Files:**
- Modify: `src/components/recall/RecallLift.tsx`
- Modify: `src/components/recall/RecallScreen.tsx`（`RecallLift` に `clusterPlanets` を渡す）
- Modify: `src/components/recall/useFieldData.ts`（Task 5 で足した `clusterPlanets` を本番でも使う）

**Interfaces:**
- Consumes: Task 4（props）・Task 6（`liftNext` 等）・`useFieldData().clusterPlanets`
- Produces: `RecallLift` の props: `{ slot, planets: Planet[] /* 星団配置 */, origin, cardOpen, onClose, onCloseCard, onDotTap }`（名前は今のまま。中身が星団配置になる）

- [ ] **Step 1: 実装**

`RecallLift` の中:

```tsx
const [phase, setPhase] = useState<LiftPhase>(() => liftOpen(slot))
const field = useRef<FieldHandle>(null)
const dispatch = (ev: LiftEvent) => {
  const next = liftNext(phase, ev)
  if (next === null) { close(); return }   // 既存の close（逆の遷移 350ms → onClose）
  setPhase(next)
}
const familyLabels = useMemo(() => FAMILY_ORDER.map((k, i) => { const c = familyCenter(i); return { text: coreEnglishOf(k), sub: FAMILY_NOUN[k], kind: k, at: [c[0], c[1] + 0.2, c[2]] as Vec3 } }), [])
const buttons = liftButtons(phase)
const caption = liftCaption(phase)
```

`RecallField` は段ごとに `key` を変えて置き直す（カメラの初期化が `props.planets` の初回にしか走らないため）:

```tsx
{phase.kind === 'sphere' ? (
  <RecallField key={`sphere-${phase.slot}`} ref={field}
    planets={planets.filter((p) => p.seat.slot === phase.slot)} center="outside" reduced={reduced} initialNear={phase.slot}
    free lockNear fanOnTouch show={{ edgeLabels: false, edgeCircles: false, fans: false, pageLabels: false, nebula: true }}
    shelf={NO_SHELF} again={NO_AGAIN} lensPageId={null} cardOpen={cardOpen}
    onFront={() => {}} onStage={() => {}} onDotTap={onDotTap} onShelfTap={() => {}} onLens={() => {}} onCloseCard={onCloseCard} />
) : (
  <RecallField key="space" ref={field}
    planets={planets} mode="cluster" center="outside" reduced={reduced} initialStage="far"
    show={{ planetLabels: false, nebula: true }} familyLabels={familyLabels}
    onPlanetTap={(s) => dispatch({ type: 'planetTap', slot: s })}
    onStage={(s, sl) => { if (s === 'mid' || s === 'far') dispatch({ type: 'stage', stage: s, slot: sl }) }}
    shelf={NO_SHELF} again={NO_AGAIN} lensPageId={null} cardOpen={false}
    onFront={() => {}} onDotTap={() => {}} onShelfTap={() => {}} onLens={() => {}} onCloseCard={onCloseCard} />
)}
```

上の文字（`caption.top`）は今の和名・英名ブロックのまま。惑星の下の名前（`caption.below`）は `top: 61%` の DOM（試作の `.caption`。0.5 秒でふわっと。`motion-reduce` では即時）。書体は Task 8 の CSS 変数。

下のボタン: `buttons.back` の文言で「戻る／宇宙へ戻る」→ `dispatch({ type: 'back' })`。`buttons.toSpace` のとき「さらに宇宙へ」→ `dispatch({ type: 'toSpace' })`。

Esc: 球（`from: 'page'`）と宇宙では今までどおり `close`。球（`from: 'space'`）では `dispatch({ type: 'back' })`（宇宙へ）。カードが上にあるときは譲る（既存）。

`lockNear` により、球の中で `RecallField` から `onStage('mid')` は届かなくなる。今の「`onStage(stage) => stage !== 'near' なら close`」は消す。

`RecallScreen`: `<RecallLift ... planets={data.clusterPlanets} />`。`useFieldData` に `clusterSeats = fieldLayout(counts, 'cluster')` を足し、`planets` と同じ `useMemo` で `clusterPlanets` を組む（dots・summary・pages は同じ値を共有してよい）。

- [ ] **Step 2: 型・テスト・実画面**

Run: `npx tsc --noEmit -p tsconfig.json && npm test` → PASS

playwright で `/dev/recall-screen`（本物の `RecallScreen`）から: 分野ページ → 紋章 → 球（触れて弧が出る）→ さらに宇宙へ → 族名を押す → 惑星を押す（中景・名前が下に出る）→ もう一度押す（球）→ 宇宙へ戻る → 戻る（分野ページ）。各段でスクショ。Esc の経路も1回。**カードが開いている球で外側タップ**が今までどおりカードだけ閉じること（既存の不具合対策の回帰）。

- [ ] **Step 3: コミット**

```bash
git add src/components/recall/RecallLift.tsx src/components/recall/RecallScreen.tsx src/components/recall/useFieldData.ts
git commit -m "feat(recall): 隠しコマンドを球→宇宙→中景→球の段に切り直す（RecallLift を lift-phase で駆動）"
```

---

### Task 8: 書体（Jost 300・Noto Sans JP 300）

**Files:**
- Modify: `src/app/layout.tsx`（`next/font/google` で `Jost` を足し、CSS 変数 `--font-jost` を `<html>` に付ける。`Noto_Sans_JP` の `weight` に `'300'` を足す）
- Modify: `src/lib/recall/field-render.ts`（`FONT_LATIN` の `Jost` を CSS 変数経由の family 名にする。`next/font` は family 名を生成するので、`FONT_LATIN` は `getComputedStyle(document.documentElement).getPropertyValue('--font-jost')` を1回読んで組み立てる関数 `fontLatin()` にする）
- Modify: `src/components/recall/RecallField.tsx`（初回の `frame` の前に `document.fonts.load(fontLatin())` と `document.fonts.load(FONT_JP)` を待つ。待てない環境は即描く）
- Modify: `src/components/recall/RecallLift.tsx`（上の文字と惑星の下の名前に `font-[family-name:var(--font-jost)]`／`font-light`）

- [ ] **Step 1: 実装**

`layout.tsx`:

```ts
import { Noto_Sans_JP, Jost } from 'next/font/google'
const notoSansJP = Noto_Sans_JP({ subsets: ['latin'], weight: ['300', '400', '500', '700'], display: 'swap', preload: false })
const jost = Jost({ subsets: ['latin'], weight: ['300'], display: 'swap', preload: false, variable: '--font-jost' })
// <html className={`${notoSansJP.className} ${jost.variable}`}>（既存の className の付け方に合わせる）
```

`field-render.ts`:

```ts
let latinFamily: string | null = null
export function fontLatin(): string {
  if (latinFamily === null) {
    const v = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue('--font-jost').trim() : ''
    latinFamily = v || 'Jost, "Helvetica Neue", sans-serif'
  }
  return `300 11px ${latinFamily}`
}
```

族名のブロックで `ctx.font = fontLatin()`。テスト（DOM 無し）では `'300 11px Jost, "Helvetica Neue", sans-serif'` に落ちる。

`letterSpacing` の対応確認: `'letterSpacing' in ctx` が偽なら、族名を1字ずつ `fillText` で置く（字間 = フォントサイズ×0.32）。**iOS Safari の実機で確かめて結果を設計書 §4.4 に書く**（未確認事項）。

- [ ] **Step 2: 確認・コミット**

Run: `npx tsc --noEmit -p tsconfig.json && npm test && npm run build` → PASS

playwright（ライト・ダーク）で族名が細い幾何学書体・字間広めで出ていること、上の和名が細字になっていることを撮る。

```bash
git add src/app/layout.tsx src/lib/recall/field-render.ts src/components/recall/RecallField.tsx src/components/recall/RecallLift.tsx
git commit -m "feat(recall): 宇宙と球の文字を Jost 300・Noto Sans JP 300 にそろえる"
```

---

### Task 9: 仕上げ

- [ ] **Step 1: 全件**

Run: `npm test && npx tsc --noEmit -p tsconfig.json && npm run build` → PASS

- [ ] **Step 2: 設計書の更新**

Task 5 で定数を変えていれば §4.3 に反映。`letterSpacing` の実機結果を §4.4 に書く。`2026-09-05-recall-space-design.md` の冒頭に「本書は `2026-09-05-recall-replan-design.md` で置き換えた」を1行足す。

- [ ] **Step 3: マージと本番**

`superpowers:finishing-a-development-branch`。push は tatsukiさんの承認を取る。デプロイ Ready 後、本番の Recall タブで紋章 → 球 → 宇宙 が動くことを実機（iPhone）で見てもらう（記憶 `merge-is-not-deploy`）。**未確認のまま残っているもの**（iOS Safari の `fixed`＋`transform` の追従・reduced motion）はこの実機確認でまとめて見る。

---

## 自己点検

- 設計 §4.1 遷移表 → Task 6・7。§4.2 球 → Task 4（free・lockNear・fanOnTouch）＋ Task 7（show）。§4.3 配置・カメラ・ガス・族名・惑星名・押す操作 → Task 1〜4・7。§4.4 書体 → Task 8。§4.5 のファイル表 → 各 Task。§6 テスト → Task 1・2・3・6（純関数）と Task 5・7（playwright・1コマ 8ms）
- 型の一致: `FieldFrameArgs.show/familyLabels/familyFocus`（Task 3）を Task 4・7 が渡す。`FieldHandle.backToFar`（Task 4）は Task 7 では使わない（`key` で置き直すため）が、dev ハーネス（Task 5）で使う。`LiftPhase/LiftEvent`（Task 6）を Task 7 が使う。`FAMILY_ORDER` は Task 1（`field-cluster.ts`）と計画A（`families.ts`）で二重定義になる → 両方入ったら `families.ts` から import する1本にする（Task 9 で確認）
- 試作にあって本番に持ち込まないもの: 案1〜3の切り替え・族名の常時 sub（`always`）・惑星名の常時表示（`labelMinR` の縮小）・粒／ガスの切り替え
