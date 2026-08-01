# 知の蔓 v1.2 Part 1（ロジックの土台）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 知の蔓v1.2の純関数層（高さ関数・ラダーv2・葉の状態機械・リプレイゲート・蔓パス生成）をTDDで構築する。UIはまだ触らない（Part 2）。

**Architecture:** すべて端末ローカル・純関数。新規3ファイル（vine-ladder / vine-leaves / vine-path）＋既存 `tower-steps.ts` の `markSeen` 1関数のシグネチャ変更。DOM API（getPointAtLength等）は一切使わない——蔓パスは自前のベジェサンプリングで長さを持つ（SSR安全・ブラウザ差ゼロ）。

**Tech Stack:** TypeScript / vitest（既存設定のまま。新規依存の追加は禁止）

**Spec:** `docs/superpowers/specs/2026-08-01-chi-no-tsuru-v1.2-design.md`（正典）

## Global Constraints

- **単位は「葉」**。コード識別子に leaf/leaves を使う。UI文言・コメント・コミットメッセージに「歩」を新規に書かない（既存 tower-steps.ts 内の歴史的コメントは触らない）
- **葉1枚=2mm**・複利開始=葉125枚・**複利率 r=0.8%**（`0.008`）。この3定数は表示露出後変更不可＝ゴールデンテストで固定
- 実物の寸法は実寸のまま改変禁止（ラダーv2の値を1mmも動かさない）
- 高さは減らない・葉の記録は消えない（既存 addStep の重複規則・MAX_STEPS はそのまま）
- 越え判定は整数の葉数比較のみ（浮動小数の高さ比較禁止）
- コメントは既存コードの流儀（日本語・設計理由を書く）に合わせる
- テストは `src/lib/__tests__/` に置く（既存慣行）

---

### Task 1: vine-ladder — 高さ関数（二帯モデル）

**Files:**
- Create: `src/lib/vine-ladder.ts`
- Test: `src/lib/__tests__/vine-ladder.test.ts`

**Interfaces:**
- Produces: `MM_PER_LEAF=2` / `COMPOUND_START_LEAVES=125` / `COMPOUND_RATE=0.008` / `heightMmFromLeaves(n: number): number` / `leavesForHeightMm(mm: number): number` / `formatHeight(mm: number): string`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/vine-ladder.test.ts
import { describe, expect, it } from 'vitest'
import {
  MM_PER_LEAF, COMPOUND_START_LEAVES, COMPOUND_RATE,
  heightMmFromLeaves, leavesForHeightMm, formatHeight,
} from '../vine-ladder'

describe('ゴールデン定数（GA後は変更不可。落ちたら定数を疑え、テストを直すな）', () => {
  it('葉1枚=2mm・複利開始125枚・r=0.8%', () => {
    expect(MM_PER_LEAF).toBe(2)
    expect(COMPOUND_START_LEAVES).toBe(125)
    expect(COMPOUND_RATE).toBe(0.008)
  })
  it('実寸帯: 葉0=0mm・葉3=6mm・葉125=250mm', () => {
    expect(heightMmFromLeaves(0)).toBe(0)
    expect(heightMmFromLeaves(3)).toBe(6)
    expect(heightMmFromLeaves(125)).toBe(250)
  })
  it('複利帯: 葉126=252mm・富士山(3776m)は葉1333枚で越える', () => {
    expect(heightMmFromLeaves(126)).toBeCloseTo(252, 0)
    expect(leavesForHeightMm(3_776_000)).toBe(1333)
  })
})

describe('heightMmFromLeaves', () => {
  it('単調増加（0〜2000枚）', () => {
    let prev = -1
    for (let n = 0; n <= 2000; n++) {
      const h = heightMmFromLeaves(n)
      expect(h).toBeGreaterThan(prev)
      prev = h
    }
  })
  it('境界が連続（125枚と126枚の間に段差がない）', () => {
    const gap = heightMmFromLeaves(126) - heightMmFromLeaves(125)
    expect(gap).toBeGreaterThan(0)
    expect(gap).toBeLessThan(4) // 2mm×複利ぶん程度
  })
})

describe('leavesForHeightMm（逆関数）', () => {
  it('高さmm以上になる最小の整数葉数を返す', () => {
    expect(leavesForHeightMm(5)).toBe(3)    // アリ5mm→葉3枚目
    expect(leavesForHeightMm(70)).toBe(35)  // 湯のみ7cm→葉35枚
    expect(leavesForHeightMm(250)).toBe(125) // ネコ25cm→葉125枚
  })
  it('往復整合: 任意の目盛りmmで heightMm(leaves(mm)) >= mm かつ heightMm(leaves(mm)-1) < mm', () => {
    for (const mm of [5, 8, 20, 35, 70, 100, 250, 398, 750, 15000, 54800, 3_776_000]) {
      const n = leavesForHeightMm(mm)
      expect(heightMmFromLeaves(n)).toBeGreaterThanOrEqual(mm)
      expect(heightMmFromLeaves(n - 1)).toBeLessThan(mm)
    }
  })
})

