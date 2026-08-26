# リーダー誌面刷新（SpreadDoc）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プレミアム会員向けアプリ内リーダーに「教科書の誌面」表示を足し、公開済みの記事から1枚ずつ切り替えられるようにする。

**Architecture:** Notion原本を唯一の真実とし、サーバーが原本から SpreadDoc（構造JSON）を組み立てて Supabase に保存する。制作スキルが渡すのは本文ではなく**オーバレイ**（短ラベル・部品の上書き・理解チェック・アイコン）だけで、本文は必ず原本由来になる。読者には公開済み（status=published）の SpreadDoc だけが既存の `/api/subscription/page` 応答に同梱されて届く。SpreadDoc が無い記事は既存の ReaderBody 描画のまま変わらない。

**Tech Stack:** Next.js 16（App Router）／React 18／TypeScript／Tailwind／Supabase（service_role・SQL Editorで手動マイグレーション）／Notion API（@notionhq/client v2）／vitest

## Global Constraints

- 仕様書は `docs/superpowers/specs/2026-08-27-reader-spread-design.md`。本計画と食い違ったら仕様書が正
- **公開リポジトリ**。事業数値・税務・健康・第三者の個人情報をコード・コミット文・コメントに書かない
- テストは `npx vitest run <path>` で走らせる（`npm test` は全件）。テストファイルは `src/lib/__tests__/`
- マイグレーションは自動実行されない。**Supabase の SQL Editor に手で貼って流す**。流したら `supabase/migrations/README.md` の表に印を付ける
- 新規の個人用 localStorage キーは作らない（本計画では不要）
- ダークは `.dark` クラス基準。`@media (prefers-color-scheme)` は使わない
- アイコンに絵文字を使わない。線画SVGをCSSマスクで描く
- 文章・コメントの中でダッシュ「——」を使わない
- `ReaderBlock` に足すキーは必ず optional。既存の IndexedDB・Vercel Data Cache に無いキーだから
- コミットは各タスク末尾で1回。ブランチは `feat/reader-spread`

## 事前準備（タスク開始前に1回）

作業を隔離する。`~/MediNode-本体` の作業ツリーには無関係の未コミット変更（CQ回答通知まわり）が残っているため、そこで実装しない。

```bash
cd ~/MediNode-本体
git worktree add .worktrees/reader-spread -b feat/reader-spread main
cd .worktrees/reader-spread
npm install
```

`vitest.config.ts` は `.worktrees/**` を除外済みなので、worktree 側では worktree 内から `npx vitest run` を叩く。

---

### Task 1: SpreadDoc の型と節への切り分け

**Files:**
- Create: `src/lib/reader-spread.ts`
- Test: `src/lib/__tests__/reader-spread.test.ts`

**Interfaces:**
- Consumes: `ReaderBlock` / `ReaderDoc` / `ReaderInline` / `calloutRole` / `parseSectionHeading` / `sectionAnchor`（すべて `src/lib/reader-doc.ts` の既存エクスポート）
- Produces: `SpreadPart` / `SpreadSection` / `SpreadQuiz` / `SpreadDoc` / `SpreadOverlay` 型、`splitSections(doc: ReaderDoc): SplitResult`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/reader-spread.test.ts` を新規作成する。

```ts
import { describe, it, expect } from 'vitest'
import { splitSections } from '../reader-spread'
import type { ReaderBlock, ReaderDoc } from '../reader-doc'

const t = (text: string) => [{ text }]

const doc: ReaderDoc = {
  title: '酸素はどう使い分ける？',
  icon: null,
  cover: null,
  lastEdited: '2026-08-20T00:00:00.000Z',
  blocks: [
    /* 0 */ { kind: 'callout', icon: '⚡', color: 'yellow_background', blocks: [{ kind: 'paragraph', inlines: t('目標SpO2から決める。') }] },
    /* 1 */ { kind: 'heading', level: 2, inlines: t('1. 最初に決めるのは目標SpO2である') },
    /* 2 */ { kind: 'paragraph', inlines: t('デバイスより先に目標値を決める。') },
    /* 3 */ { kind: 'heading', level: 2, inlines: t('2. 鼻カニューレで開始する') },
    /* 4 */ { kind: 'list_item', ordered: false, inlines: t('2〜6 L/分で開始する。') },
    /* 5 */ { kind: 'callout', icon: '🧑‍⚕️', color: null, blocks: [{ kind: 'paragraph', inlines: t('実際には忍容性を見る。') }] },
  ],
}

describe('splitSections', () => {
  it('⚡結論を lead に、番号つきH2ごとに節を切り、署名は tail に置く', () => {
    const r = splitSections(doc)
    expect(r.lead).toBe(doc.blocks[0])
    expect(r.sections.map((s) => s.n)).toEqual([1, 2])
    expect(r.sections[0].title).toBe('1. 最初に決めるのは目標SpO2である')
    expect(r.sections[0].anchor).toBe('1')
    expect(r.sections[0].blocks).toEqual([doc.blocks[2]])
    expect(r.sections[1].blocks).toEqual([doc.blocks[4]])
    expect(r.tail).toEqual([doc.blocks[5]])
  })

  it('H2の前にある本文は lead にも節にも入らず preface に落ちる', () => {
    const d: ReaderDoc = { ...doc, blocks: [{ kind: 'paragraph', inlines: t('前書き。') }, doc.blocks[1], doc.blocks[2]] }
    const r = splitSections(d)
    expect(r.lead).toBeNull()
    expect(r.preface).toEqual([d.blocks[0]])
    expect(r.sections).toHaveLength(1)
  })
})
```

- [ ] **Step 2: テストを走らせて失敗を確認する**

Run: `npx vitest run src/lib/__tests__/reader-spread.test.ts`
Expected: FAIL（`Failed to resolve import "../reader-spread"`）

- [ ] **Step 3: 実装する**

`src/lib/reader-spread.ts` を新規作成する。

```ts
// アプリ内リーダーの「誌面」表示（TEXTBOOK LITE）のデータ模型。
// 設計: docs/superpowers/specs/2026-08-27-reader-spread-design.md
//
// 本文は必ず Notion原本由来の ReaderBlock をそのまま抱える（生成側が本文を書かない）。
// 表層の部品は原本のブロックから導出し、制作スキルからのオーバレイで上書きできる。
// ここは純関数だけに留めてテスト可能にする（描画は components/reader/spread 側）。
import {
  calloutRole,
  parseSectionHeading,
  sectionAnchor,
  type ReaderBlock,
  type ReaderDoc,
  type ReaderInline,
} from './reader-doc'

// 表層に出す部品。'none' は表層なし（深掘りだけ）を意味する。
export type SpreadPart =
  | { kind: 'comparison' | 'matrix'; rows: ReaderInline[][][] }
  | { kind: 'flow' | 'timeline'; steps: { label: string; inlines: ReaderInline[] }[] }
  | { kind: 'bignumber'; value: string; caption: ReaderInline[] }
  | { kind: 'gonogo'; go: ReaderInline[][]; noGo: ReaderInline[][] }
  | { kind: 'none' }

export type SpreadSection = {
  n: number | null
  anchor: string
  title: string
  shortLabel: string | null
  part: SpreadPart
  deep: ReaderBlock[]
}

export type SpreadQuiz = {
  id: string
  sectionAnchor: string
  question: string
  choices: string[]
  answerIndex: number
  // 根拠となる本文の逐語。原本と一致しなくなったら読者に出さない。
  evidence: string
  // オーナーの目視フラグ。false の間は読者に出さない。
  reviewed: boolean
}

export type SpreadDoc = {
  version: 1
  pageId: string
  title: string
  lead: ReaderBlock | null
  preface: ReaderBlock[]
  sections: SpreadSection[]
  tail: ReaderBlock[]
  quizzes: SpreadQuiz[]
  icons: Record<string, string>
}

// 制作スキルが渡すのはこれだけ。本文は渡さない（サーバーが原本から組む）。
export type SpreadOverlay = {
  shortLabels?: Record<string, string>
  parts?: Record<string, SpreadPart>
  icons?: Record<string, string>
  quizzes?: SpreadQuiz[]
}

export type SplitSection = { n: number | null; anchor: string; title: string; blocks: ReaderBlock[] }
export type SplitResult = {
  lead: ReaderBlock | null
  preface: ReaderBlock[]
  sections: SplitSection[]
  tail: ReaderBlock[]
}

export function textOf(inlines: ReaderInline[]): string {
  return inlines.map((i) => i.text).join('')
}

// 節に属さない末尾ブロック。署名・査読スタンプ・参考文献・免責は記事末にまとめる。
const TAIL_ROLES = new Set(['signature', 'stamp', 'evidence', 'disclaimer'])

function isTailBlock(b: ReaderBlock): boolean {
  return b.kind === 'callout' && TAIL_ROLES.has(calloutRole(b.icon))
}

/**
 * ReaderDoc を「⚡結論（lead）／H2前の本文（preface）／H2ごとの節／末尾（tail）」に切る。
 *
 * 節の区切りは既存の目次（tocSections）と同じ heading level 2。アンカーも
 * sectionAnchor を使い、横断検索の節ジャンプ（data-section）と一致させる。
 */
export function splitSections(doc: ReaderDoc): SplitResult {
  let lead: ReaderBlock | null = null
  const preface: ReaderBlock[] = []
  const sections: SplitSection[] = []
  const tail: ReaderBlock[] = []
  let current: SplitSection | null = null

  doc.blocks.forEach((b, index) => {
    if (b.kind === 'callout' && calloutRole(b.icon) === 'conclusion' && !lead && !current) {
      lead = b
      return
    }
    if (isTailBlock(b)) {
      tail.push(b)
      return
    }
    if (b.kind === 'heading' && b.level === 2) {
      const title = textOf(b.inlines)
      const parsed = parseSectionHeading(b.inlines)
      // アンカーは sectionAnchor の戻り値をそのまま使う（番号つきなら "1"、番号なしなら "iN"）。
      // 接頭辞を付けたり別の採番にしたりしないこと。ReaderOverlay の節ジャンプが
      // [data-section="${sectionNo}"]（Algolia の節番号）で引くので、値がずれると
      // 横断検索からの節ジャンプが無言で外れる。
      current = { n: parsed?.n ?? null, anchor: sectionAnchor(parsed?.n ?? null, index), title, blocks: [] }
      sections.push(current)
      return
    }
    if (current) current.blocks.push(b)
    else preface.push(b)
  })

  return { lead, preface, sections, tail }
}
```

- [ ] **Step 4: テストを走らせて通ることを確認する**

Run: `npx vitest run src/lib/__tests__/reader-spread.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 5: コミット**

```bash
git add src/lib/reader-spread.ts src/lib/__tests__/reader-spread.test.ts
git commit -m "feat: 誌面のデータ模型と節への切り分け（純関数）"
```

---

### Task 2: 部品の自動分類と下書き生成

**Files:**
- Modify: `src/lib/reader-spread.ts`
- Test: `src/lib/__tests__/reader-spread.test.ts`

**Interfaces:**
- Consumes: Task 1 の `splitSections` / `SplitSection` / `SpreadPart` / `SpreadDoc`
- Produces: `classifyPart(blocks: ReaderBlock[]): SpreadPart`、`buildSpreadDraft(doc: ReaderDoc, pageId: string): SpreadDoc`

