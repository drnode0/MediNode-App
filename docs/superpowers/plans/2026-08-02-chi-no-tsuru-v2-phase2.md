# 知の蔓 v2 フェーズ2（スクロール構造）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 蔓全体を1画面に収めるのをやめ、縦にスクロールして辿れる記録にする。「葉95枚の壁」を消す。

**Architecture:** 幾何をすべて `src/lib/vine-scroll.ts` の純関数に置き、`VineScene` はそれを描くだけにする。縦位置は**高さではなく葉の番号**に比例させ、1葉あたり14pxを常に確保する（間引かない）。ビューポート±1画面分だけをDOMに載せる。

**Tech Stack:** Next.js / TypeScript / vitest（`npm test`）。コンポーネントテストの基盤は無いので、**テストしたい判断はすべて純関数に出す**。

**正典:** `docs/superpowers/specs/2026-08-02-chi-no-tsuru-v2-design.md` §3・§4・§5・§11

## Global Constraints

- **縦位置は葉の番号に比例させる（高さではない）。** 複利のため高さに比例させると初期の学びが潰れる（葉900枚のとき最初の125枚は全体の0.2%）
- **1葉あたり14px以上を常に確保し、間引かない。** 既存の `stride` による間引きと `MAX_LEAVES_DRAWN` は削除する
- **仮想化必須**：DOMに載せるのはビューポート±1画面分の葉だけ
- **タップできるのは描かれている葉だけ。** 全葉をタップ対象にしない
- **文言の六つの禁（§14）**：説明しない／溜めの読点を置かない／二人称を使わない／褒めない／数えるものを増やさない／感嘆符を使わない。**新しい文言は必ず `src/lib/vine-copy.ts` に置き、`ALL_VINE_COPY` に載せる**
- 蔓の中の言葉は常体。測るものは算用数字、出来事は漢数字
- **色褪せ・未読・連続日数を数えてUIに出すことは永久禁止**
- **このフェーズではアセットを差し替えない。** 葉は現行のSVG仮アートのまま。変えるのは配置だけ
- コメントは既存ファイルの密度に合わせる（なぜそうしたかを書く）

---

### Task 1: 幾何の純関数（`vine-scroll.ts`）

**Files:**
- Create: `src/lib/vine-scroll.ts`
- Test: `src/lib/__tests__/vine-scroll.test.ts`

**Interfaces:**
- Consumes: `passedMilestones`, `type Milestone`（`@/lib/vine-ladder`）
- Produces:
  - `PX_PER_LEAF: 14` / `SCENE_TOP_PAD: 80` / `GROUND_GAP: 40` / `SCENE_BOTTOM_PAD: 60`
  - `sceneHeightPx(total: number): number`
  - `leafY(index: number, total: number): number`（1始まりの葉番号 → シーン上端からのy）
  - `groundY(total: number): number`
  - `visibleRange(scrollTop: number, viewportH: number, total: number): { from: number; to: number }`
  - `markPositions(total: number): { milestone: Milestone; leafIndex: number; y: number }[]`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/lib/__tests__/vine-scroll.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  PX_PER_LEAF, SCENE_TOP_PAD, GROUND_GAP, SCENE_BOTTOM_PAD,
  sceneHeightPx, leafY, groundY, visibleRange, markPositions,
} from '../vine-scroll'

describe('葉の縦位置', () => {
  it('いちばん新しい葉が上端の余白の位置に来る', () => {
    expect(leafY(100, 100)).toBe(SCENE_TOP_PAD)
  })
  it('古い葉ほど下に来る（1葉あたり14px）', () => {
    expect(leafY(99, 100)).toBe(SCENE_TOP_PAD + PX_PER_LEAF)
    expect(leafY(1, 100)).toBe(SCENE_TOP_PAD + 99 * PX_PER_LEAF)
  })
  it('葉が何枚あっても間隔は縮まない（間引かない設計の担保）', () => {
    for (const total of [10, 300, 3000]) {
      expect(leafY(1, total) - leafY(2, total)).toBe(PX_PER_LEAF)
    }
  })
  it('葉0でも落ちない', () => {
    expect(() => sceneHeightPx(0)).not.toThrow()
    expect(groundY(0)).toBe(SCENE_TOP_PAD + GROUND_GAP)
  })
})