describe('formatHeight', () => {
  it('mm/cm/mを桁で切り替える', () => {
    expect(formatHeight(6)).toBe('6mm')
    expect(formatHeight(70)).toBe('7cm')
    expect(formatHeight(252)).toBe('25.2cm')
    expect(formatHeight(3_776_000)).toBe('3776m')
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/lib/__tests__/vine-ladder.test.ts`
Expected: FAIL（`vine-ladder` が存在しない）

- [ ] **Step 3: 実装**

```ts
// src/lib/vine-ladder.ts
// 知の蔓の高さ関数。ルールは一文——「葉が1枚ひらくと、蔓が2mm伸びる」。
// ネコ（葉125枚=25cm）から先は複利（1枚ごとに+0.8%）。「学びは複利」を機構で語る。
// ⚠️ この3定数は表示露出後は実質変更不可（ユーザーの高さが動く）。
//    ゴールデンテスト（vine-ladder.test.ts）が事故的変更を封じている。GA前の監修でのみ動かす。
export const MM_PER_LEAF = 2
export const COMPOUND_START_LEAVES = 125
export const COMPOUND_RATE = 0.008

const COMPOUND_BASE_MM = COMPOUND_START_LEAVES * MM_PER_LEAF // 250mm（ネコ）

export function heightMmFromLeaves(n: number): number {
  if (n <= COMPOUND_START_LEAVES) return n * MM_PER_LEAF
  return COMPOUND_BASE_MM * Math.pow(1 + COMPOUND_RATE, n - COMPOUND_START_LEAVES)
}

// その高さ以上になる最小の整数葉数。越え判定は必ずこの整数で行う（浮動小数比較の二重発火を防ぐ）。
export function leavesForHeightMm(mm: number): number {
  if (mm <= COMPOUND_BASE_MM) return Math.ceil(mm / MM_PER_LEAF)
  const n = COMPOUND_START_LEAVES + Math.log(mm / COMPOUND_BASE_MM) / Math.log(1 + COMPOUND_RATE)
  const whole = Math.ceil(n - 1e-9) // 表現誤差でceilが1つ滑るのを防ぐ
  return heightMmFromLeaves(whole) >= mm ? whole : whole + 1
}

export function formatHeight(mm: number): string {
  if (mm < 10) return `${Math.round(mm)}mm`
  if (mm < 1000) return `${(mm / 10).toFixed(1).replace(/\.0$/, '')}cm`
  return `${(mm / 1000).toFixed(2).replace(/\.?0+$/, '')}m`
}
```

- [ ] **Step 4: パスを確認**

Run: `npx vitest run src/lib/__tests__/vine-ladder.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: Commit**

```bash
git add src/lib/vine-ladder.ts src/lib/__tests__/vine-ladder.test.ts
git commit -m "feat(vine): 高さ関数の二帯モデル（葉1枚=2mm・葉125枚から複利0.8%）＋ゴールデンテスト"
```

---

### Task 2: vine-ladder — ラダーv2と目盛り・シーン計算

**Files:**
- Modify: `src/lib/vine-ladder.ts`（Task 1の続きに追記）
- Test: `src/lib/__tests__/vine-ladder.test.ts`（追記）

**Interfaces:**
- Consumes: Task 1 の `leavesForHeightMm`
- Produces: `type Milestone = { mm: number; label: string; sizeLabel: string; measure: string; provisional?: boolean; leaves: number }` / `LADDER: readonly Milestone[]`（23件） / `FAR_DREAM: Milestone`（富士山） / `nextMilestone(leafCount: number): Milestone`（富士山を含む・nullなし） / `passedMilestones(leafCount: number): Milestone[]` / `sceneForLeaves(leafCount: number, viewportHeightPx: number): { next: Milestone; prevMm: number; pxPerMm: number }`

- [ ] **Step 1: 失敗するテストを追記**

```ts
// vine-ladder.test.ts に追記
import { LADDER, FAR_DREAM, nextMilestone, passedMilestones, sceneForLeaves } from '../vine-ladder'

describe('ラダーv2', () => {
  it('23目盛り＋遠い夢=富士山。実寸は確定値のまま（1mmも動かさない）', () => {
    expect(LADDER).toHaveLength(23)
    expect(LADDER[0]).toMatchObject({ mm: 5, label: 'アリ' })
    expect(LADDER[4]).toMatchObject({ mm: 70, label: '湯のみ' })
    expect(LADDER[6]).toMatchObject({ mm: 250, label: 'ネコ' })
    expect(LADDER[17]).toMatchObject({ mm: 54_800, label: '五重塔' })
    expect(LADDER[22]).toMatchObject({ mm: 3_015_000, label: '立山' })
    expect(FAR_DREAM).toMatchObject({ mm: 3_776_000, label: '富士山' })
  })
  it('mmは狭義単調増加・必要葉数も狭義単調増加', () => {
    for (let i = 1; i < LADDER.length; i++) {
      expect(LADDER[i].mm).toBeGreaterThan(LADDER[i - 1].mm)
      expect(LADDER[i].leaves).toBeGreaterThan(LADDER[i - 1].leaves)
    }
  })
  it('上段5件（那智の滝〜立山）はprovisional（画風テスト後に確定）', () => {
    expect(LADDER.slice(18).every((m) => m.provisional)).toBe(true)
    expect(LADDER.slice(0, 18).every((m) => !m.provisional)).toBe(true)
  })
  it('初日で最初の実物: アリは葉3枚で越えられる', () => {
    expect(LADDER[0].leaves).toBe(3)
  })
})

describe('nextMilestone / passedMilestones', () => {
  it('葉0→つぎはアリ、葉3→アリは越えた・つぎはテントウムシ', () => {
    expect(nextMilestone(0).label).toBe('アリ')
    expect(nextMilestone(3).label).toBe('テントウムシ')
    expect(passedMilestones(3).map((m) => m.label)).toEqual(['アリ'])
  })
  it('全ラダーを越えたら次は富士山（遠い夢）', () => {
    const beyond = LADDER[22].leaves
    expect(nextMilestone(beyond).label).toBe('富士山')
    expect(passedMilestones(beyond)).toHaveLength(23)
  })
})

describe('sceneForLeaves', () => {
  it('次の実物が画面高の70%に収まる縮尺', () => {
    const s = sceneForLeaves(40, 600) // 湯のみは越えた・つぎはスズメ100mm
    expect(s.next.label).toBe('スズメ')
    expect(s.pxPerMm).toBeCloseTo((600 * 0.7) / 100, 5)
    expect(s.prevMm).toBe(70)
  })
  it('葉0でもシーンが成立（prevMm=0・つぎはアリ）', () => {
    const s = sceneForLeaves(0, 600)
    expect(s.next.label).toBe('アリ')
    expect(s.prevMm).toBe(0)
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/lib/__tests__/vine-ladder.test.ts`
Expected: FAIL（LADDER未定義）

- [ ] **Step 3: 実装を追記**

```ts
// vine-ladder.ts に追記
// 実物ラダーv2（寸法は2026-08-01に裏取り済み。実寸を動かすことは世界の嘘になる＝禁止）。
// measure は画面に小さく明記する「測り方」。provisional=上段仮置き（画風テスト後に確定。
// 未到達ラダーの差し替えは記録（葉数）を壊さない——このテーブルは表示専用で台帳に書かれないため）。
export type Milestone = {
  mm: number; label: string; sizeLabel: string; measure: string
  provisional?: boolean; leaves: number
}

type RawMilestone = Omit<Milestone, 'leaves'>
const RAW: readonly RawMilestone[] = [
  { mm: 5, label: 'アリ', sizeLabel: '5mm', measure: '体長（クロヤマアリ働きアリ）' },
  { mm: 8, label: 'テントウムシ', sizeLabel: '8mm', measure: '体長（ナナホシテントウ）' },
  { mm: 20, label: 'ドングリ', sizeLabel: '2cm', measure: '果長（コナラ）' },
  { mm: 35, label: 'カタツムリ', sizeLabel: '3.5cm', measure: '殻径（ミスジマイマイ）' },
  { mm: 70, label: '湯のみ', sizeLabel: '7cm', measure: '器高（小ぶり）' },
  { mm: 100, label: 'スズメ', sizeLabel: '10cm', measure: '立ち姿の背丈' },
  { mm: 250, label: 'ネコ', sizeLabel: '25cm', measure: '体高（肩高）' },
  { mm: 398, label: '一升瓶', sizeLabel: '39.8cm', measure: '全高（JIS規格）' },
  { mm: 750, label: '番傘', sizeLabel: '75cm', measure: 'すぼめた全長' },
  { mm: 900, label: 'ニホンジカ', sizeLabel: '90cm', measure: '体高（本州産オス）' },
  { mm: 1400, label: 'タンチョウ', sizeLabel: '1.4m', measure: '立ち姿' },
  { mm: 1700, label: 'ヒト', sizeLabel: '1.7m', measure: '身長（笠の旅人）' },
  { mm: 3000, label: '白象', sizeLabel: '3m', measure: '肩高（オス）' },
  { mm: 5000, label: '鳥居', sizeLabel: '5m', measure: '全高（街の明神鳥居）' },
  { mm: 12_000, label: '合掌造りの民家', sizeLabel: '12m', measure: '棟高' },
  { mm: 15_000, label: '奈良の大仏', sizeLabel: '15m', measure: '像高（台座を除く）' },
  { mm: 25_000, label: 'ご神木の大杉', sizeLabel: '25m', measure: '樹高' },
  { mm: 54_800, label: '五重塔', sizeLabel: '54.8m', measure: '全高（東寺・相輪含む）' },
  { mm: 133_000, label: '那智の滝', sizeLabel: '133m', measure: '落差', provisional: true },
  { mm: 350_000, label: '称名滝', sizeLabel: '350m', measure: '落差（四段計）', provisional: true },
  { mm: 877_000, label: '筑波山', sizeLabel: '877m', measure: '標高', provisional: true },
  { mm: 1_982_000, label: '石鎚山', sizeLabel: '1982m', measure: '標高', provisional: true },
  { mm: 3_015_000, label: '立山', sizeLabel: '3015m', measure: '標高', provisional: true },
]

export const LADDER: readonly Milestone[] = RAW.map((m) => ({ ...m, leaves: leavesForHeightMm(m.mm) }))
export const FAR_DREAM: Milestone = {
  mm: 3_776_000, label: '富士山', sizeLabel: '3776m', measure: '標高（剣ヶ峰）',
  leaves: leavesForHeightMm(3_776_000),
}

// 富士山より先は「雲の上」＝測れない領域なので、nextは常に存在する（nullを返さない）。
export function nextMilestone(leafCount: number): Milestone {
  return LADDER.find((m) => m.leaves > leafCount) ?? FAR_DREAM
}

export function passedMilestones(leafCount: number): Milestone[] {
  return LADDER.filter((m) => m.leaves <= leafCount)
}

// シーン（帯）モデル: 1目盛り区間=1シーン。縮尺は「次の実物が画面高の70%」から決める。
// ラダーが対数等間隔（隣接比≤2.5）なので、シーン切替時の縮尺ジャンプも2.5倍以内に収まる。
const NEXT_OBJECT_VIEWPORT_RATIO = 0.7

export function sceneForLeaves(leafCount: number, viewportHeightPx: number): {
  next: Milestone; prevMm: number; pxPerMm: number
} {
  const next = nextMilestone(leafCount)
  const passed = passedMilestones(leafCount)
  const prevMm = passed.length ? passed[passed.length - 1].mm : 0
  return { next, prevMm, pxPerMm: (viewportHeightPx * NEXT_OBJECT_VIEWPORT_RATIO) / next.mm }
}
```

- [ ] **Step 4: パスを確認**

Run: `npx vitest run src/lib/__tests__/vine-ladder.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: Commit**

```bash
git add src/lib/vine-ladder.ts src/lib/__tests__/vine-ladder.test.ts
git commit -m "feat(vine): 実物ラダーv2（23目盛り・整数葉数の越え判定・シーン縮尺計算）"
```

---

### Task 3: vine-leaves — 葉の状態機械

**Files:**
- Create: `src/lib/vine-leaves.ts`
- Test: `src/lib/__tests__/vine-leaves.test.ts`

**Interfaces:**
- Consumes: `Step`（tower-steps）・`QuizStat`（quiz-srs）
- Produces: `type LeafForm = 'outline' | 'futaba' | 'green'` / `type LeafVisual = { form: LeafForm; fade: number; teri: boolean }` / `fadeLevel(stat: QuizStat | undefined, nowIso: string): number` / `buildLeafVisuals(steps: Step[], stats: Record<string, QuizStat>, nowIso: string): LeafVisual[]` / `spotlightFaded(steps: Step[], stats: Record<string, QuizStat>, nowIso: string, limit?: number): string[]`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/vine-leaves.test.ts
import { describe, expect, it } from 'vitest'
import type { QuizStat } from '../quiz-srs'
import type { Step } from '../tower-steps'
import { fadeLevel, buildLeafVisuals, spotlightFaded } from '../vine-leaves'

const NOW = '2026-08-01T12:00:00.000Z'
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString()
const ok = (lastDaysAgo: number): QuizStat => ({ ok: 1, ng: 0, last: daysAgo(lastDaysAgo), lastResult: 'ok' })
const step = (id: string, kind: Step['kind']): Step => ({ id, kind, at: daysAgo(10), genre: '', title: `T-${id}` })

describe('fadeLevel（色褪せは失敗ではなく再学習の合図。数値は議事録A-2の段階遷移）', () => {
  it('鮮度が高ければ0', () => {
    expect(fadeLevel(ok(1), NOW)).toBe(0)
    expect(fadeLevel(ok(89), NOW)).toBe(0)
  })
  it('期限日(90日)から2日かけて微減（最大0.15）', () => {
    expect(fadeLevel(ok(90), NOW)).toBe(0)
    expect(fadeLevel(ok(91), NOW)).toBeCloseTo(0.075, 3)
    expect(fadeLevel(ok(92), NOW)).toBeCloseTo(0.15, 3)
  })
  it('+2〜+7日ではっきり褪せ、以後は1で打ち止め（枯れ落ちなし）', () => {
    expect(fadeLevel(ok(94.5), NOW)).toBeCloseTo(0.5, 2)
    expect(fadeLevel(ok(97), NOW)).toBe(1)
    expect(fadeLevel(ok(400), NOW)).toBe(1)
  })
  it('クイズ失敗（lastResult=ng）は即1', () => {
    expect(fadeLevel({ ok: 3, ng: 1, last: daysAgo(0), lastResult: 'ng' }, NOW)).toBe(1)
  })
  it('statなし（クイズ未通過）は0——輪郭の葉は褪せる対象ですらない', () => {
    expect(fadeLevel(undefined, NOW)).toBe(0)
  })
})

describe('buildLeafVisuals（導出表: read=輪郭不褪／wrote=双葉不褪／recall系のみ褪せる）', () => {
  it('kindごとの形と、照り葉（repolish歴あり・fade0）', () => {
    const steps = [step('a', 'read'), step('b', 'wrote'), step('c', 'recall'), step('d', 'repolish')]
    const stats = { c: ok(1), d: ok(1) }
    const v = buildLeafVisuals(steps, stats, NOW)
    expect(v[0]).toEqual({ form: 'outline', fade: 0, teri: false })
    expect(v[1]).toEqual({ form: 'futaba', fade: 0, teri: false })
    expect(v[2]).toEqual({ form: 'green', fade: 0, teri: false })
    expect(v[3]).toEqual({ form: 'green', fade: 0, teri: true }) // 磨き直した葉は照る
  })
  it('同じidのrecall葉も、repolish歴があれば照る（idごとの履歴で判定）', () => {
    const steps = [step('x', 'recall'), step('x', 'repolish')]
    const v = buildLeafVisuals(steps, { x: ok(1) }, NOW)
    expect(v[0].teri).toBe(true)
  })
  it('色褪せ中は照らない', () => {
    const v = buildLeafVisuals([step('y', 'repolish')], { y: ok(100) }, NOW)
    expect(v[0]).toMatchObject({ form: 'green', fade: 1, teri: false })
  })
})

describe('spotlightFaded（目立たせるのは最大3枚・lastが新しい順。数字での集計は永久にしない）', () => {
  it('fade=1のidだけを、lastが新しい順に最大3件', () => {
    const steps = ['a', 'b', 'c', 'd', 'e'].map((id) => step(id, 'recall'))
    const stats = { a: ok(100), b: ok(120), c: ok(98), d: ok(50), e: ok(200) }
    expect(spotlightFaded(steps, stats, NOW)).toEqual(['c', 'a', 'b']) // dはまだ褪せてない・eは4番目
  })
  it('limit指定を尊重・重複idは1回だけ', () => {
    const steps = [step('a', 'recall'), step('a', 'repolish')]
    expect(spotlightFaded(steps, { a: ok(100) }, NOW, 1)).toEqual(['a'])
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/lib/__tests__/vine-leaves.test.ts`
Expected: FAIL（vine-leaves が存在しない）

- [ ] **Step 3: 実装**

```ts
// src/lib/vine-leaves.ts
// 葉の状態機械（純関数）。設計の核＝「高さ=行為の累積（不可逆）／葉の色=いまの状態（可逆）」の分離。
// read=輪郭のみ（検索練習未通過の誠実な表示・褪せない）／wrote=双葉（希少な生成行為・褪せない）／
// recall・repolish=青葉（検索強度に応じて色褪せ）。磨き直して戻した葉は「照り葉」——
// 一度忘れて思い出した知識が最も強い、を絵で語る。
// ⚠️ 色褪せを数字で集計してUIに出すことは永久禁止（負債台帳化＝この設計全体の死）。
import type { QuizStat } from './quiz-srs'
import type { Step } from './tower-steps'

export type LeafForm = 'outline' | 'futaba' | 'green'
export type LeafVisual = { form: LeafForm; fade: number; teri: boolean }

// 期限90日（quiz-srsは簡易SRSで期限日を持たないため、DULL_DAYSと同じ「last+90日」を期限とみなす）。
// 期限〜+2日は微減（最大0.15）→ +2〜+7日ではっきり→1で打ち止め。枯れ落ち・降格はしない。
export const FADE_DUE_DAYS = 90
export const FADE_PRE_DAYS = 2
export const FADE_RAMP_DAYS = 5
const PRE_FADE_MAX = 0.15
const DAY_MS = 86_400_000

export function fadeLevel(stat: QuizStat | undefined, nowIso: string): number {
  if (!stat || !stat.last) return 0
  if (stat.lastResult === 'ng') return 1 // 実測で落ちている＝即・合図
  const days = (Date.parse(nowIso) - Date.parse(stat.last)) / DAY_MS
  const pre = Math.max(0, Math.min(1, (days - FADE_DUE_DAYS) / FADE_PRE_DAYS)) * PRE_FADE_MAX
  const main = Math.max(0, Math.min(1, (days - FADE_DUE_DAYS - FADE_PRE_DAYS) / FADE_RAMP_DAYS))
  return Math.max(pre, main)
}

export function buildLeafVisuals(
  steps: Step[], stats: Record<string, QuizStat>, nowIso: string,
): LeafVisual[] {
  const repolished = new Set(steps.filter((s) => s.kind === 'repolish').map((s) => s.id))
  return steps.map((s) => {
    if (s.kind === 'read') return { form: 'outline' as const, fade: 0, teri: false }
    if (s.kind === 'wrote') return { form: 'futaba' as const, fade: 0, teri: false }
    const fade = fadeLevel(stats[s.id], nowIso)
    return { form: 'green' as const, fade, teri: fade === 0 && repolished.has(s.id) }
  })
}

// 「磨きどきの葉」をそっと目立たせる選定（蛙が近くに座る対象でもある）。
// fadeが1に達したidを、lastが新しい順（=まだ記憶の残り香がある順）に最大limit件。
export function spotlightFaded(
  steps: Step[], stats: Record<string, QuizStat>, nowIso: string, limit = 3,
): string[] {
  const ids = [...new Set(steps.filter((s) => s.kind === 'recall' || s.kind === 'repolish').map((s) => s.id))]
  return ids
    .filter((id) => fadeLevel(stats[id], nowIso) >= 1)
    .sort((a, b) => (stats[b]?.last || '').localeCompare(stats[a]?.last || ''))
    .slice(0, limit)
}
```

- [ ] **Step 4: パスを確認**

Run: `npx vitest run src/lib/__tests__/vine-leaves.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: Commit**

```bash
git add src/lib/vine-leaves.ts src/lib/__tests__/vine-leaves.test.ts
git commit -m "feat(vine): 葉の状態機械（輪郭/双葉/青葉・色褪せグラデーション・照り葉・磨きどき3枚）"
```

---

### Task 4: markSeen改修とリプレイゲート

**Files:**
- Modify: `src/lib/tower-steps.ts:103-105`（markSeen）
- Modify: `src/components/tower/TowerScreen.tsx:82-83`（呼び出し側）
- Test: `src/lib/__tests__/tower-steps.test.ts`（追記）

**Interfaces:**
- Consumes: `TowerState`
- Produces: `markSeen(state: TowerState, uptoCount: number): TowerState`（**シグネチャ変更**） / `planReplay(state: TowerState): { from: number; to: number; play: boolean }`

**背景（なぜ変えるか）:** 現行はマウント時に即markSeen（全件seen）するため、(a)リプレイ中に閉じるとその日の成長が二度と見られない、(b)リプレイ中に積まれた新イベントまでseen扱いになる。v1.2はリプレイ完走時に「見せたぶんまで」をコミットする。ゲートは葉数比較のみ——「同じ成長は二度と再生されない」が数で保証されるので、日付比較（UTC境界バグの温床）は不要になる。

- [ ] **Step 1: 失敗するテストを追記**

```ts
// src/lib/__tests__/tower-steps.test.ts に追記
import { markSeen, planReplay, type TowerState, type Step } from '../tower-steps'

const mkStep = (i: number): Step => ({ id: `s${i}`, kind: 'read', at: '2026-08-01T00:00:00.000Z', genre: '', title: '' })
const mkState = (count: number, seen: number): TowerState => ({
  steps: Array.from({ length: count }, (_, i) => mkStep(i)),
  lastSeenSteps: seen, lastSeenAt: '', backfilledAt: '',
})

describe('markSeen(state, uptoCount)', () => {
  it('見せたところまでだけseenにする（全件ではなく）', () => {
    const s = markSeen(mkState(10, 3), 7)
    expect(s.lastSeenSteps).toBe(7)
    expect(s.lastSeenAt).not.toBe('')
  })
  it('steps数を超える値は丸める・後退はしない', () => {
    expect(markSeen(mkState(5, 2), 99).lastSeenSteps).toBe(5)
    expect(markSeen(mkState(5, 4), 1).lastSeenSteps).toBe(4)
  })
})

describe('planReplay', () => {
  it('成長があれば再生（from=前回seen, to=現在葉数）', () => {
    expect(planReplay(mkState(10, 6))).toEqual({ from: 6, to: 10, play: true })
  })
  it('成長ゼロなら再生しない', () => {
    expect(planReplay(mkState(6, 6))).toEqual({ from: 6, to: 6, play: false })
  })
  it('seenが葉数を上回る壊れデータでも安全（from=to・再生なし）', () => {
    expect(planReplay(mkState(4, 9))).toEqual({ from: 4, to: 4, play: false })
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/lib/__tests__/tower-steps.test.ts`
Expected: FAIL（markSeenの引数・planReplay未定義）

- [ ] **Step 3: 実装（tower-steps.ts の markSeen を置換し、planReplay を追加）**

```ts
// tower-steps.ts — 既存 markSeen(103-105行) をこの2関数で置き換える
// 「見た」の水位。リプレイ完走時に「見せたところまで」をコミットする（v1.2）。
// マウント時に全件seenにすると、リプレイ中断でその日の成長が永遠に見られなくなる。
export function markSeen(state: TowerState, uptoCount: number): TowerState {
  const upto = Math.max(state.lastSeenSteps, Math.min(uptoCount, state.steps.length))
  return { ...state, lastSeenSteps: upto, lastSeenAt: new Date().toISOString() }
}

// リプレイのゲート。葉数の比較だけで決める——「同じ成長は二度と再生しない」が数で保証されるため、
// 日付比較（UTC境界のバグ温床）は不要。リプレイ中に積まれた新イベントは from..to の外なので次回へ回る。
export function planReplay(state: TowerState): { from: number; to: number; play: boolean } {
  const to = state.steps.length
  const from = Math.min(state.lastSeenSteps, to)
  return { from, to, play: to > from }
}
```

- [ ] **Step 4: 呼び出し側を追随（TowerScreen.tsx 82-83行）**

現行:
```ts
    const seen = markSeen(loadTowerState())
    saveTowerState(seen)
```
変更後（現行画面の挙動は維持。リプレイ完走コミットへの本置換はPart 2）:
```ts
    const fresh = loadTowerState()
    saveTowerState(markSeen(fresh, fresh.steps.length))
```

- [ ] **Step 5: 全テストとビルド確認**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS / エラー0（markSeenの他の呼び出し箇所があればコンパイルエラーで検出→同様に `(state, state.steps.length)` へ）

- [ ] **Step 6: Commit**

```bash
git add src/lib/tower-steps.ts src/components/tower/TowerScreen.tsx src/lib/__tests__/tower-steps.test.ts
git commit -m "feat(vine): markSeenを「見せたところまで」コミットに変更＋planReplayゲート（葉数比較のみ）"
```

---

### Task 5: vine-path — 蔓パスの純関数ジェネレータ

**Files:**
- Create: `src/lib/vine-path.ts`
- Test: `src/lib/__tests__/vine-path.test.ts`

**Interfaces:**
- Produces: `type VineSample = { x: number; y: number; len: number }` / `type VinePath = { d: string; samples: VineSample[]; totalLen: number }` / `generateVinePath(seed: number, heightPx: number, baseX: number, amp: number): VinePath` / `pointAtHeight(path: VinePath, hPx: number): VineSample` / `lengthAtHeight(path: VinePath, hPx: number): number`
- 座標系: **地面が y=0・上が正**。SVG側（Part 2）は `transform="scale(1,-1)"` で消費し、`<path pathLength={totalLen}>` を指定して dashoffset の計算をこの自前長に正規化する（ブラウザの長さ測定に依存しない）

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/vine-path.test.ts
import { describe, expect, it } from 'vitest'
import { generateVinePath, pointAtHeight, lengthAtHeight } from '../vine-path'

describe('generateVinePath（決定的・y単調・DOM不使用）', () => {
  it('同じseedなら完全に同じ結果（リロードで蔓が変わらない）', () => {
    const a = generateVinePath(42, 800, 100, 60)
    const b = generateVinePath(42, 800, 100, 60)
    expect(a.d).toBe(b.d)
    expect(a.totalLen).toBe(b.totalLen)
  })
  it('seedが違えば形が変わる', () => {
    expect(generateVinePath(1, 800, 100, 60).d).not.toBe(generateVinePath(2, 800, 100, 60).d)
  })
  it('yは厳密単調増加（高さ→座標の対応が壊れない・20seed分）', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const p = generateVinePath(seed, 1200, 100, 70)
      for (let i = 1; i < p.samples.length; i++) {
        expect(p.samples[i].y).toBeGreaterThan(p.samples[i - 1].y)
      }
    }
  })
  it('最上部サンプルはheightPxに到達・弧長は高さ以上（うねるぶん長い）', () => {
    const p = generateVinePath(7, 1000, 100, 60)
    expect(p.samples[p.samples.length - 1].y).toBeCloseTo(1000, 0)
    expect(p.totalLen).toBeGreaterThanOrEqual(1000)
    expect(p.totalLen).toBeLessThan(1500) // 過剰にうねらない
  })
  it('xはbaseX±ampに収まる', () => {
    const p = generateVinePath(9, 1000, 100, 60)
    for (const s of p.samples) {
      expect(s.x).toBeGreaterThanOrEqual(100 - 60)
      expect(s.x).toBeLessThanOrEqual(100 + 60)
    }
  })
})

describe('pointAtHeight / lengthAtHeight', () => {
  it('指定高さ±1px以内の点を返す・長さは単調', () => {
    const p = generateVinePath(5, 900, 100, 60)
    let prevLen = -1
    for (const h of [0, 100, 333, 500, 899]) {
      const pt = pointAtHeight(p, h)
      expect(Math.abs(pt.y - h)).toBeLessThanOrEqual(1)
      const len = lengthAtHeight(p, h)
      expect(len).toBeGreaterThan(prevLen)
      prevLen = len
    }
  })
  it('範囲外は端にクランプ', () => {
    const p = generateVinePath(5, 900, 100, 60)
    expect(pointAtHeight(p, -10).y).toBe(p.samples[0].y)
    expect(pointAtHeight(p, 99_999).y).toBeCloseTo(900, 0)
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/lib/__tests__/vine-path.test.ts`
Expected: FAIL（vine-path が存在しない）

- [ ] **Step 3: 実装**

```ts
// src/lib/vine-path.ts
// 蔓の中心線パスを決定的に生成する純関数。DOMのgetPointAtLengthは使わない
// （SSR/hydrationで死ぬ・ブラウザ差がある・毎回測ると重い）。ベジェを自前サンプリングして
// 「高さ→座標」「高さ→弧長」の対応表を持つ。座標系は地面y=0・上が正（SVG側でscale(1,-1)）。
// yの厳密単調は生成規則で保証する: 各セグメントの制御点yを [prevY, y] の内側に置けば
// 3次ベジェのy(t)は単調になる（導関数が非負の凸結合になるため）。
export type VineSample = { x: number; y: number; len: number }
export type VinePath = { d: string; samples: VineSample[]; totalLen: number }

const SEG_PX = 120        // 節の名目長（アセットの節PNGとおおよそ対応）
const SAMPLES_PER_SEG = 24
const BEND = 0.4          // 制御点をセグメント内に寄せる比率（単調性の要）

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function cubic(p0: number, c1: number, c2: number, p1: number, t: number): number {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * p1
}

export function generateVinePath(seed: number, heightPx: number, baseX: number, amp: number): VinePath {
  const rand = mulberry32(seed)
  const segCount = Math.max(1, Math.ceil(heightPx / SEG_PX))
  let x = baseX
  let y = 0
  let dir = rand() < 0.5 ? 1 : -1
  const samples: VineSample[] = [{ x, y, len: 0 }]
  let d = `M ${x.toFixed(1)} ${y.toFixed(1)}`
  let len = 0
  for (let i = 0; i < segCount; i++) {
    const nextY = Math.min(heightPx, y + SEG_PX)
    const span = nextY - y
    // 左右交互に振る。振れ幅は0.35〜1.0×ampで揺らぎ、常にbaseX±ampに収める。
    const targetX = Math.max(baseX - amp, Math.min(baseX + amp, baseX + dir * (0.35 + 0.65 * rand()) * amp))
    const c1x = x + (targetX - x) * 0.1
    const c1y = y + span * BEND
    const c2x = targetX - (targetX - x) * 0.1
    const c2y = nextY - span * BEND
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${targetX.toFixed(1)} ${nextY.toFixed(1)}`
    let px = x
    let py = y
    for (let s = 1; s <= SAMPLES_PER_SEG; s++) {
      const t = s / SAMPLES_PER_SEG
      const sx = cubic(x, c1x, c2x, targetX, t)
      const sy = cubic(y, c1y, c2y, nextY, t)
      len += Math.hypot(sx - px, sy - py)
      samples.push({ x: sx, y: sy, len })
      px = sx
      py = sy
    }
    x = targetX
    y = nextY
    dir = -dir
  }
  return { d, samples, totalLen: len }
}

// 高さ→サンプル（yが単調なので二分探索）。範囲外は端にクランプ。
export function pointAtHeight(path: VinePath, hPx: number): VineSample {
  const s = path.samples
  if (hPx <= s[0].y) return s[0]
  if (hPx >= s[s.length - 1].y) return s[s.length - 1]
  let lo = 0
  let hi = s.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (s[mid].y <= hPx) lo = mid
    else hi = mid
  }
  const a = s[lo]
  const b = s[hi]
  const t = (hPx - a.y) / (b.y - a.y || 1)
  return { x: a.x + (b.x - a.x) * t, y: hPx, len: a.len + (b.len - a.len) * t }
}

export function lengthAtHeight(path: VinePath, hPx: number): number {
  return pointAtHeight(path, hPx).len
}
```

- [ ] **Step 4: パスを確認**

Run: `npx vitest run src/lib/__tests__/vine-path.test.ts`
Expected: PASS（全件）

- [ ] **Step 5: 仕上げの全体確認とCommit**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 全テストPASS・型エラー0

```bash
git add src/lib/vine-path.ts src/lib/__tests__/vine-path.test.ts
git commit -m "feat(vine): 蔓パスの決定的ジェネレータ（y厳密単調・自前弧長・DOM不使用）"
```

---

## Part 2以降（別プランで作成）

- **Part 2: 画面リフォーム** — VineScreen（シーン描画・背比べ・朱の計測・賛のHTML縦書きオーバーレイ）・リプレイ再生エンジン（フェーズ列・疾書・visibilitychange・reduced-motion）・TowerScreen/TowerStack/TowerCard置換・「要再確認n件」表示の廃止
- **Part 3: 世界の彩り** — 実時間の空・住人と住み着き・見下ろしscroll-snap・節の茂み集約（tower-volumes転用）・アセットマニフェスト＆本番PNG差し替え・フォントサブセット

Part 1完了時点で `npx vitest run` が緑・既存画面の挙動は不変（markSeenの内部改修のみ）であること。