分類は控えめにする。表があれば比較表、番号つき箇条書きが3つ以上なら判断フロー、それ以外は表層なし。凝った推定はしない。細かい指定は制作スキルのオーバレイが担う。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/reader-spread.test.ts` の末尾に追記する。冒頭の import を差し替える。

```ts
import { splitSections, classifyPart, buildSpreadDraft } from '../reader-spread'
```

```ts
describe('classifyPart', () => {
  it('表ブロックがあれば比較表になる', () => {
    const rows = [[[{ text: 'デバイス' }], [{ text: '流量' }]], [[{ text: '鼻カニューレ' }], [{ text: '2〜6 L/分' }]]]
    const part = classifyPart([{ kind: 'table', rows }])
    expect(part).toEqual({ kind: 'comparison', rows })
  })

  it('番号つき箇条書きが3つ以上なら判断フローになる', () => {
    const blocks: ReaderBlock[] = [
      { kind: 'list_item', ordered: true, inlines: t('目標SpO2を決める') },
      { kind: 'list_item', ordered: true, inlines: t('デバイスを選ぶ') },
      { kind: 'list_item', ordered: true, inlines: t('反応を見て替える') },
    ]
    const part = classifyPart(blocks)
    expect(part.kind).toBe('flow')
    expect(part.kind === 'flow' && part.steps.map((s) => s.label)).toEqual(['1', '2', '3'])
  })

  it('該当しなければ表層なし', () => {
    expect(classifyPart([{ kind: 'paragraph', inlines: t('ただの段落。') }])).toEqual({ kind: 'none' })
  })
})

describe('buildSpreadDraft', () => {
  it('節ごとに部品と深掘りを持つ下書きを組む', () => {
    const d = buildSpreadDraft(doc, 'page-1')
    expect(d.version).toBe(1)
    expect(d.pageId).toBe('page-1')
    expect(d.title).toBe('酸素はどう使い分ける？')
    expect(d.lead).toBe(doc.blocks[0])
    expect(d.sections).toHaveLength(2)
    expect(d.sections[0].deep).toEqual([doc.blocks[2]])
    expect(d.sections[0].part).toEqual({ kind: 'none' })
    expect(d.sections[0].shortLabel).toBeNull()
    expect(d.quizzes).toEqual([])
    expect(d.tail).toEqual([doc.blocks[5]])
  })
})
```

- [ ] **Step 2: テストを走らせて失敗を確認する**

Run: `npx vitest run src/lib/__tests__/reader-spread.test.ts`
Expected: FAIL（`classifyPart is not a function`）

- [ ] **Step 3: 実装する**

`src/lib/reader-spread.ts` の末尾に追記する。

```ts
const MIN_FLOW_STEPS = 3

/**
 * 節のブロックから表層部品を推定する。
 *
 * 推定は控えめにする。医学的な意味づけ（この表は分類マトリクスか比較表か等）は
 * 機械には決められないので、迷ったら 'none'（表層なし）に倒し、
 * 制作スキルのオーバレイで明示的に上書きしてもらう。
 */
export function classifyPart(blocks: ReaderBlock[]): SpreadPart {
  const table = blocks.find((b) => b.kind === 'table')
  if (table && table.kind === 'table') return { kind: 'comparison', rows: table.rows }

  const ordered = blocks.filter((b) => b.kind === 'list_item' && b.ordered)
  if (ordered.length >= MIN_FLOW_STEPS) {
    return {
      kind: 'flow',
      steps: ordered.map((b, i) => ({
        label: String(i + 1),
        inlines: b.kind === 'list_item' ? b.inlines : [],
      })),
    }
  }
  return { kind: 'none' }
}

/**
 * 原本の ReaderDoc から SpreadDoc の下書きを組む。
 * 本文（deep）は原本のブロックをそのまま持つので、この時点で逐語一致は保証される。
 */
export function buildSpreadDraft(doc: ReaderDoc, pageId: string): SpreadDoc {
  const split = splitSections(doc)
  return {
    version: 1,
    pageId,
    title: doc.title,
    lead: split.lead,
    preface: split.preface,
    sections: split.sections.map((s) => ({
      n: s.n,
      anchor: s.anchor,
      title: s.title,
      shortLabel: null,
      part: classifyPart(s.blocks),
      deep: s.blocks,
    })),
    tail: split.tail,
    quizzes: [],
    icons: {},
  }
}
```

- [ ] **Step 4: テストを走らせて通ることを確認する**

Run: `npx vitest run src/lib/__tests__/reader-spread.test.ts`
Expected: PASS（6 tests）

- [ ] **Step 5: コミット**

```bash
git add src/lib/reader-spread.ts src/lib/__tests__/reader-spread.test.ts
git commit -m "feat: 節の部品推定と誌面下書きの生成"
```

---

### Task 3: オーバレイの適用と逐語一致検査

**Files:**
- Modify: `src/lib/reader-spread.ts`
- Test: `src/lib/__tests__/reader-spread.test.ts`

**Interfaces:**
- Consumes: Task 2 の `buildSpreadDraft` / `SpreadOverlay` / `SpreadDoc`
- Produces: `applyOverlay(draft: SpreadDoc, overlay: SpreadOverlay): SpreadDoc`、`verifyVerbatim(spread: SpreadDoc, doc: ReaderDoc): { ok: boolean; missing: string[] }`

オーバレイが入れるテキスト（部品の上書き・理解チェックの根拠）は原本に無い文かもしれない。だから適用後に必ず検査する。検査は「原本の全文の中に、その文字列がそのまま含まれるか」で判定する。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/reader-spread.test.ts` の末尾に追記する。冒頭の import を差し替える。

```ts
import { splitSections, classifyPart, buildSpreadDraft, applyOverlay, verifyVerbatim } from '../reader-spread'
```

```ts
describe('applyOverlay / verifyVerbatim', () => {
  it('短ラベル・部品・理解チェックを重ねる', () => {
    const draft = buildSpreadDraft(doc, 'page-1')
    const merged = applyOverlay(draft, {
      shortLabels: { '1': '目標SpO2' },
      parts: { '1': { kind: 'bignumber', value: '94%', caption: [{ text: 'デバイスより先に目標値を決める。' }] } },
      icons: { '1': 'target' },
      quizzes: [{ id: 'q1', sectionAnchor: '1', question: '先に決めるのは？', choices: ['目標SpO2', 'デバイス'], answerIndex: 0, evidence: 'デバイスより先に目標値を決める。', reviewed: false }],
    })
    expect(merged.sections[0].shortLabel).toBe('目標SpO2')
    expect(merged.sections[0].part.kind).toBe('bignumber')
    expect(merged.icons).toEqual({ '1': 'target' })
    expect(merged.quizzes).toHaveLength(1)
    // 深掘り本文はオーバレイでは触れない
    expect(merged.sections[0].deep).toEqual(draft.sections[0].deep)
  })

  it('原本に無い文が混ざったら検査で落ちる', () => {
    const draft = buildSpreadDraft(doc, 'page-1')
    const bad = applyOverlay(draft, {
      parts: { '1': { kind: 'bignumber', value: '94%', caption: [{ text: '目標は常に98%以上にする。' }] } },
    })
    const r = verifyVerbatim(bad, doc)
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('目標は常に98%以上にする。')
  })

  it('原本の逐語だけなら検査を通る', () => {
    const draft = buildSpreadDraft(doc, 'page-1')
    const good = applyOverlay(draft, {
      quizzes: [{ id: 'q1', sectionAnchor: '1', question: '先に決めるのは？', choices: ['目標SpO2', 'デバイス'], answerIndex: 0, evidence: 'デバイスより先に目標値を決める。', reviewed: true }],
    })
    expect(verifyVerbatim(good, doc)).toEqual({ ok: true, missing: [] })
  })

  it('短ラベルは検査の対象にしない（原本に無くてよい）', () => {
    const draft = buildSpreadDraft(doc, 'page-1')
    const merged = applyOverlay(draft, { shortLabels: { '1': '目標SpO2' } })
    expect(verifyVerbatim(merged, doc).ok).toBe(true)
  })
})
```

- [ ] **Step 2: テストを走らせて失敗を確認する**

Run: `npx vitest run src/lib/__tests__/reader-spread.test.ts`
Expected: FAIL（`applyOverlay is not a function`）

- [ ] **Step 3: 実装する**

`src/lib/reader-spread.ts` の末尾に追記する。

```ts
/**
 * 制作スキルからのオーバレイを下書きに重ねる。
 * 本文（deep / lead / preface / tail）には一切触れない。触れさせないことが安全装置になる。
 */
export function applyOverlay(draft: SpreadDoc, overlay: SpreadOverlay): SpreadDoc {
  return {
    ...draft,
    sections: draft.sections.map((s) => ({
      ...s,
      shortLabel: overlay.shortLabels?.[s.anchor] ?? s.shortLabel,
      part: overlay.parts?.[s.anchor] ?? s.part,
    })),
    icons: { ...draft.icons, ...(overlay.icons ?? {}) },
    quizzes: overlay.quizzes ?? draft.quizzes,
  }
}

// 部品と理解チェックが持つ「原本に由来するはずの文」を集める。
// 短ラベルは目次チップ用の呼び名で原本には無くてよいので、対象に入れない。
function verbatimTargets(spread: SpreadDoc): string[] {
  const out: string[] = []
  for (const s of spread.sections) {
    const p = s.part
    if (p.kind === 'comparison' || p.kind === 'matrix') {
      for (const row of p.rows) for (const cell of row) out.push(textOf(cell))
    } else if (p.kind === 'flow' || p.kind === 'timeline') {
      for (const step of p.steps) out.push(textOf(step.inlines))
    } else if (p.kind === 'bignumber') {
      out.push(p.value, textOf(p.caption))
    } else if (p.kind === 'gonogo') {
      for (const line of [...p.go, ...p.noGo]) out.push(textOf(line))
    }
  }
  for (const q of spread.quizzes) out.push(q.evidence)
  return out.map((s) => s.trim()).filter(Boolean)
}

// 原本の全文（ブロックを跨いだ連結ではなく、ブロックごとの文字列の集合）。
function corpusOf(doc: ReaderDoc): string {
  const parts: string[] = []
  const walk = (blocks: ReaderBlock[]) => {
    for (const b of blocks) {
      if (b.kind === 'heading' || b.kind === 'paragraph' || b.kind === 'list_item') parts.push(textOf(b.inlines))
      else if (b.kind === 'callout') walk(b.blocks)
      else if (b.kind === 'table') for (const row of b.rows) for (const cell of row) parts.push(textOf(cell))
      else if (b.kind === 'image' && b.caption) parts.push(b.caption)
    }
  }
  walk(doc.blocks)
  // 改行と連続空白の揺れを吸収する。文字を落とす正規化はしない（別物を同一視しないため）。
  return parts.join('\n').replace(/[ \t]+/g, ' ')
}

/**
 * 誌面が原本の逐語だけでできているかを検査する。
 * 落ちたら投入を拒否する。生成側が本文を書き換えたことを意味するため。
 */
export function verifyVerbatim(spread: SpreadDoc, doc: ReaderDoc): { ok: boolean; missing: string[] } {
  const corpus = corpusOf(doc)
  const missing = verbatimTargets(spread)
    .filter((s) => !corpus.includes(s.replace(/[ \t]+/g, ' ')))
  return { ok: missing.length === 0, missing }
}
```

- [ ] **Step 4: テストを走らせて通ることを確認する**