describe('シーンの丈', () => {
  it('地面は最古の葉より下、シーンはさらに下に余白を持つ', () => {
    expect(groundY(100)).toBe(leafY(1, 100) + GROUND_GAP)
    expect(sceneHeightPx(100)).toBe(groundY(100) + SCENE_BOTTOM_PAD)
  })
  it('葉300枚で6画面分ほどになる（画面700px想定）', () => {
    expect(Math.round(sceneHeightPx(300) / 700)).toBe(6)
  })
})

describe('仮想化の窓', () => {
  it('上端では新しい側だけを返す', () => {
    const r = visibleRange(0, 700, 300)
    expect(r.to).toBe(300)
    expect(r.from).toBeLessThan(300)
    expect(r.from).toBeGreaterThanOrEqual(1)
  })
  it('前後1画面分の余白を含む（窓はおよそ3画面分）', () => {
    // 上端でも下端でもない位置。3画面分 ÷ 14px = およそ150枚が窓に入る
    const mid = visibleRange(1400, 700, 300)
    expect(mid.to - mid.from + 1).toBeGreaterThanOrEqual(148)
    expect(mid.to - mid.from + 1).toBeLessThanOrEqual(156)
    // 画面の中に居る葉が窓から漏れていないこと
    expect(leafY(mid.to, 300)).toBeLessThanOrEqual(1400)
    expect(leafY(mid.from, 300)).toBeGreaterThanOrEqual(1400 + 700)
  })
  it('総数を超えない・1を下回らない', () => {
    const r = visibleRange(-9999, 700, 50)
    expect(r.from).toBe(1)
    expect(r.to).toBe(50)
  })
  it('葉0なら空の窓を返す', () => {
    expect(visibleRange(0, 700, 0)).toEqual({ from: 1, to: 0 })
  })
})

describe('越えた印', () => {
  it('越えた実物だけを、越えた時点の葉の位置に置く', () => {
    const marks = markPositions(60) // アリ3・テントウムシ4・ドングリ10・カタツムリ18・湯のみ35・スズメ50
    expect(marks.map((m) => m.milestone.label)).toEqual(
      ['アリ', 'テントウムシ', 'ドングリ', 'カタツムリ', '湯のみ', 'スズメ'],
    )
    const suzume = marks[marks.length - 1]
    expect(suzume.leafIndex).toBe(50)
    expect(suzume.y).toBe(leafY(50, 60))
  })
  it('まだ越えていない実物は含めない', () => {
    expect(markPositions(2)).toEqual([])
  })
})
```

- [ ] **Step 2: テストが落ちることを確認**

```bash
npm test -- src/lib/__tests__/vine-scroll.test.ts
```

Expected: FAIL（`Failed to resolve import "../vine-scroll"`）

- [ ] **Step 3: 実装する**

Create `src/lib/vine-scroll.ts`:

```ts
// 知の蔓のスクロール幾何（純関数）。DOMに触れない——描画とテストが同じ源を見る。
// 縦位置は「高さ」ではなく「葉の番号」に比例させる。複利のため高さに比例させると
// 初期の学びが潰れるため（葉900枚のとき最初の125枚は全体の0.2%）。
// これにより、どの時期の学びも等しい厚みで辿れる。高さは数字と「越えた印」で示す。
import { passedMilestones, type Milestone } from './vine-ladder'

// 1葉あたりの縦幅。葉身に対する節間の比が実測の自然な帯（0.22〜0.40）に入る値。
// ⚠️ 何枚あっても縮めない——縮めた瞬間に「葉が潰れて塊になる」旧構造に戻る。
export const PX_PER_LEAF = 14
export const SCENE_TOP_PAD = 80     // 穂先の上の余白
export const GROUND_GAP = 40        // 最古の葉から地面まで
export const SCENE_BOTTOM_PAD = 60  // 地面の下の余白

// 葉の番号（1=最古）→ シーン上端からのy。新しいほど上。
export function leafY(index: number, total: number): number {
  return SCENE_TOP_PAD + (total - index) * PX_PER_LEAF
}

export function groundY(total: number): number {
  return SCENE_TOP_PAD + Math.max(0, total - 1) * PX_PER_LEAF + GROUND_GAP
}

export function sceneHeightPx(total: number): number {
  return groundY(total) + SCENE_BOTTOM_PAD
}

