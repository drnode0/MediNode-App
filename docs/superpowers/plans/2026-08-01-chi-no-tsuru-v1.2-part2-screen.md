# 知の蔓 v1.2 Part 2（画面リフォーム）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 知の塔の画面を「知の蔓」に全面刷新——シーン描画・成長リプレイ・朱の計測・縦書きの賛を仮アートで動く状態にする（本番アセット差し替えと空・住人はPart 3）。

**Architecture:** Part 1の純関数層（vine-ladder/vine-leaves/vine-path/planReplay）の上に、純関数のリプレイタイムライン（vine-replay）→React hook（useReplayEngine）→SVGシーン（VineScene）→統合画面（VineScreen）を積む。アニメはGSAPなし＝rAF時間ベース＋CSS。シーンは「1目盛り区間=1シーン」でリプレイ中は到達後シーンに固定。

**Tech Stack:** TypeScript / React 18 / Next.js App Router / CSS Modules / vitest（純関数のみテスト。コンポーネントはdevハーネスで目視検証）

**Spec:** `docs/superpowers/specs/2026-08-01-chi-no-tsuru-v1.2-design.md`（§4〜§7・§10）

## Global Constraints

- 「歩」をUI文言・コメントに新規に書かない。単位はcmと葉のみ
- **新規依存の追加は禁止**（GSAP不採用。rAF＋CSS＋WAAPIのみ）
- 賛（縦書き）はHTMLオーバーレイの `writing-mode: vertical-rl`（SVG縦書きtext禁止。例外：刻み日付の漢数字のみSVG `writing-mode="tb"` 可・読点を含まないため）
- 朱の三原則：同時3箇所まで・必ず対象に触れる・色は #B33A2B（純赤禁止）。朱に感情を語らせない
- 賛の文に算用数字を入れない（漢数字）。称賛語・感嘆符・絵文字🎉の類を書かない
- 色褪せを数字で集計して表示しない（「要再確認が n件」の復活禁止）
- 蔓画面は**常時和紙**（`.dark`分岐を書かない。プロジェクトのダーク規約に対する設計書§8明記の例外）
- リプレイ：成長ゼロは再生しない・スキップは1タップ疾書（残りを約500msで走り切る）・markSeenは完走時に `markSeen(state, to)` でコミット・バックグラウンドで進めない
- モックHTML（specs/assets/2026-08-01-tsuru-motion-proto.html）のコードはコピー禁止（設計語彙のみ継承）
- 動きモックの動的値はすべて台帳から導出（ハードコードのシナリオ・文言禁止）

---

### Task 1: vine-replay ＋ kanji-date（純関数）

**Files:**
- Create: `src/lib/vine-replay.ts`
- Create: `src/lib/kanji-date.ts`
- Test: `src/lib/__tests__/vine-replay.test.ts`
- Test: `src/lib/__tests__/kanji-date.test.ts`

**Interfaces:**
- Produces: `type ReplayPhase = { name: 'tame'|'nobi'|'ma'|'kizami'|'chakuchi'|'yoin'; durMs: number; fromLeaves: number; toLeaves: number }` / `buildPhases(fromLeaves: number, toLeaves: number, lastCrossedLeaves: number | null, reduced: boolean): ReplayPhase[]` / `totalDurMs(phases): number` / `replayAt(phases, tMs): { name: ReplayPhase['name']; localT: number; leavesNow: number; done: boolean }` / `kanjiNumber(n: number): string`（1〜99） / `kanjiDate(d: Date): string`（「八月朔日」「八月十五日」・使用者の暦日＝端末ローカル）

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/vine-replay.test.ts
import { describe, expect, it } from 'vitest'
import { buildPhases, totalDurMs, replayAt } from '../vine-replay'

describe('buildPhases', () => {
  it('通常の日: 溜め500→伸び1600→着地450→余韻1300', () => {
    const p = buildPhases(10, 14, null, false)
    expect(p.map((x) => [x.name, x.durMs])).toEqual([
      ['tame', 500], ['nobi', 1600], ['chakuchi', 450], ['yoin', 1300],
    ])
    expect(totalDurMs(p)).toBe(3850)
  })
  it('追い越しの日: 伸びが目盛りで二分され、間と刻みが挟まる', () => {
    const p = buildPhases(30, 40, 35, false) // 葉35=湯のみを越える日
    expect(p.map((x) => x.name)).toEqual(['tame', 'nobi', 'ma', 'kizami', 'nobi', 'chakuchi', 'yoin'])
    const nobis = p.filter((x) => x.name === 'nobi')
    expect(nobis[0]).toMatchObject({ fromLeaves: 30, toLeaves: 35 })
    expect(nobis[1]).toMatchObject({ fromLeaves: 35, toLeaves: 40 })
  })
  it('reduced: 400msの余韻のみ（leavesは即to）', () => {
    const p = buildPhases(10, 14, null, true)
    expect(p).toEqual([{ name: 'yoin', durMs: 400, fromLeaves: 14, toLeaves: 14 }])
  })
})

