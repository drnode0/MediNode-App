# Recall 分野ページ＋説明（再計画 計画A）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 分野ページを「主張の行の列挙」から「記事ごとの点の地図＋押した点の1行」に書き直し、一覧に Recall の説明（1文＋折りたたみ）を置く。

**Architecture:** 判断は `src/lib/recall/dex.ts`（純関数）と新規 `families.ts` に置き、部品（`RecallPlatePage.tsx`・`RecallDex.tsx`）はモデルを写すだけ。既存のカード・確かめる・同期は触らない。見た目の正は設計書 §2・§3 と試作 https://claude.ai/code/artifact/2b5f6189-4d02-484b-a42c-bce9d404b7db （案3）。

**Tech Stack:** Next.js 16 / React / Tailwind / vitest（DOM 環境なし。判断は純関数に出してテストする）/ Python playwright（画面の実測）

設計書: `docs/superpowers/specs/2026-09-05-recall-replan-design.md`（§2・§3・§5・§6）

## Global Constraints

- 公開リポジトリ。事業数値（登録者数・課金数・売上・コスト）をコード・コメント・コミット文に書かない
- 使わない語: 振る・拾う・血肉・落ちる・定着。長いダッシュを使わない。画面の語は設計書 §8 と 09-04 §9 に従う
- 点の見た目は `RecallDot`（5段）だけを使う。見た目を2か所に散らさない
- 記事名は本文の色・15px・500。節の見出しは 11px・薄い色。**一目で区別できること**（R3）
- 点は 14px・間隔 6px・当たり判定 26px（`::after`）
- 押した点の1行は分野ページで同時に1つ
- 「Recall とは」は初回だけ開いた状態。`localStorage` の `recall.aboutOpen`（`'1'`/`'0'`）
- 7族の短い名詞は未定。**空文字で実装し、表の列は名詞が空なら省く**
- 作業は worktree で（記憶 `shared-worktree-branch-collision`）。`.preview/grains.json` は gitignore なので共有チェックアウトから写す（`recall-reader-claims.test.ts` が読む）
- 画面確認は Python playwright（記憶 `playwright-screenshot-for-visual-check`）。dev server は `.claude/launch.json` の `medical-search-public-3210`（別ポートに変えてよい）。Browser pane は使わない
- テスト: `npx vitest run src/lib/__tests__/recall-dex.test.ts` のようにファイル単位で回し、最後に `npm test` 全件

---

### Task 1: `PageModel.pages[].escaping`（目次のチップの数）

**Files:**
- Modify: `src/lib/recall/dex.ts`（`PageModel` 型と `pageModelOf`）
- Test: `src/lib/__tests__/recall-dex.test.ts`

**Interfaces:**
- Consumes: 既存 `pageModelOf(planet, claimById): PageModel`
- Produces: `PageModel.pages[i].escaping: number`（その記事の離れかけの数。`rows[].look.kind === 'escaping'` の個数）

- [ ] **Step 1: 失敗するテストを書く**

`recall-dex.test.ts` の `describe('分野ページ pageModelOf'` の中（無ければ末尾に新しい describe）に足す。既存の `planetOf`/`claimOf` ヘルパーがあればそれを使う。無ければこの形で作る:

