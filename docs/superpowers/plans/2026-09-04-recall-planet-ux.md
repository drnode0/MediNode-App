# Recall 惑星の中の体験 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 惑星 field（席＝惑星・芯＝族）の中に、記憶の状態の居場所5段・惑星ごとの「確かめる」・3段の寄り方（視点は外から／中心から）・記事の扇形を入れ、`RecallScreen` を単一球から field に差し替える。

**Architecture:** 配置と状態の幾何は `src/lib/recall/field.ts`（純関数）、描画は `src/lib/recall/field-render.ts`（Canvas 2D・位置と状態を受けて描くだけ）、操作と RAF は新しい `src/components/recall/RecallField.tsx`、画面の組み立ては `RecallScreen.tsx`。芯は `cores.ts` を変えずに `drawCore3D` の `yaw`/`pitch` へ手回しを足す。データは既存の `useRecallData` に席ごとの点と記事の扇形を足す。

**Tech Stack:** Next.js (App Router) / TypeScript / Canvas 2D / vitest（node 環境。canvas は偽の ctx で記録する）

**Spec:** `docs/superpowers/specs/2026-09-04-recall-planet-ux-design.md`（決定8点は末尾「決定の記録」）
**ラフ（挙動の正）:** https://claude.ai/code/artifact/c89ace96-7bcb-43c1-9c63-828edb3afe20 （ラフのソースはセッションの一時領域にあり、リポジトリには無い。このファイルのコードが正）

## Global Constraints

- 作業ブランチは **`worktree-recall-seven-cores`**（`field.ts` / `field-render.ts` / `cores.ts` があるのはこのブランチだけ）。`superpowers:using-git-worktrees` で、このブランチから新しい worktree を切って始める。`feat/genre-seats-37` との統合（`genres.ts` の突き合わせ）は Task 12 の着手条件で、それまで main へはマージしない
- 用語: 主張・残す・確かめる・定着・離れかけ・Recall。UI 文言に「粒」「振る」「拾う」「血肉」「落ちる」「落ちかけ」を使わない
- 居場所の半径（惑星の半径＝1）: 定着 `RING_INNER − 0.14`（1.16）／残した `orbitRadius(rem)` を **2.85 で頭打ち**／読んだ 3.05／未着手 3.38±0.14
- 明るさ＝保持力: 残した `0.5 + 0.45 × rem`。定着 0.95、読んだ 0.4、未着手 0.2。離れかけ（`rem < ESCAPE_THRESHOLD`＝0.28、定着でも同じ）は `INK_HALO` で明滅（動きを減らす設定では明滅しない）
- 3段: 遠景（外から: 倍率 1.5／中心から: 視野 95°）・中景（外から: 倍率 8／中心から: 視野 15°）・近景（外から: 倍率 `0.115 / (0.42 × r)`／中心から: 視野 42°・距離 `3.45 r / (tan 21° × 0.92)`）。**近景は霧（3.38）まで画面の短辺に収まる**
- 既定の視点は「外から」。「中心から」は `localStorage` キー `medinode_recall_viewpoint_v1`（値 `outside`／`inside`）。学習記録ではないので Supabase に置かず、`PERSONAL_DEVICE_KEYS` にも入れない（動きを減らす設定と同じ扱い）
- 慣性: 減衰 `vel × exp(−2.6 × dt)`、`|vel| < 0.002` で止める。押さえて 80ms 以上止めてから離したら付けない。動きを減らす設定では付けない
- 境目の名前: 近景に入ってから 3400ms、最後の 600ms で消えていく。最初のドラッグで消す。居場所の境目は `[RING_INNER, RING_OUTER, 2.95, 3.22]`、名前は 0.98 定着／1.95 残した／2.76 離れかけ／3.06 読んだ／3.42 未着手
- 詳細ジャンル＝記事。扇形の幅＝記事の主張数、記事間の隙間 0.09 rad、扇形の弧は半径 3.62、記事名は 3.98。記事の中の主張は 節番号 → `createdAt` → `claimId` の順
- 空の惑星（主張 0）は薄い輪郭（芯の濃さ 0.35・輪郭 0.5 倍）で残し、近景には入れない。帯は主張のある席を先頭、空の席は「空の席 N」に畳む
- `src/components/recall/*.tsx` に半径・中心の数式を書かない（`Math.min(W, H)`・`H / 2`・`0.34` は `recall-viewport-single-source.test.ts` が禁じる）。投影は `field.ts` の `projectorOf` だけが持つ
- 事業数値・利用者数をコード・コメント・コミット文に書かない（公開リポ）
- テストは `npx vitest run --dir src` で回す（`.claude/worktrees/**` は除外設定済み）。`tsc --noEmit` も各 Task の最後で通す

---

## ファイル構成

| 種別 | パス | 責務 |
|---|---|---|
| Modify | `src/lib/recall/field.ts` | 居場所・明るさ（Task 1）、`FieldView`・3段・視点・投影・慣性（Task 3）、記事の扇形（Task 7） |
| Modify | `src/lib/recall/field-render.ts` | 状態で描く（Task 2）、`FieldView` で描く・境目の名前（Task 4）、扇形と記事名（Task 8）、棚（Task 10） |
| Modify | `src/lib/recall/notice.ts` | 惑星単位の文言（Task 9） |
| Modify | `src/components/recall/useRecallData.ts` | 席ごとの点・記事・離れかけ数・席で絞った候補（Task 9） |
| Create | `src/components/recall/RecallField.tsx` | canvas・操作・RAF・段の遷移・慣性（Task 5） |
| Create | `src/lib/recall/viewpoint.ts` | 視点の読み書き（`localStorage`）（Task 11） |
| Modify | `src/components/recall/RecallScreen.tsx` | field を使う画面に差し替え（Task 11） |
| Delete | `src/components/recall/RecallSphere.tsx`, `src/lib/recall/render.ts`, `src/app/dev/field/page.tsx` | 単一球と旧ハーネス（Task 2 で旧ハーネス、Task 12 で球） |
| Create | `src/app/dev/field/page.tsx` | `RecallField` を仮データで動かす判断用ハーネス（Task 6） |
| Test | `src/lib/__tests__/recall-field.test.ts`, `recall-field-render.test.ts`, `recall-field-view.test.ts`（新）, `recall-field-arcs.test.ts`（新）, `recall-field-data.test.ts`（新）, `recall-notice.test.ts`, `recall-data-hook.test.ts`, `recall-viewpoint.test.ts`（新）, `recall-viewport-single-source.test.ts` | |

---

## Task 1: 居場所5段と明るさ（`field.ts`）

**Files:**
- Modify: `src/lib/recall/field.ts`
- Test: `src/lib/__tests__/recall-field.test.ts`

**Interfaces:**
- Consumes: `orbitRadius(rem)`, `RING_INNER`, `RING_OUTER`（既存）、`ESCAPE_THRESHOLD`（`srs.ts`）、`RecallStateKind`（`types.ts`）
- Produces:
  - `SETTLED_R = 1.16`, `OVERDUE_MAX_R = 2.85`, `TOUCHED_R = 3.05`, `COLD_R = 3.38`, `COLD_JITTER = 0.14`
  - `type Place = { rr: number; y: number }`
  - `placeOf(state: RecallStateKind, rem: number, jitter?: number): Place`（`jitter` は −0.5〜0.5）
  - `brightnessOf(state: RecallStateKind, rem: number): number`
  - `isOverdue(state: RecallStateKind, rem: number): boolean`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/recall-field.test.ts` の import に `placeOf, brightnessOf, isOverdue, SETTLED_R, OVERDUE_MAX_R, TOUCHED_R, COLD_R, COLD_JITTER` を足し、末尾に追加:

```ts
// 居場所5段。中心に近いほど自分のもの。
describe('居場所', () => {
  it('中心から 定着 → 残した → 離れかけ → 読んだ → 未着手 の順に並ぶ', () => {
    const settled = placeOf('settled', 1).rr
    const keptFull = placeOf('kept', 1).rr
    const keptEdge = placeOf('kept', ESCAPE_THRESHOLD).rr
    const overdue = placeOf('kept', 0).rr
    const touched = placeOf('touched', 0).rr
    const cold = placeOf('cold', 0).rr
    expect(settled).toBe(SETTLED_R)
    expect(settled).toBeLessThan(keptFull)
    expect(keptFull).toBeCloseTo(RING_INNER, 9)
    expect(keptEdge).toBeCloseTo(RING_OUTER, 9)
    expect(overdue).toBeGreaterThan(keptEdge)
    expect(overdue).toBeLessThanOrEqual(OVERDUE_MAX_R)
    expect(touched).toBe(TOUCHED_R)
    expect(cold).toBe(COLD_R)
    expect(OVERDUE_MAX_R).toBeLessThan(TOUCHED_R)
    expect(TOUCHED_R).toBeLessThan(COLD_R)
  })

  it('離れかけは 2.85 で頭打ち（読んだの帯と当たらない）', () => {
    expect(placeOf('kept', -5).rr).toBe(OVERDUE_MAX_R)
  })

  it('定着も期限が来れば残したと同じ規則で外へ出る', () => {
    expect(placeOf('settled', ESCAPE_THRESHOLD - 0.05).rr).toBe(placeOf('kept', ESCAPE_THRESHOLD - 0.05).rr)
    expect(placeOf('settled', 0.9).rr).toBe(SETTLED_R)
  })

  it('未着手だけ上下に散る。散りは jitter に比例し、他の状態は散らない', () => {
    expect(placeOf('cold', 0, 0.5).y).toBeCloseTo(COLD_JITTER * 0.5, 9)
    expect(placeOf('cold', 0, -0.5).y).toBeCloseTo(-COLD_JITTER * 0.5, 9)
    expect(placeOf('cold', 0).y).toBe(0)
    for (const s of ['touched', 'kept', 'settled'] as const) expect(placeOf(s, 1, 0.5).y).toBe(0)
  })
})