describe('replayAt', () => {
  const p = buildPhases(10, 14, null, false)
  it('溜め中はleaves=from・完了後はdone&leaves=to', () => {
    expect(replayAt(p, 0)).toMatchObject({ name: 'tame', leavesNow: 10, done: false })
    expect(replayAt(p, 99_999)).toMatchObject({ leavesNow: 14, done: true })
  })
  it('伸びの中間で単調に増える（イージングつき）', () => {
    const a = replayAt(p, 500 + 400).leavesNow
    const b = replayAt(p, 500 + 800).leavesNow
    const c = replayAt(p, 500 + 1200).leavesNow
    expect(a).toBeGreaterThan(10)
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
    expect(c).toBeLessThanOrEqual(14)
  })
  it('伸び終端でtoLeavesに到達', () => {
    expect(replayAt(p, 500 + 1600).leavesNow).toBeCloseTo(14, 5)
  })
})
```

```ts
// src/lib/__tests__/kanji-date.test.ts
import { describe, expect, it } from 'vitest'
import { kanjiNumber, kanjiDate } from '../kanji-date'

describe('kanjiNumber', () => {
  it('1〜99', () => {
    expect(kanjiNumber(1)).toBe('一')
    expect(kanjiNumber(10)).toBe('十')
    expect(kanjiNumber(15)).toBe('十五')
    expect(kanjiNumber(20)).toBe('二十')
    expect(kanjiNumber(31)).toBe('三十一')
    expect(kanjiNumber(99)).toBe('九十九')
  })
})