```ts
describe('分野ページ 記事ごとの離れかけの数', () => {
  const claim = (claimId: string, pageId: string): RecallClaim => ({
    claimId, pageId, pageTitle: `記事 ${pageId}`, pageKind: '💡', sectionKey: 'sec1', sectionHeading: '1. 節',
    body: `本文 ${claimId}`, source: '出典', confidence: 'ok', genres: ['呼吸'], primaryGenre: '呼吸', genreSlot: 3,
    holes: [], clozeStatus: 'approved', active: true,
  })
  const dot = (claimId: string, pageId: string, kind: RecallStateKind, remaining: number): ClaimDot =>
    ({ claimId, pageId, state: { kind, remaining }, angle: 0, jitter: 0, phase: 0 })

  it('記事ごとに、離れかけ（kept/settled で保持力が閾値未満）の数を持つ', () => {
    const claims = [claim('a', 'p1'), claim('b', 'p1'), claim('c', 'p2')]
    const claimById = new Map(claims.map((c) => [c.claimId, c]))
    const planet: Planet = {
      seat: { slot: 3, label: '呼吸', kind: 'exchange', at: [1, 0, 0], r: 0.05, n: 3 },
      summary: { face: 'active', haze: false, core: true, outline: true, outlineAlpha: 1, halos: 0 },
      dots: [dot('a', 'p1', 'kept', 0.1), dot('b', 'p1', 'kept', 0.9), dot('c', 'p2', 'settled', 0.05)],
      pages: [{ pageId: 'p1', title: '記事 p1', n: 2, a0: 0, a1: 1 }, { pageId: 'p2', title: '記事 p2', n: 1, a0: 1, a1: 2 }],
    }
    const model = pageModelOf(planet, claimById)
    expect(model.pages.map((p) => p.escaping)).toEqual([1, 1])
  })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/lib/__tests__/recall-dex.test.ts -t "離れかけの数"`
Expected: FAIL（`escaping` が `undefined`）

- [ ] **Step 3: 実装**

`dex.ts` の `PageModel` に `escaping: number` を足し、`pageModelOf` の `pages.map` の返り値に足す:

```ts
export type PageModel = {
  plate: PlateModel
  pages: Array<{
    pageId: string
    title: string
    n: number
    escaping: number   // 目次のチップに出す離れかけの数（§2.1）
    sections: Array<{ ... 既存 ... }>
  }>
}
```

```ts
    const escaping = sections.reduce((sum, s) => sum + s.rows.filter((r) => r.look.kind === 'escaping').length, 0)
    return { pageId: page.pageId, title: page.title, n: page.n, escaping, sections }
```

- [ ] **Step 4: 通す**

Run: `npx vitest run src/lib/__tests__/recall-dex.test.ts`
Expected: PASS（既存のテストも含めて全部）

- [ ] **Step 5: コミット**

```bash
git add src/lib/recall/dex.ts src/lib/__tests__/recall-dex.test.ts
git commit -m "feat(recall): 分野ページのモデルに記事ごとの離れかけの数を足す（目次のチップ用）"
```

---

### Task 2: 7族の短い名詞と属する分野（`families.ts`）

**Files:**
- Create: `src/lib/recall/families.ts`
- Test: `src/lib/__tests__/recall-families.test.ts`

**Interfaces:**
- Consumes: `GENRE_SEATS`・`isRetiredSeat`・`genreLabel`（`genres.ts`）、`coreKindOf`・`CoreKind`（`cores.ts`）、`coreEnglishOf`（`genre-en.ts`）
- Produces:
  - `FAMILY_NOUN: Record<CoreKind, string>`（短い名詞。**いまは全部空文字**。オーナーが決めたら表を埋める）
  - `familyMembers(): Array<{ kind: CoreKind; en: string; noun: string; members: string[] }>`（`CoreKind` の定義順。members は席番号順の和名。廃番と 63番は含めない）
  - `FAMILY_ORDER: CoreKind[]`（`['flow','exchange','signal','invasion','structure','regulation','system']`）

- [ ] **Step 1: 失敗するテストを書く**

```ts
// 7族の表（Recall の説明の折りたたみに出す）。名詞は未定（空文字）でも表が組めること。
import { describe, it, expect } from 'vitest'
import { familyMembers, FAMILY_ORDER, FAMILY_NOUN } from '@/lib/recall/families'
import { GENRE_SEATS, isRetiredSeat, OTHER_SLOT } from '@/lib/recall/genres'
import { coreKindOf } from '@/lib/recall/cores'

describe('7族の表', () => {
  it('族は定義順に7つ', () => {
    expect(familyMembers().map((f) => f.kind)).toEqual(FAMILY_ORDER)
    expect(FAMILY_ORDER).toEqual(['flow', 'exchange', 'signal', 'invasion', 'structure', 'regulation', 'system'])
  })
  it('廃番と63番を除く全席が、ちょうど1つの族に入る', () => {
    const all = familyMembers().flatMap((f) => f.members)
    const expected = GENRE_SEATS.map((_, slot) => slot).filter((s) => s !== OTHER_SLOT && !isRetiredSeat(s) && GENRE_SEATS[s])
    expect(all.length).toBe(expected.length)
    expect(new Set(all).size).toBe(all.length)
  })
  it('属する分野は cores.ts の割り当てと一致する（手で二重に持たない）', () => {
    for (const f of familyMembers()) {
      for (const label of f.members) {
        const slot = GENRE_SEATS.findIndex((s) => s && s.replace(/^\d+\./, '') === label)
        expect(coreKindOf(slot)).toBe(f.kind)
      }
    }
  })
  it('英名と名詞を持つ（名詞は空文字でもよい）', () => {
    for (const f of familyMembers()) {
      expect(f.en.length).toBeGreaterThan(0)
      expect(typeof f.noun).toBe('string')
      expect(f.noun).toBe(FAMILY_NOUN[f.kind])
    }
  })
})
```