// DOMに載せる葉の範囲。ビューポートの前後1画面分を余白に取る
// （スクロール中に葉が現れる瞬間が見えないようにするため）。
export function visibleRange(
  scrollTop: number, viewportH: number, total: number,
): { from: number; to: number } {
  if (total <= 0) return { from: 1, to: 0 }
  const yTop = scrollTop - viewportH
  const yBottom = scrollTop + viewportH * 2
  // y が小さいほど新しい。y → index は leafY の逆
  const idxAt = (y: number) => total - (y - SCENE_TOP_PAD) / PX_PER_LEAF
  const hi = Math.ceil(idxAt(yTop))
  const lo = Math.floor(idxAt(yBottom))
  return {
    from: Math.max(1, Math.min(total, lo)),
    to: Math.max(1, Math.min(total, hi)),
  }
}

// 越えた実物を、越えた時点の葉の位置に置く。これがそのまま目次になる（§4）。
export function markPositions(
  total: number,
): { milestone: Milestone; leafIndex: number; y: number }[] {
  return passedMilestones(total)
    .filter((m) => m.leaves <= total)
    .map((m) => ({ milestone: m, leafIndex: m.leaves, y: leafY(m.leaves, total) }))
}
```

- [ ] **Step 4: テストが通ることを確認**

```bash
npm test -- src/lib/__tests__/vine-scroll.test.ts
```

Expected: PASS（12 tests）

- [ ] **Step 5: 型検査と全テスト**

```bash
npx tsc --noEmit && npm test
```

Expected: 型エラーなし・全 PASS

- [ ] **Step 6: コミット**

```bash
git add src/lib/vine-scroll.ts src/lib/__tests__/vine-scroll.test.ts
git commit -m "知の蔓: スクロール幾何の純関数を追加（葉の番号に比例・間引かない）"
```

---

### Task 2: `VineScene` をスクロール描画に書き換える

現行は `viewBox="0 0 390 620"` の固定シーンに全体を押し込み、`MAX_LEAVES_DRAWN=60` と `stride` で間引き、それ以前を根元の楕円ひとつに潰している。**この3つを削除**し、Task 1 の幾何で背の高いシーンを描く。

**Files:**
- Modify: `src/components/vine/VineScene.tsx`（ほぼ全面）
- Modify: `src/components/vine/VineScreen.tsx`（`VineScene` に渡す props と、スクロール容器）

**Interfaces:**
- Consumes: `leafY` / `groundY` / `sceneHeightPx` / `visibleRange` / `markPositions` / `PX_PER_LEAF`（Task 1）
- Produces: `VineScene` の props に `scrollTop: number` と `viewportH: number` が加わる

- [ ] **Step 1: `VineScene` を書き換える**

`src/components/vine/VineScene.tsx` を以下で置き換える。

```tsx
'use client'
// 辿れる記録のシーン（SVG）。縦は葉の番号に比例し、1葉あたり14pxを常に確保する。
// 全体を1画面に収めるのをやめたので、葉を間引く必要がなくなった——
// 「去年の学びが名前のない緑の楕円になる」旧構造の原因は、収めようとしたことだった。
// 実物は仮アート（筆色の矩形＋添え書き）。本番PNGへの差し替えは別フェーズ。
import { useMemo } from 'react'
import type { Step } from '@/lib/tower-steps'
import type { LeafVisual } from '@/lib/vine-leaves'
import { formatHeight, heightMmFromLeaves } from '@/lib/vine-ladder'
import { generateVinePath, pointAtHeight } from '@/lib/vine-path'
import { leafY, groundY, sceneHeightPx, visibleRange, markPositions, PX_PER_LEAF } from '@/lib/vine-scroll'
import { kanjiDate } from '@/lib/kanji-date'
import styles from './vine.module.css'

const W = 390
const VINE_SEED = 42
const BASE_X = 150
const AMP = 34
const SHU = '#B33A2B'
const INK = '#2c2a22'
const USUZUMI = '#8b8272'