Run: `npx vitest run src/lib/__tests__/reader-spread.test.ts`
Expected: PASS（10 tests）

- [ ] **Step 5: コミット**

```bash
git add src/lib/reader-spread.ts src/lib/__tests__/reader-spread.test.ts
git commit -m "feat: オーバレイ適用と逐語一致検査"
```

---

### Task 4: 全ブロックに blockId を透過させる

**Files:**
- Modify: `src/lib/reader-doc.ts:5-15`（`ReaderBlock` 型）, `src/lib/reader-doc.ts:92-136`（`mapBlocks`）
- Test: `src/lib/__tests__/reader-doc.test.ts`

**Interfaces:**
- Produces: すべての `ReaderBlock` が `blockId?: string` を持つ（後の編集レイヤーが使う。本計画では持たせるだけ）

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/reader-doc.test.ts` の末尾に追記する。

```ts
import { mapBlocks } from '../reader-doc'

describe('mapBlocks の blockId', () => {
  it('段落・見出し・箇条書きに Notion のブロックIDを載せる', () => {
    const raw = [
      { id: 'b1', type: 'heading_2', heading_2: { rich_text: [{ plain_text: '1. 見出し' }] } },
      { id: 'b2', type: 'paragraph', paragraph: { rich_text: [{ plain_text: '本文。' }] } },
    ]
    const blocks = mapBlocks(raw as never)
    expect(blocks[0].blockId).toBe('b1')
    expect(blocks[1].blockId).toBe('b2')
  })

  it('IDが無い入力でも落ちない（blockId は undefined）', () => {
    const blocks = mapBlocks([{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'x' }] } }] as never)
    expect(blocks[0].blockId).toBeUndefined()
  })
})
```

- [ ] **Step 2: テストを走らせて失敗を確認する**

Run: `npx vitest run src/lib/__tests__/reader-doc.test.ts`
Expected: FAIL（`blockId` が undefined、または型エラー）

- [ ] **Step 3: 実装する**

`src/lib/reader-doc.ts` の `ReaderBlock` 定義（5行目付近）を、共通キーを持つ形に書き換える。

```ts
// blockId は Notion のブロックID。編集レイヤー（誌面からの書き戻し）と
// 個人・部署リーダーのプレースホルダが使う。
// 既存の IndexedDB・Vercel Data Cache に保存された doc には無いキーなので、
// 常に optional として扱うこと（欠けていても描画は成立する）。
type BlockBase = { blockId?: string }

export type ReaderBlock = BlockBase & (
  | { kind: 'heading'; level: 1 | 2 | 3; inlines: ReaderInline[] }
  | { kind: 'paragraph'; inlines: ReaderInline[] }
  | { kind: 'list_item'; ordered: boolean; inlines: ReaderInline[] }
  | { kind: 'callout'; icon: string | null; color: string | null; blocks: ReaderBlock[] }
  | { kind: 'image'; url: string; caption: string | null }
  | { kind: 'divider' }
  | { kind: 'table'; rows: ReaderInline[][][] }
  | { kind: 'unsupported'; text: string; blockType?: string }
)
```

`mapBlocks`（92行目）の `for` ループを直す。各 `case` に `blockId` を散らすと足し忘れるので、1箇所でまとめて載せる。すべての `case` はちょうど1個を `out` に push しているので、この方法で漏れなく付く。

`for (const b of blocks || []) {` の直後に2行足す。

```ts
    // この b が押すブロックの位置を控えておき、switch のあとでIDを載せる
    // （各 case に散らすと、あとで case を足したときに足し忘れる）。
    const start = out.length
    const blockId = b.id ? String(b.id) : undefined
```

`switch` の閉じ括弧の直後、`if (b.children?.length && ...)` の直前に足す。

```ts
    if (blockId && out.length > start) out[start] = { ...out[start], blockId }
```

`default:` の push から `blockId` の重複指定を削る（型定義から `unsupported` 固有のキーではなくなったため）。`blockType` はそのまま残す。

```ts
      default:
        out.push({ kind: 'unsupported', text: `[未対応ブロック: ${b.type}]`, blockType: b.type })
```

- [ ] **Step 4: 🎨 の制作メモを読者から隠す**

同じファイルの `calloutRole`（185行目）に1行足す。制作メモの callout が `plain` に落ちて読者に見えている既知の不具合の対処。

```ts
  if (icon.includes('🎨')) return 'draft' // 制作メモ（画像作成中など）。読者には出さない
```

`CalloutRole` の union（182行目）に `'draft'` を足す。

```ts
export type CalloutRole = 'conclusion' | 'signature' | 'stamp' | 'evidence' | 'disclaimer' | 'note' | 'draft' | 'plain'
```

`ReaderBody.tsx` の callout 描画で `calloutRole(block.icon) === 'draft'` のとき `return null` する。

Run: `grep -n "calloutRole" src/components/reader/ReaderBody.tsx` で描画箇所を特定してから直す。

- [ ] **Step 5: テストを走らせて通ることを確認する**

Run: `npx vitest run src/lib/__tests__/reader-doc.test.ts`
Expected: PASS

- [ ] **Step 6: 型チェックを通す**

Run: `npx tsc --noEmit`
Expected: エラーなし（`unsupported` の `blockId` を型定義から外したので、参照側が壊れていないか確認する）

- [ ] **Step 7: コミット**

```bash
git add src/lib/reader-doc.ts src/components/reader/ReaderBody.tsx src/lib/__tests__/reader-doc.test.ts
git commit -m "feat: 全ReaderBlockにblockIdを透過し、制作メモcalloutを隠す"
```

---

### Task 5: 同期が表ブロックを読めるようにする

**Files:**
- Modify: `src/lib/content-stats.ts:13-17`（`blockText`）
- Modify: `src/app/api/subscription/sync/_core.ts:88-105`（`fetchPageBlocks`）
- Test: `src/lib/__tests__/content-stats.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `blockText` が `table_row` のセルを読む。同期が取得するブロック配列に `table_row` が平坦に含まれる

これは**酸素療法の改稿より先に本番へ出す必要がある**。今のままだと、箇条書きを表に直した瞬間その本文が全文検索から消え、本文文字数（約N分表示）も減る。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/content-stats.test.ts` に追記する（ファイルが無ければ新規作成する）。

```ts
import { describe, it, expect } from 'vitest'
import { blockText, computeContentStats } from '../content-stats'

describe('blockText の表対応', () => {
  it('table_row のセルを空白区切りで読む', () => {
    const row = {
      type: 'table_row',
      table_row: { cells: [[{ plain_text: '鼻カニューレ' }], [{ plain_text: '2〜6 L/分' }]] },
    }
    expect(blockText(row)).toBe('鼻カニューレ 2〜6 L/分')
  })

  it('table 本体（セルを持たない）は空文字のまま', () => {
    expect(blockText({ type: 'table', table: { table_width: 2 } })).toBe('')
  })

  it('表の文字数が本文文字数に加算される', () => {
    const blocks = [
      { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'あいう' }] } },
      { type: 'table', table: { table_width: 2 } },
      { type: 'table_row', table_row: { cells: [[{ plain_text: 'かき' }], [{ plain_text: 'くけ' }]] } },
    ]
    expect(computeContentStats(blocks).contentChars).toBe(3 + 'かき くけ'.length)
  })
})
```

- [ ] **Step 2: テストを走らせて失敗を確認する**

Run: `npx vitest run src/lib/__tests__/content-stats.test.ts`
Expected: FAIL（`blockText` が空文字を返す）

- [ ] **Step 3: `blockText` を直す**

`src/lib/content-stats.ts` の `blockText` を差し替える。

```ts
export function blockText(block: NotionBlockLite): string {
  // 表の中身は table_row の cells にある（rich_text ではない）。
  // ここを読まないと、本文を表に書き直した瞬間その文が検索と文字数から消える。
  if (block.type === 'table_row') {
    const cells = (block.table_row as { cells?: Array<Array<{ plain_text?: string }>> } | undefined)?.cells
    if (!Array.isArray(cells)) return ''
    return cells.map((cell) => cell.map((t) => t.plain_text || '').join('')).join(' ')
  }
  const payload = block[block.type] as { rich_text?: Array<{ plain_text?: string }> } | undefined
  if (!payload || !Array.isArray(payload.rich_text)) return ''
  return payload.rich_text.map((t) => t.plain_text || '').join('')
}
```

- [ ] **Step 4: 同期が table_row を取りに行くようにする**

`src/app/api/subscription/sync/_core.ts` の `fetchPageBlocks` を差し替える。

```ts
// 表の子（table_row）を取りに行く回数の上限。1ページに表が大量にある想定はしないが、
// 同期全体を止めないための保険として置く（cloze-sync の展開上限と同じ考え方）。
const MAX_TABLE_EXPANDS = 8

// 1つの表につき table_row を取りに行くページ数の上限（1ページ100行 × 5 = 最大500行）。
// 上限なしにページネーションすると、巨大な表1つで同期コストが青天井になり得るため、
// 実務上まず超えない行数で頭打ちにする。超えた分は取りこぼすが、同期全体は止めない。
const MAX_TABLE_ROW_PAGES = 5

// ページ本文（トップレベルブロック）を全ページネーションで取得する。
// 失敗してもページ全体の同期は止めない（nullで続行）。統計と節分割の両方がこれを使う。
//
// 表だけは子（table_row）に中身があるため、平坦な配列に展開して混ぜる。
// 展開しないと、表に書いた本文が検索スニペットにも本文文字数にも載らない。
async function fetchPageBlocks(notion: Client, pageId: string): Promise<NotionBlockLite[] | null> {
  try {
    const blocks: NotionBlockLite[] = []
    let cursor: string | undefined = undefined
    do {
      const res = await notion.blocks.children.list({
        block_id: pageId,
        page_size: 100,
        start_cursor: cursor,
      })
      blocks.push(...(res.results as unknown as NotionBlockLite[]))
      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
    } while (cursor)

    const out: NotionBlockLite[] = []
    let expands = 0
    for (const b of blocks) {
      out.push(b)
      if (b.type !== 'table' || expands >= MAX_TABLE_EXPANDS) continue
      expands++
      try {
        // トップレベルと同じくページネーションする。1回だけの取得にすると
        // 100行を超える表の後半が黙って落ち、この修正の目的（表に書いた本文を
        // 検索に載せる）が果たせない。
        const tableId = (b as unknown as { id: string }).id
        let rowCursor: string | undefined = undefined
        let rowPage = 0
        do {
          const rows = await notion.blocks.children.list({
            block_id: tableId,
            page_size: 100,
            start_cursor: rowCursor,
          })
          out.push(...(rows.results as unknown as NotionBlockLite[]))
          rowPage++
          rowCursor = rows.has_more && rowPage < MAX_TABLE_ROW_PAGES ? (rows.next_cursor ?? undefined) : undefined
        } while (rowCursor)
      } catch {
        // 表の中身が取れなくても、そのページの同期自体は続ける。
      }
    }
    return out
  } catch {
    return null
  }
}
```

- [ ] **Step 5: テストを走らせて通ることを確認する**

Run: `npx vitest run src/lib/__tests__/content-stats.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 6: 全テストと型チェック**