`GENRE_SEATS` の要素の形（番号つきか）は `genres.ts` を読んで合わせる。`genreLabel(slot)` が番号を落とした和名を返すなら、3つ目のテストは `GENRE_SEATS.findIndex((_, s) => genreLabel(s) === label)` にする。

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/lib/__tests__/recall-families.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装**

```ts
// 7族の表（純関数・表）。Recall の説明の折りたたみ（設計 2026-09-05 再計画 §3）に出す。
// 属する分野は cores.ts の coreKindOf から導く（手で二重に持たない）。
// 短い名詞（R12）はオーナーが決める。決まるまで空文字。動きの言葉（閉じて戻る 等）は画面に出さない。
import { GENRE_SEATS, OTHER_SLOT, isRetiredSeat, genreLabel } from './genres'
import { coreKindOf, type CoreKind } from './cores'
import { coreEnglishOf } from './genre-en'

export const FAMILY_ORDER: CoreKind[] = ['flow', 'exchange', 'signal', 'invasion', 'structure', 'regulation', 'system']

export const FAMILY_NOUN: Record<CoreKind, string> = {
  flow: '', exchange: '', signal: '', invasion: '', structure: '', regulation: '', system: '',
}

export type FamilyRow = { kind: CoreKind; en: string; noun: string; members: string[] }

export function familyMembers(): FamilyRow[] {
  const members = new Map<CoreKind, string[]>(FAMILY_ORDER.map((k) => [k, []]))
  for (let slot = 0; slot < GENRE_SEATS.length; slot++) {
    if (!GENRE_SEATS[slot] || slot === OTHER_SLOT || isRetiredSeat(slot)) continue
    members.get(coreKindOf(slot))!.push(genreLabel(slot))
  }
  return FAMILY_ORDER.map((kind) => ({ kind, en: coreEnglishOf(kind), noun: FAMILY_NOUN[kind], members: members.get(kind)! }))
}
```

- [ ] **Step 4: 通す**

Run: `npx vitest run src/lib/__tests__/recall-families.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/recall/families.ts src/lib/__tests__/recall-families.test.ts
git commit -m "feat(recall): 7族の表（英名・名詞・属する分野）を cores.ts から導く"
```

---

### Task 3: 分野ページの書き直し（目次・記事の帯・節・点の列・押した点の1行）

**Files:**
- Modify: `src/components/recall/RecallDot.tsx`（`hit` prop）
- Modify: `src/components/recall/RecallPlatePage.tsx`（**全面書き直し**。props は変えない）
- Test（実測）: `/dev/recall-screen` を playwright で撮る

**Interfaces:**
- Consumes: `PageModel`（Task 1 の `escaping` 込み）、`RecallDot`、`CoreEmblem`。props `{ model, onBack, onCheck, onRow(claimId, look), onEmblem, onRead, liftOpen }` は今のまま（`RecallScreen` を変えない）
- Produces: なし（画面だけ）

- [ ] **Step 1: `RecallDot` に当たり判定を足す**

```tsx
type Props = {
  look: DotLook
  size: number
  row?: boolean
  // 分野ページの点（14px）で true。::after で 26px の当たり判定を広げる（指で押せる）。
  hit?: boolean
  className?: string
}
```