function leafFill(v: LeafVisual): string {
  if (v.form === 'outline') return 'none'
  // 青葉→銀鼠へ（茶色禁止）。fadeで補間
  const g = [125, 145, 105]
  const s = [168, 173, 164]
  const c = g.map((x, i) => Math.round(x + (s[i] - x) * v.fade))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

export function VineScene({
  leavesNow, from, to, visuals, spotlightIds, steps, crossedNow, onLeafTap, scrollTop, viewportH,
}: {
  leavesNow: number; from: number; to: number
  visuals: LeafVisual[]; spotlightIds: string[]; steps: Step[]
  crossedNow: boolean; onLeafTap: (index: number) => void
  scrollTop: number; viewportH: number
}) {
  const H = sceneHeightPx(to)
  const gY = groundY(to)
  // 蔓は地面から最新の葉まで。パスは高さpxで生成し、y反転して地面基準で置く
  const vineH = Math.max(1, gY - leafY(to, to))
  const path = useMemo(() => generateVinePath(VINE_SEED, vineH, BASE_X, AMP), [vineH])
  const win = visibleRange(scrollTop, viewportH, to)
  const marks = useMemo(() => markPositions(to), [to])

  // 葉の番号 → 蔓の中心線上の点（蔓の弧長ではなく、葉の縦位置で引く）
  const stemXAt = (index: number) => pointAtHeight(path, gY - leafY(index, to)).x

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block" aria-label="知の蔓">
      {/* 蔓（伸びた分だけ描く） */}
      <g transform={`translate(0 ${gY}) scale(1 -1)`}>
        <path d={path.d} fill="none" stroke="#96a67e" strokeWidth={16} strokeLinecap="round" opacity={0.42} />
        <path d={path.d} fill="none" stroke="#55603f" strokeWidth={9} strokeLinecap="round" opacity={0.88} />
        <path d={path.d} fill="none" stroke={INK} strokeWidth={2} strokeLinecap="round" opacity={0.5} />
      </g>

      {/* 越えた印＝背比べと目次（§4）。越えた時点の葉の位置に置く */}
      {marks.map((m) => (
        <g key={m.milestone.label}>
          <line x1={24} x2={W - 96} y1={m.y} y2={m.y} stroke={SHU} strokeWidth={1.2} strokeDasharray="5 4" opacity={0.75} />
          <line x1={24} x2={24} y1={m.y - 5} y2={m.y + 5} stroke={SHU} strokeWidth={2.2} />
          <text x={W - 92} y={m.y + 3.5} fontSize={10} fill={SHU}>
            {m.milestone.label} {m.milestone.sizeLabel}
          </text>
          <text x={W - 92} y={m.y + 15} fontSize={8} fill={USUZUMI}>{m.milestone.measure}</text>
        </g>
      ))}

      {/* 葉（窓の中だけ。間引かない） */}
      {Array.from({ length: Math.max(0, win.to - win.from + 1) }, (_, k) => {
        const n = win.from + k
        if (n > Math.floor(leavesNow)) return null
        const v = visuals[n - 1]
        const step = steps[n - 1]
        if (!v || !step) return null
        const y = leafY(n, to)
        const side = n % 2 === 0 ? 1 : -1
        const spot = spotlightIds.includes(step.id)
        return (
          <g
            key={n}
            transform={`translate(${stemXAt(n) + side * 6} ${y}) scale(${side} 1)`}
            onClick={() => onLeafTap(n - 1)}
            style={{ cursor: 'pointer' }}
          >
            <g className={styles.leafSway} style={{ animationDelay: `${-(n % 7) * 0.6}s` }}>
              <g className={n > from ? styles.leafPop : undefined}>
                <path d="M3,0 C8,-3 13,-2 16,1" fill="none" stroke="#39442c" strokeWidth={1.6} opacity={0.8} />
                <path
                  d="M14,0 C21,-11 35,-11 38,-2 C35,8 21,9 14,0 Z"
                  fill={leafFill(v)} stroke={v.form === 'outline' ? USUZUMI : INK}
                  strokeWidth={v.form === 'futaba' ? 2.2 : 1.7} opacity={0.92}
                />
                {v.form === 'futaba' && (
                  <path d="M16,-5 C19,-11 27,-13 30,-8 C27,-3 19,-2 16,-5 Z" fill={leafFill(v)} stroke={INK} strokeWidth={1.4} opacity={0.85} />
                )}
                {v.teri && <ellipse cx={24} cy={-5} rx={5.5} ry={2.4} fill="#fff" opacity={0.45} />}
                {spot && <circle cx={26} cy={-1} r={2.6} fill="none" stroke={USUZUMI} strokeWidth={1} opacity={0.8} />}
              </g>
            </g>
          </g>
        )
      })}

      {/* 穂先（伸びている間だけ） */}
      {leavesNow < to && (
        <circle cx={stemXAt(Math.max(1, Math.floor(leavesNow)))} cy={leafY(Math.max(1, Math.floor(leavesNow)), to)} r={5} fill="#4a5537" opacity={0.75} />
      )}

      {/* 地面 */}
      <path d={`M20,${gY} C 120,${gY - 4} 260,${gY + 3} 372,${gY - 2}`} stroke={INK} strokeWidth={3} opacity={0.5} fill="none" strokeLinecap="round" />
      <path d={`M${BASE_X - 26},${gY} C ${BASE_X - 22},${gY - 12} ${BASE_X - 2},${gY - 16} ${BASE_X + 14},${gY - 8} C ${BASE_X + 28},${gY - 2} ${BASE_X + 22},${gY + 4} ${BASE_X},${gY + 4} Z`} fill={INK} opacity={0.7} />

      {/* 朱の刻み: 越えた瞬間だけ、いちばん上の印に日付を添える（同時3箇所までの原則） */}
      {crossedNow && marks.length > 0 && (
        <text
          x={18} y={marks[marks.length - 1].y - 8} fontSize={9} fill={SHU}
          style={{ writingMode: 'vertical-rl' as const }}
        >
          {kanjiDate(new Date())}
        </text>
      )}

      {/* いまの高さ（穂先の脇） */}
      <text x={W - 92} y={leafY(to, to) - 14} fontSize={11} fill={SHU}>
        {formatHeight(heightMmFromLeaves(Math.floor(leavesNow)))}
      </text>
    </svg>
  )
}
```

- [ ] **Step 2: 型検査**

```bash
npx tsc --noEmit
```

Expected: `VineScene` に渡す props が足りない旨のエラーが `VineScreen.tsx` で出る（次のStepで直す）

- [ ] **Step 3: `VineScreen` にスクロール容器を付ける**

`src/components/vine/VineScreen.tsx` で、`VineScene` を囲っている要素をスクロール容器にし、`scrollTop` と `viewportH` を渡す。

まず import に追加：

```tsx
import { sceneHeightPx, leafY } from '@/lib/vine-scroll'
```

`useState` の並びに追加：

```tsx
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(700)
```

`VineScene` を囲っている要素を、スクロール容器に置き換える（`className` の余白は既存の見た目に合わせる）：

```tsx
          <div
            ref={scrollRef}
            className="relative overflow-y-auto overscroll-contain"
            style={{ maxHeight: '70vh' }}
            onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
          >
            <VineScene
              leavesNow={leavesNow} from={from} to={to}
              visuals={visuals} spotlightIds={spotlight} steps={state.steps}
              crossedNow={crossed != null && leavesNow >= (crossed?.leaves ?? Infinity)}
              onLeafTap={(i) => { if (!engine.running) setLeafOpen(i) }}
              scrollTop={scrollTop} viewportH={viewportH}
            />
          </div>