Run: `npm test && npx tsc --noEmit`
Expected: すべて PASS・型エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/lib/content-stats.ts src/app/api/subscription/sync/_core.ts src/lib/__tests__/content-stats.test.ts
git commit -m "feat: 同期が表ブロックの中身を読むようにする"
```

---

### Task 6: 保存テーブル（migration 0026）

**Files:**
- Create: `supabase/migrations/0026_reader_spreads.sql`
- Modify: `supabase/migrations/README.md`（適用状況の表）

**Interfaces:**
- Produces: `public.reader_spreads` テーブル（`page_id` PK・`spread_doc` jsonb・`overlay` jsonb・`source_last_edited`・`status`・`verified_at`・`updated_at`）

- [ ] **Step 1: 既存の適用状況を確認する**

README の表は 0023 までしか記録が無い。0024（トップレベル `migrations/0024_user_occupation.sql`）と 0025 が本番に流れているかを Supabase の SQL Editor で確かめる。

```sql
select table_name from information_schema.tables
where table_schema = 'public' and table_name in ('block_type_stats', 'profiles');
```

`block_type_stats` が無ければ 0025 が未適用。先に 0025 を流してから 0026 に進む。

- [ ] **Step 2: マイグレーションを書く**

`supabase/migrations/0026_reader_spreads.sql` を新規作成する。

```sql
-- MediNode アプリ内リーダーの「誌面」（TEXTBOOK LITE）の保存先。
-- 設計: docs/superpowers/specs/2026-08-27-reader-spread-design.md
--
-- Notion原本が唯一の真実で、この表はその「公開スナップショット」を持つ。
-- 原本を直しても、再生成して published にするまで読者には届かない（公開制御）。
-- 読み書きともサーバー（service_role）のみ＝ポリシーなし（cq_views と同じ方針）。