`DOT_BASE` に `relative` を足し、`hit` のとき `after:content-[''] after:absolute after:-inset-1.5` を付ける（14px＋6px×2＝26px）。`<i>` は `aria-hidden` のままなので、押す役目は親の `<button>` が持つ（下の Step 2）。

- [ ] **Step 2: `RecallPlatePage.tsx` を書き直す**

見出しブロック（紋章・和名・英名・件数・ボタン2つ）は今のコードをそのまま残す。その下を次に置き換える。state は `selected: string | null`（押した点の claimId）だけ。

```tsx
const [selected, setSelected] = useState<string | null>(null)
const [current, setCurrent] = useState<string | null>(null) // いま画面にある記事（目次の濃いチップ）
const chipLabel = (title: string) => (title.length > 16 ? `${title.slice(0, 14)}…` : title)
const gold = 'text-[#A86B0C] dark:text-[#F0D68A]'

// 記事の見出しが画面に入ったら、その記事のチップを濃くする
useEffect(() => {
  const els = document.querySelectorAll<HTMLElement>('[data-recall-article]')
  if (!els.length || typeof IntersectionObserver === 'undefined') return
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) setCurrent(e.target.getAttribute('data-recall-article'))
  }, { rootMargin: '-80px 0px -60% 0px' })
  els.forEach((el) => io.observe(el))
  return () => io.disconnect()
}, [pages])

const onDot = (row: { claimId: string; look: DotLook }) => {
  if (selected === row.claimId) { onRow(row.claimId, row.look); return }   // 2回目＝カード
  setSelected(row.claimId)
}
```

描画（見出しブロックの直後）:

```tsx
{/* 凡例（§2.1） */}
<div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-slate-500 dark:text-slate-400">
  {(['cold', 'touched', 'kept', 'settled', 'escaping'] as DotKind[]).map((k) => (
    <span key={k} className="inline-flex items-center gap-1">
      <RecallDot look={{ kind: k, alpha: k === 'cold' ? 0.35 : k === 'touched' ? 0.55 : 1 }} size={9} row />{STATE_LABEL[k]}
    </span>
  ))}
</div>

{/* 記事の目次（§2.1・貼り付き） */}
<nav aria-label="記事" className="sticky top-0 z-[4] -mx-1 flex gap-1.5 overflow-x-auto border-b border-slate-300/60 dark:border-white/15 bg-[#F5F7FA] dark:bg-[#0B1524] px-1 py-2 [scrollbar-width:none]">
  {pages.map((page) => (
    <a key={page.pageId} href={`#recall-article-${page.pageId}`}
      onClick={(e) => { e.preventDefault(); document.getElementById(`recall-article-${page.pageId}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }}
      className={`shrink-0 max-w-[190px] truncate rounded-full border px-2.5 py-1 text-[11px] tracking-[.03em] tabular-nums ${current === page.pageId ? 'border-slate-700 text-slate-800 dark:border-white/70 dark:text-[#F2F5F1]' : 'border-slate-300/70 text-slate-500 dark:border-white/20 dark:text-slate-400'}`}>
      {chipLabel(page.title)}{page.escaping > 0 && <em className={`ml-1 not-italic ${gold}`}>{page.escaping}</em>}
    </a>
  ))}
</nav>

{pages.map((page) => (
  <section key={page.pageId} id={`recall-article-${page.pageId}`} data-recall-article={page.pageId} className="mt-4 scroll-mt-12">
    {/* 記事の見出し（R3・帯・貼り付き） */}
    <div className="sticky top-[44px] z-[3] -mx-4 flex items-baseline justify-between gap-3 border-l-[3px] border-slate-800 dark:border-[#F2F5F1] bg-[color-mix(in_srgb,#1e293b_6%,#F5F7FA)] dark:bg-[color-mix(in_srgb,#F2F5F1_6%,#0B1524)] px-4 py-2">
      <h3 className="min-w-0 text-[15px] font-medium leading-snug tracking-[.02em]">
        {page.title}<small className="ml-1.5 text-[11.5px] font-normal text-slate-500 dark:text-slate-400 tabular-nums">{page.n}</small>
      </h3>
      <button type="button" onClick={() => onRead(page.pageId, page.title)}
        className="shrink-0 text-[11px] text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
        記事を読む ›
      </button>
    </div>

    {page.sections.map((section) => {
      const picked = section.rows.find((r) => r.claimId === selected) ?? null
      return (
        <div key={section.sectionKey} className="mt-3">
          {section.heading && <p className="mb-1.5 text-[11px] tracking-[.06em] text-slate-500 dark:text-slate-400">{section.heading}</p>}
          <div className="flex flex-wrap gap-1.5">
            {section.rows.map((row) => (
              <button type="button" key={row.claimId} onClick={() => onDot(row)} aria-label={row.body}
                className={`relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${selected === row.claimId ? 'outline outline-2 outline-offset-2 outline-cyan-600 dark:outline-cyan-400' : ''}`}>
                <RecallDot look={row.look} size={14} hit />
              </button>
            ))}
          </div>
          {picked && (
            <button type="button" onClick={() => onRow(picked.claimId, picked.look)}
              className="mt-2 grid w-full grid-cols-[1fr_auto] items-center gap-2.5 border-l-2 border-cyan-600 dark:border-cyan-400 py-1 pl-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
              <span className="min-w-0">
                <span className="block truncate text-[12.5px] leading-snug">{picked.body}</span>
                <span className={`block text-[10.5px] ${picked.look.kind === 'escaping' ? gold : 'text-slate-500 dark:text-slate-400'}`}>
                  {STATE_LABEL[picked.look.kind]}{picked.look.kind === 'escaping' ? '　もう一度押すと確かめる' : ''}
                </span>
              </span>
              <span className="text-[11px] text-cyan-700 dark:text-cyan-300">開く ›</span>
            </button>
          )}
        </div>
      )
    })}
  </section>
))}
```

注意:
- 目次の `top-0`、記事の帯の `top-[44px]` は目次の実高さに合わせる。playwright で `getBoundingClientRect` を測って直す
- 帯の背景は Tailwind の任意値で `color-mix` を書く。書けなければ `globals.css` に `.recall-article-band` を1つ足す
- `STATE_LABEL` は既存の定数をそのまま使う
- 既存の `hidden min-[560px]:inline` の「状態の語」の列は無くなる（1行の側に移る）

- [ ] **Step 3: 型とテストを回す**

Run: `npx tsc --noEmit -p tsconfig.json && npm test`
Expected: 型エラーなし・全テスト PASS（`RecallPlatePage` を直接読むテストは無い。`recall-dex` 系が通ること）

- [ ] **Step 4: 実画面で測る（playwright）**

dev server を起動し、`/dev/recall-screen` をスマホ幅で開いて「呼吸」（主張178）を開く。撮るもの: ライト・ダークの上端／中程／点を押した状態／離れかけの点を押した状態／目次を押して飛んだ直後。

```python
# scratchpad/plate.py（要点だけ。記憶 playwright-screenshot-for-visual-check の形）
await pg.goto('http://localhost:3210/dev/recall-screen', wait_until='networkidle')
await pg.locator('button[aria-label="呼吸"]').click(); await pg.wait_for_timeout(800)
h = await pg.evaluate('document.documentElement.scrollHeight'); print('height', h)   # 3,000 未満
await pg.locator('button[aria-label]').filter(has=pg.locator('i')).nth(3).click()   # 点を押す
await pg.screenshot(path='shots/plate-picked.png')
```

確認の観点（設計 §2.1）: 記事名と節の見出しが一目で区別できる／点が 14px で並ぶ／押した点の下に本文1行と状態の語／もう一度押すとカード／目次のチップで飛べる・いまの記事が濃い／高さが 3,000px 未満。

- [ ] **Step 5: コミット**

```bash
git add src/components/recall/RecallDot.tsx src/components/recall/RecallPlatePage.tsx
git commit -m "feat(recall): 分野ページを記事ごとの点の地図に書き直す（目次・記事の帯・押した点の1行）"
```

---

### Task 4: Recall の説明（1文＋「Recall とは」の折りたたみ）

**Files:**
- Modify: `src/components/recall/RecallDex.tsx`（見出しの下）
- Create: `src/components/recall/RecallAbout.tsx`（折りたたみ本体）
- Modify: `src/lib/recall/families.ts`（変更なし。読むだけ）
- Test（純関数）: `src/lib/__tests__/recall-about.test.ts`（開閉の初期値の判断）

**Interfaces:**
- Consumes: `familyMembers()`（Task 2）、`RecallDot`、`STATE_LABEL` 相当（`RecallPlatePage` の定数を `dex.ts` へ移して共有してよい: `export const STATE_LABEL: Record<DotKind, string>`）
- Produces: `aboutOpenInitial(stored: string | null): boolean`（`src/lib/recall/about.ts`。`null` → true、`'0'` → false、`'1'` → true）

- [ ] **Step 1: 失敗するテストを書く**

```ts
import { describe, it, expect } from 'vitest'
import { aboutOpenInitial, ABOUT_KEY } from '@/lib/recall/about'

describe('Recall とは の開閉', () => {
  it('初めて（保存なし）は開いた状態', () => { expect(aboutOpenInitial(null)).toBe(true) })
  it("閉じた記録 '0' なら閉じる。'1' なら開く", () => {
    expect(aboutOpenInitial('0')).toBe(false)
    expect(aboutOpenInitial('1')).toBe(true)
  })
  it('壊れた値は開いた扱い（説明を隠すより見せる方が安全）', () => { expect(aboutOpenInitial('x')).toBe(true) })
  it('保存キー', () => { expect(ABOUT_KEY).toBe('recall.aboutOpen') })
})
```

- [ ] **Step 2: 失敗を確かめる**

Run: `npx vitest run src/lib/__tests__/recall-about.test.ts`
Expected: FAIL（モジュールが無い）

- [ ] **Step 3: 実装（純関数と部品）**

`src/lib/recall/about.ts`:

```ts
// 「Recall とは」の折りたたみの初期状態（設計 2026-09-05 再計画 §3）。
export const ABOUT_KEY = 'recall.aboutOpen'
export const aboutOpenInitial = (stored: string | null): boolean => stored !== '0'
```

`src/components/recall/RecallAbout.tsx`:

```tsx
'use client'
// 「Recall とは」の折りたたみ。仕組みの4文・点の凡例・族の1文・7族の表。
// 開閉は localStorage（ABOUT_KEY）。初めてのときは開いた状態。
import { useEffect, useState } from 'react'
import { RecallDot } from './RecallDot'
import { familyMembers } from '@/lib/recall/families'
import { aboutOpenInitial, ABOUT_KEY } from '@/lib/recall/about'
import { STATE_LABEL, type DotKind } from '@/lib/recall/dex'

const LEGEND: DotKind[] = ['cold', 'touched', 'kept', 'settled', 'escaping']
const legendAlpha = (k: DotKind) => (k === 'cold' ? 0.35 : k === 'touched' ? 0.55 : 1)

export function RecallAbout() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    try { setOpen(aboutOpenInitial(localStorage.getItem(ABOUT_KEY))) } catch { setOpen(true) }
  }, [])
  const toggle = (next: boolean) => {
    setOpen(next)
    try { localStorage.setItem(ABOUT_KEY, next ? '1' : '0') } catch { /* 書けない端末では覚えない */ }
  }
  const rows = familyMembers()
  const hasNoun = rows.some((r) => r.noun)
  return (
    <details open={open} onToggle={(e) => toggle((e.currentTarget as HTMLDetailsElement).open)}
      className="mt-2 text-[12px] leading-relaxed text-slate-600 dark:text-slate-300">
      <summary className="cursor-pointer select-none text-[11.5px] tracking-[.06em] text-slate-500 dark:text-slate-400">Recall とは ›</summary>
      <p className="mt-2">記事を読むと、検証済みの主張が分野ごとの点になります。カードで「残す」と点が濃くなり、時間が経つと薄れて「離れかけ」（金）になります。離れかけを確かめて答えると、また濃くなり、次に確かめる日が延びます。二度目に同じことを調べなくて済むための場所です。</p>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] text-slate-500 dark:text-slate-400">
        {LEGEND.map((k) => (
          <span key={k} className="inline-flex items-center gap-1"><RecallDot look={{ kind: k, alpha: legendAlpha(k) }} size={9} row />{STATE_LABEL[k]}</span>
        ))}
      </div>
      <p className="mt-3">分野は臓器ではなく、体の中の動きの型で7つの族に分けています。紋章はその動きをしています。</p>
      <table className="mt-2 w-full text-[11.5px]">
        <tbody>
          {rows.map((r) => (
            <tr key={r.kind} className="align-top border-t border-slate-200/70 dark:border-white/10">
              <th scope="row" className="py-1.5 pr-3 text-left font-normal uppercase tracking-[.12em] text-slate-500 dark:text-slate-400 whitespace-nowrap">{r.en}</th>
              {hasNoun && <td className="py-1.5 pr-3 whitespace-nowrap">{r.noun}</td>}
              <td className="py-1.5 text-slate-500 dark:text-slate-400">{r.members.join('・')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}
```

`STATE_LABEL` を `RecallPlatePage.tsx` から `dex.ts` へ移し（`export const STATE_LABEL`）、`RecallPlatePage` はそれを import する。

`RecallDex.tsx` の見出し:

```tsx
<p className="mt-1.5 text-[11px] tracking-[.08em] text-slate-500 dark:text-slate-400">
  今まで読んできた記事の主張をこの一覧で確認できます。色が濃くなるほど、自分の知識として深まっているものです。
</p>
<RecallAbout />
```

（今の「検証済みの主張 {total}　濃いほど、自分のもの」は消す。右の数字ブロックは残す。）

- [ ] **Step 4: 通す・型・実画面**

Run: `npx vitest run src/lib/__tests__/recall-about.test.ts && npx tsc --noEmit -p tsconfig.json && npm test`
Expected: PASS・型エラーなし

playwright で `/dev/recall-screen` を開き、初回（localStorage 空）に折りたたみが開いていること、閉じて再読み込みで閉じたままなこと、7族の表に属する分野が並ぶこと（名詞の列は無い）を撮る。ライト・ダーク。

- [ ] **Step 5: コミット**

```bash
git add src/lib/recall/about.ts src/lib/__tests__/recall-about.test.ts src/components/recall/RecallAbout.tsx src/components/recall/RecallDex.tsx src/components/recall/RecallPlatePage.tsx src/lib/recall/dex.ts
git commit -m "feat(recall): 一覧に Recall の説明（1文＋「Recall とは」の折りたたみ・7族の表）を置く"
```

---

### Task 5: 仕上げ（全テスト・ビルド・本番反映の手順）

**Files:**
- なし（確認だけ）

- [ ] **Step 1: 全件**

Run: `npm test && npx tsc --noEmit -p tsconfig.json && npm run build`
Expected: 全 PASS・型エラーなし・ビルド成功

- [ ] **Step 2: 実画面の最終確認**

`/dev/recall-screen` で「離れかけを順に確かめる」を押し、分野ページの点の列の上でカードが順に出て、答えると点が濃くなること（600ms）を playwright の動画かスクショ3枚で残す。隠しコマンド（紋章）を押して覆いが今までどおり出ることも確認（計画B の前提）。

- [ ] **Step 3: マージと本番**

`superpowers:finishing-a-development-branch` に従う。main へマージしたら **push は tatsukiさんの承認を取る**（グローバル規則）。push 後は Vercel のデプロイが Ready になり、本番の Recall タブで分野ページが点の列になっていることを見てから完了とする（記憶 `merge-is-not-deploy`）。

---

## 自己点検（計画を書いたあと）

- 設計 §2.1 の各項目 → Task 3（凡例・目次・帯・節・点・1行・カード後の遷移は既存）。§2.3 → Task 1。§3 → Task 2・4。§6 のテスト → Task 1・2・4（純関数）と Task 3・5（playwright）
- 型の一致: `PageModel.pages[].escaping`（Task 1）を Task 3 が読む。`familyMembers()`（Task 2）を Task 4 が読む。`STATE_LABEL` は Task 4 で `dex.ts` へ移す（Task 3 の時点では `RecallPlatePage` 内の定数のまま）
- 置き場のない項目: なし