describe('kanjiDate（刻みの日付。朔日だけ特別表記）', () => {
  it('1日は朔日', () => {
    expect(kanjiDate('2026-08-01T09:00:00+09:00')).toBe('八月朔日')
  })
  it('通常日は漢数字', () => {
    expect(kanjiDate('2026-08-15T09:00:00+09:00')).toBe('八月十五日')
    expect(kanjiDate('2026-12-03T09:00:00+09:00')).toBe('十二月三日')
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/lib/__tests__/vine-replay.test.ts src/lib/__tests__/kanji-date.test.ts`
Expected: FAIL（モジュール不存在）

- [ ] **Step 3: 実装**

```ts
// src/lib/vine-replay.ts
// 成長リプレイのタイムライン（純関数）。フェーズ列を組み、経過msから「いま何枚か」を返す。
// 尺は固定（通常≈3.9秒）——複利で1回の伸び幅が増えるほど同じ秒数で駆け上がる距離が増える、
// が複利の見せ方（UIは何も言わない）。複数目盛りを一度に越えた場合も演出は最後の1つだけ。
export type ReplayPhaseName = 'tame' | 'nobi' | 'ma' | 'kizami' | 'chakuchi' | 'yoin'
export type ReplayPhase = { name: ReplayPhaseName; durMs: number; fromLeaves: number; toLeaves: number }

const TAME_MS = 500
const NOBI_MS = 1600
const NOBI_A_MS = 1150
const MA_MS = 450
const KIZAMI_MS = 650
const NOBI_B_MS = 550
const CHAKUCHI_MS = 450
const YOIN_MS = 1300
const REDUCED_MS = 400

export function buildPhases(
  fromLeaves: number, toLeaves: number, lastCrossedLeaves: number | null, reduced: boolean,
): ReplayPhase[] {
  if (reduced) return [{ name: 'yoin', durMs: REDUCED_MS, fromLeaves: toLeaves, toLeaves }]
  const at = (name: ReplayPhaseName, durMs: number, a: number, b: number): ReplayPhase =>
    ({ name, durMs, fromLeaves: a, toLeaves: b })
  if (lastCrossedLeaves != null && lastCrossedLeaves > fromLeaves && lastCrossedLeaves <= toLeaves) {
    return [
      at('tame', TAME_MS, fromLeaves, fromLeaves),
      at('nobi', NOBI_A_MS, fromLeaves, lastCrossedLeaves),
      at('ma', MA_MS, lastCrossedLeaves, lastCrossedLeaves),
      at('kizami', KIZAMI_MS, lastCrossedLeaves, lastCrossedLeaves),
      at('nobi', NOBI_B_MS, lastCrossedLeaves, toLeaves),
      at('chakuchi', CHAKUCHI_MS, toLeaves, toLeaves),
      at('yoin', YOIN_MS, toLeaves, toLeaves),
    ]
  }
  return [
    at('tame', TAME_MS, fromLeaves, fromLeaves),
    at('nobi', NOBI_MS, fromLeaves, toLeaves),
    at('chakuchi', CHAKUCHI_MS, toLeaves, toLeaves),
    at('yoin', YOIN_MS, toLeaves, toLeaves),
  ]
}

export function totalDurMs(phases: ReplayPhase[]): number {
  return phases.reduce((a, p) => a + p.durMs, 0)
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

export function replayAt(phases: ReplayPhase[], tMs: number): {
  name: ReplayPhaseName; localT: number; leavesNow: number; done: boolean
} {
  let acc = 0
  for (const p of phases) {
    if (tMs < acc + p.durMs) {
      const localT = (tMs - acc) / p.durMs
      const eased = p.name === 'nobi' ? easeInOutCubic(localT) : localT
      return {
        name: p.name, localT,
        leavesNow: p.fromLeaves + (p.toLeaves - p.fromLeaves) * eased,
        done: false,
      }
    }
    acc += p.durMs
  }
  const last = phases[phases.length - 1]
  return { name: last.name, localT: 1, leavesNow: last.toLeaves, done: true }
}
```

```ts
// src/lib/kanji-date.ts
// 刻みの日付は縦書き漢数字（画賛研究者の様式指定）。朔日だけ特別表記——通が喜ぶ。
const DIGITS = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九']

export function kanjiNumber(n: number): string {
  if (n <= 0 || n > 99) return String(n)
  const tens = Math.floor(n / 10)
  const ones = n % 10
  return (tens > 1 ? DIGITS[tens] : '') + (tens >= 1 ? '十' : '') + DIGITS[ones]
}

export function kanjiDate(iso: string): string {
  const d = new Date(iso)
  const m = d.getMonth() + 1
  const day = d.getDate()
  return `${kanjiNumber(m)}月${day === 1 ? '朔日' : `${kanjiNumber(day)}日`}`
}
```

- [ ] **Step 4: パス確認 → コミット**

Run: `npx vitest run src/lib/__tests__/vine-replay.test.ts src/lib/__tests__/kanji-date.test.ts`
Expected: PASS

```bash
git add src/lib/vine-replay.ts src/lib/kanji-date.ts src/lib/__tests__/vine-replay.test.ts src/lib/__tests__/kanji-date.test.ts
git commit -m "feat(vine): リプレイタイムライン（尺固定・最後の目盛りだけ演出）＋漢数字日付"
```

---

### Task 2: useReplayEngine（React hook）

**Files:**
- Create: `src/components/vine/useReplayEngine.ts`

**Interfaces:**
- Consumes: `buildPhases/replayAt/totalDurMs`（vine-replay）
- Produces: `useReplayEngine(opts: { play: boolean; from: number; to: number; lastCrossedLeaves: number | null; reduced: boolean; onDone: () => void }): { leavesNow: number; phaseName: ReplayPhaseName | null; running: boolean; skip: () => void }`
- 契約: playがfalseなら即 `leavesNow=to`・running=false・onDoneは呼ばない／完走時に一度だけonDone／`document.visibilitychange` で一時停止・復帰再開（バックグラウンドで進めない）／skip()=残りを約500msで走り切る疾書

- [ ] **Step 1: 実装（hookはテスト対象外——Task 5のdevハーネスで目視検証。tscで型担保）**

```ts
// src/components/vine/useReplayEngine.ts
'use client'
// 成長リプレイの再生エンジン。時間ベース（30fps環境でもコマが減るだけ）・
// visibilitychangeで一時停止（バックグラウンドで進めて「戻ったら終わっていた」を防ぐ）・
// skip()は残りを約500msで走り切る疾書（カットしない——筆の連続が世界観）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { buildPhases, replayAt, totalDurMs, type ReplayPhaseName } from '@/lib/vine-replay'

const SHISSHO_MS = 500

export function useReplayEngine(opts: {
  play: boolean; from: number; to: number
  lastCrossedLeaves: number | null; reduced: boolean; onDone: () => void
}): { leavesNow: number; phaseName: ReplayPhaseName | null; running: boolean; skip: () => void } {
  const { play, from, to, lastCrossedLeaves, reduced } = opts
  const [view, setView] = useState(() =>
    play ? { leavesNow: from, phaseName: 'tame' as ReplayPhaseName | null, running: true }
         : { leavesNow: to, phaseName: null, running: false })
  const raf = useRef(0)
  const tMs = useRef(0)          // 再生位置（一時停止をまたいで累積）
  const lastNow = useRef(0)
  const speed = useRef(1)
  const doneFired = useRef(false)
  const onDoneRef = useRef(opts.onDone)
  onDoneRef.current = opts.onDone
  const phases = useRef(buildPhases(from, to, lastCrossedLeaves, reduced))

  useEffect(() => {
    if (!play) return
    const step = (now: number) => {
      if (lastNow.current) tMs.current += (now - lastNow.current) * speed.current
      lastNow.current = now
      const s = replayAt(phases.current, tMs.current)
      setView({ leavesNow: s.leavesNow, phaseName: s.done ? null : s.name, running: !s.done })
      if (s.done) {
        if (!doneFired.current) { doneFired.current = true; onDoneRef.current() }
        return
      }
      raf.current = requestAnimationFrame(step)
    }
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf.current)
        lastNow.current = 0 // 復帰フレームで巨大dtを加算しない
      } else if (!doneFired.current) {
        raf.current = requestAnimationFrame(step)
      }
    }
    raf.current = requestAnimationFrame(step)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelAnimationFrame(raf.current)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // 再生条件は開いた瞬間のスナップショットで固定（リプレイ中の新イベントは次回へ）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play])

  const skip = useCallback(() => {
    const remaining = totalDurMs(phases.current) - tMs.current
    if (remaining > 0) speed.current = Math.max(1, remaining / SHISSHO_MS)
  }, [])

  return { ...view, skip }
}
```

- [ ] **Step 2: 型チェック → コミット**

Run: `npx tsc --noEmit`
Expected: 0 errors

```bash
git add src/components/vine/useReplayEngine.ts
git commit -m "feat(vine): リプレイ再生エンジン（時間ベース・visibility一時停止・疾書スキップ）"
```

---

### Task 3: VineScene（SVGシーン描画）

**Files:**
- Create: `src/components/vine/VineScene.tsx`
- Create: `src/components/vine/vine.module.css`

**Interfaces:**
- Consumes: `sceneForLeaves/formatHeight/nextMilestone/passedMilestones/heightMmFromLeaves`（vine-ladder）・`generateVinePath/pointAtHeight/lengthAtHeight`（vine-path）・`LeafVisual`（vine-leaves）・`kanjiDate`
- Produces: `VineScene(props: { leavesNow: number; from: number; to: number; visuals: LeafVisual[]; spotlightIds: string[]; steps: Step[]; crossedNow: boolean; onLeafTap: (index: number) => void }): JSX`
- 設計: viewBox `0 0 390 620`・地面y=560・シーンは常に `sceneForLeaves(to, 520)` に固定（画面高相当520px）。蔓パスはseed固定42・baseX=130・amp=55。**描く葉は直近60枚まで**（それ以前はPart 3の節集約待ち。省略時は根元に薄い茂み楕円1つ）。仮アートの実物=筆色の角丸矩形＋名前・寸法・測り方の博物図譜式添え書き

- [ ] **Step 1: 実装**

```css
/* src/components/vine/vine.module.css */
/* 常時和紙（設計書§8の明示的例外——.dark分岐を書かない） */
.frame { background: #f2ead6; color: #2c2a22; font-family: "Hiragino Mincho ProN", "Yu Mincho", serif; }
.leafSway { transform-box: fill-box; transform-origin: 12% 88%; animation: sway 4s ease-in-out infinite alternate; }
@keyframes sway { from { transform: rotate(-2.2deg); } to { transform: rotate(2.6deg); } }
.leafPop { transform-box: fill-box; transform-origin: 8% 60%; animation: pop 320ms cubic-bezier(.34,1.56,.64,1); }
@keyframes pop { from { transform: scale(0); } 70% { transform: scale(1.16); } to { transform: scale(1); } }
.san { writing-mode: vertical-rl; letter-spacing: .14em; color: rgba(44,42,34,.85); }
.fadeIn { animation: fadeIn 600ms ease both; }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .leafSway, .leafPop { animation: none; }
}
```

```tsx
// src/components/vine/VineScene.tsx
'use client'
// 背比べのシーン（SVG）。蔓=Part1のパス生成＋マスクリビール（pathLengthで自前弧長に正規化）。
// 計測（朱）はコードが担保する層——三原則: 同時3箇所まで・対象に触れる・#B33A2B。
// 実物は仮アート（筆色の矩形＋博物図譜式の添え書き）。本番PNGへの差し替えはPart 3。
import { useMemo } from 'react'
import type { Step } from '@/lib/tower-steps'
import type { LeafVisual } from '@/lib/vine-leaves'
import { formatHeight, heightMmFromLeaves, sceneForLeaves } from '@/lib/vine-ladder'
import { generateVinePath, lengthAtHeight, pointAtHeight } from '@/lib/vine-path'
import { kanjiDate } from '@/lib/kanji-date'
import styles from './vine.module.css'

const W = 390
const H = 620
const GROUND_Y = 560
const SCENE_H = 520
const VINE_SEED = 42
const BASE_X = 130
const AMP = 55
const MAX_LEAVES_DRAWN = 60
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

export function VineScene({ leavesNow, from, to, visuals, spotlightIds, steps, crossedNow, onLeafTap }: {
  leavesNow: number; from: number; to: number
  visuals: LeafVisual[]; spotlightIds: string[]; steps: Step[]
  crossedNow: boolean; onLeafTap: (index: number) => void
}) {
  const scene = useMemo(() => sceneForLeaves(to, SCENE_H), [to])
  const vineHeightPx = Math.max(1, heightMmFromLeaves(to) * scene.pxPerMm)
  const path = useMemo(
    () => generateVinePath(VINE_SEED, vineHeightPx, BASE_X, AMP),
    [vineHeightPx],
  )
  const hNowPx = heightMmFromLeaves(leavesNow) * scene.pxPerMm
  const revealLen = lengthAtHeight(path, Math.min(hNowPx, vineHeightPx))
  const tip = pointAtHeight(path, Math.min(hNowPx, vineHeightPx))
  const nowMm = heightMmFromLeaves(leavesNow)
  const fromMm = heightMmFromLeaves(from)
  const yOf = (mm: number) => GROUND_Y - mm * scene.pxPerMm
  const objH = scene.next.mm * scene.pxPerMm
  const objW = Math.max(28, objH * 0.42)
  const objX = 285
  const remainMm = scene.next.mm - nowMm
  const firstDrawn = Math.max(1, to - MAX_LEAVES_DRAWN + 1)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" aria-label="豆の木の背比べ">
      <defs>
        <mask id="vineGrow">
          <path
            d={path.d} pathLength={path.totalLen} fill="none" stroke="#fff"
            strokeWidth={46} strokeLinecap="round"
            strokeDasharray={`${path.totalLen} ${path.totalLen}`}
            strokeDashoffset={path.totalLen - revealLen}
            transform={`translate(0 ${GROUND_Y}) scale(1 -1)`}
          />
        </mask>
      </defs>

      {/* 次の実物（仮アート）: 同じ地面に実寸比で立つ */}
      <g>
        <rect
          x={objX - objW / 2} y={GROUND_Y - objH} width={objW} height={objH} rx={8}
          fill="#e9dfc6" stroke={INK} strokeWidth={2} opacity={0.9}
        />
        <text x={objX} y={GROUND_Y - objH - 10} textAnchor="middle" fontSize={12} fill={INK}>
          {scene.next.label}
        </text>
        <text x={objX} y={GROUND_Y - objH + 18} textAnchor="middle" fontSize={9} fill={USUZUMI}>
          {scene.next.sizeLabel}・{scene.next.measure}
        </text>
        {crossedNow && (
          <g>
            <line
              x1={objX - objW / 2 - 8} y1={GROUND_Y - objH} x2={objX - objW / 2 + 10} y2={GROUND_Y - objH}
              stroke={SHU} strokeWidth={3.5}
            />
            <text
              x={objX - objW / 2 - 14} y={GROUND_Y - objH + 4} fontSize={9} fill={SHU}
              style={{ writingMode: 'tb' as const }}
            >
              {kanjiDate(new Date())}
            </text>
          </g>
        )}
      </g>

      {/* 蔓（マスクで「描かれていく」） */}
      <g mask="url(#vineGrow)" transform={`translate(0 ${GROUND_Y}) scale(1 -1)`}>
        <path d={path.d} fill="none" stroke="#96a67e" strokeWidth={20} strokeLinecap="round" opacity={0.42} />
        <path d={path.d} fill="none" stroke="#55603f" strokeWidth={11} strokeLinecap="round" opacity={0.88} />
        <path d={path.d} fill="none" stroke={INK} strokeWidth={2.2} strokeLinecap="round" opacity={0.5} />
      </g>

      {/* 葉（直近MAX_LEAVES_DRAWN枚。それ以前は根元の茂みに集約） */}
      {firstDrawn > 1 && (
        <ellipse cx={BASE_X} cy={GROUND_Y - 14} rx={40} ry={18} fill="#7d9169" opacity={0.35} />
      )}
      {steps.slice(firstDrawn - 1, Math.floor(leavesNow)).map((step, i) => {
        const n = firstDrawn + i
        const v = visuals[n - 1]
        if (!v) return null
        const pt = pointAtHeight(path, heightMmFromLeaves(n) * scene.pxPerMm)
        const side = n % 2 === 0 ? 1 : -1
        const spot = spotlightIds.includes(step.id)
        return (
          <g
            key={n}
            transform={`translate(${pt.x + side * 8} ${GROUND_Y - pt.y}) scale(${side} 1)`}
            onClick={() => onLeafTap(n - 1)}
            style={{ cursor: 'pointer' }}
          >
            <g className={styles.leafSway} style={{ animationDelay: `${-(n % 7) * 0.6}s` }}>
              <g className={n > from ? styles.leafPop : undefined}>
                <path d="M4,0 C10,-4 16,-2 20,2" fill="none" stroke="#39442c" strokeWidth={2} opacity={0.8} />
                <path
                  d="M18,0 C26,-14 44,-14 48,-2 C44,10 26,12 18,0 Z"
                  fill={leafFill(v)} stroke={v.form === 'outline' ? USUZUMI : INK}
                  strokeWidth={v.form === 'futaba' ? 2.6 : 2} opacity={0.92}
                />
                {v.form === 'futaba' && (
                  <path d="M20,-6 C24,-14 34,-16 38,-10 C34,-4 24,-2 20,-6 Z" fill={leafFill(v)} stroke={INK} strokeWidth={1.6} opacity={0.85} />
                )}
                {v.teri && <ellipse cx={30} cy={-6} rx={7} ry={3} fill="#fff" opacity={0.45} />}
                {spot && <circle cx={33} cy={-1} r={3} fill="none" stroke={USUZUMI} strokeWidth={1} opacity={0.8} />}
              </g>
            </g>
          </g>
        )
      })}

      {/* 穂先（伸びている間だけ） */}
      {leavesNow < to && <circle cx={tip.x} cy={GROUND_Y - tip.y} r={5.5} fill="#4a5537" opacity={0.75} />}

      {/* 地面 */}
      <path d={`M20,${GROUND_Y} C 120,${GROUND_Y - 4} 260,${GROUND_Y + 3} 372,${GROUND_Y - 2}`} stroke={INK} strokeWidth={3} opacity={0.5} fill="none" strokeLinecap="round" />
      <path d={`M${BASE_X - 26},${GROUND_Y} C ${BASE_X - 22},${GROUND_Y - 12} ${BASE_X - 2},${GROUND_Y - 16} ${BASE_X + 14},${GROUND_Y - 8} C ${BASE_X + 28},${GROUND_Y - 2} ${BASE_X + 22},${GROUND_Y + 4} ${BASE_X},${GROUND_Y + 4} Z`} fill={INK} opacity={0.7} />

      {/* 朱の計測（3箇所まで: いま・あと・前回は薄墨=朱に数えない） */}
      <line x1={24} x2={objX + objW / 2} y1={yOf(nowMm)} y2={yOf(nowMm)} stroke={SHU} strokeWidth={1.6} strokeDasharray="6 4" opacity={0.9} />
      <text x={24} y={yOf(nowMm) - 6} fontSize={11} fill={SHU}>いま {formatHeight(nowMm)}</text>
      {from < to && from > 0 && (
        <g>
          <line x1={24} x2={356} y1={yOf(fromMm)} y2={yOf(fromMm)} stroke={USUZUMI} strokeWidth={1} strokeDasharray="2 5" opacity={0.55} />
          <text x={356} y={yOf(fromMm) - 4} fontSize={9} fill={USUZUMI} textAnchor="end">前回</text>
        </g>
      )}
      {remainMm > 0.5 && (
        <g>
          <line x1={36} x2={36} y1={GROUND_Y - objH} y2={yOf(nowMm)} stroke={SHU} strokeWidth={1.2} />
          <line x1={32} x2={40} y1={GROUND_Y - objH} y2={GROUND_Y - objH} stroke={SHU} strokeWidth={1.2} />
          <line x1={32} x2={40} y1={yOf(nowMm)} y2={yOf(nowMm)} stroke={SHU} strokeWidth={1.2} />
          <text x={44} y={(GROUND_Y - objH + yOf(nowMm)) / 2 + 3} fontSize={10} fill={SHU}>あと{formatHeight(remainMm)}</text>
        </g>
      )}
    </svg>
  )
}
```

- [ ] **Step 2: 型チェック → コミット**

Run: `npx tsc --noEmit`
Expected: 0 errors

```bash
git add src/components/vine/VineScene.tsx src/components/vine/vine.module.css
git commit -m "feat(vine): 背比べシーン（蔓マスクリビール・葉60枚LOD・朱の三原則・仮アート実物）"
```

---

### Task 4: VineScreen統合＋旧画面の置換

**Files:**
- Create: `src/components/vine/VineScreen.tsx`
- Modify: `src/app/page.tsx`（TowerScreen→VineScreen。import行と使用箇所のみ）
- Modify: `src/components/tower/TowerCard.tsx`（語彙のみ：歩→葉/cm・vine-ladder使用へ）
- Delete: `src/components/tower/TowerScreen.tsx`・`src/components/tower/TowerStack.tsx`（page.tsxから参照が消えることを確認して削除。tower-volumes.tsはPart 3で転用するため残す）

**Interfaces:**
- Consumes: Task 1〜3の全て・`loadTowerState/saveTowerState/markSeen/planReplay`・`buildLeafVisuals/spotlightFaded`・`nextMilestone/passedMilestones/heightMmFromLeaves/formatHeight`・`buildBackfillRequest/applyBackfill`（既存TowerScreenのバックフィルuseEffectを**そのまま移植**——挙動を変えない）
- Produces: `VineScreen({ onClose, onGoQuiz, initialState }: { onClose: () => void; onGoQuiz: () => void; initialState?: TowerState })`（initialStateはdevハーネス専用の注入口）

- [ ] **Step 1: 実装**

```tsx
// src/components/vine/VineScreen.tsx
'use client'
// 知の蔓のフル画面。開くと planReplay のスナップショットで成長リプレイが流れ、
// 完走（疾書含む）時に markSeen(state, to) をコミットする——リプレイ中に閉じたら次回また見られる。
// 禁止事項: 称賛語・感嘆符・色褪せの数字集計・「歩」。祝意は淡墨の賛が述べ、朱は寸法だけを指す。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  loadTowerState, saveTowerState, markSeen, planReplay, type TowerState,
} from '@/lib/tower-steps'
import { buildBackfillRequest, applyBackfill } from '@/lib/tower-backfill'
import { buildLeafVisuals, spotlightFaded } from '@/lib/vine-leaves'
import { formatHeight, heightMmFromLeaves, nextMilestone, passedMilestones } from '@/lib/vine-ladder'
import { kanjiNumber } from '@/lib/kanji-date'
import { useReplayEngine } from './useReplayEngine'
import { VineScene } from './VineScene'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
import { getSettings } from '@/lib/settings'
import styles from './vine.module.css'

function loadAllQuizStats(): Record<string, import('@/lib/quiz-srs').QuizStat> {
  try {
    return JSON.parse(localStorage.getItem('medinode_quiz_stats') || '{}')
  } catch {
    return {}
  }
}

export function VineScreen({ onClose, onGoQuiz, initialState }: {
  onClose: () => void; onGoQuiz: () => void; initialState?: TowerState
}) {
  const [state, setState] = useState<TowerState>(() => initialState ?? loadTowerState())
  const [leafOpen, setLeafOpen] = useState<number | null>(null)
  const backfilled = useRef(false)
  useBodyScrollLock()

  // 開いた瞬間のスナップショット（リプレイ中の新イベントは次回へ）
  const snapshot = useRef(planReplay(state))
  const { from, to, play } = snapshot.current

  const reduced = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const crossed = useMemo(() => {
    const beforeCount = passedMilestones(from).length
    const passed = passedMilestones(to)
    return passed.length > beforeCount ? passed[passed.length - 1] : null
  }, [from, to])

  const commitSeen = useCallback(() => {
    if (initialState) return // devハーネスでは保存しない
    const fresh = loadTowerState()
    saveTowerState(markSeen(fresh, to))
  }, [to, initialState])

  const engine = useReplayEngine({
    play, from, to,
    lastCrossedLeaves: crossed?.leaves ?? null,
    reduced, onDone: commitSeen,
  })

  // 初回バックフィル（旧TowerScreenの挙動をそのまま維持。表示スナップショットには影響させない）
  useEffect(() => {
    if (backfilled.current || initialState) return
    backfilled.current = true
    if (state.backfilledAt) return
    const req = buildBackfillRequest(getSettings())
    if (!req) return
    ;(async () => {
      try {
        const res = await fetch('/api/notion/search', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req.body),
        })
        if (!res.ok) return
        const data = await res.json()
        if (!Array.isArray(data.records)) return
        const fresh = loadTowerState()
        const next = applyBackfill(fresh, data.records, new Date().toISOString())
        saveTowerState(next)
        setState(next)
      } catch {
        // 組み上げ失敗でも画面は出す
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const nowIso = useMemo(() => new Date().toISOString(), [])
  const stats = useMemo(() => loadAllQuizStats(), [])
  const visuals = useMemo(() => buildLeafVisuals(state.steps, stats, nowIso), [state.steps, stats, nowIso])
  const spotlight = useMemo(() => spotlightFaded(state.steps, stats, nowIso), [state.steps, stats, nowIso])

  const leavesNow = engine.leavesNow
  const next = nextMilestone(to)
  const hMm = heightMmFromLeaves(leavesNow)
  const newLeaves = to - from
  const todayLeaf = state.steps[to - 1]
  const showSan = !engine.running || engine.phaseName === 'yoin'

  const openLeaf = leafOpen != null ? state.steps[leafOpen] : null
  const openVisual = leafOpen != null ? visuals[leafOpen] : null

  return (
    <div className={`fixed inset-0 z-50 overflow-y-auto ${styles.frame}`} onClick={() => engine.running && engine.skip()}>
      <div className="mx-auto max-w-md px-4 pb-10 pt-[calc(14px+env(safe-area-inset-top))]">
        <div className="mb-1 flex items-start justify-between">
          <div>
            <div className="text-[11px] tracking-[.35em] text-[#7d6f52]">知　の　蔓</div>
            <div className="text-2xl font-semibold">{formatHeight(hMm)}</div>
            <div className="mt-0.5 text-[11px] text-[#8b8272]">今週 葉が {newLeaves > 0 ? `${newLeaves}枚` : 'まだ'}・ぜんぶで {to}枚</div>
          </div>
          <div className="flex items-start gap-2">
            <div className="text-right text-[10px] leading-relaxed text-[#a39678]">
              つぎは<br /><span className="text-[#2c2a22] font-semibold">{next.label} {next.sizeLabel}</span>
            </div>
            <button type="button" onClick={(e) => { e.stopPropagation(); onClose() }} aria-label="閉じる" className="rounded-full p-2 text-[#8b8272]">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="relative">
          <VineScene
            leavesNow={leavesNow} from={from} to={to}
            visuals={visuals} spotlightIds={spotlight} steps={state.steps}
            crossedNow={crossed != null && leavesNow >= (crossed?.leaves ?? Infinity)}
            onLeafTap={(i) => { if (!engine.running) setLeafOpen(i) }}
          />
          {/* 賛（縦書きHTMLオーバーレイ・上部余白・蔓先端の対角＝右上。数字は漢数字） */}
          {showSan && play && (crossed || newLeaves > 0) && (
            <div className={`absolute right-3 top-4 text-[21px] leading-[1.9] ${styles.san} ${styles.fadeIn}`}>
              {crossed ? `${crossed.label}を、越えました` : newLeaves > 0 ? `葉が、${kanjiNumber(Math.min(newLeaves, 99))}枚ふえました` : ''}
            </div>
          )}
        </div>

        <div className="mt-2 space-y-1 text-[11px] text-[#5f5a4c]">
          {todayLeaf && !engine.running && (
            <p>今日の葉：<span className="font-semibold">{todayLeaf.title || 'ひとつの知識'}</span></p>
          )}
          <p className="text-[10px] text-[#a39678]">
            葉＝学びのひとつ（読んだ・書いた・即答できた・磨き直した）・色＝いま即答できるか
          </p>
        </div>
      </div>

      {/* 葉の中身（タイトル・日付・行為の一言だけ。数字は出さない） */}
      {openLeaf && openVisual && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/25" onClick={(e) => { e.stopPropagation(); setLeafOpen(null) }}>
          <div className={`w-full max-w-md rounded-t-2xl p-4 pb-[calc(16px+env(safe-area-inset-bottom))] ${styles.frame}`} onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold">{openLeaf.title || 'ひとつの知識'}</div>
            <div className="mt-1 text-[11px] text-[#8b8272]">
              {openLeaf.at.slice(0, 10)}・
              {openLeaf.kind === 'read' ? '読んだ' : openLeaf.kind === 'wrote' ? '書いた' : openLeaf.kind === 'recall' ? '即答できた' : '磨き直した'}
            </div>
            {spotlight.includes(openLeaf.id) && (
              <button
                type="button"
                onClick={() => { setLeafOpen(null); onGoQuiz() }}
                className="mt-3 rounded-full border border-[#cbbf9f] bg-[#faf5e8] px-4 py-1.5 text-xs"
              >
                たしかめる
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: page.tsx の置換**

`src/app/page.tsx` で `TowerScreen` のimportと使用箇所（`grep -n "TowerScreen" src/app/page.tsx`）を `VineScreen`（`@/components/vine/VineScreen`）に置き換える。propsは同一（onClose/onGoQuiz）。

- [ ] **Step 3: TowerCard の語彙更新**

`src/components/tower/TowerCard.tsx` を読み、表示文言を次の方針で置換（ロジック・propsは変えない）：
- 旧 `tower-ladder` のimportを `vine-ladder` の `nextMilestone/heightMmFromLeaves/formatHeight` に差し替え
- 高さ表示は `formatHeight(heightMmFromLeaves(count))`
- 「あと◯歩で◯◯」→「{label}まで あと{formatHeight(next.mm - heightMmFromLeaves(count))}」
- 「歩」の文字が残らないこと（`grep -n "歩" src/components/tower/TowerCard.tsx` が0件）

- [ ] **Step 4: 旧ファイル削除と全体確認**

```bash
grep -rn "TowerScreen\|TowerStack" src --include="*.tsx" --include="*.ts"
# → page.tsx等に参照が残っていないことを確認してから
git rm src/components/tower/TowerScreen.tsx src/components/tower/TowerStack.tsx
```

Run: `npx vitest run && npx tsc --noEmit && npx next build 2>&1 | tail -5`
Expected: 全テストPASS・型エラー0・build成功

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(vine): VineScreen統合（リプレイ・賛・葉の中身・markSeen完走コミット）＋旧塔画面の置換"
```

---

### Task 5: devハーネスと目視検証

**Files:**
- Create: `src/app/dev/vine/page.tsx`

**Interfaces:**
- Consumes: `VineScreen`（initialState注入）・`TowerState/Step`
- 本番では404（`process.env.NODE_ENV !== 'development'` で `notFound()`）

- [ ] **Step 1: 実装**

```tsx
// src/app/dev/vine/page.tsx
'use client'
// 知の蔓のdevハーネス（development限定）。台帳を作って3シナリオを目視確認する。
// 本物のlocalStorageに触れない（initialState注入・保存もされない）。
import { notFound } from 'next/navigation'
import { useMemo, useState } from 'react'
import type { Step, TowerState } from '@/lib/tower-steps'
import { VineScreen } from '@/components/vine/VineScreen'

function mkSteps(n: number): Step[] {
  const kinds: Step['kind'][] = ['read', 'recall', 'wrote', 'recall', 'repolish']
  return Array.from({ length: n }, (_, i) => ({
    id: `dev-${i}`, kind: kinds[i % kinds.length],
    at: new Date(Date.now() - (n - i) * 43_200_000).toISOString(),
    genre: 'dev', title: `知識のたね ${i + 1}`,
  }))
}
const mk = (count: number, seen: number): TowerState => ({
  steps: mkSteps(count), lastSeenSteps: seen, lastSeenAt: '', backfilledAt: 'dev',
})

const SCENARIOS: Record<string, TowerState> = {
  'ふつうの日（+4枚）': mk(14, 10),
  '追い越しの日（湯のみ35枚越え）': mk(40, 30),
  '大量バックフィル（+80枚）': mk(200, 120),
}

export default function DevVinePage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  const [key, setKey] = useState<string | null>(null)
  const state = useMemo(() => (key ? SCENARIOS[key] : null), [key])
  return (
    <div className="min-h-screen bg-neutral-200 p-6">
      <h1 className="mb-3 text-sm font-bold">知の蔓 devハーネス</h1>
      <div className="flex flex-wrap gap-2">
        {Object.keys(SCENARIOS).map((k) => (
          <button key={k} type="button" onClick={() => { setKey(null); setTimeout(() => setKey(k), 30) }}
            className="rounded-full border border-neutral-400 bg-white px-3 py-1.5 text-xs">
            {k}
          </button>
        ))}
      </div>
      {key && state && (
        <VineScreen key={key + Date.now()} initialState={state} onClose={() => setKey(null)} onGoQuiz={() => alert('クイズへ（dev）')} />
      )}
    </div>
  )
}
```

- [ ] **Step 2: 全体確認 → コミット**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS / 0 errors

```bash
git add src/app/dev/vine/page.tsx
git commit -m "feat(vine): devハーネス（3シナリオ・development限定・localStorage非接触）"
```

- [ ] **Step 3: コントローラによるブラウザ目視**（このタスクの完了条件。実装サブエージェントではなくコントローラが実施）

dev server起動→ `http://localhost:3000/dev/vine` →3シナリオを再生し、①リプレイが流れ切る ②タップで疾書 ③賛が右上に縦書きで出る ④朱のいま/あと/刻み ⑤葉タップで中身、をスクリーンショットで確認・記録する。

---

## Part 3（別プランで作成）

実時間の空・住人と住み着き・見下ろしscroll-snap・節の茂み集約（tower-volumes転用）・本番PNG差し替え（vine-assetsマニフェスト）・フォントサブセット（Yuji Syuku/Klee One）・題字と落款の一点物SVG。

Part 2完了時点：仮アートで「動く知の蔓」が成立。既存ユーザーへの見た目はearlyAccessフラグ配下のみ変化。