create table if not exists public.reader_spreads (
  -- NotionのページID（ハイフンあり・なしを混ぜないこと。投入側で正規化する）
  page_id text primary key,
  -- 組み上がった誌面（SpreadDoc）。本文は原本由来のブロックをそのまま持つ
  spread_doc jsonb not null,
  -- 制作スキルが渡した上書き（短ラベル・部品・理解チェック・アイコン）。
  -- 原本が更新されたとき、これを再適用するだけで誌面を作り直せる
  overlay jsonb not null default '{}'::jsonb,
  -- 生成時点の原本の最終更新。原本がこれより新しければ再生成が要る
  source_last_edited timestamptz,
  -- draft: 作ったが読者には出さない / published: 読者に出す
  status text not null default 'draft',
  -- 逐語一致検査を通した時刻
  verified_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.reader_spreads enable row level security;

-- 配信は「公開済みのものを page_id で1件引く」だけなので主キーで足りる。
-- /admin の一覧（未公開・再生成待ちの棚卸し）のために status を引けるようにする。
create index if not exists reader_spreads_status_idx on public.reader_spreads (status);
```

- [ ] **Step 3: SQL Editor で流す**

https://supabase.com/dashboard/project/_/sql/new に貼って実行する。

- [ ] **Step 4: 流れたことを確認する**

```sql
select column_name, data_type from information_schema.columns
where table_schema = 'public' and table_name = 'reader_spreads' order by ordinal_position;
```

Expected: `page_id / spread_doc / overlay / source_last_edited / status / verified_at / updated_at` の7列

- [ ] **Step 5: README の台帳を更新する**

`supabase/migrations/README.md` の表の末尾に、Step 1 で確認した 0024・0025 の実状と 0026 を追記する。

```markdown
| 0024 | user_occupation（トップレベル migrations/） | `profiles.occupation` | ✅ |
| 0025 | personal_reader_metrics | `block_type_stats`, `record_block_type_counts()` | ✅ |
| 0026 | reader_spreads | `reader_spreads` | ✅ |
```

見出しの日付は `2026-08-27 時点` に**書き換えないこと**。0024 以降を本番DBで実測していないのに実測日を更新すると、台帳が嘘になる。
「2026-08-03 時点の記録 + 2026-08-27 以降は未確認」のように、確認済みの範囲が読み取れる形にする。
0026 は新規なので `⏳ 未適用`、0024・0025 は実測していないので `❓ 未確認` と書く。適用を確認できたら ✅ に直す。

- [ ] **Step 6: コミット**

```bash
git add supabase/migrations/0026_reader_spreads.sql supabase/migrations/README.md
git commit -m "feat: 誌面の保存テーブル（reader_spreads）"
```

---

### Task 7: 投入API（PUT /api/admin/spread）

**Files:**
- Create: `src/app/api/admin/spread/route.ts`
- Modify: `src/lib/admin-audit.ts:4-17`（`AdminAction` の union）
- Test: `src/lib/__tests__/admin-spread-route.test.ts`

**Interfaces:**
- Consumes: `requireAdmin()`（`{ok:true,email} | {ok:false,response}`）／`logAdminAction(admin, {actorEmail, action, detail})`／`createAdminClient()`（`@/lib/supabase/server`）／`fetchPageBlocks`（`@/lib/notion-page`）／`mapBlocksToReaderDoc`／Task 2-3 の `buildSpreadDraft` / `applyOverlay` / `verifyVerbatim`／`revalidateSubscriptionReaderDocs()`（`@/lib/reader-cache`）
- Produces: `PUT /api/admin/spread`（body: `{ pageId: string; overlay?: SpreadOverlay; publish?: boolean }`）／`GET /api/admin/spread`（一覧）

**本文はサーバーが原本から組む。** クライアントから本文を受け取らない。これで画像の署名URL（約1時間で失効）が誌面に混ざる事故も同時に防げる。`mapBlocksToReaderDoc(page, blocks, pageId)` に pageId を渡すと画像が安定プロキシURLになる。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/admin-spread-route.test.ts` を新規作成する。

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const requireAdmin = vi.fn()
const upsert = vi.fn()
const notionRetrieve = vi.fn()

vi.mock('@/lib/admin-guard', () => ({ requireAdmin: () => requireAdmin() }))
vi.mock('@/lib/admin-audit', () => ({ logAdminAction: vi.fn() }))
vi.mock('@/lib/reader-cache', () => ({ revalidateSubscriptionReaderDocs: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({
  createAdminClient: () => ({ from: () => ({ upsert, select: () => ({ order: () => ({ data: [], error: null }) }) }) }),
}))
vi.mock('@/lib/notion-page', () => ({
  fetchPageBlocks: async () => [
    { id: 'b1', type: 'heading_2', heading_2: { rich_text: [{ plain_text: '1. 見出し' }] } },
    { id: 'b2', type: 'paragraph', paragraph: { rich_text: [{ plain_text: '本文。' }] } },
  ],
}))
vi.mock('@notionhq/client', () => ({
  Client: class { pages = { retrieve: (...a: unknown[]) => notionRetrieve(...a) } },
}))

const { PUT } = await import('../../app/api/admin/spread/route')

const req = (body: unknown) =>
  new Request('http://localhost/api/admin/spread', { method: 'PUT', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  process.env.SUBSCRIPTION_NOTION_TOKEN = 'tok'
  requireAdmin.mockResolvedValue({ ok: true, email: 'owner@example.com' })
  notionRetrieve.mockResolvedValue({ last_edited_time: '2026-08-20T00:00:00.000Z', properties: {} })
  upsert.mockResolvedValue({ error: null })
})

describe('PUT /api/admin/spread', () => {
  it('管理者でなければ弾く', async () => {
    const { NextResponse } = await import('next/server')
    requireAdmin.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) })
    const res = await PUT(req({ pageId: 'p1' }))
    expect(res.status).toBe(403)
  })

  it('原本から誌面を組んで保存する', async () => {
    const res = await PUT(req({ pageId: 'p1' }))
    expect(res.status).toBe(200)
    const saved = upsert.mock.calls[0][0]
    expect(saved.page_id).toBe('p1')
    expect(saved.status).toBe('draft')
    expect(saved.spread_doc.sections).toHaveLength(1)
    expect(saved.source_last_edited).toBe('2026-08-20T00:00:00.000Z')
  })

  it('publish: true なら公開状態で保存する', async () => {
    await PUT(req({ pageId: 'p1', publish: true }))
    expect(upsert.mock.calls[0][0].status).toBe('published')
  })

  it('原本に無い文を含むオーバレイは400で拒否する', async () => {
    const res = await PUT(req({
      pageId: 'p1',
      overlay: { parts: { '1': { kind: 'bignumber', value: '99%', caption: [{ text: '原本に無い文。' }] } } },
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('verbatim_mismatch')
    expect(body.missing).toContain('原本に無い文。')
    expect(upsert).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: テストを走らせて失敗を確認する**

Run: `npx vitest run src/lib/__tests__/admin-spread-route.test.ts`
Expected: FAIL（`Failed to resolve import`）

- [ ] **Step 3: AdminAction に種別を足す**

`src/lib/admin-audit.ts` の `AdminAction` union に2つ追加する。

```ts
  | 'put_spread'
  | 'publish_spread'
```

- [ ] **Step 4: ルートを実装する**

`src/app/api/admin/spread/route.ts` を新規作成する。

```ts
import { NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { requireAdmin } from '@/lib/admin-guard'
import { logAdminAction } from '@/lib/admin-audit'
import { createAdminClient } from '@/lib/supabase/server'
import { fetchPageBlocks } from '@/lib/notion-page'
import { mapBlocksToReaderDoc } from '@/lib/reader-doc'
import { revalidateSubscriptionReaderDocs } from '@/lib/reader-cache'
import { applyOverlay, buildSpreadDraft, verifyVerbatim, type SpreadOverlay } from '@/lib/reader-spread'

/**
 * 誌面（SpreadDoc）の投入。オーナー専用。
 *
 * 本文はクライアントから受け取らない。サーバーがNotion原本を読んで組み立て、
 * 制作スキルから渡されるのは上書き（短ラベル・部品・理解チェック・アイコン）だけにする。
 * こうすると (1) 本文の逐語一致が構造上保証され、(2) Notionの署名URL（約1時間で失効）が
 * 誌面に焼き付く事故も起きない（mapBlocksToReaderDoc に pageId を渡すと
 * 画像が /api/subscription/image の安定プロキシURLになる）。
 */
export async function PUT(req: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body: { pageId?: string; overlay?: SpreadOverlay; publish?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 })
  }
  const pageId = (body.pageId || '').replace(/^subscription_/, '').replace(/#.*$/, '').trim()
  if (!pageId) return NextResponse.json({ error: 'missing pageId' }, { status: 400 })

  const token = process.env.SUBSCRIPTION_NOTION_TOKEN
  if (!token) return NextResponse.json({ error: 'not configured' }, { status: 500 })

  let doc
  let lastEdited: string | null = null
  try {
    const notion = new Client({ auth: token })
    const page = await notion.pages.retrieve({ page_id: pageId })
    const blocks = await fetchPageBlocks(notion, pageId)
    doc = mapBlocksToReaderDoc(page as Parameters<typeof mapBlocksToReaderDoc>[0], blocks, pageId)
    lastEdited = (page as { last_edited_time?: string }).last_edited_time ?? null
  } catch {
    return NextResponse.json({ error: 'notion_fetch_failed' }, { status: 502 })
  }

  const overlay = body.overlay ?? {}
  const spread = applyOverlay(buildSpreadDraft(doc, pageId), overlay)
  const check = verifyVerbatim(spread, doc)
  if (!check.ok) {
    // 生成側が本文を書き換えた、または原本が変わった。どちらも投入させない。
    return NextResponse.json({ error: 'verbatim_mismatch', missing: check.missing }, { status: 400 })
  }

  const admin = createAdminClient()
  const status = body.publish ? 'published' : 'draft'
  const { error } = await admin.from('reader_spreads').upsert({
    page_id: pageId,
    spread_doc: spread,
    overlay,
    source_last_edited: lastEdited,
    status,
    verified_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })
  if (error) return NextResponse.json({ error: 'save_failed' }, { status: 500 })

  await logAdminAction(admin, {
    actorEmail: auth.email,
    action: body.publish ? 'publish_spread' : 'put_spread',
    // admin_audit_log.target_user_id は uuid 型なので、page_id は detail に入れる。
    detail: { pageId, sections: spread.sections.length, quizzes: spread.quizzes.length },
  })

  // 誌面は /api/subscription/page の応答に同梱するので、本文と同じタグで失効させる。
  revalidateSubscriptionReaderDocs()

  return NextResponse.json({ ok: true, status, sections: spread.sections.length })
}

/** /admin の棚卸し用。誌面の一覧を新しい順に返す。 */
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('reader_spreads')
    .select('page_id, status, source_last_edited, verified_at, updated_at')
    .order('updated_at', { ascending: false })
  if (error) return NextResponse.json({ error: 'load_failed' }, { status: 500 })
  return NextResponse.json({ spreads: data ?? [] })
}
```

- [ ] **Step 5: テストを走らせて通ることを確認する**

Run: `npx vitest run src/lib/__tests__/admin-spread-route.test.ts`
Expected: PASS（4 tests）

- [ ] **Step 6: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/app/api/admin/spread/route.ts src/lib/admin-audit.ts src/lib/__tests__/admin-spread-route.test.ts
git commit -m "feat: 誌面の投入API（原本から組み立て・逐語検査つき）"
```

---

### Task 8: 配信（本文APIへの同梱とクライアントキャッシュ）

**Files:**
- Modify: `src/app/api/subscription/page/route.ts`
- Modify: `src/lib/reader-prefetch.ts:36-60`
- Modify: `src/lib/reader-doc-store.ts:24`（`Entry` 型）, `:60-88`（read/write）
- Modify: `src/components/reader/SubscriptionReader.tsx:55-101`（`runFetch`）
- Test: `src/lib/__tests__/reader-doc-store.test.ts`

**Interfaces:**
- Consumes: Task 7 が保存する `reader_spreads`（status=published）
- Produces: `/api/subscription/page` の応答が `{ doc, spread }`（spread は published が無ければ null）／`getCachedSpread(objectID): SpreadDoc | null`／`readStoredSpread(objectID): Promise<SpreadDoc | null>`／`SubscriptionReader` が `spread` を `ReaderOverlay` に渡す

別APIにしない。既存のメモリキャッシュ・IndexedDB・先読みの連鎖にそのまま乗せるため、同じ応答に入れる。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/reader-doc-store.test.ts` に追記する（無ければ新規作成する）。

```ts
import { describe, it, expect } from 'vitest'
import { pickStoredSpread } from '../reader-doc-store'

describe('pickStoredSpread', () => {
  it('保存済みエントリから誌面を取り出す', () => {
    expect(pickStoredSpread({ objectID: 'a', doc: { title: 'x' } as never, spread: { version: 1 } as never, at: 0 })).toEqual({ version: 1 })
  })

  it('誌面を持たない古いエントリでは null を返す', () => {
    expect(pickStoredSpread({ objectID: 'a', doc: { title: 'x' } as never, at: 0 })).toBeNull()
  })

  it('エントリ自体が無ければ null', () => {
    expect(pickStoredSpread(undefined)).toBeNull()
  })
})
```

- [ ] **Step 2: テストを走らせて失敗を確認する**

Run: `npx vitest run src/lib/__tests__/reader-doc-store.test.ts`
Expected: FAIL（`pickStoredSpread is not a function`）

- [ ] **Step 3: 本文APIに誌面を同梱する**

`src/app/api/subscription/page/route.ts` の GET を差し替える。冒頭に import を足す。

```ts
import { createAdminClient } from '@/lib/supabase/server'
import type { SpreadDoc } from '@/lib/reader-spread'
```

`getReaderDocCached` の下に追記する。

```ts
// 公開済みの誌面だけを引く。無ければ null（＝従来の ReaderBody 描画になる）。
// Supabase 直読みは Notion API と違って速いので、Data Cache には載せない。
// 投入時に revalidateSubscriptionReaderDocs() が本文側のタグを失効させる。
async function getPublishedSpread(pageId: string): Promise<SpreadDoc | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('reader_spreads')
      .select('spread_doc')
      .eq('page_id', pageId)
      .eq('status', 'published')
      .maybeSingle()
    return (data?.spread_doc as SpreadDoc | undefined) ?? null
  } catch {
    // 誌面が引けなくても本文は返す。読めなくなることだけは避ける。
    return null
  }
}
```

`try` ブロックの中を差し替える。

```ts
  try {
    const [doc, spread] = await Promise.all([getReaderDocCached(pageId, token), getPublishedSpread(pageId)])
    return NextResponse.json({ doc, spread }, { headers: { 'Cache-Control': 'private, max-age=600, stale-while-revalidate=86400' } })
  } catch {
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 })
  }
```

- [ ] **Step 4: IndexedDB に誌面も残す**

`src/lib/reader-doc-store.ts` の `Entry` 型と読み書きを差し替える。冒頭の import に型を足す。

```ts
import type { SpreadDoc } from './reader-spread'

// spread は後から足したキー。既存エントリには無いので必ず optional として扱う。
type Entry = { objectID: string; doc: ReaderDoc; spread?: SpreadDoc | null; at: number }
```

`readStoredDoc` の下に追記する。

```ts
// Entry から誌面を取り出す純関数（テスト可能にするため分けてある）。
export function pickStoredSpread(entry: Entry | undefined): SpreadDoc | null {
  return entry?.spread ?? null
}

export async function readStoredSpread(objectID: string): Promise<SpreadDoc | null> {
  const db = await openDb()
  if (!db) return null
  const store = tx(db, 'readonly')
  if (!store) return null
  return new Promise((resolve) => {
    const req = store.get(objectID)
    req.onsuccess = () => resolve(pickStoredSpread(req.result as Entry | undefined))
    req.onerror = () => resolve(null)
  })
}
```

`writeStoredDoc` の引数に誌面を足す。

```ts
export async function writeStoredDoc(
  objectID: string,
  doc: ReaderDoc,
  spread: SpreadDoc | null = null,
  now = Date.now(),
): Promise<void> {
  const db = await openDb()
  if (!db) return
  const store = tx(db, 'readwrite')
  if (!store) return
  try {
    store.put({ objectID, doc, spread, at: now } satisfies Entry)
  } catch {
    return
  }
  await evictOldest(db)
}
```

- [ ] **Step 5: 先読みキャッシュに誌面を持たせる**

`src/lib/reader-prefetch.ts` を直す。冒頭に型 import を足す。

```ts
import type { SpreadDoc } from './reader-spread'
```

`docs` の宣言の下に追記する。

```ts
// 誌面は本文と同じ応答で届くので、同じタイミングで別のMapに置く。
// fetchReaderDoc の戻り値（ReaderDoc）は変えない。呼び出し側が10箇所以上あるため。
const spreads = new Map<string, SpreadDoc | null>()
```

`.then((d) => { ... })` を差し替える。

```ts
    .then((d) => {
      const doc = d.doc as ReaderDoc
      const spread = (d.spread as SpreadDoc | undefined) ?? null
      docs.set(objectID, { doc, at: Date.now() })
      spreads.set(objectID, spread)
      // 端末にも残す（リロード・PWA再起動を跨いで速く開くため）。失敗は握り潰される。
      void writeStoredDoc(objectID, doc, spread)
      return doc
    })
```

`getCachedReaderDoc` の下に追記する。

```ts
export function getCachedSpread(objectID: string): SpreadDoc | null {
  return spreads.get(objectID) ?? null
}
```

`clearReaderDocCache` に `spreads.clear()` を足す。

- [ ] **Step 6: SubscriptionReader が誌面を受け渡す**

`src/components/reader/SubscriptionReader.tsx` を直す。import に足す。

```ts
import { getCachedSpread } from '@/lib/reader-prefetch'
import { readStoredSpread } from '@/lib/reader-doc-store'
import type { SpreadDoc } from '@/lib/reader-spread'
```

`const [doc, setDoc] = useState<ReaderDoc | null>(null)` の隣に足す。

```ts
const [spread, setSpread] = useState<SpreadDoc | null>(null)
```

`runFetch` の中を直す。キャッシュヒット時、ストア先出し時、ネットワーク到着時の3箇所で誌面も入れる。

```ts
    const cached = getCachedReaderDoc(h.objectID)
    if (cached) {
      setHit(h); setDoc(cached); setSpread(getCachedSpread(h.objectID)); setState('idle'); setZoom(null)
      return
    }
    setHit(h); setDoc(null); setSpread(null); setState('loading'); setZoom(null)
```

`readStoredDoc(...).then` の中に足す。

```ts
      void readStoredSpread(h.objectID).then((s) => {
        if (reqRef.current !== token || networkOk) return
        setSpread(s)
      })
```

`fetchReaderDoc(...).then((doc) => {...})` の中、**`if (shownFromStore && shownFromStore.lastEdited === doc.lastEdited) return` の手前**に足す。

```ts
        // 誌面は本文の lastEdited とは無関係に公開・再生成されるため、本文の同一性で
        // 誌面の更新を止めてはいけない。端末の本文が同じでも、新しく公開された誌面は
        // ここで反映する必要がある。
        setSpread(getCachedSpread(h.objectID))
```

**この位置を守ること。** 早期 return の後ろに置くと、本文が同じで誌面だけ新しく公開された場合に、
古い誌面（または誌面なし）が画面に残り続ける。

`<ReaderOverlay ... />` に `spread={spread}` を渡す。

- [ ] **Step 7: テストを走らせて通ることを確認する**

Run: `npx vitest run src/lib/__tests__/reader-doc-store.test.ts && npx tsc --noEmit`
Expected: PASS（3 tests）。`ReaderOverlay` が `spread` prop を受けていない型エラーが出る場合は Task 12 で解消するので、この時点では `ReaderOverlay` の props に `spread?: SpreadDoc | null` だけ先に足しておく（描画分岐は Task 12）

- [ ] **Step 8: コミット**

```bash
git add src/app/api/subscription/page/route.ts src/lib/reader-prefetch.ts src/lib/reader-doc-store.ts src/components/reader/SubscriptionReader.tsx src/lib/__tests__/reader-doc-store.test.ts
git commit -m "feat: 誌面を本文APIに同梱し、先読み・端末保存に載せる"
```

---

### Task 9: Inlines を共有部品として切り出す

**Files:**
- Create: `src/components/reader/Inlines.tsx`
- Modify: `src/components/reader/ReaderBody.tsx:74-120`（`Inlines` を削除して import に置き換え）

**Interfaces:**
- Produces: `<Inlines items={ReaderInline[]} k={string} plain?={boolean} />`（named export）

誌面が検索ハイライトに乗るための土台。`ReaderBody` 内の `Inlines` は非公開関数なので、そのままでは誌面側から使えない。**中身の挙動は一切変えない。** `mark[data-reader-search]` の出し方が変わると記事内検索の件数カウントが壊れる。

- [ ] **Step 1: 現状の Inlines を確認する**

Run: `sed -n '74,120p' src/components/reader/ReaderBody.tsx`
Expected: `function Inlines(...)` の全体が表示される。`data-reader-search=""` が2箇所ある

- [ ] **Step 2: そのまま移す**

`src/components/reader/Inlines.tsx` を新規作成し、Step 1 で見た `Inlines` の実装を**1文字も変えずに**貼り、先頭に `'use client'` と必要な import（`useContext`／`ReaderSearchCtx`／`findMatchRanges`／`ReaderInline` 型など、ReaderBody の冒頭から必要な分）を足し、`function Inlines` を `export function Inlines` にする。

冒頭にコメントを置く。

```tsx
// 本文のインライン描画（太字・リンク・文字色・検索ハイライト）。
// ReaderBody から切り出した共有部品。誌面（components/reader/spread）も同じものを使う。
// mark[data-reader-search] の出し方は ReaderOverlay が DOM を数えて現在位置を
// 付け替える前提なので、属性と構造を変えないこと。
```

- [ ] **Step 3: ReaderBody から使う**

`ReaderBody.tsx` の `function Inlines` 定義を削除し、import を足す。

```tsx
import { Inlines } from './Inlines'
```

- [ ] **Step 4: 型チェックと全テスト**

Run: `npx tsc --noEmit && npm test`
Expected: エラーなし・全 PASS

- [ ] **Step 5: 目視で確認する**

Run: `npm run dev` を別ターミナルで起動し、`/dev/reader` を開く
Expected: 本文がこれまでどおり表示される。記事内検索を開いて語を入れると、ハイライトと件数が従来どおり動く

- [ ] **Step 6: コミット**

```bash
git add src/components/reader/Inlines.tsx src/components/reader/ReaderBody.tsx
git commit -m "refactor: Inlines を共有部品に切り出す（挙動は変えない）"
```

---

### Task 10: 誌面の骨格（ReaderSpread）

**Files:**
- Create: `src/components/reader/spread/ReaderSpread.tsx`
- Create: `src/components/reader/spread/SpreadParts.tsx`

**Interfaces:**
- Consumes: Task 1-3 の `SpreadDoc` / `SpreadSection` / `SpreadPart`、Task 9 の `Inlines`、既存の `ReaderSearchCtx`／`Block`（ReaderBody の既存ブロック描画を深掘りで使う）
- Produces: `<ReaderSpread spread={SpreadDoc} onImageClick={(url: string) => void} />`／`<SpreadPartView part={SpreadPart} />`

**受け入れ条件（満たさないと既存機能が黙って壊れる）**

1. 節見出しに `data-section={anchor}` を出す（横断検索の節ジャンプと ReaderNavBar が使う）
2. 本文のインラインは Task 9 の `Inlines` を通す（`mark[data-reader-search]` の互換）
3. **検索中は全節の深掘りを開く**（折りたたまれた本文は DOM に無く検索が拾えない）
4. 深掘りの中身は原本のブロックをそのまま描く
5. **`lead` / `preface` / 各節の `deep` / `tail` の4つを全部描く。** どれか1つでも落とすと、
   原本にある本文が誌面から黙って消える。`splitSections` はブロックをこの4つに振り分けるので、
   4つ揃えて初めて原本と同じ量になる
6. callout の描画は `ReaderBody` の `Block` に委ねる。自前で callout を描くと、
   🎨制作メモを隠す `draft` role の処理（Task 4）が誌面だけ効かなくなる

- [ ] **Step 1: 深掘りに使うブロック描画を公開する**

`ReaderBody.tsx:308` の `function Block({ ... })` に `export` を付ける。誌面の深掘りは現行本文と同一の見た目でなければならないので、描画を作り直さず再利用する。

```tsx
export function Block({
  block,
  index,
  onImageClick,
  active,
}: {
  block: ReaderBlock
  index: number
  onImageClick: (u: string) => void
  active: Set<Confidence>
}) {
```

`active` は確信度フィルタで淡色化する対象の集合。誌面の第1版ではフィルタを持たないので、呼び出し側から空集合を渡す。

- [ ] **Step 2: 部品の描画を書く**

`src/components/reader/spread/SpreadParts.tsx` を新規作成する。

```tsx
'use client'
import { Inlines } from '../Inlines'
import type { ReaderInline } from '@/lib/reader-doc'
import type { SpreadPart } from '@/lib/reader-spread'

// 表層の部品。教科書の誌面で「どこを見るか」を形が教える役割を持つ。
// 現行の本文中の表は本文より小さい全セル枠線だったが、誌面では逆にする。
// ヘッダ行に地色・横罫のみ・数値セルを大きく太く。

function ComparisonTable({ rows }: { rows: ReaderInline[][][] }) {
  const [head, ...body] = rows
  return (
    <div className="overflow-x-auto my-4 rounded-lg border border-gray-200 dark:border-white/10">
      <table className="w-full text-[1em] border-collapse text-gray-800 dark:text-gray-100">
        <thead>
          <tr className="bg-brand-50 dark:bg-white/[0.06]">
            {head?.map((cell, c) => (
              <th key={c} className="text-left font-bold px-3 py-2.5 align-top leading-relaxed">
                <Inlines items={cell} k={`th-${c}`} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {body.map((row, r) => (
            <tr key={r} className="border-t border-gray-200 dark:border-white/10">
              {row.map((cell, c) => (
                <td key={c} className="px-3 py-2.5 align-top leading-relaxed">
                  <Inlines items={cell} k={`td-${r}-${c}`} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function SpreadPartView({ part }: { part: SpreadPart }) {
  if (part.kind === 'none') return null
  if (part.kind === 'comparison' || part.kind === 'matrix') return <ComparisonTable rows={part.rows} />
  if (part.kind === 'flow' || part.kind === 'timeline') {
    return (
      <ol className="my-4 space-y-2.5">
        {part.steps.map((s, i) => (
          <li key={i} className="flex items-start gap-3">
            <span className="shrink-0 w-7 h-7 rounded-full bg-brand-600 text-white text-sm font-bold grid place-items-center">
              {s.label}
            </span>
            <span className="leading-relaxed pt-0.5">
              <Inlines items={s.inlines} k={`step-${i}`} />
            </span>
          </li>
        ))}
      </ol>
    )
  }
  if (part.kind === 'bignumber') {
    return (
      <div className="my-4 rounded-lg bg-gray-50 dark:bg-white/[0.04] px-4 py-3.5">
        <div className="text-[2em] font-bold text-brand-600 dark:text-brand-300 leading-tight">{part.value}</div>
        <div className="text-[0.9em] text-gray-600 dark:text-gray-300 mt-1 leading-relaxed">
          <Inlines items={part.caption} k="bn" />
        </div>
      </div>
    )
  }
  return (
    <div className="my-4 grid gap-3 sm:grid-cols-2">
      <div className="rounded-lg bg-gray-50 dark:bg-white/[0.04] px-4 py-3.5">
        <div className="text-sm font-bold text-brand-700 dark:text-brand-300 mb-1.5">こうする</div>
        <ul className="space-y-1.5 leading-relaxed">
          {part.go.map((line, i) => <li key={i}><Inlines items={line} k={`go-${i}`} /></li>)}
        </ul>
      </div>
      <div className="rounded-lg bg-gray-50 dark:bg-white/[0.04] px-4 py-3.5">
        <div className="text-sm font-bold text-gray-700 dark:text-gray-300 mb-1.5">こうしない</div>
        <ul className="space-y-1.5 leading-relaxed">
          {part.noGo.map((line, i) => <li key={i}><Inlines items={line} k={`nogo-${i}`} /></li>)}
        </ul>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 骨格を書く**

`src/components/reader/spread/ReaderSpread.tsx` を新規作成する。

```tsx
'use client'
import { useContext, useMemo, useState } from 'react'
import { ReaderSearchCtx } from '../reader-search-context'
import { Block } from '../ReaderBody'
import { SpreadPartView } from './SpreadParts'
import type { Confidence } from '@/lib/reader-confidence'
import type { SpreadDoc } from '@/lib/reader-spread'

// 誌面の第1版は確信度フィルタを持たない。Block は active を必須で取るので、
// 描画のたびに new Set() を作らないよう定数を1つだけ置く。
const NO_FILTER: Set<Confidence> = new Set()

/**
 * 誌面表示（TEXTBOOK LITE）。
 *
 * 二層構造: 表層＝情報の型に応じた部品（見て分かる）／深掘り＝現行の密な本文
 * （確かめられる）。深掘りは節ごとに開く。
 *
 * 検索中は全節を開く。折りたたんだ本文は DOM に無く、ReaderOverlay の
 * 記事内検索（mark[data-reader-search] を数える）が拾えないため。
 */
export function ReaderSpread({
  spread,
  onImageClick,
}: {
  spread: SpreadDoc
  onImageClick: (url: string) => void
}) {
  const query = useContext(ReaderSearchCtx)
  const searching = query.trim().length > 0
  const [open, setOpen] = useState<Set<string>>(new Set())

  const toc = useMemo(
    () => spread.sections.map((s) => ({ anchor: s.anchor, label: s.shortLabel || s.title })),
    [spread.sections],
  )

  return (
    <div className="reader-prose">
      {spread.lead && (
        <div data-tldr="" className="mb-5">
          <Block block={spread.lead} index={-1} onImageClick={onImageClick} active={NO_FILTER} />
        </div>
      )}

      {/* 最初のH2より前の本文。ここを描かないと、導入の段落が誌面から黙って消える。 */}
      {spread.preface.map((b, i) => (
        <Block key={`p-${i}`} block={b} index={-100 - i} onImageClick={onImageClick} active={NO_FILTER} />
      ))}

      {toc.length > 0 && (
        <nav className="flex flex-wrap gap-1.5 mb-6" aria-label="目次">
          {toc.map((s) => (
            <a
              key={s.anchor}
              href={`#${s.anchor}`}
              className="text-[0.8em] px-2.5 py-1 rounded-full bg-gray-100 dark:bg-white/[0.06] text-gray-700 dark:text-gray-200"
            >
              {s.label}
            </a>
          ))}
        </nav>
      )}

      {spread.sections.map((s, i) => {
        const isOpen = searching || open.has(s.anchor)
        return (
          <section key={s.anchor} className="mb-8">
            {/* data-section は横断検索の節ジャンプと ReaderNavBar が使う。値を変えないこと。 */}
            <h2
              id={s.anchor}
              data-section={s.anchor}
              className="flex items-start gap-2.5 rounded-lg bg-gray-50 dark:bg-white/[0.05] px-3 py-2.5 mb-3.5 text-[1.15em] font-bold text-gray-900 dark:text-gray-100"
            >
              <span className="shrink-0 w-7 h-7 rounded-full bg-brand-600 text-white text-sm grid place-items-center">
                {s.n ?? i + 1}
              </span>
              <span className="leading-snug pt-0.5">{s.title}</span>
            </h2>

            <SpreadPartView part={s.part} />

            <button
              type="button"
              onClick={() => setOpen((prev) => {
                const next = new Set(prev)
                if (next.has(s.anchor)) next.delete(s.anchor)
                else next.add(s.anchor)
                return next
              })}
              aria-expanded={isOpen}
              className="text-[0.85em] text-brand-700 dark:text-brand-300 underline min-h-[44px] px-1"
            >
              {isOpen ? 'この節の根拠を閉じる' : 'この節の根拠を見る'}
            </button>

            {isOpen && (
              <div className="mt-2">
                {s.deep.map((b, bi) => (
                  <Block key={bi} block={b} index={bi} onImageClick={onImageClick} active={NO_FILTER} />
                ))}
              </div>
            )}
          </section>
        )
      })}

      {spread.tail.map((b, i) => (
        <Block key={i} block={b} index={1000 + i} onImageClick={onImageClick} active={NO_FILTER} />
      ))}
    </div>
  )
}
```

- [ ] **Step 4: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/components/reader/spread/
git commit -m "feat: 誌面の骨格と表層部品の描画"
```

---

### Task 11: 誌面のダーク配色と目次チップの見た目

**Files:**
- Modify: `tailwind.config.js`
- Modify: `src/components/reader/spread/ReaderSpread.tsx`
- Modify: `src/components/reader/spread/SpreadParts.tsx`

**Interfaces:**
- Produces: Tailwind に誌面用の面の色（`sheet` / `soft` / `card`）

ダークは青寄りニュートラルの単一階調4段（ページ地→シート→ソフトな箱→カード）にし、色はアクセント（数値・バッジ・マーク）にだけ使う。低彩度の暗い色は濁って見える。明るさで高さを作る（浮くものほど明るい）。

- [ ] **Step 1: 現状の色設定を見る**

Run: `sed -n '1,60p' tailwind.config.js`
Expected: `theme.extend.colors` に `brand` がある

- [ ] **Step 2: 面の色を足す**

`tailwind.config.js` の `theme.extend.colors` に追記する。

```js
      // 誌面（TEXTBOOK LITE）の面。青寄りニュートラルの単一階調で、
      // 浮くものほど明るくする。色はアクセントだけに使い、面には乗せない
      // （低彩度の暗い色は濁って見えるため）。
      sheet: { light: '#ffffff', dark: '#131721' },
      soft: { light: '#f5f7fa', dark: '#1a1f2b' },
      card: { light: '#ffffff', dark: '#212736' },
```

- [ ] **Step 3: 誌面の面をトークンに寄せる**

`ReaderSpread.tsx` と `SpreadParts.tsx` の `dark:bg-white/[0.0x]` を、上で定義した階調に置き換える。

- 節見出しの帯: `bg-soft-light dark:bg-soft-dark`
- 部品の箱（大きい数値・Go/No-Go）: `bg-soft-light dark:bg-soft-dark`
- 表の外枠: `bg-card-light dark:bg-card-dark`
- 表のヘッダ行: `bg-brand-50 dark:bg-white/[0.06]` はそのまま残す（アクセントなので階調の対象外）

- [ ] **Step 4: 目視で確認する**

Run: `npm run dev` を起動し `/dev/reader` を開く。ライトとダークを切り替える
Expected: ダークで面が4段に分かれて見え、濁った色が乗っていない。**切り替えた直後のスクリーンショットは遷移中で誤診しやすいので、1秒おいて撮り直す**

- [ ] **Step 5: コミット**

```bash
git add tailwind.config.js src/components/reader/spread/
git commit -m "feat: 誌面のダーク配色を単一階調4段にする"
```

---

### Task 12: 出し分けと要点トグルの抑制

**Files:**
- Modify: `src/components/reader/ReaderOverlay.tsx:245-257`（`canDigest`）, `:423`（描画分岐）

**Interfaces:**
- Consumes: Task 8 で追加した `spread` prop、Task 10 の `ReaderSpread`
- Produces: 誌面がある記事は `ReaderSpread`、無い記事は従来どおり `ReaderBody`

- [ ] **Step 1: props に誌面を受ける**

`ReaderOverlay` の props 型に足す（Task 8 で先に足していれば済んでいる）。

```ts
  spread?: SpreadDoc | null
```

import も足す。

```ts
import { ReaderSpread } from './spread/ReaderSpread'
import type { SpreadDoc } from '@/lib/reader-spread'
```

- [ ] **Step 2: 要点トグルを隠す**

`canDigest` の行を差し替える。既存のコメントは残す。

```ts
  // 誌面がある記事では表層が要点の役割を、節ごとの深掘りが全文の役割を引き継ぐので、
  // 全文｜要点のトグルは出さない（保存された端末設定は上書きしない＝誌面のない記事を
  // 開けば従来どおり要点で開く）。
  const canDigest = !isPersonalDoc && !spread
```

- [ ] **Step 3: 描画を出し分ける**

`{state === 'idle' && doc && (` のブロックの中で、`<ReaderBody ... />` を呼んでいる箇所を差し替える。

Run: `grep -n "<ReaderBody" src/components/reader/ReaderOverlay.tsx` で位置を確認してから直す。

```tsx
              {spread ? (
                <ReaderSpread spread={spread} onImageClick={setZoom} />
              ) : (
                /* 既存の ReaderBody 呼び出しをそのまま残す */
                <ReaderBody /* ...既存の props をそのまま... */ />
              )}
```

`onImageClick` に渡す関数は、既存の `ReaderBody` 呼び出しが使っているものと同じものを渡す。

全文｜要点の切替UIを描いている箇所は `canDigest` で既に閉じているはずだが、閉じていなければ `canDigest &&` で包む。

- [ ] **Step 4: 型チェックと全テスト**

Run: `npx tsc --noEmit && npm test`
Expected: エラーなし・全 PASS

- [ ] **Step 5: 誌面が無い記事が壊れていないことを確認する**

Run: `npm run dev` を起動し `/dev/reader` を開く
Expected: 従来どおりの本文表示。全文｜要点のトグルも従来どおり出る（誌面がまだ1件も無いため）

- [ ] **Step 6: コミット**

```bash
git add src/components/reader/ReaderOverlay.tsx
git commit -m "feat: 誌面の有無で描画を出し分ける"
```

---

### Task 13: 理解チェックの表示

**Files:**
- Create: `src/components/reader/spread/SpreadQuizCard.tsx`
- Modify: `src/components/reader/spread/ReaderSpread.tsx`
- Test: `src/lib/__tests__/reader-spread.test.ts`

**Interfaces:**
- Consumes: Task 3 の `SpreadQuiz`、`SpreadDoc`
- Produces: `visibleQuizzes(spread: SpreadDoc, anchor: string): SpreadQuiz[]`（`reader-spread.ts` に追加）／`<SpreadQuizCard quiz={SpreadQuiz} />`

**出す条件は2つとも満たすときだけ。** オーナーの目視フラグが立っていること、根拠の逐語が誌面の本文にそのまま含まれること。原本が変わって根拠が消えた設問を黙って出し続けないため。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/reader-spread.test.ts` の末尾に追記する。import に `visibleQuizzes` を足す。

```ts
describe('visibleQuizzes', () => {
  const base = buildSpreadDraft(doc, 'page-1')
  const q = (over: Partial<SpreadQuiz>): SpreadQuiz => ({
    id: 'q1', sectionAnchor: '1', question: '？', choices: ['a', 'b'], answerIndex: 0,
    evidence: 'デバイスより先に目標値を決める。', reviewed: true, ...over,
  })

  it('目視済みで根拠が本文にあるものだけ出す', () => {
    const s = { ...base, quizzes: [q({})] }
    expect(visibleQuizzes(s, '1')).toHaveLength(1)
  })

  it('目視前は出さない', () => {
    const s = { ...base, quizzes: [q({ reviewed: false })] }
    expect(visibleQuizzes(s, '1')).toHaveLength(0)
  })

  it('根拠が本文に無くなったら出さない', () => {
    const s = { ...base, quizzes: [q({ evidence: '原本から消えた文。' })] }
    expect(visibleQuizzes(s, '1')).toHaveLength(0)
  })

  it('別の節の設問は出さない', () => {
    const s = { ...base, quizzes: [q({ sectionAnchor: '2' })] }
    expect(visibleQuizzes(s, '1')).toHaveLength(0)
  })
})
```

冒頭の import に型を足す。

```ts
import type { SpreadQuiz } from '../reader-spread'
```

- [ ] **Step 2: テストを走らせて失敗を確認する**

Run: `npx vitest run src/lib/__tests__/reader-spread.test.ts`
Expected: FAIL（`visibleQuizzes is not a function`）

- [ ] **Step 3: 実装する**

`src/lib/reader-spread.ts` の末尾に追記する。

```ts
/**
 * その節で読者に出してよい理解チェックだけを返す。
 *
 * 条件は2つとも必要。
 *  1. オーナーの目視を通っている（reviewed）
 *  2. 根拠の逐語が、その節の深掘り本文にそのまま含まれている
 * 原本が変わって根拠が消えた設問を、黙って出し続けないための関門。
 */
export function visibleQuizzes(spread: SpreadDoc, anchor: string): SpreadQuiz[] {
  const section = spread.sections.find((s) => s.anchor === anchor)
  if (!section) return []
  const corpus = corpusOf({ title: '', icon: null, cover: null, lastEdited: null, blocks: section.deep })
  return spread.quizzes.filter(
    (q) => q.sectionAnchor === anchor && q.reviewed && corpus.includes(q.evidence.replace(/[ \t]+/g, ' ')),
  )
}
```

- [ ] **Step 4: テストを走らせて通ることを確認する**

Run: `npx vitest run src/lib/__tests__/reader-spread.test.ts`
Expected: PASS（14 tests）

- [ ] **Step 5: カードを描く**

`src/components/reader/spread/SpreadQuizCard.tsx` を新規作成する。

```tsx
'use client'
import { useState } from 'react'
import type { SpreadQuiz } from '@/lib/reader-spread'

// 節末の理解チェック。採点は端末の中だけで完結し、サーバーには何も送らない
// （既存のクイズ・SRSと同じ方針）。正誤を出したあと、根拠の逐語をそのまま見せる。
export function SpreadQuizCard({ quiz }: { quiz: SpreadQuiz }) {
  const [picked, setPicked] = useState<number | null>(null)
  const answered = picked !== null
  return (
    <div className="my-4 rounded-lg bg-soft-light dark:bg-soft-dark px-4 py-3.5">
      <div className="text-[0.8em] font-bold text-gray-500 dark:text-gray-400 mb-1.5">理解チェック</div>
      <p className="font-bold leading-relaxed mb-2.5">{quiz.question}</p>
      <div className="space-y-1.5">
        {quiz.choices.map((c, i) => {
          const correct = i === quiz.answerIndex
          const tone = !answered
            ? 'bg-card-light dark:bg-card-dark'
            : correct
              ? 'bg-brand-50 dark:bg-brand-900/30 font-bold'
              : i === picked
                ? 'bg-gray-100 dark:bg-white/[0.08] line-through text-gray-500 dark:text-gray-400'
                : 'bg-card-light dark:bg-card-dark opacity-60'
          return (
            <button
              key={i}
              type="button"
              disabled={answered}
              onClick={() => setPicked(i)}
              className={`block w-full text-left px-3 py-2.5 rounded-lg min-h-[44px] leading-relaxed ${tone}`}
            >
              {c}
            </button>
          )
        })}
      </div>
      {answered && (
        <p className="text-[0.85em] text-gray-600 dark:text-gray-300 mt-2.5 leading-relaxed">
          {quiz.evidence}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 6: 節末に差し込む**

`ReaderSpread.tsx` の各節で、深掘りの開閉ボタンの直前に足す。

```tsx
            {visibleQuizzes(spread, s.anchor).map((q) => (
              <SpreadQuizCard key={q.id} quiz={q} />
            ))}
```

import を足す。

```tsx
import { visibleQuizzes } from '@/lib/reader-spread'
import { SpreadQuizCard } from './SpreadQuizCard'
```

- [ ] **Step 7: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 8: コミット**

```bash
git add src/lib/reader-spread.ts src/components/reader/spread/ src/lib/__tests__/reader-spread.test.ts
git commit -m "feat: 節末の理解チェック（目視済み・根拠一致のものだけ表示）"
```

---

### Task 14: /admin の誌面カード

**Files:**
- Create: `src/app/admin/SpreadCard.tsx`
- Modify: `src/app/admin/page.tsx`（カードの差し込み）

**Interfaces:**
- Consumes: Task 7 の `GET /api/admin/spread`（`{ spreads: [{ page_id, status, source_last_edited, verified_at, updated_at }] }`）と `PUT /api/admin/spread`
- Produces: 誌面の一覧・再生成・公開の操作

**確認ダイアログ（`confirm` / `alert`）は使わない。** 表示環境で抑止されることがある。2度押し方式にする。

- [ ] **Step 1: カードを書く**

`src/app/admin/SpreadCard.tsx` を新規作成する。

```tsx
'use client'
import { useEffect, useState } from 'react'

type Row = {
  page_id: string
  status: string
  source_last_edited: string | null
  verified_at: string | null
  updated_at: string
}

// 誌面（TEXTBOOK LITE）の棚卸し。
// 原本を直したあと再生成し忘れると、検索結果には新しい文が出るのに誌面だけ古い、
// というズレが起きる。ここがその気づきの場所になる。
export function SpreadCard() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = () => {
    fetch('/api/admin/spread')
      .then((r) => r.json())
      .then((d) => setRows(d.spreads ?? []))
      .catch(() => setRows([]))
  }
  useEffect(load, [])

  const run = async (pageId: string, publish: boolean) => {
    setBusy(pageId)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/spread', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, publish }),
      })
      const d = await res.json()
      if (!res.ok) {
        setMsg(d.error === 'verbatim_mismatch'
          ? `逐語一致で落ちました: ${(d.missing ?? []).slice(0, 3).join(' / ')}`
          : `失敗しました: ${d.error ?? res.status}`)
      } else {
        setMsg(publish ? '公開しました。' : '再生成しました（未公開）。')
        load()
      }
    } finally {
      setBusy(null)
      setArmed(null)
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <h2 className="font-bold mb-3">誌面（リーダー表示）</h2>
      {msg && <p className="text-sm mb-2 text-gray-600 dark:text-gray-300">{msg}</p>}
      {rows === null && <p className="text-sm text-gray-500">読み込み中…</p>}
      {rows?.length === 0 && <p className="text-sm text-gray-500">まだ誌面はありません。</p>}
      <ul className="space-y-2">
        {rows?.map((r) => {
          const stale = false // 原本の最終更新との突合は Step 2 で足す
          return (
            <li key={r.page_id} className="text-sm flex flex-wrap items-center gap-2">
              <code className="text-xs">{r.page_id.slice(0, 8)}</code>
              <span className={r.status === 'published' ? 'text-brand-600' : 'text-gray-500'}>
                {r.status === 'published' ? '公開中' : '未公開'}
              </span>
              {stale && <span className="text-orange-600">原本が更新されています</span>}
              <button
                type="button"
                disabled={busy === r.page_id}
                onClick={() => run(r.page_id, false)}
                className="underline min-h-[44px] px-2"
              >
                再生成
              </button>
              <button
                type="button"
                disabled={busy === r.page_id}
                onClick={() => (armed === r.page_id ? run(r.page_id, true) : setArmed(r.page_id))}
                className="underline min-h-[44px] px-2"
              >
                {armed === r.page_id ? 'もう一度押すと公開' : '公開'}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
```

- [ ] **Step 2: 原本の更新を検知する**

`src/app/api/admin/spread/route.ts` の `GET` を差し替える。`?check=1` のときだけ Notion に問い合わせる（件数が増えたときに毎回叩くと重いため）。

```ts
export async function GET(req: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('reader_spreads')
    .select('page_id, status, source_last_edited, verified_at, updated_at')
    .order('updated_at', { ascending: false })
  if (error) return NextResponse.json({ error: 'load_failed' }, { status: 500 })

  const rows = data ?? []
  // ?check=1 のときだけ、原本の最終更新と突き合わせて「再生成が要る」を判定する。
  // 原本を直したあと再生成を忘れると、検索結果には新しい文が出るのに誌面だけ古くなる。
  const check = new URL(req.url).searchParams.get('check') === '1'
  const token = process.env.SUBSCRIPTION_NOTION_TOKEN
  if (!check || !token) return NextResponse.json({ spreads: rows })

  const notion = new Client({ auth: token })
  const withStale = await Promise.all(
    rows.map(async (r) => {
      try {
        const page = await notion.pages.retrieve({ page_id: r.page_id })
        const last = (page as { last_edited_time?: string }).last_edited_time ?? null
        const stale = !!last && !!r.source_last_edited && new Date(last) > new Date(r.source_last_edited)
        return { ...r, stale }
      } catch {
        // 原本が引けないときは判定しない（誤って「更新あり」と出さない）。
        return { ...r, stale: false }
      }
    }),
  )
  return NextResponse.json({ spreads: withStale })
}
```

`SpreadCard.tsx` を2箇所直す。

```tsx
    fetch('/api/admin/spread?check=1')
```

```tsx
          const stale = (r as Row & { stale?: boolean }).stale === true
```

- [ ] **Step 3: /admin に差し込む**

`src/app/admin/page.tsx` を開き、既存のカード（`PersonalReaderMetricsCard` など）が並んでいる場所を確認して `<SpreadCard />` を足す。

Run: `grep -n "PersonalReaderMetricsCard" src/app/admin/page.tsx`

- [ ] **Step 4: 目視で確認する**

Run: `npm run dev` を起動し `/admin` を開く
Expected: 誌面カードが出て「まだ誌面はありません。」と表示される

- [ ] **Step 5: コミット**

```bash
git add src/app/admin/SpreadCard.tsx src/app/admin/page.tsx src/app/api/admin/spread/route.ts
git commit -m "feat: /admin に誌面の棚卸しカード（再生成・公開・原本更新の検知）"
```

---

### Task 15: パイロット（酸素療法1枚を通す）

**Files:** コードの変更なし。運用手順。

**Interfaces:**
- Consumes: Task 5（同期の表対応）が本番にデプロイ済みであること、Task 6 の migration が本番に流れていること、Task 7-14 が本番にデプロイ済みであること

**この順序を守る。** 同期の表対応を出す前に原本を表へ改稿すると、その本文が全文検索から消え、本文文字数も減る。

- [ ] **Step 1: 前提の確認**

- `reader_spreads` が本番に存在する（Task 6 Step 4 のクエリ）
- Task 5 を含むブランチが本番にマージ・デプロイ済み
- デプロイ直後に手動同期を1回叩き、blockId 無しの古い本文キャッシュを一掃する

```bash
curl -X POST -H "x-sync-secret: <.env.local の SUBSCRIPTION_SYNC_SECRET>" https://<本番ドメイン>/api/subscription/sync
```

- [ ] **Step 2: 原本を規約に合わせて改稿する**

対象は「💡 酸素療法はどのように使い分ける？」（比較・使い分け型）。改稿は medinode-knowledge-promote の流儀で1ブロックずつオーナー確認を取りながら行う。**箇条書きから表への機械変換はしない。**

- 節1の目標SpO2の比較を、実際の表ブロックにする
- 節2〜3の手順を番号つきリストにする
- ⚡結論ボックスを3行程度に収める
- 🎨制作メモの callout を削除する（読者に見えている）
- **赤マーカー（穴埋め印）を表セルに入れない**（クイズ抽出が表を読まないため）

- [ ] **Step 3: 改稿の副作用が出ていないことを確かめる**

同期を1回叩いてから確認する。

- アプリの検索で、表に移した語（例「ベンチュリーマスク」）が引けること
- 一覧カードの「約N分」が改稿前と極端に減っていないこと
- 穴埋めクイズにその記事の問題が残っていること

減っていたら Task 5 が本番に出ていない。先に戻る。

- [ ] **Step 4: 誌面を投入する（未公開）**

制作スキルがオーバレイ（短ラベル・部品の上書き・理解チェック・アイコン）を組み、投入する。本文は送らない。

```bash
curl -X PUT https://<本番ドメイン>/api/admin/spread \
  -H "Content-Type: application/json" \
  -b "<オーナーでログイン済みのCookie>" \
  -d '{"pageId":"<酸素療法のページID>","overlay":{ ... }}'
```

`verbatim_mismatch` で落ちたら、オーバレイの中に原本に無い文が混ざっている。応答の `missing` に出た文を原本の逐語へ直す。

- [ ] **Step 5: 実機で目視する**

/admin の誌面カードには「未公開」と出ている状態。この時点では読者に届かない。

オーナーの端末（特にiPhone実機）で確認する。未公開のものを見るには、一時的に `status` を published にして自分で見てから戻すか、`/dev/reader` で確認する。

- 節見出しの帯と番号バッジ
- 表がヘッダ行に地色・横罫のみで、本文より小さくなっていない
- 「この節の根拠を見る」で現行の本文がそのまま出る
- 記事内検索で、閉じた節の中の語もヒットする（検索中は全節が開く）
- 横断検索から節ジャンプで正しい節に飛ぶ
- ダークで面が濁っていない
- 理解チェックが出る（目視フラグを立てたものだけ）

- [ ] **Step 6: 公開する**

/admin の誌面カードで「公開」を2度押しする。

- [ ] **Step 7: 公開後の確認**

- プレミアムのアカウントでその記事を開くと誌面になる
- 別の記事（誌面未投入）を開くと従来どおりの表示で、全文｜要点のトグルも出る
- オフライン（機内モード）で一度開いた誌面が開ける

- [ ] **Step 8: 記録する**

- Notion「📖 リーダー誌面刷新の設計記録（2026-08-26）」に、公開までの結果と気づきを追記する
- memory-vault の `medinode-reader-typography` の第5波に、本番化した旨と落とし穴を追記する

---

## 後回しにしたもの（本計画の範囲外）

- **編集レイヤー**（`PATCH /api/admin/notion-block`・`SUBSCRIPTION_NOTION_WRITE_TOKEN`）。仕様書の段4。パイロットに必須ではないので、誌面が実機で見えてから着手する。Task 4 で blockId を通してあるので前提は満たしている
- **現在地ナビの拡張**。既存の `ReaderNavBar` が `[data-section]` を IntersectionObserver で見ており、`ReaderSpread` も同じ属性を出すので、現状のまま動く。現在地の見せ方を強くするのは実機を見てから
- **アイコン（CSSマスク・healthicons）と確信度マークの線画化**。仕様書には入っているが、誌面の第1版では描画しない。`SpreadDoc.icons` の器だけ作ってあるので、構造が実機で確かめられてから足す。確信度マーク（✅⚠️❓）は深掘りの中で現行どおり絵文字のまま出る
- **既存記事の一括移行**。1枚ずつ同じ経路（改稿→投入→目視→公開）で進める
- **インフォグラフィック画像の制作工程からの除外**。制作スキルとNotionの制作ステータスの改訂で扱う