```

⚠️ **既存の props から `crossed` を渡す行は削除する**（新しい `VineScene` は `crossed` を受け取らない。越えた実物は `markPositions` から自分で引く）。

開いた直後は穂先（＝いちばん新しい葉）を見せる。`useEffect` を1つ足す：

```tsx
  // 開いた直後は穂先（＝今日）を見せる。下へスクロールすると過去へ遡る（§3）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setViewportH(el.clientHeight || 700)
    el.scrollTop = 0
  }, [to])
```

- [ ] **Step 4: 型検査と全テスト**

```bash
npx tsc --noEmit && npm test
```

Expected: 型エラーなし・全 PASS

- [ ] **Step 5: ビルドが通ることを確認**

```bash
npm run build 2>&1 | tail -20
```

Expected: ビルド成功（`Compiled successfully` またはエラーなしで完了）

- [ ] **Step 6: コミット**

```bash
git add src/components/vine/VineScene.tsx src/components/vine/VineScreen.tsx
git commit -m "知の蔓: 全体収めをやめてスクロール描画へ（間引きと根元の茂みを削除）"
```

---

### Task 3: 越えた印を目次にする（タップで飛ぶ）

印は Task 2 で描かれている。この Task はそれを**目次として使えるように**する——一覧から選ぶとその位置へスクロールする。60画面分でも迷わないための仕掛け（§4）。

**Files:**
- Modify: `src/components/vine/VineScreen.tsx`
- Modify: `src/lib/vine-copy.ts`（見出しの文言）
- Test: `src/lib/__tests__/vine-copy.test.ts`（文言の禁を走査）

**Interfaces:**
- Consumes: `markPositions` / `leafY`（Task 1）、`scrollRef`（Task 2）
- Produces: なし（画面内で閉じる）

- [ ] **Step 1: 目次の見出し文言をテストに足す**

`src/lib/__tests__/vine-copy.test.ts` の `文言` describe に追加：

```ts
  it('目次の見出しは名詞だけ置く', () => {
    expect(indexHeading()).toBe('越えたもの')
  })