describe('明るさ＝保持力', () => {
  it('残したは保持力に比例して明るい（忘れるほど暗い）', () => {
    expect(brightnessOf('kept', 1)).toBeCloseTo(0.95, 9)
    expect(brightnessOf('kept', 0)).toBeCloseTo(0.5, 9)
    expect(brightnessOf('kept', 0.8)).toBeGreaterThan(brightnessOf('kept', 0.3))
    expect(brightnessOf('kept', 2)).toBe(brightnessOf('kept', 1))
  })

  it('定着がいちばん明るく、読んだ・未着手は暗い', () => {
    expect(brightnessOf('settled', 1)).toBe(0.95)
    expect(brightnessOf('touched', 0)).toBe(0.4)
    expect(brightnessOf('cold', 0)).toBe(0.2)
    expect(brightnessOf('touched', 0)).toBeGreaterThan(brightnessOf('cold', 0))
  })

  it('離れかけの判定は残した・定着だけに効く', () => {
    expect(isOverdue('kept', ESCAPE_THRESHOLD - 0.01)).toBe(true)
    expect(isOverdue('settled', ESCAPE_THRESHOLD - 0.01)).toBe(true)
    expect(isOverdue('kept', ESCAPE_THRESHOLD)).toBe(false)
    expect(isOverdue('touched', 0)).toBe(false)
    expect(isOverdue('cold', 0)).toBe(false)
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run --dir src src/lib/__tests__/recall-field.test.ts`
Expected: FAIL（`placeOf` が export されていない）

- [ ] **Step 3: 実装する**

`src/lib/recall/field.ts` の import に `import type { RecallStateKind } from './types'` を足し、`orbitRadius` の直後に追加:

```ts
// ---- 居場所5段（オーナー決定 2026-09-04）----
// 中心に近いほど自分のもの、という1軸で全状態を読む。半径は惑星の半径を 1 とする単位。
//   定着 → 輪の内縁より内（SETTLED_R）
//   残した → 輪（高度＝保持力。orbitRadius）。期限切れを割っても OVERDUE_MAX_R で頭打ち
//           （現行の 3.12 まで伸ばすと、読んだの帯と当たる）
//   読んだ → 輪の外の細い帯（TOUCHED_R）。出題しない
//   未着手 → いちばん外の霧（COLD_R ± COLD_JITTER）
// 定着も期限が来れば残したと同じ規則で外へ出る（卒業させない、の帰結）。
export const SETTLED_R = RING_INNER - 0.14
export const OVERDUE_MAX_R = 2.85
export const TOUCHED_R = 3.05
export const COLD_R = 3.38
export const COLD_JITTER = 0.14

export type Place = { rr: number; y: number }

export function isOverdue(state: RecallStateKind, rem: number): boolean {
  return (state === 'kept' || state === 'settled') && rem < ESCAPE_THRESHOLD
}

// jitter は −0.5〜0.5（主張IDから決める決定的な値を渡す）。未着手の霧の上下の散り。
export function placeOf(state: RecallStateKind, rem: number, jitter = 0): Place {
  switch (state) {
    case 'settled':
      return isOverdue(state, rem) ? placeOf('kept', rem) : { rr: SETTLED_R, y: 0 }
    case 'kept':
      return { rr: Math.min(OVERDUE_MAX_R, orbitRadius(rem)), y: 0 }
    case 'touched':
      return { rr: TOUCHED_R, y: 0 }
    default:
      return { rr: COLD_R, y: jitter * COLD_JITTER }
  }
}

// 明るさ＝記憶の残り（設計書 09-02）。現行 field-render は忘れるほど明るかったので、ここで向きを正す。
export function brightnessOf(state: RecallStateKind, rem: number): number {
  switch (state) {
    case 'settled': return 0.95
    case 'kept': return 0.5 + 0.45 * Math.max(0, Math.min(1, rem))
    case 'touched': return 0.4
    default: return 0.2
  }
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run --dir src src/lib/__tests__/recall-field.test.ts`
Expected: PASS（既存のテストも全部通る）

- [ ] **Step 5: コミット**

```bash
git add src/lib/recall/field.ts src/lib/__tests__/recall-field.test.ts
git commit -m "feat(recall): 居場所5段と明るさ＝保持力を field に置く"
```

---

## Task 2: 状態で描く（`field-render.ts`）と旧ハーネスの撤去

**Files:**
- Modify: `src/lib/recall/field-render.ts`（`ClaimDot`・`drawPlanet` を書き換え）
- Delete: `src/app/dev/field/page.tsx`（Task 6 で `RecallField` 版として作り直す）
- Test: `src/lib/__tests__/recall-field-render.test.ts`

**Interfaces:**
- Consumes: `placeOf`, `brightnessOf`, `isOverdue`（Task 1）、`drawCore3D`, `coreSeatSpin`, `INK_COOL`, `INK_HALO`（`cores.ts`）
- Produces:
  - `type ClaimDot = { claimId: string; a: number; state: RecallStateKind; rem: number; jitter: number; page: number }`（`b`・`seen`・`UnseenPlace`・`DEFAULT_UNSEEN` は廃止。`page` は Task 8 の扇形で使う。それまでは 0）
  - `FieldFrame` から `unseen` を外す（`cam`・`focus` は Task 4 まで残す）
  - `drawField(ctx, frame): PlanetHit[]`（戻り値はまだ変えない）

- [ ] **Step 1: テストを書き換える**

`src/lib/__tests__/recall-field-render.test.ts` を次の内容に置き換える（`dots` の作り方と、表面の置き方のテストを変える）:

```ts
import { describe, it, expect } from 'vitest'
import { drawField, type ClaimDot, type FieldFrame } from '@/lib/recall/field-render'
import { buildField, focusPointOf, frontRotYFor, COLD_R, TOUCHED_R, RING_OUTER, RING_PITCH, type FieldLayout } from '@/lib/recall/field'
import { GENRE_SEATS } from '@/lib/recall/genres'
import { ESCAPE_THRESHOLD } from '@/lib/recall/srs'
import type { RecallStateKind } from '@/lib/recall/types'

const COUNTS = GENRE_SEATS.map((_, i) => (i % 3 === 0 ? 0 : 10 + ((i * 7) % 30)))

function dots(n: number, state: RecallStateKind, rem = 0.6): ClaimDot[] {
  return Array.from({ length: n }, (_, i) => ({ claimId: `c${state}${i}`, a: (i / n) * Math.PI * 2, state, rem, jitter: (i % 5) / 5 - 0.5, page: 0 }))
}

function frame(over: Partial<FieldFrame> = {}): FieldFrame {
  const claims = new Map<number, ClaimDot[]>()
  COUNTS.forEach((n, i) => claims.set(i, dots(n, i % 2 === 0 ? 'kept' : 'cold')))
  return {
    W: 900, H: 560, cam: { rotY: 0.4, rotX: -0.18, zoom: 1 },
    field: buildField(COUNTS, 'sphere'), claims, t: 3.1, reduced: false,
    ...over,
  }
}

// Canvas の代わり（このファイル内だけの記録用の偽物）。Path2D は node に無い。
function recorder() {
  const arcs: { x: number; y: number; r: number; alpha: number; fill: string }[] = []
  const texts: string[] = []
  let strokes = 0
  const ctx = {
    globalAlpha: 1, lineWidth: 1, lineCap: '', textAlign: '', textBaseline: '', font: '',
    strokeStyle: '' as unknown, fillStyle: '' as unknown,
    clearRect() {}, fillRect() {}, fillText(s: string) { texts.push(s) }, measureText(s: string) { return { width: s.length * 6 } },
    save() {}, restore() {},
    beginPath() {},
    moveTo() {}, lineTo() {},
    arc(x: number, y: number, r: number) { arcs.push({ x, y, r, alpha: ctx.globalAlpha, fill: String(ctx.fillStyle) }) },
    fill() {},
    stroke() { strokes++ },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, arcs, texts, strokes: () => strokes }
}

// 惑星 slot の周りに描かれた小さな点（芯・輪郭・要約の光を除く）の、惑星中心からの距離と濃さ。
function ownDots(r: ReturnType<typeof recorder>, hit: { X: number; Y: number; S: number }) {
  return r.arcs
    .filter((x) => x.r <= 3 && Math.hypot(x.x - hit.X, x.y - hit.Y) > hit.S * 1.05)
    .map((x) => ({ d: Math.hypot(x.x - hit.X, x.y - hit.Y) / hit.S, alpha: x.alpha, r: x.r, fill: x.fill }))
}

describe('field を描く', () => {
  it('どの並べ方でも例外なく描ける', () => {
    for (const layout of ['sphere', 'ring'] as FieldLayout[]) {
      const r = recorder()
      expect(() => drawField(r.ctx, frame({ field: buildField(COUNTS, layout) })), layout).not.toThrow()
      expect(r.strokes(), layout).toBeGreaterThan(0)
    }
  })

  it('画面に入っている惑星だけを返し、席番号が付いている', () => {
    const hits = drawField(recorder().ctx, frame())
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.length).toBeLessThanOrEqual(GENRE_SEATS.length)
    for (const h of hits) {
      expect(h.slot).toBeGreaterThanOrEqual(0)
      expect(h.S).toBeGreaterThan(0)
      expect(Number.isFinite(h.X) && Number.isFinite(h.Y)).toBe(true)
    }
    expect(new Set(hits.map((h) => h.slot)).size).toBe(hits.length)
  })

  it('画面の外へ出た惑星は描かない（寄ると数が減る）', () => {
    const wide = drawField(recorder().ctx, frame({ cam: { rotY: 0, rotX: 0, zoom: 1 } }))
    const near = drawField(recorder().ctx, frame({ cam: { rotY: 0, rotX: 0, zoom: 6 } }))
    expect(near.length).toBeLessThan(wide.length)
  })

  it('帯で選んだ惑星は、どの倍率でも画面のど真ん中に来る', () => {
    const field = buildField(COUNTS, 'ring')
    for (const target of [field[0], field[9], field[20], field[field.length - 1]]) {
      const rotY = frontRotYFor(target.at)
      for (const zoom of [1, 3.4, 8]) {
        const hits = drawField(recorder().ctx, frame({ field, cam: { rotY, rotX: RING_PITCH, zoom }, focus: focusPointOf('ring', rotY) }))
        const front = hits.find((h) => h.slot === target.slot)
        expect(front, `slot${target.slot} zoom${zoom}`).toBeDefined()
        expect(Math.hypot(front!.X - 900 / 2, front!.Y - 560 / 2), `slot${target.slot} zoom${zoom}`).toBeLessThan(1)
      }
    }
  })

  it('どこで手を止めても、8倍で惑星が画面に残る（空っぽにならない）', () => {
    const field = buildField(COUNTS, 'ring')
    for (const rotY of [0, 0.37, 1.1, 2.6, 4.2, 5.9]) {
      const hits = drawField(recorder().ctx, frame({ field, cam: { rotY, rotX: RING_PITCH, zoom: 8 }, focus: focusPointOf('ring', rotY) }))
      expect(hits.length, `rotY${rotY}`).toBeGreaterThan(0)
      const near = Math.min(...hits.map((h) => Math.hypot(h.X - 900 / 2, h.Y - 560 / 2)))
      expect(near, `rotY${rotY}`).toBeLessThan(560 / 2)
    }
  })

  it('見る先を渡さなければ field の中心を見る（球状のふるまいは変わらない）', () => {
    const hits = drawField(recorder().ctx, frame({ field: buildField(COUNTS, 'sphere'), cam: { rotY: 0, rotX: -0.18, zoom: 1 } }))
    expect(hits.some((h) => h.X < 900 / 2)).toBe(true)
    expect(hits.some((h) => h.X > 900 / 2)).toBe(true)
  })

  // 居場所5段が描画に出ること。距離は惑星の半径＝1 の単位で見る（見下ろしの潰れがあるので幅を持たせる）。
  it('読んだは輪の外、未着手はさらに外の霧に描かれる', () => {
    const field = buildField(COUNTS, 'sphere')
    const at = (state: RecallStateKind) => {
      const claims = new Map<number, ClaimDot[]>([[2, dots(24, state, 0.9)]])
      const r = recorder()
      const hit = drawField(r.ctx, frame({ field, claims, cam: { rotY: 0, rotX: 0, zoom: 3 } })).find((h) => h.slot === 2)!
      const ds = ownDots(r, hit).map((x) => x.d)
      return { max: Math.max(...ds), min: Math.min(...ds) }
    }
    expect(at('kept').max).toBeLessThan(RING_OUTER * 1.02)
    expect(at('touched').max).toBeCloseTo(TOUCHED_R, 0)
    expect(at('cold').max).toBeGreaterThan(COLD_R - 0.3)
    expect(at('touched').min).toBeGreaterThan(at('kept').max * 0.98)
  })

  it('残したは保持力が高いほど明るい（忘れるほど暗い）', () => {
    const field = buildField(COUNTS, 'sphere')
    const alpha = (rem: number) => {
      const claims = new Map<number, ClaimDot[]>([[2, dots(12, 'kept', rem)]])
      const r = recorder()
      const hit = drawField(r.ctx, frame({ field, claims, cam: { rotY: 0, rotX: 0, zoom: 3 } })).find((h) => h.slot === 2)!
      const own = ownDots(r, hit)
      return own.reduce((a, x) => a + x.alpha, 0) / own.length
    }
    expect(alpha(0.95)).toBeGreaterThan(alpha(0.4))
  })

  it('離れかけは光の色で、まだ確かな主張より外側に大きく描かれる', () => {
    const field = buildField(COUNTS, 'sphere')
    const at = (rem: number) => {
      const claims = new Map<number, ClaimDot[]>([[2, dots(24, 'kept', rem)]])
      const r = recorder()
      const hit = drawField(r.ctx, frame({ field, claims, cam: { rotY: 0, rotX: 0, zoom: 3 } })).find((h) => h.slot === 2)!
      const own = ownDots(r, hit)
      return { far: Math.max(...own.map((x) => x.d)), size: Math.max(...own.map((x) => x.r)), halo: own.some((x) => x.fill === '#F6E7B8') }
    }
    const fresh = at(0.95), overdue = at(ESCAPE_THRESHOLD - 0.05)
    expect(overdue.far).toBeGreaterThan(fresh.far)
    expect(overdue.size).toBeGreaterThan(fresh.size)
    expect(overdue.halo).toBe(true)
    expect(fresh.halo).toBe(false)
  })

  it('動きを減らす設定では離れかけが明滅しない（時刻を変えても同じ濃さ）', () => {
    const field = buildField(COUNTS, 'sphere')
    const claims = new Map<number, ClaimDot[]>([[2, dots(6, 'kept', 0.1)]])
    const alphas = (t: number) => {
      const r = recorder()
      const hit = drawField(r.ctx, frame({ field, claims, t, reduced: true, cam: { rotY: 0, rotX: 0, zoom: 3 } })).find((h) => h.slot === 2)!
      return ownDots(r, hit).map((x) => x.alpha.toFixed(3)).join(',')
    }
    expect(alphas(1)).toBe(alphas(2.7))
  })

  it('遠景（惑星が小さい）では、離れかけの数だけ光の点を惑星の外に添える', () => {
    const field = buildField(COUNTS, 'sphere')
    const claims = new Map<number, ClaimDot[]>([[2, [...dots(3, 'kept', 0.1), ...dots(10, 'kept', 0.9)]]])
    const r = recorder()
    const hit = drawField(r.ctx, frame({ field, claims, cam: { rotY: 0, rotX: 0, zoom: 1 } })).find((h) => h.slot === 2)!
    expect(hit.S).toBeLessThan(22)
    const halos = r.arcs.filter((x) => x.fill === '#F6E7B8' && Math.abs(Math.hypot(x.x - hit.X, x.y - hit.Y) - (hit.S + 5)) < 0.5)
    expect(halos).toHaveLength(3)
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run --dir src src/lib/__tests__/recall-field-render.test.ts`
Expected: FAIL（`ClaimDot` に `seen` が要る／`unseen` が無い、で型と描画が合わない）

- [ ] **Step 3: `field-render.ts` を書き換える**

`src/lib/recall/field-render.ts` を次の内容に置き換える:

```ts
// 惑星 field の描画。配置（field.ts）と芯（cores.ts）を受けて Canvas 2D に描くだけ。
// 居場所5段（field.ts の placeOf）: 定着は輪の内縁より内、残したは輪（高度＝保持力）、
// 離れかけは輪の外縁を割って光る、読んだは輪の外の細い帯、未着手はいちばん外の霧。
import { placeOf, brightnessOf, isOverdue, RING_INNER, RING_OUTER, type FieldCamera, type Planet } from './field'
import type { Vec3 } from './layout'
import type { RecallStateKind } from './types'
import { drawCore3D, coreSeatSpin, INK_COOL, INK_HALO, INK_WHITE } from './cores'

// 主張1つの見え方。a は惑星の上での向き（経度）、jitter は −0.5〜0.5（未着手の霧の散り）、page は記事の添字（扇形で使う）。
export type ClaimDot = { claimId: string; a: number; state: RecallStateKind; rem: number; jitter: number; page: number }

export type { FieldCamera } from './field'
export type FieldFrame = {
  W: number; H: number
  cam: FieldCamera
  field: Planet[]
  claims: Map<number, ClaimDot[]>
  t: number
  reduced: boolean
  focus?: Vec3
  bg?: string
}

const DIM = '#7C8DA6'
const LABEL = '#A9B8CC'
const TOUCHED = '#8FA3BD'
// 芯が読める大きさ。これより小さい惑星には名前を付けず、要約の光だけ添える。
export const LABEL_MIN_S = 22

export type PlanetHit = { slot: number; X: number; Y: number; S: number }

export function drawField(ctx: CanvasRenderingContext2D, a: FieldFrame): PlanetHit[] {
  const { W, H, cam, t } = a
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = a.bg ?? '#0B1524'
  ctx.fillRect(0, 0, W, H)

  const R = Math.min(W, H) * 0.42 * cam.zoom
  const cx = W / 2, cy = H / 2
  const cyw = Math.cos(cam.rotY), syw = Math.sin(cam.rotY)
  const cp = Math.cos(cam.rotX), sp = Math.sin(cam.rotX)
  const place = (v: Vec3) => {
    const x1 = v[0] * cyw + v[2] * syw, z1 = -v[0] * syw + v[2] * cyw
    const y2 = v[1] * cp - z1 * sp, z2 = v[1] * sp + z1 * cp
    const persp = 1 / (1 + z2 * 0.22)
    return { X: x1 * R * persp, Y: -y2 * R * persp, Z: z2, persp }
  }
  const f = place(a.focus ?? [0, 0, 0])
  const shown = a.field.map((p) => {
    const q = place(p.at)
    return { p, X: cx + q.X - f.X, Y: cy + q.Y - f.Y, Z: q.Z, S: p.r * R * q.persp }
  }).sort((m, n) => n.Z - m.Z)

  const hits: PlanetHit[] = []
  for (const s of shown) {
    const reach = s.S * RING_OUTER * 1.3
    if (s.X + reach < 0 || s.X - reach > W || s.Y + reach < 0 || s.Y - reach > H) continue
    const far = 0.45 + 0.55 * ((1 - s.Z) / 2)
    drawPlanet(ctx, s.p, s.X, s.Y, s.S, far, a.claims.get(s.p.slot) ?? [], t, a.reduced)
    hits.push({ slot: s.p.slot, X: s.X, Y: s.Y, S: s.S })
  }
  ctx.globalAlpha = 1
  return hits
}

// 状態1つの見え方（色・濃さ・大きさ・後光）。明滅は離れかけだけ、動きを減らす設定では止める。
export function lookOf(c: ClaimDot, t: number, reduced: boolean): { ink: string; alpha: number; size: number; glow: boolean } {
  if (isOverdue(c.state, c.rem)) {
    return { ink: INK_HALO, alpha: reduced ? 0.9 : 0.6 + 0.38 * Math.sin(t * 3.2 + c.a * 3), size: 1.9, glow: true }
  }
  const alpha = brightnessOf(c.state, c.rem)
  switch (c.state) {
    case 'settled': return { ink: INK_WHITE, alpha, size: 1.35, glow: true }
    case 'kept': return { ink: INK_COOL, alpha, size: 1.15, glow: false }
    case 'touched': return { ink: TOUCHED, alpha, size: 1.0, glow: false }
    default: return { ink: DIM, alpha, size: 0.9, glow: false }
  }
}

function drawPlanet(
  ctx: CanvasRenderingContext2D, p: Planet, X: number, Y: number, S: number, far: number,
  claims: ClaimDot[], t: number, reduced: boolean,
): void {
  const spin = coreSeatSpin(p.slot)
  const tt = reduced ? 0 : t
  const mine = claims.filter((c) => c.state === 'kept' || c.state === 'settled')
  const overdue = claims.filter((c) => isOverdue(c.state, c.rem))
  const avgRem = mine.length ? mine.reduce((a, c) => a + Math.max(0, Math.min(1, c.rem)), 0) / mine.length : 0
  const empty = p.n === 0

  // 芯。空の惑星は薄く残す（席が固定であること・これから増える場所が見える）。
  ctx.save()
  ctx.globalAlpha = far * (empty ? 0.35 : 1)
  drawCore3D(ctx, { cx: X, cy: Y, CR: S * 0.42 * spin.scale, kind: p.kind, t: tt * spin.rate, reduced: tt === 0, pitch: spin.tilt })
  ctx.restore()

  // 輪郭＝要約。残した主張の平均保持力で明るさが決まる（何も残していなければ薄い輪郭だけ）。
  ctx.globalAlpha = (0.16 + 0.42 * avgRem) * far * (empty ? 0.5 : 1)
  ctx.strokeStyle = INK_COOL
  ctx.lineWidth = 0.8
  ctx.beginPath(); ctx.arc(X, Y, S, 0, Math.PI * 2); ctx.stroke()

  // 遠景の要約: 離れかけの数だけ光の点（上限5）。芯も点も読めない大きさのときだけ。
  if (S < LABEL_MIN_S && overdue.length) {
    ctx.fillStyle = INK_HALO
    ctx.globalAlpha = 0.85 * far
    for (let i = 0; i < Math.min(5, overdue.length); i++) {
      const ang = -Math.PI * 0.35 + i * 0.22
      ctx.beginPath(); ctx.arc(X + Math.cos(ang) * (S + 5), Y + Math.sin(ang) * (S + 5), 1.6, 0, Math.PI * 2); ctx.fill()
    }
  }

  const ptilt = spin.tilt * 0.35
  const sz = Math.max(1, Math.min(4.4, S / 38))
  const drift = reduced ? 0 : t * 0.05
  for (const c of claims) {
    const o = placeOf(c.state, c.rem, c.jitter)
    const ang = c.a + drift / o.rr
    const ox = Math.cos(ang) * o.rr * S, oz = Math.sin(ang) * o.rr * S
    const px = X + ox
    const py = Y - (o.y * S + oz * Math.sin(ptilt))
    const look = lookOf(c, t, reduced)
    const r = look.size * sz
    if (look.glow && S > LABEL_MIN_S) {
      ctx.globalAlpha = look.alpha * far * 0.25; ctx.fillStyle = look.ink
      ctx.beginPath(); ctx.arc(px, py, r * 2.6, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = look.alpha * far
    ctx.fillStyle = look.ink
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2); ctx.fill()
  }

  // 名前と件数。小さいうちは出さない（37個ぶん出すと字だけの画面になる）。
  if (S > LABEL_MIN_S) {
    ctx.globalAlpha = 0.6 * far
    ctx.fillStyle = LABEL
    ctx.textAlign = 'center'
    ctx.font = '400 10px "Zen Kaku Gothic New",sans-serif'
    ctx.fillText(empty ? p.label : `${p.label}　${p.n}`, X, Y + S * RING_INNER + 12)
    if (overdue.length) { ctx.fillStyle = INK_HALO; ctx.fillText(`離れかけ ${overdue.length}`, X, Y + S * RING_INNER + 26) }
  }
  ctx.globalAlpha = 1
}
```

- [ ] **Step 4: 旧ハーネスを消し、型を通す**

```bash
git rm src/app/dev/field/page.tsx
npx tsc --noEmit
```
Expected: エラーなし（`page.tsx` 以外に `DEFAULT_UNSEEN`・`UnseenPlace` の参照は無い。あれば `grep -rn "UnseenPlace\|DEFAULT_UNSEEN\|seen:" src/` で洗って直す）

- [ ] **Step 5: 通ることを確かめる**

Run: `npx vitest run --dir src src/lib/__tests__/recall-field-render.test.ts src/lib/__tests__/recall-field.test.ts`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add -A src/lib/recall/field-render.ts src/lib/__tests__/recall-field-render.test.ts src/app/dev/field
git commit -m "feat(recall): 惑星の点を居場所5段で描く。明るさ＝保持力、離れかけは光で明滅、遠景は要約の光"
```

---
## Task 3: `FieldView`（3段・視点・投影・慣性）を `field.ts` に置く

**Files:**
- Modify: `src/lib/recall/field.ts`
- Test: `src/lib/__tests__/recall-field-view.test.ts`（新規）

**Interfaces:**
- Consumes: `Planet`, `RING_PITCH`, `DEFAULT_ZOOM`, `frontRotYFor`, `focusPointOf`, `COLD_R`（既存・Task 1）
- Produces（すべて純関数）:
  - `type Stage = 'far' | 'mid' | 'near'`, `type Viewpoint = 'outside' | 'inside'`
  - `type FieldView = { stage; viewpoint; rotY; rotX; zoom; focus: Vec3; pitch; fov; eye: Vec3; nearSlot: number | null; spin: number }`
  - `type Projected = { X: number; Y: number; Z: number; k: number }`（`Z` は小さいほど手前、`k` はその点での拡大率 px/単位）
  - `initialView(viewpoint, rotY): FieldView`
  - `viewFor(cur, stage, planets, nearSlot): FieldView`（段の行き先）
  - `settleView(v, planets): FieldView`（アニメーションが無いときの毎フレームの規則）
  - `lerpView(a, b, k): FieldView`
  - `dragView(v, dx, dy): FieldView`
  - `coast(vel, dt): number`, `coastView(v, vel, dt): FieldView`, `COAST_STOP = 0.002`
  - `projectorOf(v, W, H): (p: Vec3) => Projected | null`
  - `zoomForPlanet(p)`, `distForPlanet(p)`, `eyeFor(p, yaw, pitch)`, `basisOf(yaw, pitch)`, `nearestTurn(cur, want)`
  - 定数 `FAR_ZOOM = 1.5`, `MID_ZOOM = DEFAULT_ZOOM`, `NEAR_PITCH_OUTSIDE = -0.62`, `NEAR_PITCH_INSIDE = 0.55`, `NEAR_TILT_MIN = 0.05`, `NEAR_TILT_MAX = 1.35`, `INSIDE_FOV_FAR/MID/NEAR`, `INSIDE_EYE_Y_FAR = 0.24`, `INSIDE_EYE_Y_MID = 0.16`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/recall-field-view.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  buildField, frontRotYFor, frontSlotOf, initialView, viewFor, settleView, lerpView, dragView, coast, coastView, projectorOf,
  zoomForPlanet, nearestTurn, COLD_R, RING_PITCH, FAR_ZOOM, MID_ZOOM, NEAR_TILT_MIN, NEAR_TILT_MAX, COAST_STOP,
  type FieldView, type Viewpoint, type Stage,
} from '@/lib/recall/field'
import { GENRE_SEATS } from '@/lib/recall/genres'

const COUNTS = GENRE_SEATS.map((_, i) => (i % 3 === 0 ? 0 : 10 + ((i * 7) % 30)))
const field = buildField(COUNTS, 'ring')
const populated = field.filter((p) => p.n > 0)
const VIEWPOINTS: Viewpoint[] = ['outside', 'inside']
const W = 900, H = 560

describe('段の行き先', () => {
  it('中景の既定は外から見る・8倍・環状の傾き', () => {
    const v = initialView('outside', 0.3)
    expect(v.stage).toBe('mid'); expect(v.viewpoint).toBe('outside')
    expect(v.zoom).toBe(MID_ZOOM); expect(v.rotX).toBe(RING_PITCH); expect(v.rotY).toBe(0.3)
    expect(v.nearSlot).toBeNull(); expect(v.spin).toBe(0)
  })

  it('遠景は 1.5 倍で field の中心を見る。中景へ戻すとリングの手前側を見る', () => {
    const mid = initialView('outside', 1.0)
    const far = viewFor(mid, 'far', field, null)
    expect(far.stage).toBe('far'); expect(far.zoom).toBe(FAR_ZOOM); expect(far.focus).toEqual([0, 0, 0])
    const back = viewFor(far, 'mid', field, null)
    expect(back.zoom).toBe(MID_ZOOM); expect(back.focus[1]).toBe(0); expect(Math.hypot(...back.focus)).toBeCloseTo(1, 9)
  })

  it('近景はその惑星を正面に回し、見る先を惑星に固定する（外から）', () => {
    const p = populated[3]
    const v = viewFor(initialView('outside', 0), 'near', field, p.slot)
    expect(v.stage).toBe('near'); expect(v.nearSlot).toBe(p.slot); expect(v.focus).toEqual(p.at)
    expect(v.zoom).toBeCloseTo(zoomForPlanet(p), 9)
    expect(frontSlotOf(field, v.rotY)).toBe(p.slot)
  })

  it('近景は、いちばん外の霧まで画面の短辺に収まる（両方の視点・主張のある全席）', () => {
    for (const vp of VIEWPOINTS) {
      for (const p of populated) {
        const v = settleView(viewFor(initialView(vp, 0), 'near', field, p.slot), field)
        const proj = projectorOf(v, W, H)
        const center = proj(p.at)!
        expect(Math.hypot(center.X - W / 2, center.Y - H / 2), `${vp} slot${p.slot} center`).toBeLessThan(2)
        for (const ang of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
          const q = proj([p.at[0] + Math.cos(ang) * COLD_R * p.r, p.at[1], p.at[2] + Math.sin(ang) * COLD_R * p.r])
          expect(q, `${vp} slot${p.slot} ang${ang}`).not.toBeNull()
          expect(q!.X, `${vp} slot${p.slot} ang${ang}`).toBeGreaterThan(0); expect(q!.X).toBeLessThan(W)
          expect(q!.Y, `${vp} slot${p.slot} ang${ang}`).toBeGreaterThan(0); expect(q!.Y).toBeLessThan(H)
        }
      }
    }
  })

  it('近景から中景へ戻すと、席と掴んだ回転が消え、傾きは環状の定位置に戻る', () => {
    const p = populated[0]
    const near = dragView(viewFor(initialView('outside', 0), 'near', field, p.slot), 40, 30)
    const mid = viewFor(near, 'mid', field, null)
    expect(mid.nearSlot).toBeNull(); expect(mid.spin).toBe(0); expect(mid.rotX).toBe(RING_PITCH); expect(mid.stage).toBe('mid')
  })

  it('空の惑星は近景の行き先にならない（中景のまま）', () => {
    const empty = field.find((p) => p.n === 0)!
    const v = viewFor(initialView('outside', 0), 'near', field, empty.slot)
    expect(v.stage).toBe('mid'); expect(v.nearSlot).toBeNull()
  })

  it('半周以内で届く側へ回す', () => {
    expect(nearestTurn(0.1, 6.2)).toBeCloseTo(6.2 - Math.PI * 2, 9)
    expect(nearestTurn(6.2, 0.1)).toBeCloseTo(0.1 + Math.PI * 2, 9)
    expect(nearestTurn(1, 1.5)).toBe(1.5)
  })
})

describe('ドラッグと慣性', () => {
  const mid = initialView('outside', 0.5)
  it('遠景・中景は横だけ回る。縦に振っても傾かない', () => {
    const v = dragView(mid, 40, 90)
    expect(v.rotY).toBeGreaterThan(mid.rotY); expect(v.rotX).toBe(RING_PITCH); expect(v.spin).toBe(0)
  })
  it('近景（外から）は横で輪と芯を回し、縦で見下ろす。見下ろしは頭打ち', () => {
    const near = viewFor(mid, 'near', field, populated[0].slot)
    const v = dragView(near, 40, -30)
    expect(v.rotY).toBe(near.rotY); expect(v.spin).toBeGreaterThan(0); expect(v.rotX).toBeLessThan(near.rotX)
    expect(dragView(near, 0, -100000).rotX).toBe(-NEAR_TILT_MAX)
    expect(dragView(near, 0, 100000).rotX).toBe(-NEAR_TILT_MIN)
  })
  it('近景（中心から）は横で惑星を回り込み、縦で見下ろす。見下ろしは頭打ち', () => {
    const near = viewFor(initialView('inside', 0.5), 'near', field, populated[0].slot)
    const v = dragView(near, 40, 30)
    expect(v.spin).toBeGreaterThan(0); expect(v.pitch).toBeLessThan(near.pitch)
    expect(dragView(near, 0, 100000).pitch).toBe(NEAR_TILT_MIN)
    expect(dragView(near, 0, -100000).pitch).toBe(NEAR_TILT_MAX)
  })
  it('慣性は減衰して止まる', () => {
    let v = 1
    for (let i = 0; i < 200; i++) v = coast(v, 1 / 60)
    expect(v).toBeLessThan(COAST_STOP)
    expect(coast(1, 0.1)).toBeLessThan(1); expect(coast(-1, 0.1)).toBeGreaterThan(-1)
  })
  it('慣性は中景では向きに、近景では掴んだ回転に効く', () => {
    expect(coastView(mid, 2, 0.1).rotY).toBeCloseTo(mid.rotY + 0.2, 9)
    const near = viewFor(mid, 'near', field, populated[0].slot)
    const n2 = coastView(near, 2, 0.1)
    expect(n2.spin).toBeCloseTo(0.2, 9); expect(n2.rotY).toBe(near.rotY)
  })
  it('段の間の補間は両端でそれぞれの値になる', () => {
    const a = initialView('outside', 0), b = viewFor(a, 'far', field, null)
    expect(lerpView(a, b, 0).zoom).toBe(a.zoom); expect(lerpView(a, b, 1).zoom).toBe(b.zoom)
    expect(lerpView(a, b, 1).stage).toBe('far')
  })
})

describe('投影', () => {
  it('中心から見るとき、後ろの点は見えない（null）', () => {
    const v = settleView(initialView('inside', 0), field)
    const proj = projectorOf(v, W, H)
    expect(proj([0, 0, -1])).not.toBeNull()   // rotY=0 は −z を向く
    expect(proj([0, 0, 1])).toBeNull()
  })
  it('中心から見るとき、正面の惑星は画面の中央に来て、正面の席は外から見るときと同じ', () => {
    for (const p of populated) {
      const rotY = frontRotYFor(p.at)
      const v = settleView(initialView('inside', rotY), field)
      const q = projectorOf(v, W, H)(p.at)!
      expect(Math.abs(q.X - W / 2), `slot${p.slot}`).toBeLessThan(1)
      expect(frontSlotOf(field, rotY)).toBe(p.slot)
    }
  })
  it('外から見るときの見る先は画面の中央に来る', () => {
    const v = settleView(initialView('outside', 1.3), field)
    const q = projectorOf(v, W, H)(v.focus)!
    expect(Math.abs(q.X - W / 2)).toBeLessThan(1e-6); expect(Math.abs(q.Y - H / 2)).toBeLessThan(1e-6)
  })
  it('遠景（中心から）は中景より多くの惑星が視野に入る', () => {
    const count = (stage: Stage) => {
      const v = settleView(viewFor(initialView('inside', 0), stage, field, null), field)
      const proj = projectorOf(v, W, H)
      return field.filter((p) => { const q = proj(p.at); return q && q.X > 0 && q.X < W && q.Y > 0 && q.Y < H }).length
    }
    expect(count('far')).toBeGreaterThan(count('mid'))
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run --dir src src/lib/__tests__/recall-field-view.test.ts`
Expected: FAIL（`initialView` などが無い）

- [ ] **Step 3: 実装する**

`src/lib/recall/field.ts` の末尾に追加（`dragCamera`・`focusPointOf`・`frontRotYFor`・`frontSlotOf` はそのまま残す。球状の並べ方と Task 2 までのテストが使う）:

```ts
// ---- 3段の寄り方と視点（オーナー決定 2026-09-04）----
// 段: 遠景（リング全体）・中景（既定。正面の惑星が芯まで読める）・近景（1つの惑星。霧まで短辺に収まる）。
// 視点: 外から（既定）／中心から（カメラをリングの中心に置き、惑星が自分の周りに並ぶ。透視投影）。
// 動線（帯・寄る・確かめる）は両方で同じ。違うのは投影と、近景の横ドラッグの意味
// （外から＝輪と芯を回す、中心から＝惑星を回り込む）。
export type Stage = 'far' | 'mid' | 'near'
export type Viewpoint = 'outside' | 'inside'
export type FieldView = {
  stage: Stage
  viewpoint: Viewpoint
  rotY: number        // 向き（両方の視点）
  rotX: number        // 外から: 傾き（環状は RING_PITCH、近景は見下ろし）
  zoom: number        // 外から: 倍率
  focus: Vec3         // 外から: 見る先（画面の中央に来る点）
  pitch: number       // 中心から: 見下ろし（正が下）
  fov: number         // 中心から: 縦の視野（rad）
  eye: Vec3           // 中心から: カメラの位置
  nearSlot: number | null
  spin: number        // 近景で掴んで回したぶん（rad）
}
export type Projected = { X: number; Y: number; Z: number; k: number }

export const FAR_ZOOM = 1.5
export const MID_ZOOM = DEFAULT_ZOOM
export const NEAR_PITCH_OUTSIDE = -0.62
export const NEAR_PITCH_INSIDE = 0.55
export const NEAR_TILT_MIN = 0.05
export const NEAR_TILT_MAX = 1.35
const rad = (deg: number) => (deg * Math.PI) / 180
export const INSIDE_FOV_FAR = rad(95)
export const INSIDE_FOV_MID = rad(15)
export const INSIDE_FOV_NEAR = rad(42)
export const INSIDE_EYE_Y_FAR = 0.24
export const INSIDE_EYE_Y_MID = 0.16
const INSIDE_PITCH_FAR = 0.24
const INSIDE_PITCH_MID = 0.16
export const COAST_STOP = 0.002
const COAST_DECAY = 2.6
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// 外からの近景の倍率。惑星本体でなく、いちばん外の霧（COLD_R）まで短辺に収める。
// 惑星の半径は短辺の約15%、芯は約40px（ラフで実測。0.27 では読んだ・未着手が画面の外に出た）。
export function zoomForPlanet(p: Planet): number {
  return 0.115 / (0.42 * p.r)
}
// 中心からの近景。惑星から距離 d に立って見下ろす。霧まで縦に収まる距離。
export function distForPlanet(p: Planet): number {
  return (3.45 * p.r) / (Math.tan(INSIDE_FOV_NEAR / 2) * 0.92)
}
export function nearestTurn(cur: number, want: number): number {
  return want + Math.round((cur - want) / (Math.PI * 2)) * Math.PI * 2
}
// 向きと見下ろしからカメラの基底。前 f・右 r・上 u。rotY=0 は −z を向く（frontRotYFor と同じ約束）。
export function basisOf(yaw: number, pitch: number): { f: Vec3; r: Vec3; u: Vec3 } {
  const f: Vec3 = [Math.sin(yaw), 0, -Math.cos(yaw)]
  const r: Vec3 = [Math.cos(yaw), 0, Math.sin(yaw)]
  const cp = Math.cos(pitch), sp = Math.sin(pitch)
  return { f: [f[0] * cp, -sp, f[2] * cp], r, u: [f[0] * sp, cp, f[2] * sp] }
}
export function eyeFor(p: Planet, yaw: number, pitch: number): Vec3 {
  const d = distForPlanet(p), b = basisOf(yaw, pitch)
  return [p.at[0] - b.f[0] * d, p.at[1] - b.f[1] * d, p.at[2] - b.f[2] * d]
}

export function initialView(viewpoint: Viewpoint, rotY: number): FieldView {
  return {
    stage: 'mid', viewpoint, rotY, rotX: RING_PITCH, zoom: MID_ZOOM, focus: focusPointOf('ring', rotY),
    pitch: INSIDE_PITCH_MID, fov: INSIDE_FOV_MID, eye: [0, INSIDE_EYE_Y_MID, 0], nearSlot: null, spin: 0,
  }
}

// 段の行き先。近景は主張のある席にだけ入れる（空の惑星を渡されたら中景）。
export function viewFor(cur: FieldView, stage: Stage, planets: Planet[], nearSlot: number | null): FieldView {
  const p = stage === 'near' && nearSlot !== null ? planets.find((q) => q.slot === nearSlot && q.n > 0) : undefined
  const base: FieldView = { ...cur, stage: p ? 'near' : stage === 'near' ? 'mid' : stage, nearSlot: p ? p.slot : null, spin: 0 }
  if (cur.viewpoint === 'inside') {
    if (base.stage === 'far') return { ...base, pitch: INSIDE_PITCH_FAR, fov: INSIDE_FOV_FAR, eye: [0, INSIDE_EYE_Y_FAR, 0] }
    if (p) { const rotY = nearestTurn(cur.rotY, frontRotYFor(p.at)); return { ...base, rotY, pitch: NEAR_PITCH_INSIDE, fov: INSIDE_FOV_NEAR, eye: eyeFor(p, rotY, NEAR_PITCH_INSIDE) } }
    return { ...base, pitch: INSIDE_PITCH_MID, fov: INSIDE_FOV_MID, eye: [0, INSIDE_EYE_Y_MID, 0] }
  }
  if (base.stage === 'far') return { ...base, rotX: RING_PITCH, zoom: FAR_ZOOM, focus: [0, 0, 0] }
  if (p) return { ...base, rotY: nearestTurn(cur.rotY, frontRotYFor(p.at)), rotX: NEAR_PITCH_OUTSIDE, zoom: zoomForPlanet(p), focus: p.at }
  return { ...base, rotX: RING_PITCH, zoom: MID_ZOOM, focus: focusPointOf('ring', cur.rotY) }
}

// アニメーションが無いときの毎フレームの規則。中景は見る先が向きに追従し、環状の傾きは定位置。
// 中心からの近景は、掴んで回したぶんだけ惑星を回り込む（カメラの位置が動く）。
export function settleView(v: FieldView, planets: Planet[]): FieldView {
  if (v.viewpoint === 'inside') {
    if (v.stage !== 'near' || v.nearSlot === null) return v
    const p = planets.find((q) => q.slot === v.nearSlot)
    if (!p) return v
    const rotY = nearestTurn(v.rotY, frontRotYFor(p.at)) + v.spin
    return { ...v, rotY, eye: eyeFor(p, rotY, v.pitch) }
  }
  if (v.stage === 'mid') return { ...v, rotX: RING_PITCH, focus: focusPointOf('ring', v.rotY) }
  if (v.stage === 'far') return { ...v, rotX: RING_PITCH, focus: [0, 0, 0] }
  return v
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]
// k=1 で b の段・席になる（途中は a の段のまま。段の名前が飛ぶ途中で変わらないように）。
export function lerpView(a: FieldView, b: FieldView, k: number): FieldView {
  return {
    ...(k >= 1 ? b : a),
    rotY: lerp(a.rotY, b.rotY, k), rotX: lerp(a.rotX, b.rotX, k),
    zoom: Math.exp(lerp(Math.log(a.zoom), Math.log(b.zoom), k)),
    focus: lerp3(a.focus, b.focus, k), pitch: lerp(a.pitch, b.pitch, k), fov: lerp(a.fov, b.fov, k), eye: lerp3(a.eye, b.eye, k),
  }
}

const DRAG_YAW_PX = 0.006
const DRAG_TILT_PX = 0.005
// ドラッグ1回ぶんの移動量（px）。遠景・中景は横だけ（環状は横回転だけ、の決定）。
// 近景は横で掴んで回し、縦で見下ろす。外からは rotX（負が見下ろし）、中心からは pitch（正が見下ろし）。
export function dragView(v: FieldView, dx: number, dy: number): FieldView {
  const dyaw = dx * DRAG_YAW_PX
  if (v.stage !== 'near') return { ...v, rotY: v.rotY + dyaw }
  if (v.viewpoint === 'inside') return { ...v, spin: v.spin + dyaw, pitch: clamp(v.pitch - dy * DRAG_TILT_PX, NEAR_TILT_MIN, NEAR_TILT_MAX) }
  return { ...v, spin: v.spin + dyaw, rotX: clamp(v.rotX + dy * DRAG_TILT_PX, -NEAR_TILT_MAX, -NEAR_TILT_MIN) }
}
// 慣性。指を離しても回り続けて減速する。COAST_STOP を割ったら止める（呼び出し側が判定）。
export function coast(vel: number, dt: number): number {
  return vel * Math.exp(-dt * COAST_DECAY)
}
export function coastView(v: FieldView, vel: number, dt: number): FieldView {
  return v.stage === 'near' ? { ...v, spin: v.spin + vel * dt } : { ...v, rotY: v.rotY + vel * dt }
}

// 投影。どちらの視点でも { X, Y, Z（小さいほど手前）, k（その点での拡大率 px/単位） } を返す。
// 中心からの視点でカメラの後ろにある点は null。画面側で数式を組み立て直さない（ここ1本）。
export function projectorOf(v: FieldView, W: number, H: number): (p: Vec3) => Projected | null {
  const min = Math.min(W, H), cx = W / 2, cy = H / 2
  if (v.viewpoint === 'inside') {
    const F = (min / 2) / Math.tan(v.fov / 2), b = basisOf(v.rotY, v.pitch), e = v.eye
    return (p) => {
      const d: Vec3 = [p[0] - e[0], p[1] - e[1], p[2] - e[2]]
      const z = d[0] * b.f[0] + d[1] * b.f[1] + d[2] * b.f[2]
      if (z < 0.03) return null
      const x = d[0] * b.r[0] + d[1] * b.r[1] + d[2] * b.r[2]
      const y = d[0] * b.u[0] + d[1] * b.u[1] + d[2] * b.u[2]
      return { X: cx + (x / z) * F, Y: cy - (y / z) * F, Z: z, k: F / z }
    }
  }
  const R = min * 0.42 * v.zoom
  const cyw = Math.cos(v.rotY), syw = Math.sin(v.rotY), cp = Math.cos(v.rotX), sp = Math.sin(v.rotX)
  const place = (p: Vec3) => {
    const x1 = p[0] * cyw + p[2] * syw, z1 = -p[0] * syw + p[2] * cyw
    const y2 = p[1] * cp - z1 * sp, z2 = p[1] * sp + z1 * cp
    const persp = 1 / (1 + z2 * 0.22)   // 遠近は弱め（強いと奥の惑星が読めない）
    return { X: x1 * R * persp, Y: -y2 * R * persp, Z: z2, k: R * persp }
  }
  const f = place(v.focus)
  return (p) => { const q = place(p); return { X: cx + q.X - f.X, Y: cy + q.Y - f.Y, Z: q.Z, k: q.k } }
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run --dir src src/lib/__tests__/recall-field-view.test.ts src/lib/__tests__/recall-field.test.ts && npx tsc --noEmit`
Expected: PASS。`near 霧まで収まる` が落ちるなら `zoomForPlanet` の 0.115 か `distForPlanet` の 0.92 を小さくして通す（0.10／0.88 まで）。それでも落ちる席があるなら、その席の `p.r`（`fitFactor` で縮んでいる）を出力して原因を見る

- [ ] **Step 5: コミット**

```bash
git add src/lib/recall/field.ts src/lib/__tests__/recall-field-view.test.ts
git commit -m "feat(recall): 3段の寄り方・視点（外から／中心から）・投影・慣性を FieldView として field に置く"
```

---
## Task 4: `FieldView` で描く。点を3Dで置き、近景に境目の名前を出す（`field-render.ts`）

**Files:**
- Modify: `src/lib/recall/field-render.ts`
- Test: `src/lib/__tests__/recall-field-render.test.ts`

**Interfaces:**
- Consumes: `projectorOf`, `FieldView`, `initialView`, `viewFor`, `settleView`（Task 3）、`placeOf`, `brightnessOf`, `isOverdue`（Task 1）
- Produces:
  - `FieldFrame = { W; H; view: FieldView; field: Planet[]; claims: Map<number, ClaimDot[]>; t; reduced; guide?: number; bg? }`（`cam`・`focus` は廃止）
  - `type DotHit = { claimId: string; X: number; Y: number }`
  - `type FieldHits = { planets: PlanetHit[]; dots: DotHit[] }`（`dots` は近景の惑星の点だけ）
  - `drawField(ctx, frame): FieldHits`
  - `ZONE_LINES = [RING_INNER, RING_OUTER, 2.95, 3.22]`, `ZONE_NAMES: [number, string][]`

- [ ] **Step 1: テストを書き換える**

`src/lib/__tests__/recall-field-render.test.ts` を次の内容に置き換える（`frame()` が `view` を持ち、`drawField` は `{ planets, dots }` を返す）:

```ts
import { describe, it, expect } from 'vitest'
import { drawField, type ClaimDot, type FieldFrame, ZONE_NAMES } from '@/lib/recall/field-render'
import { buildField, frontRotYFor, initialView, viewFor, settleView, COLD_R, TOUCHED_R, RING_OUTER, type FieldLayout, type FieldView } from '@/lib/recall/field'
import { GENRE_SEATS } from '@/lib/recall/genres'
import { ESCAPE_THRESHOLD } from '@/lib/recall/srs'
import type { RecallStateKind } from '@/lib/recall/types'

const COUNTS = GENRE_SEATS.map((_, i) => (i % 3 === 0 ? 0 : 10 + ((i * 7) % 30)))
const W = 900, H = 560

function dots(n: number, state: RecallStateKind, rem = 0.6): ClaimDot[] {
  return Array.from({ length: n }, (_, i) => ({ claimId: `c${state}${i}`, a: (i / n) * Math.PI * 2, state, rem, jitter: (i % 5) / 5 - 0.5, page: 0 }))
}
const ring = buildField(COUNTS, 'ring')
const mid = (rotY = 0.4) => settleView(initialView('outside', rotY), ring)
const near = (slot: number, viewpoint: 'outside' | 'inside' = 'outside') => settleView(viewFor(initialView(viewpoint, 0), 'near', ring, slot), ring)

function frame(over: Partial<FieldFrame> = {}): FieldFrame {
  const claims = new Map<number, ClaimDot[]>()
  COUNTS.forEach((n, i) => claims.set(i, dots(n, i % 2 === 0 ? 'kept' : 'cold')))
  return { W, H, view: mid(), field: ring, claims, t: 3.1, reduced: false, ...over }
}

function recorder() {
  const arcs: { x: number; y: number; r: number; alpha: number; fill: string }[] = []
  const texts: string[] = []
  let strokes = 0
  const ctx = {
    globalAlpha: 1, lineWidth: 1, lineCap: '', textAlign: '', textBaseline: '', font: '',
    strokeStyle: '' as unknown, fillStyle: '' as unknown,
    clearRect() {}, fillRect() {}, fillText(s: string) { texts.push(s) }, measureText(s: string) { return { width: s.length * 6 } },
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
    arc(x: number, y: number, r: number) { arcs.push({ x, y, r, alpha: ctx.globalAlpha, fill: String(ctx.fillStyle) }) },
    fill() {}, stroke() { strokes++ },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, arcs, texts, strokes: () => strokes }
}
function ownDots(r: ReturnType<typeof recorder>, hit: { X: number; Y: number; S: number }) {
  return r.arcs
    .filter((x) => x.r <= 8 && Math.hypot(x.x - hit.X, x.y - hit.Y) > hit.S * 1.05)
    .map((x) => ({ d: Math.hypot(x.x - hit.X, x.y - hit.Y) / hit.S, alpha: x.alpha, r: x.r, fill: x.fill }))
}
const populated = ring.filter((p) => p.n > 0)

describe('field を描く', () => {
  it('どの並べ方・どの視点・どの段でも例外なく描ける', () => {
    for (const layout of ['sphere', 'ring'] as FieldLayout[]) {
      const field = buildField(COUNTS, layout)
      for (const vp of ['outside', 'inside'] as const) {
        for (const stage of ['far', 'mid', 'near'] as const) {
          const view = settleView(viewFor(initialView(vp, 0.2), stage, field, populated[0].slot), field)
          const r = recorder()
          expect(() => drawField(r.ctx, frame({ field, view })), `${layout}/${vp}/${stage}`).not.toThrow()
          expect(r.strokes(), `${layout}/${vp}/${stage}`).toBeGreaterThan(0)
        }
      }
    }
  })

  it('画面に入っている惑星だけを返し、席番号が付いている', () => {
    const { planets } = drawField(recorder().ctx, frame())
    expect(planets.length).toBeGreaterThan(0)
    expect(planets.length).toBeLessThanOrEqual(GENRE_SEATS.length)
    for (const h of planets) { expect(h.S).toBeGreaterThan(0); expect(Number.isFinite(h.X) && Number.isFinite(h.Y)).toBe(true) }
    expect(new Set(planets.map((h) => h.slot)).size).toBe(planets.length)
  })

  it('帯で選んだ惑星は中景でど真ん中に来る', () => {
    for (const target of [ring[0], ring[9], ring[20], ring[ring.length - 1]]) {
      const { planets } = drawField(recorder().ctx, frame({ view: mid(frontRotYFor(target.at)) }))
      const front = planets.find((h) => h.slot === target.slot)
      expect(front, `slot${target.slot}`).toBeDefined()
      expect(Math.hypot(front!.X - W / 2, front!.Y - H / 2), `slot${target.slot}`).toBeLessThan(1)
    }
  })

  it('近景では、その惑星の点だけを当たり判定として返す', () => {
    const p = populated[2]
    const { dots: hits } = drawField(recorder().ctx, frame({ view: near(p.slot) }))
    expect(hits.length).toBe(COUNTS[p.slot])
    for (const d of hits) expect(d.claimId.startsWith('c')).toBe(true)
    expect(drawField(recorder().ctx, frame()).dots).toHaveLength(0)   // 中景では返さない
  })

  it('近景（中心から）でも、その惑星の点がすべて画面に入る', () => {
    const p = populated[2]
    const { dots: hits } = drawField(recorder().ctx, frame({ view: near(p.slot, 'inside') }))
    expect(hits.length).toBe(COUNTS[p.slot])
    for (const d of hits) { expect(d.X).toBeGreaterThan(0); expect(d.X).toBeLessThan(W); expect(d.Y).toBeGreaterThan(0); expect(d.Y).toBeLessThan(H) }
  })

  it('読んだは輪の外、未着手はさらに外の霧に描かれる', () => {
    const p = populated[1]
    const at = (state: RecallStateKind) => {
      const claims = new Map<number, ClaimDot[]>([[p.slot, dots(24, state, 0.9)]])
      const r = recorder()
      const hit = drawField(r.ctx, frame({ claims, view: near(p.slot) })).planets.find((h) => h.slot === p.slot)!
      const ds = ownDots(r, hit).map((x) => x.d)
      return { max: Math.max(...ds), min: Math.min(...ds) }
    }
    expect(at('kept').max).toBeLessThan(RING_OUTER * 1.02)
    expect(at('touched').max).toBeCloseTo(TOUCHED_R, 0)
    expect(at('cold').max).toBeGreaterThan(COLD_R - 0.3)
    expect(at('touched').min).toBeGreaterThan(at('kept').max * 0.98)
  })

  it('残したは保持力が高いほど明るい', () => {
    const p = populated[1]
    const alpha = (rem: number) => {
      const r = recorder()
      const hit = drawField(r.ctx, frame({ claims: new Map([[p.slot, dots(12, 'kept', rem)]]), view: near(p.slot) })).planets.find((h) => h.slot === p.slot)!
      const own = ownDots(r, hit)
      return own.reduce((a, x) => a + x.alpha, 0) / own.length
    }
    expect(alpha(0.95)).toBeGreaterThan(alpha(0.4))
  })

  it('離れかけは光の色で、まだ確かな主張より外側に大きく描かれる', () => {
    const p = populated[1]
    const at = (rem: number) => {
      const r = recorder()
      const hit = drawField(r.ctx, frame({ claims: new Map([[p.slot, dots(24, 'kept', rem)]]), view: near(p.slot) })).planets.find((h) => h.slot === p.slot)!
      const own = ownDots(r, hit)
      return { far: Math.max(...own.map((x) => x.d)), size: Math.max(...own.map((x) => x.r)), halo: own.some((x) => x.fill === '#F6E7B8') }
    }
    const fresh = at(0.95), overdue = at(ESCAPE_THRESHOLD - 0.05)
    expect(overdue.far).toBeGreaterThan(fresh.far); expect(overdue.size).toBeGreaterThan(fresh.size)
    expect(overdue.halo).toBe(true); expect(fresh.halo).toBe(false)
  })

  it('動きを減らす設定では離れかけが明滅しない', () => {
    const p = populated[1]
    const claims = new Map([[p.slot, dots(6, 'kept', 0.1)]])
    const alphas = (t: number) => {
      const r = recorder()
      const hit = drawField(r.ctx, frame({ claims, t, reduced: true, view: near(p.slot) })).planets.find((h) => h.slot === p.slot)!
      return ownDots(r, hit).map((x) => x.alpha.toFixed(3)).join(',')
    }
    expect(alphas(1)).toBe(alphas(2.7))
  })

  it('遠景では、離れかけの数だけ光の点を惑星の外に添える', () => {
    const p = populated[1]
    const claims = new Map([[p.slot, [...dots(3, 'kept', 0.1), ...dots(10, 'kept', 0.9)]]])
    const r = recorder()
    const view = settleView(viewFor(initialView('outside', frontRotYFor(p.at)), 'far', ring, null), ring)
    const hit = drawField(r.ctx, frame({ claims, view })).planets.find((h) => h.slot === p.slot)!
    expect(hit.S).toBeLessThan(22)
    const halos = r.arcs.filter((x) => x.fill === '#F6E7B8' && Math.abs(Math.hypot(x.x - hit.X, x.y - hit.Y) - (hit.S + 5)) < 0.5)
    expect(halos).toHaveLength(3)
  })

  it('境目の名前は近景で guide が正のときだけ出る', () => {
    const p = populated[1]
    const names = ZONE_NAMES.map(([, n]) => n)
    const shown = (view: FieldView, guide?: number) => {
      const r = recorder()
      drawField(r.ctx, frame({ view, guide }))
      return names.filter((n) => r.texts.includes(n))
    }
    expect(shown(near(p.slot), 1)).toEqual(names)
    expect(shown(near(p.slot), 0)).toEqual([])
    expect(shown(near(p.slot))).toEqual([])
    expect(shown(mid(), 1)).toEqual([])
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run --dir src src/lib/__tests__/recall-field-render.test.ts`
Expected: FAIL（`FieldFrame` に `view` が無い）

- [ ] **Step 3: `field-render.ts` を書き換える**

`src/lib/recall/field-render.ts` を次の内容に置き換える:

```ts
// 惑星 field の描画。配置（field.ts）と芯（cores.ts）を受けて Canvas 2D に描くだけ。
// 投影は field.ts の projectorOf 一本（外から／中心からの両方）。点は惑星の周りの3Dの位置から投影するので、
// 近景で見下ろすと輪が上から円に見える。
import {
  placeOf, brightnessOf, isOverdue, projectorOf, RING_INNER, RING_OUTER, RING_PITCH, NEAR_PITCH_INSIDE,
  type FieldView, type Planet, type Projected,
} from './field'
import type { Vec3 } from './layout'
import type { RecallStateKind } from './types'
import { drawCore3D, coreSeatSpin, CORE_SPIN_RATE, INK_COOL, INK_HALO, INK_WHITE } from './cores'

export type ClaimDot = { claimId: string; a: number; state: RecallStateKind; rem: number; jitter: number; page: number }
export type FieldFrame = {
  W: number; H: number
  view: FieldView
  field: Planet[]
  claims: Map<number, ClaimDot[]>
  t: number
  reduced: boolean
  guide?: number   // 境目の名前の濃さ 0〜1（近景に入った直後だけ正）
  bg?: string
}
export type PlanetHit = { slot: number; X: number; Y: number; S: number }
export type DotHit = { claimId: string; X: number; Y: number }
export type FieldHits = { planets: PlanetHit[]; dots: DotHit[] }

const DIM = '#7C8DA6'
const LABEL = '#A9B8CC'
const TOUCHED = '#8FA3BD'
export const LABEL_MIN_S = 22
// 境目の名前。半径は惑星の半径＝1。
export const ZONE_LINES = [RING_INNER, RING_OUTER, 2.95, 3.22]
export const ZONE_NAMES: [number, string][] = [[0.98, '定着'], [1.95, '残した'], [2.76, '離れかけ'], [3.06, '読んだ'], [3.42, '未着手']]

export function drawField(ctx: CanvasRenderingContext2D, a: FieldFrame): FieldHits {
  const { W, H, view, t } = a
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = a.bg ?? '#0B1524'
  ctx.fillRect(0, 0, W, H)
  const proj = projectorOf(view, W, H)
  const inside = view.viewpoint === 'inside'
  const shown = a.field
    .map((p) => { const q = proj(p.at); return q ? { p, X: q.X, Y: q.Y, Z: q.Z, S: p.r * q.k } : null })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((m, n) => n.Z - m.Z)

  const hits: FieldHits = { planets: [], dots: [] }
  for (const s of shown) {
    const reach = s.S * 4.2
    if (s.X + reach < 0 || s.X - reach > W || s.Y + reach < 0 || s.Y - reach > H) continue
    // 奥の惑星を薄く。外からは奥行き、中心からは距離。
    const far = inside ? Math.max(0.4, Math.min(1, 0.4 + 0.6 * Math.min(1, 1.15 / s.Z))) : 0.45 + 0.55 * ((1 - s.Z) / 2)
    const isNear = view.stage === 'near' && view.nearSlot === s.p.slot
    const dots = drawPlanet(ctx, s.p, s.X, s.Y, s.S, far, a.claims.get(s.p.slot) ?? [], t, a.reduced, proj, view, isNear, isNear ? (a.guide ?? 0) : 0)
    hits.planets.push({ slot: s.p.slot, X: s.X, Y: s.Y, S: s.S })
    if (isNear) hits.dots = dots
  }
  ctx.globalAlpha = 1
  return hits
}

export function lookOf(c: ClaimDot, t: number, reduced: boolean): { ink: string; alpha: number; size: number; glow: boolean } {
  if (isOverdue(c.state, c.rem)) {
    return { ink: INK_HALO, alpha: reduced ? 0.9 : 0.6 + 0.38 * Math.sin(t * 3.2 + c.a * 3), size: 1.9, glow: true }
  }
  const alpha = brightnessOf(c.state, c.rem)
  switch (c.state) {
    case 'settled': return { ink: INK_WHITE, alpha, size: 1.35, glow: true }
    case 'kept': return { ink: INK_COOL, alpha, size: 1.15, glow: false }
    case 'touched': return { ink: TOUCHED, alpha, size: 1.0, glow: false }
    default: return { ink: DIM, alpha, size: 0.9, glow: false }
  }
}

// 惑星の周りの点を3Dで置く道具。rr は惑星の半径＝1 の単位、y0 は上下の散り。
// spin（近景で掴んで回したぶん）は外からの視点では輪を回し、中心からの視点ではカメラが回り込むので輪には掛けない。
function ringPointOf(p: Planet, ptilt: number, ringSpin: number) {
  return (ang: number, rr: number, y0 = 0): Vec3 => {
    const lx = Math.cos(ang + ringSpin) * rr, lz = Math.sin(ang + ringSpin) * rr
    return [p.at[0] + lx * p.r, p.at[1] + (y0 + lz * Math.sin(ptilt)) * p.r, p.at[2] + lz * Math.cos(ptilt) * p.r]
  }
}

function drawPlanet(
  ctx: CanvasRenderingContext2D, p: Planet, X: number, Y: number, S: number, far: number,
  claims: ClaimDot[], t: number, reduced: boolean, proj: (v: Vec3) => Projected | null,
  view: FieldView, isNear: boolean, guide: number,
): DotHit[] {
  const spin = coreSeatSpin(p.slot)
  const tt = reduced ? 0 : t
  const inside = view.viewpoint === 'inside'
  const mine = claims.filter((c) => c.state === 'kept' || c.state === 'settled')
  const overdue = claims.filter((c) => isOverdue(c.state, c.rem))
  const avgRem = mine.length ? mine.reduce((a, c) => a + Math.max(0, Math.min(1, c.rem)), 0) / mine.length : 0
  const empty = p.n === 0
  // 掴んで回したぶんは芯にも掛ける（輪と一体）。見下ろしのぶんも芯を傾ける。
  const handYaw = isNear ? view.spin : 0
  const handPitch = isNear ? (inside ? view.pitch - NEAR_PITCH_INSIDE : view.rotX - RING_PITCH) * 0.6 : 0

  ctx.save()
  ctx.globalAlpha = far * (empty ? 0.35 : 1)
  drawCore3D(ctx, {
    cx: X, cy: Y, CR: S * 0.42 * spin.scale, kind: p.kind, t: tt * spin.rate, reduced: tt === 0,
    yaw: tt * spin.rate * CORE_SPIN_RATE[p.kind] + handYaw, pitch: spin.tilt + handPitch,
  })
  ctx.restore()

  ctx.globalAlpha = (0.16 + 0.42 * avgRem) * far * (empty ? 0.5 : 1)
  ctx.strokeStyle = INK_COOL
  ctx.lineWidth = 0.8
  ctx.beginPath(); ctx.arc(X, Y, S, 0, Math.PI * 2); ctx.stroke()

  if (S < LABEL_MIN_S && overdue.length) {
    ctx.fillStyle = INK_HALO
    ctx.globalAlpha = 0.85 * far
    for (let i = 0; i < Math.min(5, overdue.length); i++) {
      const ang = -Math.PI * 0.35 + i * 0.22
      ctx.beginPath(); ctx.arc(X + Math.cos(ang) * (S + 5), Y + Math.sin(ang) * (S + 5), 1.6, 0, Math.PI * 2); ctx.fill()
    }
  }

  const at = ringPointOf(p, spin.tilt * 0.35, isNear && !inside ? view.spin : 0)
  const sz = Math.max(1, Math.min(4.4, S / 38))
  const drift = reduced ? 0 : t * 0.05
  const dots: DotHit[] = []
  for (const c of claims) {
    const o = placeOf(c.state, c.rem, c.jitter)
    const q = proj(at(c.a + drift / o.rr, o.rr, o.y))
    if (!q) continue
    const look = lookOf(c, t, reduced)
    // 中心からの視点では手前の点ほど大きい（その点の拡大率で）。
    const r = look.size * sz * (inside ? (q.k * p.r) / S : 1)
    if (look.glow && S > LABEL_MIN_S) {
      ctx.globalAlpha = look.alpha * far * 0.25; ctx.fillStyle = look.ink
      ctx.beginPath(); ctx.arc(q.X, q.Y, r * 2.6, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = look.alpha * far
    ctx.fillStyle = look.ink
    ctx.beginPath(); ctx.arc(q.X, q.Y, r, 0, Math.PI * 2); ctx.fill()
    if (isNear) dots.push({ claimId: c.claimId, X: q.X, Y: q.Y })
  }

  // 境目の名前（近景に入った直後だけ）。土星の環の区分に名前が付いているのと同じ見せ方。
  if (isNear && guide > 0) {
    ctx.strokeStyle = LABEL; ctx.lineWidth = 0.7
    for (const rr of ZONE_LINES) {
      ctx.globalAlpha = 0.16 * guide * far
      ctx.beginPath()
      let started = false
      for (let i = 0; i <= 64; i++) {
        const q = proj(at((i / 64) * Math.PI * 2, rr))
        if (!q) continue
        if (!started) { ctx.moveTo(q.X, q.Y); started = true } else ctx.lineTo(q.X, q.Y)
      }
      ctx.stroke()
    }
    ctx.font = '400 10.5px "Zen Kaku Gothic New",sans-serif'
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle'; ctx.fillStyle = LABEL
    for (const [rr, name] of ZONE_NAMES) {
      const q = proj(at(Math.PI, rr))
      if (!q) continue
      ctx.globalAlpha = 0.8 * guide * far
      ctx.fillText(name, q.X - 6, q.Y)
    }
    ctx.textBaseline = 'alphabetic'
  }

  if (!isNear && S > LABEL_MIN_S) {
    ctx.globalAlpha = 0.6 * far
    ctx.fillStyle = LABEL
    ctx.textAlign = 'center'
    ctx.font = '400 10px "Zen Kaku Gothic New",sans-serif'
    ctx.fillText(empty ? p.label : `${p.label}　${p.n}`, X, Y + S * 3.5 + 14)
    if (overdue.length) { ctx.fillStyle = INK_HALO; ctx.fillText(`離れかけ ${overdue.length}`, X, Y + S * 3.5 + 28) }
  }
  ctx.globalAlpha = 1
  return dots
}
```

`cores.ts` は `CORE_SPIN_RATE` を export している（`export const CORE_SPIN_RATE: Record<CoreKind, number>`）。していなければ export を足す。

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run --dir src src/lib/__tests__/recall-field-render.test.ts && npx tsc --noEmit`
Expected: PASS。`読んだは輪の外` が近景の見下ろし（rotX −0.62）で潰れて `toBeCloseTo(TOUCHED_R, 0)` を外すなら、テストの `near()` を `{ ...near(p.slot), rotX: -1.35 }`（真上から）にして距離を測る

- [ ] **Step 5: コミット**

```bash
git add src/lib/recall/field-render.ts src/lib/__tests__/recall-field-render.test.ts
git commit -m "feat(recall): FieldView で描く。点は3Dに置き、近景では境目の名前と当たり判定を返す"
```

---
## Task 5: `RecallField.tsx`（canvas・操作・RAF・段の遷移・慣性）

**Files:**
- Create: `src/components/recall/RecallField.tsx`
- Test: `src/lib/__tests__/recall-viewport-single-source.test.ts`（既存の走査テストが新しい tsx も見る。数式を書かなければ通る）

**Interfaces:**
- Consumes: `FieldView`, `initialView`, `viewFor`, `settleView`, `lerpView`, `dragView`, `coast`, `coastView`, `COAST_STOP`, `nearestTurn`, `frontRotYFor`, `frontSlotOf`, `INSIDE_FOV_FAR`, `INSIDE_FOV_MID`, `INSIDE_EYE_Y_FAR`, `INSIDE_EYE_Y_MID`, `FAR_ZOOM`, `MID_ZOOM`（Task 3）、`drawField`, `FieldFrame`, `ClaimDot`, `FieldHits`（Task 4）
- Produces:
  - `type RecallFieldHandle = { go(stage: Stage, slot?: number | null): void; jump(slot: number): void }`（`ref` で受ける）
  - Props: `{ planets; claims: Map<number, ClaimDot[]>; viewpoint: Viewpoint; reduced: boolean; startSlot: number | null; onFront(slot: number | null): void; onStage(stage: Stage, slot: number | null): void; onPlanetTap(slot: number): void; onDotTap(claimId: string, at: { x: number; y: number }): void; onBackgroundTap(): void; extra?: (ctx, hits: FieldHits, t: number) => void }`（`extra` は Task 10 の棚が使う。描画の後に呼ぶ）

- [ ] **Step 1: コンポーネントを書く**

`src/components/recall/RecallField.tsx`:

```tsx
'use client'
// 惑星 field の canvas。回す（ドラッグ・慣性）、寄る（惑星をタップで近景、背景タップで中景、ホイール・ピンチで遠景⇄中景）。
// 描画は drawField に、投影は field.ts の projectorOf に委ね、ここは操作と RAF と段の遷移だけを持つ。
// 画面側で半径・中心の数式を組み立て直さない（recall-viewport-single-source.test.ts が走査する）。
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import {
  initialView, viewFor, settleView, lerpView, dragView, coast, coastView, frontRotYFor, frontSlotOf, nearestTurn,
  COAST_STOP, FAR_ZOOM, MID_ZOOM, INSIDE_FOV_FAR, INSIDE_FOV_MID, INSIDE_EYE_Y_FAR, INSIDE_EYE_Y_MID,
  type FieldView, type Planet, type Stage, type Viewpoint,
} from '@/lib/recall/field'
import { drawField, type ClaimDot, type FieldHits } from '@/lib/recall/field-render'

export type RecallFieldHandle = { go: (stage: Stage, slot?: number | null) => void; jump: (slot: number) => void }

type Props = {
  planets: Planet[]
  claims: Map<number, ClaimDot[]>
  viewpoint: Viewpoint
  reduced: boolean
  startSlot: number | null
  onFront: (slot: number | null) => void
  onStage: (stage: Stage, slot: number | null) => void
  onPlanetTap: (slot: number) => void
  onDotTap: (claimId: string, at: { x: number; y: number }) => void
  onBackgroundTap: () => void
  extra?: (ctx: CanvasRenderingContext2D, hits: FieldHits, t: number) => void
}

const FLY_MS = 650
const GUIDE_MS = 3400
const GUIDE_FADE_MS = 600
const HOLD_MS = 80          // これより長く止めてから離したら慣性を付けない
const TAP_PX = 4
const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)

export const RecallField = forwardRef<RecallFieldHandle, Props>(function RecallField(props, ref) {
  const cv = useRef<HTMLCanvasElement>(null)
  const latest = useRef(props); latest.current = props
  // 毎フレーム触る状態は ref に置く（React の再描画を挟まない）。
  const view = useRef<FieldView>(initialView(props.viewpoint, props.startSlot !== null ? frontRotYFor(planetAt(props.planets, props.startSlot)) : 0))
  const anim = useRef<{ from: FieldView; to: FieldView; t0: number } | null>(null)
  const vel = useRef(0)
  const guideUntil = useRef(0)
  const hits = useRef<FieldHits>({ planets: [], dots: [] })
  const drag = useRef<{ x: number; y: number; moved: boolean; t: number } | null>(null)
  const ptrs = useRef(new Map<number, [number, number]>())
  const pinch = useRef<{ d: number; view: FieldView } | null>(null)

  const go = (stage: Stage, slot: number | null = null) => {
    const L = latest.current
    const cur = view.current
    const s = stage === 'near' ? (slot ?? (cur.stage === 'near' ? cur.nearSlot : frontSlotOf(L.planets, cur.rotY))) : null
    const to = viewFor(cur, stage, L.planets, s)
    vel.current = 0
    if (to.stage === 'near') guideUntil.current = performance.now() + GUIDE_MS
    if (L.reduced) { view.current = to; anim.current = null } else anim.current = { from: cur, to, t0: performance.now() }
    L.onStage(to.stage, to.nearSlot)
  }
  const jump = (slot: number) => {
    const L = latest.current
    const cur = view.current.stage === 'near' ? viewFor(view.current, 'mid', L.planets, null) : view.current
    const to = { ...viewFor(cur, cur.stage === 'far' ? 'far' : 'mid', L.planets, null), rotY: nearestTurn(cur.rotY, frontRotYFor(planetAt(L.planets, slot))) }
    vel.current = 0
    if (L.reduced) { view.current = settleView(to, L.planets); anim.current = null } else anim.current = { from: view.current, to, t0: performance.now() }
    if (cur.stage !== view.current.stage) L.onStage(to.stage, null)
  }
  useImperativeHandle(ref, () => ({ go, jump }))

  // 視点が切り替わったら、同じ段のまま行き先を取り直す（飛ばずに置き換える）。
  useEffect(() => {
    const L = latest.current
    const v = view.current
    view.current = settleView(viewFor({ ...v, viewpoint: L.viewpoint }, v.stage, L.planets, v.nearSlot), L.planets)
    anim.current = null; vel.current = 0
  }, [props.viewpoint])

  useEffect(() => {
    const el = cv.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    let W = 0, H = 0
    const size = () => {
      const DPR = Math.min(devicePixelRatio || 1, 2)
      W = el.clientWidth; H = el.clientHeight
      el.width = W * DPR; el.height = H * DPR; ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
    }
    size()
    const ro = new ResizeObserver(size); ro.observe(el)
    let raf = 0, last = performance.now(), lastFront: number | null = -1
    const frame = (now: number) => {
      const L = latest.current
      const dt = Math.min(now - last, 50) / 1000; last = now
      const a = anim.current
      if (a) {
        const u = Math.min(1, (now - a.t0) / FLY_MS)
        view.current = lerpView(a.from, a.to, ease(u))
        if (u >= 1) { anim.current = null; view.current = settleView(a.to, L.planets) }
      } else {
        if (!drag.current && !L.reduced && Math.abs(vel.current) > COAST_STOP) {
          view.current = coastView(view.current, vel.current, dt)
          vel.current = coast(vel.current, dt)
        } else if (Math.abs(vel.current) <= COAST_STOP) vel.current = 0
        view.current = settleView(view.current, L.planets)
      }
      const t = now * 0.001
      const guide = guideUntil.current > now ? Math.min(1, (guideUntil.current - now) / GUIDE_FADE_MS) : 0
      hits.current = drawField(ctx, { W, H, view: view.current, field: L.planets, claims: L.claims, t, reduced: L.reduced, guide })
      L.extra?.(ctx, hits.current, t)
      const front = view.current.stage === 'near' ? view.current.nearSlot : frontSlotOf(L.planets, view.current.rotY)
      if (front !== lastFront) { lastFront = front; L.onFront(front) }
      raf = requestAnimationFrame(frame)
    }
    const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else { last = performance.now(); raf = requestAnimationFrame(frame) } }
    document.addEventListener('visibilitychange', onVis)
    // React の onWheel は passive なので preventDefault が効かない。ここで passive:false を明示する。
    const onWheel = (e: WheelEvent) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * 0.0012)) }
    el.addEventListener('wheel', onWheel, { passive: false })
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', onVis); el.removeEventListener('wheel', onWheel) }
  }, [])

  // 遠景⇄中景の連続的な寄り（ホイール・ピンチ）。近景では寄り戻し（factor < 1）で中景へ抜ける。
  const zoomBy = (factor: number) => {
    const L = latest.current
    const v = view.current
    if (v.stage === 'near') { if (factor < 1) go('mid'); return }
    anim.current = null
    let next: FieldView
    if (v.viewpoint === 'inside') {
      const fov = Math.max(INSIDE_FOV_MID * 0.8, Math.min(INSIDE_FOV_FAR * 1.05, v.fov / factor))
      const stage: Stage = fov > (INSIDE_FOV_MID + INSIDE_FOV_FAR) / 2 ? 'far' : 'mid'
      next = { ...v, stage, fov, eye: [0, stage === 'far' ? INSIDE_EYE_Y_FAR : INSIDE_EYE_Y_MID, 0], pitch: stage === 'far' ? 0.24 : 0.16 }
    } else {
      const zoom = Math.max(FAR_ZOOM * 0.8, Math.min(MID_ZOOM * 1.5, v.zoom * factor))
      next = { ...v, stage: zoom < 4 ? 'far' : 'mid', zoom }
    }
    view.current = settleView(next, L.planets)
    if (next.stage !== v.stage) L.onStage(next.stage, null)
  }

  const capture = (e: React.PointerEvent<HTMLCanvasElement>) => { try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 捕まえられない端末は諦める */ } }
  const syncPinch = () => {
    const v = [...ptrs.current.values()]
    pinch.current = v.length === 2 ? { d: Math.max(1, Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1])), view: view.current } : null
  }
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    capture(e)
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY])
    vel.current = 0
    if (ptrs.current.size >= 2) { drag.current = null; syncPinch(); return }
    drag.current = { x: e.clientX, y: e.clientY, moved: false, t: performance.now() }
  }
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, [e.clientX, e.clientY])
    if (ptrs.current.size === 2 && pinch.current) {
      const v = [...ptrs.current.values()]
      const d = Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1])
      view.current = pinch.current.view
      zoomBy(d / pinch.current.d)
      return
    }
    if (ptrs.current.size > 2) return
    const d = drag.current; if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < TAP_PX) return
    d.moved = true; anim.current = null; guideUntil.current = 0
    const now = performance.now(), dt = Math.max(8, now - d.t) / 1000
    const before = view.current
    view.current = dragView(before, dx, dy)
    // 横回しの角速度（慣性のもと）。中景は向き、近景は掴んだ回転から取る。
    vel.current = latest.current.reduced ? 0 : ((before.stage === 'near' ? view.current.spin - before.spin : view.current.rotY - before.rotY) / dt)
    d.x = e.clientX; d.y = e.clientY; d.t = now
  }
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    ptrs.current.delete(e.pointerId)
    if (ptrs.current.size >= 2) { drag.current = null; syncPinch(); return }
    pinch.current = null
    if (ptrs.current.size === 1) { drag.current = null; return }
    const d = drag.current; drag.current = null
    if (!d) return
    if (d.moved) { if (performance.now() - d.t > HOLD_MS) vel.current = 0; return }
    vel.current = 0
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left, y = e.clientY - rect.top
    const L = latest.current
    const v = view.current
    if (v.stage === 'near') {
      let best: { claimId: string; X: number; Y: number } | null = null, bd = 11
      for (const h of hits.current.dots) { const dd = Math.hypot(h.X - x, h.Y - y); if (dd < bd) { bd = dd; best = h } }
      if (best) { L.onDotTap(best.claimId, { x: best.X, y: best.Y }); return }
      L.onBackgroundTap(); return
    }
    for (const h of hits.current.planets) {
      if (Math.hypot(h.X - x, h.Y - y) < Math.max(h.S * 2.6, 14)) { L.onPlanetTap(h.slot); return }
    }
    L.onBackgroundTap()
  }

  return (
    <canvas ref={cv} className="absolute inset-0 w-full h-full touch-none cursor-grab active:cursor-grabbing"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
  )
})

function planetAt(planets: Planet[], slot: number): Planet {
  return planets.find((p) => p.slot === slot) ?? planets[0]
}
```

- [ ] **Step 2: 走査テストと型を通す**

Run: `npx vitest run --dir src src/lib/__tests__/recall-viewport-single-source.test.ts && npx tsc --noEmit`
Expected: PASS（`RecallField.tsx` に `Math.min(W, H)`・`H / 2`・`0.34` が無い。`pickAt`／`hereMark` の検査は呼び出しが無いファイルには掛からない。`0.34` に引っかかったら定数名に逃がす）

- [ ] **Step 3: コミット**

```bash
git add src/components/recall/RecallField.tsx
git commit -m "feat(recall): 惑星 field の canvas（段の遷移・慣性・掴んで回す・ピンチ・タップ）"
```

---

## Task 6: 判断用ハーネスを `RecallField` で作り直す（development 限定）

**Files:**
- Create: `src/app/dev/field/page.tsx`

**Interfaces:**
- Consumes: `RecallField`, `RecallFieldHandle`（Task 5）、`buildField`（既存）、`ClaimDot`（Task 2）

- [ ] **Step 1: ハーネスを書く**

```tsx
'use client'
// 惑星 field の判断用ハーネス（development 限定）。描くのは出荷される実物（field.ts / field-render.ts / cores.ts / RecallField）。
// 仮なのは主張のデータだけ（本番の件数と保持力は Supabase 側にあり、ここからは読めない）。
import { notFound } from 'next/navigation'
import { useMemo, useRef, useState } from 'react'
import { buildField, type Stage, type Viewpoint } from '@/lib/recall/field'
import type { ClaimDot } from '@/lib/recall/field-render'
import { GENRE_SEATS, genreLabel } from '@/lib/recall/genres'
import { RecallField, type RecallFieldHandle } from '@/components/recall/RecallField'
import type { RecallStateKind } from '@/lib/recall/types'

const POPULATED = [2, 3, 4, 5, 6, 9, 12, 13, 14, 16, 21, 23, 24, 25, 26]
const COUNTS = GENRE_SEATS.map((_, i) => (POPULATED.includes(i) ? 20 + ((i * 37) % 70) : 0))

function fakeClaims(slot: number, n: number): ClaimDot[] {
  let s = (slot * 2654435761 + 12345) | 0
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
  return Array.from({ length: n }, (_, i) => {
    const u = rnd()
    const state: RecallStateKind = u < 0.42 ? 'cold' : u < 0.66 ? 'touched' : u < 0.93 ? 'kept' : 'settled'
    const rem = state === 'kept' ? Math.max(0.02, rnd()) : state === 'settled' ? 0.6 + rnd() * 0.4 : 0
    return { claimId: `${slot}-${i}`, a: rnd() * Math.PI * 2, state, rem, jitter: rnd() - 0.5, page: 0 }
  })
}

export default function DevFieldPage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  const field = useRef<RecallFieldHandle>(null)
  const [viewpoint, setViewpoint] = useState<Viewpoint>('outside')
  const [stage, setStage] = useState<Stage>('mid')
  const [front, setFront] = useState<number | null>(null)
  const [tapped, setTapped] = useState<string | null>(null)
  const planets = useMemo(() => buildField(COUNTS, 'ring'), [])
  const claims = useMemo(() => { const m = new Map<number, ClaimDot[]>(); COUNTS.forEach((n, i) => m.set(i, fakeClaims(i, n))); return m }, [])

  return (
    <div className="fixed inset-0 bg-[#0B1524] text-[#EBF2FB]">
      <RecallField ref={field} planets={planets} claims={claims} viewpoint={viewpoint} reduced={false} startSlot={3}
        onFront={setFront} onStage={(s) => setStage(s)}
        onPlanetTap={(slot) => field.current?.go('near', slot)}
        onDotTap={(id) => setTapped(id)}
        onBackgroundTap={() => { if (stage === 'near') field.current?.go('mid'); setTapped(null) }} />
      <div className="absolute left-3 top-3 flex flex-wrap gap-2 text-[12px]">
        <Seg label="段" opts={[['far', '遠景'], ['mid', '中景'], ['near', '近景']]} v={stage} on={(v) => field.current?.go(v as Stage)} />
        <Seg label="視点" opts={[['outside', '外から'], ['inside', '中心から']]} v={viewpoint} on={(v) => setViewpoint(v as Viewpoint)} />
        <span className="rounded bg-white/10 px-2 py-1">{front !== null ? genreLabel(front) : '—'}{tapped ? `　主張 ${tapped}` : ''}</span>
      </div>
      <nav className="absolute inset-x-0 bottom-0 border-t border-white/10 bg-[#0B1524]/85 backdrop-blur">
        <ul className="flex gap-1 overflow-x-auto px-3 py-2 text-[11px]">
          {planets.filter((p) => p.n > 0).map((p) => (
            <li key={p.slot}>
              <button type="button" onClick={() => field.current?.jump(p.slot)} aria-current={front === p.slot ? 'true' : undefined}
                className={`whitespace-nowrap rounded px-2 py-1 ${front === p.slot ? 'bg-[#F6E7B8] text-[#0B1524]' : 'text-[#A9B8CC] hover:bg-white/10'}`}>
                {p.label}<span className="ml-1 opacity-60 tabular-nums">{p.n}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <p className="absolute bottom-12 left-3 text-[11px] opacity-50">芯・配置・カメラは実物。主張のデータだけ仮。</p>
    </div>
  )
}

function Seg({ label, opts, v, on }: { label: string; opts: [string, string][]; v: string; on: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1 rounded bg-white/10 px-2 py-1">
      <span className="opacity-70">{label}</span>
      {opts.map(([k, t]) => (
        <button key={k} type="button" onClick={() => on(k)} className={`rounded px-2 py-0.5 ${v === k ? 'bg-[#F6E7B8] text-[#0B1524]' : 'hover:bg-white/10'}`}>{t}</button>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: 型を通して、目で見る**

Run: `npx tsc --noEmit`
Expected: エラーなし

目視: worktree では Browser pane が使えない（記憶 `worktree-cannot-preview-in-browser-pane`）。`npx esbuild` で `field.ts`・`field-render.ts`・`cores.ts` を束ねて Artifact にするか、共有チェックアウト側で `npm run dev` を上げて `http://localhost:3000/dev/field` を開く。確かめるのは4つ: 中景で惑星をタップ→近景へ飛ぶ／近景の横ドラッグで輪と芯が一体で回り、縦で見下ろすと輪が円になる／指を離しても回り続けて止まる／「中心から」で惑星が自分の周りに並ぶ

- [ ] **Step 3: コミット**

```bash
git add src/app/dev/field/page.tsx
git commit -m "feat(recall): 判断用ハーネスを RecallField で作り直す"
```

---
## Task 7: 記事の扇形（`pageArcs`・`field.ts`）

**Files:**
- Modify: `src/lib/recall/field.ts`
- Test: `src/lib/__tests__/recall-field-arcs.test.ts`（新規）

**Interfaces:**
- Produces:
  - `type ArcInput = { claimId: string; pageId: string; pageTitle: string; sectionKey: string; createdAt?: string }`
  - `type PageArc = { pageId: string; title: string; idx: number; n: number; a0: number; a1: number }`
  - `ARC_GAP = 0.09`, `ARC_LINE_R = 3.62`, `ARC_LABEL_R = 3.98`
  - `pageArcs(items: ArcInput[]): { pages: PageArc[]; angleById: Map<string, number>; pageIdxById: Map<string, number> }`（1つの席ぶんの主張を渡す）

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/recall-field-arcs.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { pageArcs, ARC_GAP, type ArcInput } from '@/lib/recall/field'

function items(spec: Record<string, number>, from = 0): ArcInput[] {
  const out: ArcInput[] = []
  let k = from
  for (const [pageId, n] of Object.entries(spec)) {
    for (let i = 0; i < n; i++) {
      out.push({ claimId: `${pageId}-${i}`, pageId, pageTitle: `記事 ${pageId}`, sectionKey: `sec${(i % 4) + 1}`, createdAt: new Date(2026, 0, 1 + k++).toISOString() })
    }
  }
  return out
}

describe('記事の扇形', () => {
  it('扇形の幅は主張数に比例し、隙間を足すと1周になる', () => {
    const { pages } = pageArcs(items({ a: 10, b: 30 }))
    expect(pages).toHaveLength(2)
    const wa = pages[0].a1 - pages[0].a0, wb = pages[1].a1 - pages[1].a0
    expect(wb / wa).toBeCloseTo(3, 6)
    expect(wa + wb + ARC_GAP * 2).toBeCloseTo(Math.PI * 2, 9)
    expect(pages[0].n).toBe(10); expect(pages[1].title).toBe('記事 b'); expect(pages[1].idx).toBe(1)
  })

  it('全部の主張に角度と記事の添字が付き、角度は自分の記事の扇形の中にある', () => {
    const src = items({ a: 5, b: 7, c: 3 })
    const { pages, angleById, pageIdxById } = pageArcs(src)
    expect(angleById.size).toBe(15)
    for (const it of src) {
      const idx = pageIdxById.get(it.claimId)!
      const g = pages[idx]
      expect(g.pageId).toBe(it.pageId)
      const a = angleById.get(it.claimId)!
      expect(a).toBeGreaterThan(g.a0); expect(a).toBeLessThan(g.a1)
    }
  })

  it('記事の中の主張は 節番号 → 作成日時 → ID の順に並ぶ', () => {
    const src: ArcInput[] = [
      { claimId: 'z', pageId: 'p', pageTitle: 'p', sectionKey: 'sec2', createdAt: '2026-01-05T00:00:00Z' },
      { claimId: 'y', pageId: 'p', pageTitle: 'p', sectionKey: 'sec1', createdAt: '2026-01-09T00:00:00Z' },
      { claimId: 'x', pageId: 'p', pageTitle: 'p', sectionKey: 'sec2', createdAt: '2026-01-05T00:00:00Z' },
      { claimId: 'w', pageId: 'p', pageTitle: 'p', sectionKey: 'sec2', createdAt: '2026-01-01T00:00:00Z' },
    ]
    const { angleById } = pageArcs(src)
    const order = [...angleById.entries()].sort((a, b) => a[1] - b[1]).map(([id]) => id)
    expect(order).toEqual(['y', 'w', 'x', 'z'])
  })

  it('別の記事に主張を足しても、既存の記事の中の順は変わらない', () => {
    const before = pageArcs(items({ a: 6, b: 6 }))
    const after = pageArcs([...items({ a: 6, b: 6 }), ...items({ b: 4 }, 100)])
    const orderIn = (r: ReturnType<typeof pageArcs>, page: string) =>
      [...r.angleById.entries()].filter(([id]) => id.startsWith(page)).sort((x, y) => x[1] - y[1]).map(([id]) => id)
    expect(orderIn(after, 'a')).toEqual(orderIn(before, 'a'))
    expect(after.pages.map((g) => g.pageId)).toEqual(before.pages.map((g) => g.pageId))   // 記事の並びも動かない
  })

  it('記事の並びは最初の主張の作成日時の順（新しい記事は後ろに付く）', () => {
    const { pages } = pageArcs([...items({ b: 3 }, 0), ...items({ a: 3 }, 10)])
    expect(pages.map((g) => g.pageId)).toEqual(['b', 'a'])
  })

  it('主張が無ければ空', () => {
    const r = pageArcs([])
    expect(r.pages).toEqual([]); expect(r.angleById.size).toBe(0)
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run --dir src src/lib/__tests__/recall-field-arcs.test.ts`
Expected: FAIL（`pageArcs` が無い）

- [ ] **Step 3: 実装する**

`src/lib/recall/field.ts` の末尾に追加:

```ts
// ---- 詳細ジャンル＝記事の扇形（オーナー決定 2026-09-04）----
// 席の下の区分は記事。近景で輪を記事ごとの扇形に分け、扇形の幅＝その記事の主張数。
// 記事の並びは最初の主張の作成日時（新しい記事は後ろに付く）。記事の中は 節番号 → 作成日時 → ID。
// 主張を足すと扇形の幅は変わるが、記事の並びと記事の中の順は変わらない。
export type ArcInput = { claimId: string; pageId: string; pageTitle: string; sectionKey: string; createdAt?: string }
export type PageArc = { pageId: string; title: string; idx: number; n: number; a0: number; a1: number }
export const ARC_GAP = 0.09
export const ARC_LINE_R = 3.62
export const ARC_LABEL_R = 3.98
const ARC_START = -Math.PI / 2

const secNo = (key: string) => { const m = /(\d+)/.exec(key); return m ? Number(m[1]) : 0 }
const stamp = (iso?: string) => { const t = iso ? new Date(iso).getTime() : NaN; return Number.isFinite(t) ? t : Number.MAX_SAFE_INTEGER }

export function pageArcs(items: ArcInput[]): { pages: PageArc[]; angleById: Map<string, number>; pageIdxById: Map<string, number> } {
  const byPage = new Map<string, ArcInput[]>()
  for (const it of items) { if (!byPage.has(it.pageId)) byPage.set(it.pageId, []); byPage.get(it.pageId)!.push(it) }
  const order = [...byPage.entries()]
    .map(([pageId, list]) => ({ pageId, list, first: Math.min(...list.map((x) => stamp(x.createdAt))) }))
    .sort((a, b) => a.first - b.first || a.pageId.localeCompare(b.pageId))
  const total = items.length
  const pages: PageArc[] = []
  const angleById = new Map<string, number>(), pageIdxById = new Map<string, number>()
  if (!total) return { pages, angleById, pageIdxById }
  let a = ARC_START
  order.forEach(({ pageId, list }, idx) => {
    const span = (Math.PI * 2 - ARC_GAP * order.length) * (list.length / total)
    pages.push({ pageId, title: list[0].pageTitle, idx, n: list.length, a0: a, a1: a + span })
    const sorted = [...list].sort((x, y) => secNo(x.sectionKey) - secNo(y.sectionKey) || stamp(x.createdAt) - stamp(y.createdAt) || x.claimId.localeCompare(y.claimId))
    sorted.forEach((it, i) => { angleById.set(it.claimId, a + ((i + 0.5) / sorted.length) * span); pageIdxById.set(it.claimId, idx) })
    a += span + ARC_GAP
  })
  return { pages, angleById, pageIdxById }
}
```

- [ ] **Step 4: 通ることを確かめる**

Run: `npx vitest run --dir src src/lib/__tests__/recall-field-arcs.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/recall/field.ts src/lib/__tests__/recall-field-arcs.test.ts
git commit -m "feat(recall): 記事の扇形（幅＝主張数・節順・並びは作成日時）を field に置く"
```

---

## Task 8: 近景に扇形と記事名を描き、レンズで1記事だけ明るくする（`field-render.ts`）

**Files:**
- Modify: `src/lib/recall/field-render.ts`
- Test: `src/lib/__tests__/recall-field-render.test.ts`

**Interfaces:**
- Consumes: `PageArc`, `ARC_LINE_R`, `ARC_LABEL_R`（Task 7）
- Produces:
  - `FieldFrame.pages?: Map<number, PageArc[]>`（席ごとの扇形）、`FieldFrame.lens?: number | null`（明るく残す記事の添字）
  - `type ArcHit = { page: number; x: number; y: number; w: number; h: number }`、`FieldHits.arcs: ArcHit[]`

- [ ] **Step 1: テストを足す**

`src/lib/__tests__/recall-field-render.test.ts` の import に `pageArcs` を足し、`describe('field を描く')` の末尾に追加:

```ts
  it('近景では記事の扇形と記事名を描き、記事名の当たり判定を返す', () => {
    const p = populated[1]
    const src = Array.from({ length: COUNTS[p.slot] }, (_, i) => ({ claimId: `c${i}`, pageId: i < 8 ? 'A' : 'B', pageTitle: i < 8 ? '酸素療法' : '急性呼吸不全', sectionKey: `sec${(i % 3) + 1}` }))
    const arcs = pageArcs(src)
    const claims = new Map<number, ClaimDot[]>([[p.slot, src.map((s) => ({ claimId: s.claimId, a: arcs.angleById.get(s.claimId)!, state: 'kept' as const, rem: 0.8, jitter: 0, page: arcs.pageIdxById.get(s.claimId)! }))]])
    const pages = new Map([[p.slot, arcs.pages]])
    const r = recorder()
    const hits = drawField(r.ctx, frame({ claims, pages, view: near(p.slot) }))
    expect(hits.arcs).toHaveLength(2)
    expect(r.texts.some((s) => s.startsWith('酸素療法'))).toBe(true)
    expect(r.texts.some((s) => s.startsWith('急性呼吸不全'))).toBe(true)
    for (const a of hits.arcs) { expect(a.w).toBeGreaterThan(0); expect(a.h).toBeGreaterThan(0) }
    expect(drawField(recorder().ctx, frame({ claims, pages })).arcs).toHaveLength(0)   // 中景では描かない
  })

  it('レンズを掛けると、その記事以外の点が沈む', () => {
    const p = populated[1]
    const src = Array.from({ length: 12 }, (_, i) => ({ claimId: `c${i}`, pageId: i < 6 ? 'A' : 'B', pageTitle: i < 6 ? 'A' : 'B', sectionKey: 'sec1' }))
    const arcs = pageArcs(src)
    const claims = new Map<number, ClaimDot[]>([[p.slot, src.map((s) => ({ claimId: s.claimId, a: arcs.angleById.get(s.claimId)!, state: 'kept' as const, rem: 0.8, jitter: 0, page: arcs.pageIdxById.get(s.claimId)! }))]])
    const pages = new Map([[p.slot, arcs.pages]])
    const alphaOf = (lens: number | null) => {
      const r = recorder()
      const hits = drawField(r.ctx, frame({ claims, pages, lens, view: near(p.slot) }))
      const hit = hits.planets.find((h) => h.slot === p.slot)!
      const byId = new Map(hits.dots.map((d) => [d.claimId, d]))
      const alpha = (id: string) => { const d = byId.get(id)!; return r.arcs.filter((x) => Math.abs(x.x - d.X) < 0.01 && Math.abs(x.y - d.Y) < 0.01 && x.r <= 8).map((x) => x.alpha).sort((a, b) => b - a)[0] }
      return { a: alpha('c0'), b: alpha('c9'), S: hit.S }
    }
    const none = alphaOf(null), lensA = alphaOf(0)
    expect(lensA.a).toBeCloseTo(none.a, 6)
    expect(lensA.b).toBeLessThan(none.b * 0.3)
  })
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run --dir src src/lib/__tests__/recall-field-render.test.ts`
Expected: FAIL（`pages`・`lens` が `FieldFrame` に無く、`hits.arcs` が undefined）

- [ ] **Step 3: 実装する**

`src/lib/recall/field-render.ts` を次のように変える。

import に `ARC_LINE_R, ARC_LABEL_R, type PageArc` を `./field` から足す。型を変える:

```ts
export type FieldFrame = {
  W: number; H: number
  view: FieldView
  field: Planet[]
  claims: Map<number, ClaimDot[]>
  pages?: Map<number, PageArc[]>   // 席ごとの記事の扇形（近景で描く）
  lens?: number | null             // 明るく残す記事の添字（近景）
  t: number
  reduced: boolean
  guide?: number
  bg?: string
}
export type ArcHit = { page: number; x: number; y: number; w: number; h: number }
export type FieldHits = { planets: PlanetHit[]; dots: DotHit[]; arcs: ArcHit[] }
```

`drawField` の `hits` の初期値を `{ planets: [], dots: [], arcs: [] }` にし、`drawPlanet` の呼び出しと受け取りを次にする:

```ts
    const r = drawPlanet(ctx, s.p, s.X, s.Y, s.S, far, a.claims.get(s.p.slot) ?? [], t, a.reduced, proj, view, isNear, isNear ? (a.guide ?? 0) : 0,
      isNear ? (a.pages?.get(s.p.slot) ?? []) : [], isNear ? (a.lens ?? null) : null)
    hits.planets.push({ slot: s.p.slot, X: s.X, Y: s.Y, S: s.S })
    if (isNear) { hits.dots = r.dots; hits.arcs = r.arcs }
```

`drawPlanet` のシグネチャと戻り値を変える（末尾に `pages: PageArc[], lens: number | null` を足し、`{ dots: DotHit[]; arcs: ArcHit[] }` を返す）。点のループの `ctx.globalAlpha = look.alpha * far` の前に、レンズの減光を入れる:

```ts
    const dim = lens !== null && c.page !== lens ? 0.22 : 1
    if (look.glow && S > LABEL_MIN_S) {
      ctx.globalAlpha = look.alpha * far * dim * 0.25; ctx.fillStyle = look.ink
      ctx.beginPath(); ctx.arc(q.X, q.Y, r * 2.6, 0, Math.PI * 2); ctx.fill()
    }
    ctx.globalAlpha = look.alpha * far * dim
```

境目の名前のブロックの後、中景の名前のブロックの前に扇形を足す:

```ts
  // 近景: 記事の扇形と記事名。押すとその記事だけ明るく残る（レンズ）。
  const arcs: ArcHit[] = []
  if (isNear && pages.length) {
    ctx.font = '400 11px "Zen Kaku Gothic New",sans-serif'
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    for (const g of pages) {
      const on = lens === null || lens === g.idx
      ctx.globalAlpha = (on ? 0.22 : 0.08) * far; ctx.strokeStyle = LABEL; ctx.lineWidth = 1
      ctx.beginPath()
      let started = false
      for (let i = 0; i <= 24; i++) {
        const q = proj(at(g.a0 + ((g.a1 - g.a0) * i) / 24, ARC_LINE_R))
        if (!q) continue
        if (!started) { ctx.moveTo(q.X, q.Y); started = true } else ctx.lineTo(q.X, q.Y)
      }
      ctx.stroke()
      const q = proj(at((g.a0 + g.a1) / 2, ARC_LABEL_R))
      if (!q) continue
      const text = `${g.title}  ${g.n}`
      const w = ctx.measureText(text).width + 14
      ctx.globalAlpha = (on ? 0.85 : 0.35) * far
      ctx.fillStyle = 'rgba(11,21,36,.75)'; ctx.fillRect(q.X - w / 2, q.Y - 9, w, 18)
      ctx.fillStyle = lens === g.idx ? INK_HALO : LABEL
      ctx.fillText(text, q.X, q.Y)
      arcs.push({ page: g.idx, x: q.X - w / 2, y: q.Y - 9, w, h: 18 })
    }
    ctx.textBaseline = 'alphabetic'
  }
```

関数の最後を `return { dots, arcs }` にする。

- [ ] **Step 4: `RecallField.tsx` に扇形の当たり判定を通す**

`src/components/recall/RecallField.tsx` の Props に `pages?: Map<number, PageArc[]>`, `lens?: number | null`, `onArcTap?: (page: number) => void` を足し（`PageArc` を `@/lib/recall/field` から import）、`drawField` の呼び出しに `pages: L.pages, lens: L.lens` を渡す。`onUp` の近景の分岐で、点の判定の後・背景タップの前に:

```ts
      const arc = hits.current.arcs.find((h) => x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h)
      if (arc) { L.onArcTap?.(arc.page); return }
```

- [ ] **Step 5: 通ることを確かめる**

Run: `npx vitest run --dir src src/lib/__tests__/recall-field-render.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add src/lib/recall/field-render.ts src/components/recall/RecallField.tsx src/lib/__tests__/recall-field-render.test.ts
git commit -m "feat(recall): 近景に記事の扇形と記事名。タップでその記事だけ明るく残す"
```

---
## Task 9: 席ごとのデータ（`field-data.ts`）と惑星単位の文言（`notice.ts`）

**Files:**
- Create: `src/lib/recall/field-data.ts`（純関数。主張と記録から、惑星・点・扇形・離れかけ数を組む）
- Modify: `src/lib/recall/notice.ts`（`where` を足す）
- Modify: `src/components/recall/useRecallData.ts`（`field-data` を呼んで返す。既存の返り値は残す）
- Test: `src/lib/__tests__/recall-field-data.test.ts`（新規）、`src/lib/__tests__/recall-notice.test.ts`

**Interfaces:**
- Consumes: `buildField`, `pageArcs`, `isOverdue`（field）、`stateOf`, `pickCandidates`, `nextDue`（srs）、`RecallClaim`, `RecallProgress`, `RecallSectionRead`（types）
- Produces:
  - `type FieldData = { planets: Planet[]; dots: Map<number, ClaimDot[]>; pages: Map<number, PageArc[]>; overdueBySlot: Map<number, number>; slotById: Map<string, number> }`
  - `buildFieldData(claims, progressById, readSet, now): FieldData`
  - `jitterOf(claimId): number`（−0.5〜0.5・決定的）
  - `candidatesFor(progress, slotById, slot, now): RecallProgress[]`、`dueFor(progress, slotById, slot, now): NextDue | null`
  - `checkNotice(candidateCount, due, now, where?: string)`（`where` があれば「${where}に、いま確かめる主張はありません…」）
  - `useRecallData()` の返り値に `field: FieldData`, `candidatesFor(slot)`, `dueFor(slot)` を足す

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/recall-field-data.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildFieldData, jitterOf, candidatesFor, dueFor } from '@/lib/recall/field-data'
import { newProgress, applyResult } from '@/lib/recall/srs'
import type { RecallClaim, RecallProgress } from '@/lib/recall/types'

const NOW = new Date('2026-09-04T03:00:00Z')
function claim(id: string, slot: number, pageId: string, sec = 1): RecallClaim {
  return {
    claimId: id, pageId, pageTitle: `記事${pageId}`, pageKind: '💡', sectionKey: `sec${sec}`, sectionHeading: `節${sec}`,
    body: `${id} の本文`, source: '出典', confidence: 'ok', genres: [], primaryGenre: '', genreSlot: slot,
    holes: [], clozeStatus: 'pending', active: true, createdAt: '2026-08-01T00:00:00Z',
  }
}
const claims = [claim('a1', 3, 'A'), claim('a2', 3, 'A', 2), claim('b1', 3, 'B'), claim('c1', 4, 'C'), claim('c2', 4, 'C')]
// a1: 残した（新しい・満タン）、b1: 残したが期限切れ、c1: 読んだ
const fresh = newProgress('a1', NOW)
const stale: RecallProgress = { ...applyResult(newProgress('b1', new Date('2026-08-01T00:00:00Z')), 'ok', new Date('2026-08-01T00:00:00Z')), lastReviewedAt: '2026-08-01T00:00:00Z' }
const progressById = new Map([[fresh.claimId, fresh], [stale.claimId, stale]])
const readSet = new Set(['C#sec1'])

describe('席ごとのデータ', () => {
  const d = buildFieldData(claims, progressById, readSet, NOW)
  it('席の主張数から惑星ができ、主張のある席にだけ点がある', () => {
    expect(d.planets.find((p) => p.slot === 3)!.n).toBe(3)
    expect(d.planets.find((p) => p.slot === 4)!.n).toBe(2)
    expect(d.planets.find((p) => p.slot === 0)!.n).toBe(0)
    expect(d.dots.get(3)).toHaveLength(3); expect(d.dots.get(4)).toHaveLength(2); expect(d.dots.has(0)).toBe(false)
  })
  it('点の状態は記録と読了から決まる', () => {
    const st = (id: string, slot: number) => d.dots.get(slot)!.find((x) => x.claimId === id)!
    expect(st('a1', 3).state).toBe('kept'); expect(st('a1', 3).rem).toBeCloseTo(1, 1)
    expect(st('b1', 3).state).toBe('kept'); expect(st('b1', 3).rem).toBe(0)
    expect(st('c1', 4).state).toBe('touched'); expect(st('c2', 4).state).toBe('cold')
  })
  it('点の角度と記事の添字は扇形から来る。扇形は席ごと', () => {
    expect(d.pages.get(3)!.map((g) => g.pageId)).toEqual(['A', 'B'])
    const a1 = d.dots.get(3)!.find((x) => x.claimId === 'a1')!, b1 = d.dots.get(3)!.find((x) => x.claimId === 'b1')!
    expect(a1.page).toBe(0); expect(b1.page).toBe(1)
    const g = d.pages.get(3)!
    expect(a1.a).toBeGreaterThan(g[0].a0); expect(a1.a).toBeLessThan(g[0].a1)
    expect(b1.a).toBeGreaterThan(g[1].a0); expect(b1.a).toBeLessThan(g[1].a1)
  })
  it('離れかけの数は席ごと', () => {
    expect(d.overdueBySlot.get(3)).toBe(1); expect(d.overdueBySlot.get(4) ?? 0).toBe(0)
  })
  it('散りは主張IDから決まり、−0.5〜0.5 に収まる', () => {
    expect(jitterOf('a1')).toBe(jitterOf('a1'))
    for (const id of ['a1', 'b1', 'x', 'よく忘れる主張']) { expect(jitterOf(id)).toBeGreaterThanOrEqual(-0.5); expect(jitterOf(id)).toBeLessThanOrEqual(0.5) }
    expect(jitterOf('a1')).not.toBe(jitterOf('a2'))
  })
})

describe('席で絞った候補', () => {
  const d = buildFieldData(claims, progressById, readSet, NOW)
  const progress = [fresh, stale]
  it('席を渡すとその席の離れかけだけ、null なら全部', () => {
    expect(candidatesFor(progress, d.slotById, 3, NOW).map((p) => p.claimId)).toEqual(['b1'])
    expect(candidatesFor(progress, d.slotById, 4, NOW)).toEqual([])
    expect(candidatesFor(progress, d.slotById, null, NOW).map((p) => p.claimId)).toEqual(['b1'])
  })
  it('次の期限も席で絞る', () => {
    expect(dueFor(progress, d.slotById, 3, NOW)?.overdue).toBe(true)
    expect(dueFor(progress, d.slotById, 4, NOW)).toBeNull()
  })
})
```

`src/lib/__tests__/recall-notice.test.ts` の末尾に追加:

```ts
  it('席の名前を渡すと、その惑星の話として言う', () => {
    const now = new Date('2026-09-04T03:00:00Z')
    expect(checkNotice(0, null, now, '呼吸')).toBe('呼吸に、まだ残した主張がありません。惑星の主張を開いて「残す」を押すと、ここから確かめられます')
    expect(checkNotice(0, { at: new Date('2026-09-07T03:00:00Z'), count: 2, overdue: false }, now, '呼吸')).toBe('呼吸に、いま確かめる主張はありません。次は 3 日後に 2 件')
    expect(checkNotice(1, null, now, '呼吸')).toBeNull()
  })
```

（`recall-notice.test.ts` の既存の期待文言に「球の主張を開いて」があれば「惑星の主張を開いて」に直す。球は無くなる。）

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run --dir src src/lib/__tests__/recall-field-data.test.ts src/lib/__tests__/recall-notice.test.ts`
Expected: FAIL（`field-data` が無い／`where` が効かない）

- [ ] **Step 3: `field-data.ts` を書く**

```ts
// 主張と本人の記録から、惑星 field に渡す形（惑星・点・扇形・離れかけ数）を組む。純関数。
// 配置（角度）は主張の並びだけで決まり、状態（記憶の残り）は時刻で動く。呼び出し側は
// 主張が変わったときだけ扇形を作り直し、時刻が進んだときは点の状態だけ更新してよい。
import { buildField, pageArcs, isOverdue, type Planet, type PageArc } from './field'
import type { ClaimDot } from './field-render'
import { GENRE_SEATS } from './genres'
import { stateOf, pickCandidates, nextDue, type NextDue } from './srs'
import type { RecallClaim, RecallProgress } from './types'

export type FieldData = {
  planets: Planet[]
  dots: Map<number, ClaimDot[]>
  pages: Map<number, PageArc[]>
  overdueBySlot: Map<number, number>
  slotById: Map<string, number>
}

// 主張IDから −0.5〜0.5 の決定的な値。未着手の霧の上下の散り。
export function jitterOf(claimId: string): number {
  let h = 0
  for (let i = 0; i < claimId.length; i++) h = (Math.imul(h, 31) + claimId.charCodeAt(i)) | 0
  return ((h >>> 0) % 1000) / 1000 - 0.5
}

export function buildFieldData(
  claims: RecallClaim[], progressById: Map<string, RecallProgress>, readSet: Set<string>, now: Date,
): FieldData {
  const bySlot = new Map<number, RecallClaim[]>()
  for (const c of claims) { if (!bySlot.has(c.genreSlot)) bySlot.set(c.genreSlot, []); bySlot.get(c.genreSlot)!.push(c) }
  const counts = GENRE_SEATS.map((_, i) => bySlot.get(i)?.length ?? 0)
  const planets = buildField(counts, 'ring')
  const dots = new Map<number, ClaimDot[]>(), pages = new Map<number, PageArc[]>()
  const overdueBySlot = new Map<number, number>(), slotById = new Map<string, number>()
  for (const [slot, list] of bySlot) {
    const arcs = pageArcs(list.map((c) => ({ claimId: c.claimId, pageId: c.pageId, pageTitle: c.pageTitle, sectionKey: c.sectionKey, createdAt: c.createdAt })))
    pages.set(slot, arcs.pages)
    let overdue = 0
    dots.set(slot, list.map((c) => {
      const st = stateOf(c.claimId, progressById.get(c.claimId), readSet.has(`${c.pageId}#${c.sectionKey}`), now)
      if (isOverdue(st.kind, st.remaining)) overdue++
      slotById.set(c.claimId, slot)
      return { claimId: c.claimId, a: arcs.angleById.get(c.claimId) ?? 0, state: st.kind, rem: st.remaining, jitter: jitterOf(c.claimId), page: arcs.pageIdxById.get(c.claimId) ?? 0 }
    }))
    if (overdue) overdueBySlot.set(slot, overdue)
  }
  return { planets, dots, pages, overdueBySlot, slotById }
}

const inSlot = (progress: RecallProgress[], slotById: Map<string, number>, slot: number | null) =>
  slot === null ? progress : progress.filter((p) => slotById.get(p.claimId) === slot)

// 惑星ごとの「確かめる」。席を渡すとその席の主張だけから候補を選ぶ（保持力の低い順・最大5）。
export function candidatesFor(progress: RecallProgress[], slotById: Map<string, number>, slot: number | null, now: Date): RecallProgress[] {
  return pickCandidates(inSlot(progress, slotById, slot), now)
}
export function dueFor(progress: RecallProgress[], slotById: Map<string, number>, slot: number | null, now: Date): NextDue | null {
  return nextDue(inSlot(progress, slotById, slot), now)
}
```

- [ ] **Step 4: `notice.ts` に `where` を足す**

```ts
export function checkNotice(candidateCount: number, due: NextDue | null, now: Date, where?: string): string | null {
  if (candidateCount > 0) return null
  const head = where ? `${where}に、` : ''
  if (!due || due.count <= 0) {
    return `${head}まだ残した主張がありません。惑星の主張を開いて「残す」を押すと、ここから確かめられます`
  }
  if (due.overdue || due.at.getTime() <= now.getTime()) {
    return `${head}いま確かめる主張はありません。期限が来ている主張が ${due.count} 件あります`
  }
  const days = Math.max(1, Math.ceil((due.at.getTime() - now.getTime()) / DAY))
  return `${head}いま確かめる主張はありません。次は ${days} 日後に ${due.count} 件`
}
```

- [ ] **Step 5: `useRecallData.ts` に足す**

import に `import { buildFieldData, candidatesFor, dueFor } from '@/lib/recall/field-data'` を足し、`const due = useMemo(...)` の直後に:

```ts
  // 惑星 field 用。配置は主張だけで決まるが、点の状態は時刻で動くので now も見る（数百件で数ミリ秒）。
  const field = useMemo(() => buildFieldData(claims, progressById, readSet, now), [claims, progressById, readSet, now])
  const candidatesForSlot = useCallback((slot: number | null) => candidatesFor(openable, field.slotById, slot, now), [openable, field.slotById, now])
  const dueForSlot = useCallback((slot: number | null) => dueFor(openable, field.slotById, slot, now), [openable, field.slotById, now])
```

返り値に `field, candidatesFor: candidatesForSlot, dueFor: dueForSlot` を足す。

- [ ] **Step 6: 通ることを確かめる**

Run: `npx vitest run --dir src src/lib/__tests__/recall-field-data.test.ts src/lib/__tests__/recall-notice.test.ts src/lib/__tests__/recall-data-hook.test.ts && npx tsc --noEmit`
Expected: PASS（`recall-data-hook.test.ts` が返り値の形を固定しているなら、足した3つを許すよう期待を更新する）

- [ ] **Step 7: コミット**

```bash
git add src/lib/recall/field-data.ts src/lib/recall/notice.ts src/components/recall/useRecallData.ts src/lib/__tests__/recall-field-data.test.ts src/lib/__tests__/recall-notice.test.ts src/lib/__tests__/recall-data-hook.test.ts
git commit -m "feat(recall): 席ごとの点・扇形・離れかけ数を組む field-data と、惑星単位の確かめる候補"
```

---

## Task 10: 棚（離れた主張がこちらへ来て並ぶ）を描く（`field-render.ts`・`RecallField.tsx`）

**Files:**
- Modify: `src/lib/recall/field-render.ts`（`drawShelf` を足す）
- Modify: `src/components/recall/RecallField.tsx`（`beforeTap` を足す）
- Test: `src/lib/__tests__/recall-field-render.test.ts`

**Interfaces:**
- Produces:
  - `type DeckDot = { claimId: string; slot: number; from: { X: number; Y: number }; p: number; dir: 1 | -1; again: boolean }`（`p` は 0→1 で棚へ、`dir=-1` は輪へ帰る）
  - `type ShelfHit = { claimId: string; X: number; Y: number }`
  - `drawShelf(ctx, W, H, deck: DeckDot[], target: (d: DeckDot) => { X: number; Y: number } | undefined, label: (slot: number) => string): ShelfHit[]`
  - `SHELF_MS = 900`, `SHELF_GAP_PX = 52`, `SHELF_BOTTOM_PX = 34`
  - `RecallField` Props に `beforeTap?: (x: number, y: number) => boolean`（true を返したら他の当たり判定をしない）

- [ ] **Step 1: テストを足す**

`src/lib/__tests__/recall-field-render.test.ts` の import に `drawShelf, type DeckDot` を足し、末尾に追加:

```ts
describe('棚', () => {
  const deck = (p: number, n = 3): DeckDot[] => Array.from({ length: n }, (_, i) => ({ claimId: `d${i}`, slot: 3, from: { X: 100 + i * 10, Y: 80 }, p, dir: 1, again: false }))
  it('着いた主張だけ当たり判定を返し、横一列に並ぶ', () => {
    const hits = drawShelf(recorder().ctx, W, H, deck(1), () => undefined, () => '呼吸')
    expect(hits).toHaveLength(3)
    expect(new Set(hits.map((h) => h.Y.toFixed(1))).size).toBe(1)
    expect(hits[1].X - hits[0].X).toBeCloseTo(52, 6)
    expect(hits[1].X).toBeCloseTo(W / 2, 6)
    expect(drawShelf(recorder().ctx, W, H, deck(0.5), () => undefined, () => '呼吸')).toHaveLength(0)
  })
  it('こちらへ来るあいだ大きくなる', () => {
    const size = (p: number) => { const r = recorder(); drawShelf(r.ctx, W, H, deck(p, 1), () => undefined, () => ''); return Math.min(...r.arcs.map((x) => x.r)) }
    expect(size(0.1)).toBeLessThan(size(0.9))
  })
  it('帰るときは輪の今の位置へ向かう', () => {
    const r = recorder()
    drawShelf(r.ctx, W, H, [{ claimId: 'd', slot: 3, from: { X: 0, Y: 0 }, p: 0.02, dir: -1, again: false }], () => ({ X: 300, Y: 200 }), () => '')
    const near = r.arcs.filter((x) => x.r <= 8).map((x) => Math.hypot(x.x - 300, x.y - 200))
    expect(Math.min(...near)).toBeLessThan(20)
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run --dir src src/lib/__tests__/recall-field-render.test.ts`
Expected: FAIL（`drawShelf` が無い）

- [ ] **Step 3: `drawShelf` を書く**

`src/lib/recall/field-render.ts` の末尾に追加:

```ts
// 棚。輪から離れた主張が、こちらへ来て（手前で大きくなりながら）画面の下に横一列に並ぶ。
// 「落ちる」とは言わない（重力の向きが無い図で、外へ離れる物が下へ落ちるのは矛盾する）。
export type DeckDot = { claimId: string; slot: number; from: { X: number; Y: number }; p: number; dir: 1 | -1; again: boolean }
export type ShelfHit = { claimId: string; X: number; Y: number }
export const SHELF_MS = 900
export const SHELF_GAP_PX = 52
export const SHELF_BOTTOM_PX = 34
const easeInOut = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2)

export function drawShelf(
  ctx: CanvasRenderingContext2D, W: number, H: number, deck: DeckDot[],
  target: (d: DeckDot) => { X: number; Y: number } | undefined, label: (slot: number) => string,
): ShelfHit[] {
  const hits: ShelfHit[] = []
  const n = deck.length
  for (let i = 0; i < n; i++) {
    const d = deck[i]
    const sx = W / 2 + (i - (n - 1) / 2) * SHELF_GAP_PX, sy = H - SHELF_BOTTOM_PX
    const from = d.dir === 1 ? d.from : (target(d) ?? d.from)
    const k = easeInOut(d.p), mx = (from.X + sx) / 2, my = Math.min(from.Y, sy) - 60
    const X = (1 - k) * (1 - k) * from.X + 2 * (1 - k) * k * mx + k * k * sx
    const Y = (1 - k) * (1 - k) * from.Y + 2 * (1 - k) * k * my + k * k * sy
    const r = 3 + 3.5 * k
    ctx.globalAlpha = 0.28; ctx.fillStyle = INK_HALO
    ctx.beginPath(); ctx.arc(X, Y, r * 2.4, 0, Math.PI * 2); ctx.fill()
    ctx.globalAlpha = d.again ? 0.7 : 0.98
    ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2); ctx.fill()
    if (d.p >= 1 && d.dir === 1) {
      hits.push({ claimId: d.claimId, X, Y })
      ctx.globalAlpha = 0.6; ctx.fillStyle = LABEL
      ctx.font = '400 9.5px "Zen Kaku Gothic New",sans-serif'; ctx.textAlign = 'center'
      ctx.fillText(label(d.slot), X, Y + 18)
    }
  }
  ctx.globalAlpha = 1
  return hits
}
```

- [ ] **Step 4: `RecallField.tsx` に `beforeTap` を足す**

Props に `beforeTap?: (x: number, y: number) => boolean` を足し、`onUp` で `const L = latest.current` の直後に:

```ts
    if (L.beforeTap?.(x, y)) return
```

（`extra` は Task 5 で入れてある。画面側は `extra` の中で `drawShelf` を呼び、返った当たり判定を ref に持って `beforeTap` で見る。）

- [ ] **Step 5: 通ることを確かめる**

Run: `npx vitest run --dir src src/lib/__tests__/recall-field-render.test.ts && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add src/lib/recall/field-render.ts src/components/recall/RecallField.tsx src/lib/__tests__/recall-field-render.test.ts
git commit -m "feat(recall): 棚。離れた主張がこちらへ来て画面の下に並び、覚えたら輪へ帰る"
```

---
## Task 11: 視点の保存（`viewpoint.ts`）と `RecallScreen` の差し替え

**Files:**
- Create: `src/lib/recall/viewpoint.ts`
- Modify: `src/components/recall/RecallScreen.tsx`（全面書き換え）
- Test: `src/lib/__tests__/recall-viewpoint.test.ts`（新規）

**Interfaces:**
- Consumes: `RecallField`, `RecallFieldHandle`（Task 5・8・10）、`drawShelf`, `DeckDot`, `ShelfHit`, `SHELF_MS`（Task 10）、`useRecallData().field / candidatesFor / dueFor`（Task 9）、`checkNotice`（Task 9）、`RecallCard`（既存）、`useReducedMotion`（既存）、`genreLabel`（既存）、`coreKindOf`（cores）
- Produces:
  - `VIEWPOINT_KEY = 'medinode_recall_viewpoint_v1'`
  - `readViewpoint(storage?: Pick<Storage, 'getItem'>): Viewpoint`（無い・壊れている・読めないときは `'outside'`）
  - `writeViewpoint(v: Viewpoint, storage?: Pick<Storage, 'setItem'>): void`（書けなくても落とさない）

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/recall-viewpoint.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readViewpoint, writeViewpoint, VIEWPOINT_KEY } from '@/lib/recall/viewpoint'

function fakeStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v) }, m }
}

describe('視点の保存', () => {
  it('既定は外から。保存した値を読む', () => {
    expect(readViewpoint(fakeStorage())).toBe('outside')
    expect(readViewpoint(fakeStorage({ [VIEWPOINT_KEY]: 'inside' }))).toBe('inside')
  })
  it('壊れた値・読めない環境では外から', () => {
    expect(readViewpoint(fakeStorage({ [VIEWPOINT_KEY]: 'sideways' }))).toBe('outside')
    expect(readViewpoint({ getItem: () => { throw new Error('private') } })).toBe('outside')
    expect(readViewpoint(undefined)).toBe('outside')
  })
  it('書けなくても落ちない', () => {
    const s = fakeStorage()
    writeViewpoint('inside', s)
    expect(s.m.get(VIEWPOINT_KEY)).toBe('inside')
    expect(() => writeViewpoint('inside', { setItem: () => { throw new Error('full') } })).not.toThrow()
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run --dir src src/lib/__tests__/recall-viewpoint.test.ts`
Expected: FAIL

- [ ] **Step 3: `viewpoint.ts` を書く**

```ts
// 視点（外から／中心から）の保存。学習記録ではないので Supabase に置かず、端末ローカルに持つ
// （動きを減らす設定と同じ扱い。PERSONAL_DEVICE_KEYS にも入れない＝アカウントを切り替えても消さない）。
import type { Viewpoint } from './field'

export const VIEWPOINT_KEY = 'medinode_recall_viewpoint_v1'

export function readViewpoint(storage?: Pick<Storage, 'getItem'>): Viewpoint {
  try {
    const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
    const v = s?.getItem(VIEWPOINT_KEY)
    return v === 'inside' ? 'inside' : 'outside'
  } catch {
    return 'outside'
  }
}

export function writeViewpoint(v: Viewpoint, storage?: Pick<Storage, 'setItem'>): void {
  try {
    const s = storage ?? (typeof localStorage !== 'undefined' ? localStorage : undefined)
    s?.setItem(VIEWPOINT_KEY, v)
  } catch {
    // 書けない環境（プライベートブラウズ等）では既定のまま
  }
}
```

- [ ] **Step 4: `RecallScreen.tsx` を書き換える**

`src/components/recall/RecallScreen.tsx` を次の内容に置き換える（旧画面の「残したものだけ」レンズは、居場所5段で見分けが付くので廃止。ヘッダーの高さの実測と Esc・タイマーの控えは旧画面から引き継ぐ）:

```tsx
'use client'
// Recall 画面。惑星 field ＋ 上の見出し ＋ 帯 ＋ 下の操作列（この惑星を確かめる／視点／戻す）。
// 確かめる: 寄っている惑星の離れかけ（最大5）が輪から離れ、こちらへ来て画面の下の棚に並ぶ。
// 棚をタップ→カード→覚えた／まだ。覚えたら光として輪の内側へ帰る。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRecallData } from './useRecallData'
import { useReducedMotion } from './useReducedMotion'
import { RecallField, type RecallFieldHandle } from './RecallField'
import { RecallCard } from './RecallCard'
import { drawShelf, SHELF_MS, type DeckDot, type FieldHits, type ShelfHit } from '@/lib/recall/field-render'
import { isOverdue, type Stage, type Viewpoint } from '@/lib/recall/field'
import { genreLabel } from '@/lib/recall/genres'
import { coreKindOf, type CoreKind } from '@/lib/recall/cores'
import { checkNotice } from '@/lib/recall/notice'
import { readViewpoint, writeViewpoint } from '@/lib/recall/viewpoint'

const NOTICE_MS = 4000
const HEADER_FALLBACK = 132
const STAGE_LABEL: Record<Stage, string> = { far: '遠景', mid: '中景', near: '近景' }
const KIND_LABEL: Record<CoreKind, string> = { flow: '流れ', exchange: '交換', signal: '信号', invasion: '侵入', structure: '構造', regulation: '調節', system: '体系' }

export function RecallScreen() {
  const data = useRecallData()
  const reduced = useReducedMotion()
  const field = useRef<RecallFieldHandle>(null)
  const [viewpoint, setViewpoint] = useState<Viewpoint>('outside')
  const [stage, setStage] = useState<Stage>('mid')
  const [nearSlot, setNearSlot] = useState<number | null>(null)
  const [front, setFront] = useState<number | null>(null)
  const [lens, setLens] = useState<number | null>(null)
  const [card, setCard] = useState<{ claimId: string; mode: 'quiz' | 'view' } | null>(null)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [deckCount, setDeckCount] = useState(0)
  const [foldEmpty, setFoldEmpty] = useState(true)
  const [headerH, setHeaderH] = useState(HEADER_FALLBACK)
  // 棚は毎フレーム動くので ref に持つ。件数だけ state に写して案内を出す。
  const deck = useRef<DeckDot[]>([])
  const shelfHits = useRef<ShelfHit[]>([])
  const lastHits = useRef<FieldHits>({ planets: [], dots: [], arcs: [] })
  const lastT = useRef(0)

  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const later = useCallback((fn: () => void, ms: number) => { const id = setTimeout(() => { timers.current.delete(id); fn() }, ms); timers.current.add(id); return id }, [])
  const clearTimers = useCallback(() => { for (const id of timers.current) clearTimeout(id); timers.current.clear() }, [])
  useEffect(() => () => clearTimers(), [clearTimers])
  const say = useCallback((msg: string) => { setNotice(msg); later(() => setNotice(null), NOTICE_MS) }, [later])

  useEffect(() => { setViewpoint(readViewpoint()) }, [])
  useEffect(() => {
    if (!card) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCard(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [card])
  useEffect(() => {
    const el = document.querySelector('[data-app-header]')
    if (!el) return
    const sync = () => setHeaderH(el.getBoundingClientRect().height || HEADER_FALLBACK)
    sync()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(sync); ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const claimById = useMemo(() => new Map(data.claims.map((c) => [c.claimId, c])), [data.claims])
  const planets = data.field.planets
  const populated = useMemo(() => planets.filter((p) => p.n > 0), [planets])
  const empties = useMemo(() => planets.filter((p) => p.n === 0), [planets])
  const startSlot = populated[0]?.slot ?? null
  const shownSlot = stage === 'near' ? nearSlot : front
  const shownPlanet = shownSlot !== null ? planets.find((p) => p.slot === shownSlot) : undefined
  const shownDots = shownSlot !== null ? data.field.dots.get(shownSlot) ?? [] : []
  const shownCounts = useMemo(() => ({
    kept: shownDots.filter((d) => d.state === 'kept').length,
    settled: shownDots.filter((d) => d.state === 'settled').length,
    overdue: shownDots.filter((d) => isOverdue(d.state, d.rem)).length,
  }), [shownDots])

  // 描画の後に棚を描く（RecallField の extra）。棚の進みもここで進める。
  const extra = useCallback((ctx: CanvasRenderingContext2D, hits: FieldHits, t: number) => {
    lastHits.current = hits
    const dt = lastT.current ? Math.min(t - lastT.current, 0.05) : 0
    lastT.current = t
    const list = deck.current
    for (const d of list) d.p = Math.max(0, Math.min(1, d.p + (dt * 1000 / SHELF_MS) * d.dir))
    for (let i = list.length - 1; i >= 0; i--) if (list[i].dir === -1 && list[i].p <= 0) list.splice(i, 1)
    if (list.length !== deckCount) setDeckCount(list.length)
    const W = ctx.canvas.clientWidth, H = ctx.canvas.clientHeight
    shelfHits.current = drawShelf(ctx, W, H, list, (d) => {
      const dot = hits.dots.find((h) => h.claimId === d.claimId)
      if (dot) return { X: dot.X, Y: dot.Y }
      const p = hits.planets.find((h) => h.slot === d.slot)
      return p ? { X: p.X, Y: p.Y } : undefined
    }, genreLabel)
  }, [deckCount])

  const pull = useCallback((ids: string[]) => {
    ids.forEach((id, k) => later(() => {
      if (deck.current.some((d) => d.claimId === id)) return
      const c = claimById.get(id); if (!c) return
      const hits = lastHits.current
      const dot = hits.dots.find((h) => h.claimId === id)
      const p = hits.planets.find((h) => h.slot === c.genreSlot)
      const from = dot ? { X: dot.X, Y: dot.Y } : p ? { X: p.X, Y: p.Y } : { X: 0, Y: 0 }
      deck.current.push({ claimId: id, slot: c.genreSlot, from, p: reduced ? 1 : 0.001, dir: 1, again: false })
    }, reduced ? 0 : 120 + k * 70))
  }, [claimById, later, reduced])

  const check = useCallback(() => {
    data.clearSaveError()
    const slot = stage === 'near' ? nearSlot : front
    const p = slot !== null ? planets.find((q) => q.slot === slot) : undefined
    if (!p || p.n === 0) { say('空の惑星には確かめる主張がありません'); return }
    if (stage !== 'near') field.current?.go('near', p.slot)
    const cands = data.candidatesFor(p.slot).map((x) => x.claimId).filter((id) => claimById.has(id) && !deck.current.some((d) => d.claimId === id))
    if (!cands.length) { const msg = checkNotice(0, data.dueFor(p.slot), new Date(), genreLabel(p.slot)); if (msg) say(msg); return }
    setNotice(null)
    pull(cands)
  }, [data, stage, nearSlot, front, planets, claimById, say, pull])

  const reset = () => { clearTimers(); deck.current = []; setDeckCount(0); setCard(null); setNotice(null); setSaving(false); data.clearSaveError() }

  const onAnswer = async (claimId: string, result: 'ok' | 'ng') => {
    setSaving(true)
    try { await data.review(claimId, result) } catch { setSaving(false); setCard(null); say('保存に失敗しました。通信を確かめてもう一度'); return }
    setSaving(false); setCard(null)
    const d = deck.current.find((x) => x.claimId === claimId)
    if (!d) return
    if (result === 'ok') { d.dir = -1; if (reduced) d.p = 0 } else d.again = true
  }
  const kept = (id: string) => { const p = data.progressById.get(id); return !!p && !p.removedAt }
  const cardClaim = card ? claimById.get(card.claimId) : undefined
  const fatal = data.error && !data.claims.length ? data.error : null
  const pill = notice ?? data.saveError ?? (data.error && !fatal ? data.error : null)

  const changeViewpoint = (v: Viewpoint) => { setViewpoint(v); writeViewpoint(v) }

  return (
    <div className="fixed inset-0 z-0 bg-[#0B1524] text-slate-100 overflow-hidden" style={{ fontFamily: '"Zen Kaku Gothic New",-apple-system,"Hiragino Sans",sans-serif' }}>
      {planets.length > 0 && (
        <RecallField ref={field} planets={planets} claims={data.field.dots} pages={data.field.pages} lens={stage === 'near' ? lens : null}
          viewpoint={viewpoint} reduced={reduced} startSlot={startSlot}
          onFront={setFront}
          onStage={(s, slot) => { setStage(s); setNearSlot(slot); if (s !== 'near') setLens(null) }}
          onPlanetTap={(slot) => { const p = planets.find((q) => q.slot === slot); if (!p || p.n === 0) { say('空の惑星には入れません'); return } field.current?.go('near', slot) }}
          onDotTap={(id) => { const d = shownDots.find((x) => x.claimId === id); setCard({ claimId: id, mode: d && isOverdue(d.state, d.rem) ? 'quiz' : 'view' }) }}
          onArcTap={(page) => setLens((cur) => (cur === page ? null : page))}
          onBackgroundTap={() => { if (card) { setCard(null); return } if (stage === 'near') field.current?.go('mid') }}
          beforeTap={(x, y) => {
            let best: ShelfHit | null = null, bd = 16
            for (const h of shelfHits.current) { const d = Math.hypot(h.X - x, h.Y - y); if (d < bd) { bd = d; best = h } }
            if (!best) return false
            setCard({ claimId: best.claimId, mode: 'quiz' }); return true
          }}
          extra={extra} />
      )}

      {/* 上の見出し: 段・いま見ているジャンル・族・内訳。ヘッダーの実測高さの下から始める。 */}
      <div className="absolute left-5 right-5 flex flex-wrap items-baseline gap-x-3 gap-y-1 pointer-events-none" style={{ top: headerH + 16 }}>
        <span className="text-[10.5px] tracking-[.1em] text-slate-400 border border-slate-600/40 rounded-full px-2">{STAGE_LABEL[stage]}</span>
        {shownPlanet && <>
          <b className="text-[15px] font-medium tracking-[.04em]">{shownPlanet.label}</b>
          <span className="text-[11.5px] text-slate-400">{KIND_LABEL[coreKindOf(shownPlanet.slot)]}</span>
          {stage === 'near'
            ? <span className="text-[11.5px] text-slate-400">主張 {shownPlanet.n} ・ 残した {shownCounts.kept} ・ 定着 {shownCounts.settled}</span>
            : <span className="text-[11.5px] text-slate-400">主張 {shownPlanet.n}</span>}
          {shownCounts.overdue > 0 && <span className="text-[11.5px] text-[#F6E7B8]">離れかけ {shownCounts.overdue}</span>}
          {stage === 'near' && lens !== null && <span className="text-[10.5px] tracking-[.1em] text-slate-300 border border-slate-600/40 rounded-full px-2">レンズ: {data.field.pages.get(shownPlanet.slot)?.[lens]?.title}</span>}
        </>}
      </div>
      {stage === 'near' && (
        <button type="button" onClick={() => field.current?.go('mid')} className="absolute right-5 rounded-full border border-slate-600/40 bg-[rgba(12,20,30,.85)] px-3 py-1 text-[11.5px] text-slate-300 hover:text-slate-100" style={{ top: headerH + 14 }}>← 中景へ</button>
      )}

      <div className="absolute left-7 bottom-[112px] text-[10.5px] text-slate-400 leading-7 tracking-[.06em] pointer-events-none max-[680px]:hidden">
        <div><i className="inline-block w-2 h-2 rounded-full mr-2 align-[1px]" style={{ background: '#F4F7FA', boxShadow: '0 0 6px #F4F7FA' }} />定着（内縁の内）</div>
        <div><i className="inline-block w-2 h-2 rounded-full mr-2 align-[1px]" style={{ background: '#EBF2FB' }} />残した（明るいほど思い出せる）</div>
        <div><i className="inline-block w-2 h-2 rounded-full mr-2 align-[1px]" style={{ background: '#F6E7B8', boxShadow: '0 0 6px #F6E7B8' }} />離れかけ</div>
        <div><i className="inline-block w-2 h-2 rounded-full mr-2 align-[1px]" style={{ background: '#8FA3BD' }} />読んだ節の主張</div>
        <div><i className="inline-block w-2 h-2 rounded-full mr-2 align-[1px]" style={{ background: '#7C8DA6' }} />未着手</div>
      </div>

      {deckCount > 0 && !card && (
        <div className={`absolute left-1/2 -translate-x-1/2 ${pill ? 'bottom-[184px]' : 'bottom-[148px]'} text-[11px] tracking-[.1em] text-slate-400 pointer-events-none`}>離れた主張が <b className="text-[#F6E7B8] font-medium tabular-nums">{deckCount}</b>　タップで開く</div>
      )}
      {pill && <div className="absolute left-1/2 -translate-x-1/2 bottom-[148px] max-w-[92%] truncate text-[12px] tracking-[.06em] text-cyan-200 bg-[rgba(12,20,30,.9)] border border-slate-600/40 rounded-full px-4 py-2 pointer-events-none">{pill}</div>}

      {/* 帯: 主張のある席を先頭、空の席は末尾に畳む。離れかけがある席は光の数を添える。 */}
      <nav aria-label="ジャンル" className="absolute inset-x-0 bottom-[58px] border-t border-slate-600/30 bg-[rgba(11,21,36,.85)] backdrop-blur">
        <ul className="flex gap-1 overflow-x-auto px-3 py-1.5 text-[11px]">
          {populated.map((p) => {
            const od = data.field.overdueBySlot.get(p.slot) ?? 0
            const lit = front === p.slot
            return (
              <li key={p.slot}>
                <button type="button" onClick={() => field.current?.jump(p.slot)} aria-current={lit ? 'true' : undefined}
                  className={`whitespace-nowrap rounded px-2 py-1 ${lit ? 'bg-[#F6E7B8] text-[#0B1524]' : 'text-[#A9B8CC] hover:bg-white/10'}`}>
                  {p.label}<span className="ml-1 opacity-60 tabular-nums">{p.n}</span>
                  {od > 0 && <span className={`ml-1 tabular-nums ${lit ? 'text-[#5a4a12]' : 'text-[#F6E7B8]'}`}>●{od}</span>}
                </button>
              </li>
            )
          })}
          {empties.length > 0 && (
            <li><button type="button" onClick={() => setFoldEmpty((f) => !f)} className="whitespace-nowrap rounded px-2 py-1 text-slate-500 hover:bg-white/10">{foldEmpty ? `空の席 ${empties.length} ▸` : '空の席を畳む ◂'}</button></li>
          )}
          {!foldEmpty && empties.map((p) => (
            <li key={p.slot}><button type="button" onClick={() => field.current?.jump(p.slot)} className="whitespace-nowrap rounded px-2 py-1 text-slate-500 hover:bg-white/10">{p.label}</button></li>
          ))}
        </ul>
      </nav>

      <div className="absolute left-1/2 -translate-x-1/2 bottom-3 flex gap-2.5 items-center">
        <button type="button" onClick={check} className="rounded-full border border-[#F6E7B8]/70 text-[#F6E7B8] bg-[rgba(12,20,30,.9)] px-5 py-[11px] text-[12.5px] tracking-[.08em] backdrop-blur">この惑星を確かめる</button>
        <div className="flex rounded-full border border-slate-600/40 bg-[rgba(12,20,30,.9)] overflow-hidden" role="group" aria-label="視点">
          <button type="button" onClick={() => changeViewpoint('outside')} className={`px-3.5 py-[11px] text-[11.5px] ${viewpoint === 'outside' ? 'text-cyan-300' : ''}`}>外から</button>
          <button type="button" onClick={() => changeViewpoint('inside')} className={`px-3.5 py-[11px] text-[11.5px] ${viewpoint === 'inside' ? 'text-cyan-300' : ''}`}>中心から</button>
        </div>
        {deckCount > 0 && <button type="button" onClick={reset} className="rounded-full border border-slate-600/40 bg-[rgba(12,20,30,.9)] px-5 py-[11px] text-[12.5px] tracking-[.08em]">戻す</button>}
      </div>

      {card && cardClaim && (
        <RecallCard key={card.claimId + card.mode} claim={cardClaim} mode={card.mode} kept={kept(cardClaim.claimId)} pending={saving}
          onAnswer={(r) => void onAnswer(cardClaim.claimId, r)}
          onKeep={async (k) => { setSaving(true); try { await data.keep(cardClaim.claimId, k) } catch { say('保存に失敗しました。通信を確かめてもう一度') } setSaving(false) }}
          onClose={() => setCard(null)} />
      )}
      {data.loading && <div className="absolute inset-0 grid place-items-center text-slate-400 text-sm pointer-events-none">読み込んでいます</div>}
      {fatal && <div className="absolute inset-0 grid place-items-center text-rose-300 text-sm pointer-events-none">{fatal}</div>}
    </div>
  )
}
```

`ctx.canvas.clientWidth` は画面側で半径を計算しているのではなく棚の並びの幅に使うだけだが、走査テストの禁止語（`Math.min(W, H)`・`H / 2`）は使っていないことを確かめる。

- [ ] **Step 5: 型と走査テストを通す**

Run: `npx tsc --noEmit && npx vitest run --dir src src/lib/__tests__/recall-viewpoint.test.ts src/lib/__tests__/recall-viewport-single-source.test.ts`
Expected: PASS（`RecallCard` の `mode='quiz'` は `onAnswer` を受ける既存の作り。`useRecallData` の `sprites`・`marks`・`strands` はこの時点ではまだ残っていてよい）

- [ ] **Step 6: コミット**

```bash
git add src/lib/recall/viewpoint.ts src/components/recall/RecallScreen.tsx src/lib/__tests__/recall-viewpoint.test.ts
git commit -m "feat(recall): Recall 画面を惑星 field に差し替える（帯・惑星ごとの確かめる・棚・視点の切り替え）"
```

---

## Task 12: 単一球の撤去と、全体の確認

**着手条件:** `feat/genre-seats-37` と `worktree-recall-seven-cores` のどちらを正にするかが決まっていること（引き継ぎ 09-04）。`src/lib/recall/genres.ts` は両方で変更済みで、こちらが向こうを含む形（09-04 引き継ぎ）。決まっていなければ、この Task の Step 1〜4 だけ進めて Step 5 のマージは止める。

**Files:**
- Delete: `src/components/recall/RecallSphere.tsx`, `src/lib/recall/render.ts`, `src/lib/__tests__/recall-render.test.ts`
- Modify: `src/components/recall/useRecallData.ts`（`sprites`・`marks`・`strands`・`layoutClaims`・`strandsOf`・`centroid` の利用を外す。`counts` は `field.dots` から数える）
- Modify: `src/lib/__tests__/recall-viewport-single-source.test.ts`（`RecallSphere.tsx` の存在確認を `RecallField.tsx` に。`pickAt`／`hereMark` の検査は削除し、代わりに `RecallField.tsx` が `projectorOf` を直接呼ばず `drawField` を通すことを確かめる）
- Modify: `src/lib/__tests__/recall-data-hook.test.ts`（`sprites` を見ている期待を `field.dots` に）

- [ ] **Step 1: 消す**

```bash
git rm src/components/recall/RecallSphere.tsx src/lib/recall/render.ts src/lib/__tests__/recall-render.test.ts
```

- [ ] **Step 2: `useRecallData.ts` を整える**

`layoutClaims`・`strandsOf`・`centroid`・`Sprite`・`Mark` の import と、`positions`・`strands`・`phaseById`・`sprites`・`marks` の `useMemo` を消す。`counts` を次にする:

```ts
  const counts = useMemo(() => {
    const c = { kept: 0, touched: 0, cold: 0, settled: 0 }
    for (const list of field.dots.values()) for (const d of list) c[d.state]++
    return c
  }, [field])
```

返り値から `sprites, marks, strands` を外す。`src/lib/recall/layout.ts` は `seatCenter`（球状配置）が `field.ts` から使われるので残す。

- [ ] **Step 3: 走査テストを直す**

`src/lib/__tests__/recall-viewport-single-source.test.ts` の `it('走査対象の tsx が見つかる…')` を:

```ts
  it('走査対象の tsx が見つかる（置き場所が変わったら気付く）', () => {
    expect(files).toContain('RecallField.tsx')
    expect(files.length).toBeGreaterThanOrEqual(3)
  })
```

`callsIn`・`argsOf`・`splitArgs` と `it('pickAt / hereMark は …')` を消し、代わりに:

```ts
  it('RecallField は投影を自分で組まず drawField を通す', () => {
    const src = fs.readFileSync(path.join(dir, 'RecallField.tsx'), 'utf8')
    expect(src.includes('drawField(')).toBe(true)
    expect(src.includes('projectorOf(')).toBe(false)
  })
```

- [ ] **Step 4: 全部を回す**

```bash
npx vitest run --dir src
npx tsc --noEmit
npm run build
```
Expected: すべて通る（`admin-engagement-route.test.ts` は JST 00〜09時に落ちる既知の別件。それ以外に赤が無いこと）。`recall-data-hook.test.ts` が `sprites` を見て落ちたら `field.dots` の合計件数を見る期待に直す

- [ ] **Step 5: 目視と、正にするブランチ**

1. 共有チェックアウト側で `npm run dev` を上げ、`RECALL_EMAILS` のアカウントで Recall タブを開く。確かめる4つ: 帯→惑星が正面へ／惑星タップ→近景・境目の名前が3秒／「この惑星を確かめる」→棚→答えを見る→覚えた→輪の内側へ帰る／「中心から」に切り替えて同じ動線
2. 正にするブランチが `worktree-recall-seven-cores` なら、`feat/genre-seats-37` の `genres.ts` の差分を突き合わせて取り込んでから main へマージ。逆なら向こうへ rebase
3. マージだけでは本番に出ない（記憶 `merge-is-not-deploy`）。push はオーナーの承認を取ってから

- [ ] **Step 6: コミット**

```bash
git add -A src/components/recall src/lib/recall src/lib/__tests__
git commit -m "refactor(recall): 単一球（RecallSphere・render.ts）を撤去し、field だけにする"
```

---

## 自己点検（計画を書いたあとに実施）

- 仕様の対応: 居場所5段（Task 1・2）／明るさの向きの是正（Task 1・2）／遠景の要約（Task 2・4）／惑星ごとの確かめる・手で摘む（Task 9・11）／3段＋飛ぶ（Task 3・5）／視点 A/B と保存（Task 3・11）／慣性と掴んで回す（Task 3・4・5）／境目の名前（Task 4・5）／記事の扇形とレンズ（Task 7・8・11）／帯の畳みと空の惑星（Task 2・11）／棚とカード（Task 10・11）／単一球の撤去（Task 12）。仕様の「複数ジャンルのチップ」と「帯の先頭『すべて』」は本計画に含めない（後述）
- 型の一致: `ClaimDot` は Task 2 で `{ claimId, a, state, rem, jitter, page }` に定め、Task 4・8・9 が同じ形を使う。`FieldHits` は Task 4 で `{ planets, dots }`、Task 8 で `arcs` を足す（Task 5 の `RecallField` は `hits.current.arcs` を Task 8 の Step 4 で使い始める）。`drawField` の戻り値は Task 4 以降 `FieldHits`
- 置き場所: 投影は `field.ts` の `projectorOf` だけ。`RecallField.tsx`・`RecallScreen.tsx` に `Math.min(W, H)`・`H / 2` を書いていない

## この計画に含めないこと

- 複数ジャンルの主張のチップ（「他の席: ○○」）と、帯の先頭の「すべて」（離れかけのある惑星を順に回る）。どちらも一周が本番で通ってから足す
- 読む画面からの「残す」「読んだ」の入口（部品1）、Notion への落とし（部品4）
- 描画層の WebGL 差し替え（主張 2,500 超で）
- ジャンル席の統合そのもの（`feat/genre-seats-37` との突き合わせ）は Task 12 の着手条件であって、この計画の作業ではない