```

- [ ] **Step 2: テストが落ちることを確認**

```bash
npm test -- src/lib/__tests__/vine-copy.test.ts
```

Expected: FAIL（`indexHeading is not a function`）

- [ ] **Step 3: 文言を足す**

`src/lib/vine-copy.ts` に追加（`ALL_VINE_COPY` にも載せる）：

```ts
// 目次の見出し。動詞で促さず、名詞だけを置く。
export function indexHeading(): string {
  return '越えたもの'
}
```

`ALL_VINE_COPY` の配列に `indexHeading(),` を追加する。

- [ ] **Step 4: テストが通ることを確認**

```bash
npm test -- src/lib/__tests__/vine-copy.test.ts
```

Expected: PASS

- [ ] **Step 5: 目次のUIを足す**

`src/components/vine/VineScreen.tsx` の import に追加：

```tsx
import { markPositions } from '@/lib/vine-scroll'
import { indexHeading } from '@/lib/vine-copy'
```

`useMemo` の並びに追加：

```tsx
  const marks = useMemo(() => markPositions(to), [to])
```

スクロール容器の**下**に目次を置く。越えた印が2つ以上あるときだけ出す（1つだけなら目次にならない）：

```tsx
          {marks.length > 1 && (
            <div className="mt-2 px-3">
              <div className="mb-1 text-[10px] tracking-[.25em] text-[#7d6f52]">{indexHeading()}</div>
              <div className="flex flex-wrap gap-1.5">
                {[...marks].reverse().map((m) => (
                  <button
                    key={m.milestone.label}
                    type="button"
                    onClick={() => { const el = scrollRef.current; if (el) el.scrollTop = Math.max(0, m.y - 120) }}
                    className="rounded-full border border-[#cbbf9f] bg-[#faf5e8] px-2.5 py-1 text-[11px] text-[#5c5340]"
                  >
                    {m.milestone.label}
                  </button>
                ))}
              </div>
            </div>
          )}
```

⚠️ `[...marks].reverse()` で新しい順に並べる。**`marks.reverse()` と書くと `useMemo` の配列を破壊して次の描画が狂う。**

- [ ] **Step 6: 型検査・全テスト・ビルド**

```bash
npx tsc --noEmit && npm test && npm run build 2>&1 | tail -10
```

Expected: すべて成功

- [ ] **Step 7: コミット**

```bash
git add src/lib/vine-copy.ts src/lib/__tests__/vine-copy.test.ts src/components/vine/VineScreen.tsx
git commit -m "知の蔓: 越えた印を目次にする（タップでその位置へ飛ぶ）"
```

---

## 検証について（正直な限界）

このリポジトリにはコンポーネントテストの基盤が無く、蔓は先行体験フラグの内側にあるため、**実機での見た目確認はオーナーにしかできない**。この計画で機械的に守れるのは以下まで：

- 幾何の判断はすべて Task 1 の純関数のテストが守る（間隔が縮まないこと・窓が範囲外に出ないこと・印が越えた分だけ出ること）
- 文言は `vine-copy.ts` の禁の走査が守る
- 型検査とビルドが通ること

**残るのはオーナーの実機確認**：穂先から始まるか、下へ辿れるか、印が目次として効くか、葉が潰れていないか。

## このあとの計画

| # | 内容 | spec |
|---|---|---|
| 1（完了） | 誰に出すか・高さの定数・画面の言葉 | §6, §14 |
| **2（この計画）** | スクロール構造・越えた印＝目次 | §3, §4, §5, §11 |
| 3 | 地下茎（`splitByJoin` / `joinedAt` / 地下描画 / 持ち込みゼロの分岐） | §7 |
| 4 | 葉の生え方（`resolved` / `attempt` / 読み返しの濃度） | §9 |
| 5 | 時間の点景（`sceneryMarks` / 空と住人） | §7 |
| — | アセット差し替え（筆致PNGへ）・雲の先 | §8, 発注書 |
