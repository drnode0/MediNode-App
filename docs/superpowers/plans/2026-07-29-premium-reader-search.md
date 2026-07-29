# プレミアム読書体験 第3波 実装計画（リーダー内検索＋横断本文検索＋つづけて読む枠）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プレミアムナレッジの「探す→読む→次へ進む」を完成させる — リーダー内検索（①）、Algolia節レコードによる横断本文検索（②）、リーダー末尾「つづけて読む」枠（③）。

**Architecture:** ①はクライアント完結（ReaderDoc走査＋`<mark>`注入、DOMのmark列でprev/nextジャンプ）。②はsyncが本文を`## N.`節に分割した子レコードをAlgoliaに追加し、`distinct(parentId)`でページ単位に集約、スニペットのみ応答。③はsyncが`参考文献`リレーションを同期し、リーダー末尾でAlgolia経由の関連ナレッジ自動算出＋根拠文献を表示。

**Tech Stack:** Next.js (App Router) / React / TypeScript / Algolia (algoliasearch v4 + react-instantsearch v7) / vitest / Tailwind

**Spec:** `docs/superpowers/specs/2026-07-29-premium-reader-search-design.md`

## Global Constraints

- ブランチ: `feat/premium-reader-search` を main から作成（開始前に `git branch --show-current` で現在ブランチ確認必須）
- 文言トーン: 宣伝調・AI主役の文言NG。「見つかりません」「つづけて読む」等の静かな日本語
- ダークモード: Tailwindは `dark:` プレフィックス。生CSSを書く場合は `.dark` セレクタ基準（`@media (prefers-color-scheme)` 禁止）
- テスト: 純関数は必ず vitest でユニットテスト（TDD: 失敗を確認してから実装）
- テスト実行: `npx vitest run <path>`（全体は `npm run test`）
- デプロイ前: `public/sw.js` の `CACHE_VERSION` を bump（現在 `medinode-v22`）
- Notion絵文字の確信度マーク（✅⚠️❓）はデータ由来。検索正規化で変換・除去しない

---

### Task 1: リーダー内検索の純関数（reader-search.ts）

**Files:**
- Create: `src/lib/reader-search.ts`
- Test: `src/lib/__tests__/reader-search.test.ts`

**Interfaces:**
- Produces:
  - `normalizeForSearch(s: string): string` — 長さ不変の1文字正規化（小文字化・カタカナ→ひらがな・全角英数→半角）
  - `type MatchRange = { start: number; end: number }`
  - `findMatchRanges(text: string, query: string): MatchRange[]` — 正規化後の部分一致レンジ（元文字列のindex）
  - `type InlineSegment = { text: string; mark: boolean }`
  - `inlineSegments(inlines: ReaderInline[], ranges: MatchRange[]): InlineSegment[][]` — 連結テキスト上のレンジを各inlineのセグメント列へ割付

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/reader-search.test.ts
import { describe, it, expect } from 'vitest'
import { normalizeForSearch, findMatchRanges, inlineSegments } from '../reader-search'
import type { ReaderInline } from '../reader-doc'

const inl = (text: string): ReaderInline => ({ text })

describe('normalizeForSearch', () => {
  it('カタカナをひらがなに揃える', () => {
    expect(normalizeForSearch('ナトリウム')).toBe('なとりうむ')
  })
  it('全角英数を半角小文字に揃える', () => {
    expect(normalizeForSearch('ＮａＣｌ　１２３')).toBe('nacl　123')
  })
  it('長さを変えない（indexマッピングの前提）', () => {
    const s = 'Ｎa トｶﾞ✅⚠️'
    expect(normalizeForSearch(s).length).toBe(s.length)
  })
})

describe('findMatchRanges', () => {
  it('かな/カナ・全半角・大小を無視して一致する', () => {
    expect(findMatchRanges('低ナトリウム血症', 'なとりうむ')).toEqual([{ start: 1, end: 6 }])
    expect(findMatchRanges('NaCl 投与', 'ｎａｃｌ')).toEqual([{ start: 0, end: 4 }])
  })
  it('複数ヒットを重複なしで返す', () => {
    expect(findMatchRanges('補正、補正、補正', '補正')).toEqual([
      { start: 0, end: 2 }, { start: 3, end: 5 }, { start: 6, end: 8 },
    ])
  })
  it('空クエリ・空白のみは空配列', () => {
    expect(findMatchRanges('本文', '')).toEqual([])
    expect(findMatchRanges('本文', '  ')).toEqual([])
  })
})

describe('inlineSegments', () => {
  it('単一inline内のレンジをセグメントに割る', () => {
    const segs = inlineSegments([inl('低Na血症とは')], [{ start: 1, end: 3 }])
    expect(segs).toEqual([[
      { text: '低', mark: false },
      { text: 'Na', mark: true },
      { text: '血症とは', mark: false },
    ]])
  })
  it('inline境界をまたぐレンジを両側に割り付ける', () => {
    // 連結テキスト "低Na血症"。レンジ {1,4} は inline0の"Na"とinline1の"血"にまたがる
    const segs = inlineSegments([inl('低Na'), inl('血症')], [{ start: 1, end: 4 }])
    expect(segs).toEqual([
      [{ text: '低', mark: false }, { text: 'Na', mark: true }],
      [{ text: '血', mark: true }, { text: '症', mark: false }],
    ])
  })
  it('レンジなしなら各inlineが1セグメント', () => {
    expect(inlineSegments([inl('あ'), inl('い')], [])).toEqual([
      [{ text: 'あ', mark: false }],
      [{ text: 'い', mark: false }],
    ])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/lib/__tests__/reader-search.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 3: 実装を書く**

```ts
// src/lib/reader-search.ts
// リーダー内検索の純関数。正規化は「長さ不変」が絶対条件 —
// 正規化後のindexをそのまま元文字列のindexとして使うため（NFKCは長さが変わるので使わない）。
import type { ReaderInline } from './reader-doc'

// 1コードポイント→1コードポイントの正規化: 小文字化・カタカナ→ひらがな・全角英数記号→半角。
// 変換で長さが変わる文字（ß等の特殊小文字化）は元のまま残す。
export function normalizeForSearch(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0)!
    let norm: string
    if (code >= 0x30a1 && code <= 0x30f6) norm = String.fromCodePoint(code - 0x60)
    else if (code >= 0xff01 && code <= 0xff5e) norm = String.fromCodePoint(code - 0xfee0).toLowerCase()
    else norm = ch.toLowerCase()
    out += norm.length === ch.length ? norm : ch
  }
  return out
}

export type MatchRange = { start: number; end: number }

export function findMatchRanges(text: string, query: string): MatchRange[] {
  const q = normalizeForSearch(query.trim())
  if (!q) return []
  const t = normalizeForSearch(text)
  const out: MatchRange[] = []
  let i = 0
  for (;;) {
    const at = t.indexOf(q, i)
    if (at === -1) break
    out.push({ start: at, end: at + q.length })
    i = at + q.length
  }
  return out
}

export type InlineSegment = { text: string; mark: boolean }

// inlines を連結したテキスト上のレンジを、各 inline 内のセグメント列（mark有無つき）へ割り付ける。
export function inlineSegments(inlines: ReaderInline[], ranges: MatchRange[]): InlineSegment[][] {
  const out: InlineSegment[][] = []
  let offset = 0
  for (const inline of inlines) {
    const len = inline.text.length
    const end = offset + len
    const segs: InlineSegment[] = []
    let cursor = 0 // inline内の相対位置
    for (const r of ranges) {
      const s = Math.max(r.start - offset, 0)
      const e = Math.min(r.end - offset, len)
      if (e <= 0 || s >= len || e <= s) continue
      if (s > cursor) segs.push({ text: inline.text.slice(cursor, s), mark: false })
      segs.push({ text: inline.text.slice(s, e), mark: true })
      cursor = e
    }
    if (cursor < len) segs.push({ text: inline.text.slice(cursor), mark: false })
    if (segs.length === 0) segs.push({ text: inline.text, mark: false })
    out.push(segs)
    offset = end
  }
  return out
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/__tests__/reader-search.test.ts`
Expected: PASS（全ケース）

- [ ] **Step 5: コミット**

```bash
git add src/lib/reader-search.ts src/lib/__tests__/reader-search.test.ts
git commit -m "feat(reader): リーダー内検索の純関数（正規化・レンジ検出・セグメント割付）"
```

---

### Task 2: 本文ハイライト描画（ReaderBody＋検索コンテキスト）

**Files:**
- Create: `src/components/reader/reader-search-context.ts`
- Modify: `src/components/reader/ReaderBody.tsx`（`Inlines` コンポーネント）
- Modify: `src/app/globals.css`（アクティブmarkの生CSS）

**Interfaces:**
- Consumes: Task 1 の `findMatchRanges` / `inlineSegments`
- Produces:
  - `ReaderSearchCtx: React.Context<string>` — 現在の検索クエリ（空文字=非検索）
  - 本文中のヒットが `<mark data-reader-search>` で描画される（Task 3 がDOMからこのmark列を拾ってジャンプ）

- [ ] **Step 1: 検索コンテキストを作る**

```ts
// src/components/reader/reader-search-context.ts
import { createContext } from 'react'

// リーダー内検索の現在クエリ。空文字なら非検索（ハイライトなし）。
// Provider は ReaderOverlay、Consumer は ReaderBody の Inlines。
export const ReaderSearchCtx = createContext<string>('')
```

- [ ] **Step 2: Inlines にハイライト描画を足す**

`ReaderBody.tsx` の `Inlines` を修正。冒頭のimportに追加:

```ts
import { ReaderSearchCtx } from './reader-search-context'
import { findMatchRanges, inlineSegments } from '@/lib/reader-search'
```

`Inlines` 本体（現行 67-107行目）を次に置き換え（変更点: `searchQuery` をctxから読み、セグメント描画ヘルパー `withMarks` を通す）:

```tsx
function Inlines({ items, k, plain }: { items: ReaderInline[]; k: string; plain?: boolean }) {
  const noAutoMarker = useContext(NoAutoMarkerCtx)
  const searchQuery = useContext(ReaderSearchCtx)
  // 検索中だけ、inlines連結テキスト上のヒットレンジを各inlineのセグメントに割り付ける。
  const segs = searchQuery
    ? inlineSegments(items, findMatchRanges(items.map((n) => n.text).join(''), searchQuery))
    : null

  // 1つのinlineのテキストを（検索セグメントを挟みつつ）描画する。
  // mark の中でも確信度マーク分割（renderText）は生かす。
  const renderInlineText = (n: ReaderInline, i: number) => {
    const body = (text: string, key: string) => (plain ? text : renderText(text, key))
    if (!segs) return body(n.text, `${k}-${i}`)
    return segs[i].map((seg, j) =>
      seg.mark ? (
        <mark
          key={`${k}-${i}-${j}`}
          data-reader-search=""
          className="bg-yellow-200 dark:bg-yellow-500/40 text-inherit rounded-[2px]"
        >
          {body(seg.text, `${k}-${i}-${j}`)}
        </mark>
      ) : (
        <span key={`${k}-${i}-${j}`}>{body(seg.text, `${k}-${i}-${j}`)}</span>
      ),
    )
  }

  return (
    <>
      {items.map((n, i) => {
        const color = n.color ? INLINE_COLOR[n.color] ?? '' : ''
        const autoMarker = !noAutoMarker && n.bold && !n.code ? BOLD_MARKER : ''
        const cls = [
          n.bold ? 'font-bold' : '',
          n.italic ? 'italic' : '',
          n.code ? 'font-mono text-[0.85em] bg-gray-100 dark:bg-gray-700 px-1 rounded' : '',
          plain ? '' : color || autoMarker,
        ].join(' ')
        if (n.href) {
          const prevMark = MARK_OF[items[i - 1]?.text?.trim() ?? '']
          const linkColor = prevMark ? MARK_COLOR[prevMark] : 'text-brand-600 dark:text-brand-300'
          return (
            <a
              key={i}
              href={n.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`出典: ${n.text}`}
              className={`${cls} ${linkColor} underline underline-offset-2 break-words [overflow-wrap:anywhere]`}
            >
              {renderInlineText(n, i)}
            </a>
          )
        }
        return (
          <span key={i} className={cls}>
            {renderInlineText(n, i)}
          </span>
        )
      })}
    </>
  )
}
```

注意: `plain` 指定（番号なしH2見出し等）でもセグメント自体は描画される（markは付く）。既存の `renderText` / `MARK_OF` / `INLINE_COLOR` / `BOLD_MARKER` はそのまま使う。

- [ ] **Step 3: アクティブmarkの生CSSを globals.css に追加**

`src/app/globals.css` の末尾に追加（現在ヒット位置の強調。classはTask 3のDOM操作で付け外しする）:

```css
/* リーダー内検索: 現在位置のヒット強調（.dark 基準 — @media は使わない） */
mark[data-reader-search].reader-search-active {
  outline: 2px solid #f59e0b;
  outline-offset: 1px;
}
.dark mark[data-reader-search].reader-search-active {
  outline-color: #fbbf24;
}
```

- [ ] **Step 4: ビルドが通ることを確認**

Run: `npx tsc --noEmit`
Expected: エラーなし（既存エラーが元からある場合はこの変更由来の新規エラーがないこと）

- [ ] **Step 5: コミット**

```bash
git add src/components/reader/reader-search-context.ts src/components/reader/ReaderBody.tsx src/app/globals.css
git commit -m "feat(reader): 本文ハイライト描画 — 検索コンテキストとmark注入"
```

---

### Task 3: 検索バーUI＋prev/nextジャンプ＋open()の連携口

**Files:**
- Create: `src/components/reader/ReaderSearchBar.tsx`
- Modify: `src/components/reader/ReaderOverlay.tsx`
- Modify: `src/components/reader/SubscriptionReader.tsx`

**Interfaces:**
- Consumes: Task 2 の `ReaderSearchCtx`、DOM上の `mark[data-reader-search]`
- Produces:
  - `ReaderOpenOptions = { searchQuery?: string; sectionNo?: number }`（SubscriptionReader からexport）
  - `useReader().open(hit, opts?)` — 第2引数追加（後方互換: 省略可）。Task 8 が使う
  - ReaderOverlay の `initial?: ReaderOpenOptions` prop

- [ ] **Step 1: ReaderSearchBar を作る**

```tsx
// src/components/reader/ReaderSearchBar.tsx
'use client'
// リーダー内検索バー。IME確定（compositionend）までクエリを適用しない。
// 件数・prev/next はDOM上の mark[data-reader-search] を親（ReaderOverlay）が数えて渡す。
import { useEffect, useRef, useState } from 'react'
import { ChevronUp, ChevronDown, X } from 'lucide-react'

export function ReaderSearchBar({
  onQuery,
  total,
  pos,
  onPrev,
  onNext,
  onClose,
  initialValue = '',
}: {
  onQuery: (q: string) => void
  total: number
  pos: number
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  initialValue?: string
}) {
  const [value, setValue] = useState(initialValue)
  const composingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const apply = (v: string) => {
    if (!composingRef.current) onQuery(v)
  }

  return (
    <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
      <input
        ref={inputRef}
        type="search"
        value={value}
        placeholder="この記事の中を検索"
        aria-label="この記事の中を検索"
        onChange={(e) => { setValue(e.target.value); apply(e.target.value) }}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={(e) => { composingRef.current = false; onQuery(e.currentTarget.value) }}
        className="flex-1 min-w-0 text-sm bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-300"
      />
      <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400 min-w-[3.5rem] text-center" aria-live="polite">
        {value.trim() === '' ? '' : total === 0 ? '見つかりません' : `${pos + 1}/${total}`}
      </span>
      <button type="button" onClick={onPrev} disabled={total === 0} aria-label="前のヒットへ"
        className="min-h-[44px] min-w-[36px] inline-flex items-center justify-center text-gray-500 dark:text-gray-400 disabled:opacity-40">
        <ChevronUp className="w-4 h-4" />
      </button>
      <button type="button" onClick={onNext} disabled={total === 0} aria-label="次のヒットへ"
        className="min-h-[44px] min-w-[36px] inline-flex items-center justify-center text-gray-500 dark:text-gray-400 disabled:opacity-40">
        <ChevronDown className="w-4 h-4" />
      </button>
      <button type="button" onClick={onClose} aria-label="検索を閉じる"
        className="min-h-[44px] min-w-[36px] inline-flex items-center justify-center text-gray-500 dark:text-gray-400">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
```

- [ ] **Step 2: SubscriptionReader に open() の第2引数を足す**

`SubscriptionReader.tsx` を修正:

```ts
export type ReaderOpenOptions = { searchQuery?: string; sectionNo?: number }
type ReaderCtx = { open: (hit: ReaderHit, opts?: ReaderOpenOptions) => void }
```

`ReaderProvider` 内:

```ts
const [openOpts, setOpenOpts] = useState<ReaderOpenOptions | undefined>(undefined)

const open = useCallback((h: ReaderHit, opts?: ReaderOpenOptions) => {
  triggerRef.current = (document.activeElement as HTMLElement | null) ?? null
  setOpenOpts(opts)
  runFetch(h)
}, [runFetch])
```

`close` に `setOpenOpts(undefined)` を追加。`<ReaderOverlay ... initial={openOpts} />` を渡す。
`useReader()` のフォールバックは `{ open: () => {} }` のままでよい（引数追加は後方互換）。

- [ ] **Step 3: ReaderOverlay に検索状態・ジャンプ・initial処理を足す**

`ReaderOverlay.tsx` を修正。import追加:

```ts
import { Search } from 'lucide-react'
import { ReaderSearchBar } from './ReaderSearchBar'
import { ReaderSearchCtx } from './reader-search-context'
import type { ReaderOpenOptions } from './SubscriptionReader'
```

props に `initial?: ReaderOpenOptions` を追加。コンポーネント内に状態を追加:

```ts
const [searchOpen, setSearchOpen] = useState(false)
const [searchQuery, setSearchQuery] = useState('')
const [searchPos, setSearchPos] = useState(0)
const [searchTotal, setSearchTotal] = useState(0)
```

既存の「ページが変わるたびリセット」effect（53-56行目）に追加:

```ts
setSearchOpen(false); setSearchQuery(''); setSearchPos(0)
```

Escapeハンドラ（59行目）を修正 — 検索が開いていれば先に検索を閉じる:

```ts
const onKey = (e: KeyboardEvent) => {
  if (e.key !== 'Escape') return
  if (zoom) { onZoom(null); return }
  if (searchOpen) { setSearchOpen(false); setSearchQuery(''); return }
  onClose()
}
```
（effect依存配列に `searchOpen` を追加）

mark集計・現在位置クラスのeffectとジャンプ関数を追加:

```ts
// DOM上のmark列が真実。クエリ・doc変化後の描画コミット後に数え、現在位置クラスを付け替える。
useEffect(() => {
  const root = scrollRef.current
  if (!root) return
  const marks = Array.from(root.querySelectorAll<HTMLElement>('mark[data-reader-search]'))
  setSearchTotal(marks.length)
  const clamped = Math.min(searchPos, Math.max(0, marks.length - 1))
  if (clamped !== searchPos) setSearchPos(clamped)
  marks.forEach((m, i) => m.classList.toggle('reader-search-active', i === clamped))
}, [searchQuery, doc, searchPos])

const jumpToMark = useCallback((next: number) => {
  const root = scrollRef.current
  if (!root) return
  const marks = root.querySelectorAll<HTMLElement>('mark[data-reader-search]')
  if (marks.length === 0) return
  const idx = ((next % marks.length) + marks.length) % marks.length
  setSearchPos(idx)
  marks[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}, [])
```

クエリ変更時は位置を先頭へ（ReaderSearchBarへ渡す onQuery 内で `setSearchPos(0)`）。

initial（②からの deep-link）処理のeffectを追加:

```ts
// 外部（横断検索）から渡された初期クエリ・節番号を、本文が描画できた時点で一度だけ適用する。
const initialAppliedRef = useRef(false)
useEffect(() => { initialAppliedRef.current = false }, [hit.objectID])
useEffect(() => {
  if (state !== 'idle' || !doc || !initial || initialAppliedRef.current) return
  initialAppliedRef.current = true
  if (initial.searchQuery) {
    setSearchOpen(true)
    setSearchQuery(initial.searchQuery)
  }
  if (initial.sectionNo != null) {
    requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector<HTMLElement>(`[data-section="${initial.sectionNo}"]`)
        ?.scrollIntoView({ block: 'start' })
    })
  }
}, [state, doc, initial])
```

（`data-section` の値は `sectionAnchor(n, index)`＝番号付きH2なら `String(n)`。`initial.sectionNo` はその番号。）

JSX: ヘッダー行の左側（ブックマーク★の隣）に検索トグルを追加:

```tsx
<button
  type="button"
  onClick={() => { setSearchOpen((o) => !o); if (searchOpen) setSearchQuery('') }}
  aria-pressed={searchOpen}
  aria-label="記事内を検索"
  className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
>
  <Search className="w-5 h-5" />
</button>
```

ヘッダー行の直後（スクロール領域の前）に:

```tsx
{searchOpen && (
  <ReaderSearchBar
    onQuery={(q) => { setSearchQuery(q); setSearchPos(0) }}
    total={searchTotal}
    pos={searchPos}
    onPrev={() => jumpToMark(searchPos - 1)}
    onNext={() => jumpToMark(searchPos + 1)}
    onClose={() => { setSearchOpen(false); setSearchQuery('') }}
    initialValue={searchQuery}
  />
)}
```

`ReaderBody` を Provider で包む（`state === 'idle' && doc` の分岐内）:

```tsx
<ReaderSearchCtx.Provider value={searchOpen ? searchQuery : ''}>
  <ReaderBody doc={doc} onImageClick={(u) => onZoom(u)} active={active} />
</ReaderSearchCtx.Provider>
```

- [ ] **Step 4: 手動検証（プレビュー）**

`npm run dev`（または .claude/launch.json のdev構成）でプレミアムナレッジを開き:
- 検索アイコン→バー表示→「ナトリウム」等で入力→ハイライト＋件数表示
- prev/nextで該当位置へスクロール・現在位置にアウトライン
- IME変換中に件数が動かない・確定で反映
- Escで検索→リーダーの順に閉じる
- 0件時「見つかりません」

- [ ] **Step 5: コミット**

```bash
git add src/components/reader/ReaderSearchBar.tsx src/components/reader/ReaderOverlay.tsx src/components/reader/SubscriptionReader.tsx
git commit -m "feat(reader): リーダー内検索 — 検索バー・prev/nextジャンプ・外部連携口(open opts)"
```

---

### Task 4: 節分割の純関数（subscription-sections.ts）

**Files:**
- Create: `src/lib/subscription-sections.ts`
- Modify: `src/lib/content-stats.ts`（`blockText` をexport）
- Test: `src/lib/__tests__/subscription-sections.test.ts`

**Interfaces:**
- Consumes: `NotionBlockLite`（content-stats）
- Produces:
  - `splitIntoSections(blocks: NotionBlockLite[]): SectionChunk[]` — `type SectionChunk = { sectionNo: number; sectionTitle: string; part: number; text: string }`
  - `buildSectionRecords(parent: Record<string, unknown>, chunks: SectionChunk[]): Record<string, unknown>[]`
  - `extractRelationIds(prop: Record<string, unknown>): string[]`

- [ ] **Step 1: content-stats.ts の `blockText` に export を付ける**

```ts
export function blockText(block: NotionBlockLite): string {
```
（本体は変更しない）

- [ ] **Step 2: 失敗するテストを書く**

```ts
// src/lib/__tests__/subscription-sections.test.ts
import { describe, it, expect } from 'vitest'
import { splitIntoSections, buildSectionRecords, extractRelationIds, SECTION_MAX_BYTES } from '../subscription-sections'
import type { NotionBlockLite } from '../content-stats'

const para = (text: string): NotionBlockLite => ({ type: 'paragraph', paragraph: { rich_text: [{ plain_text: text }] } })
const h2 = (text: string): NotionBlockLite => ({ type: 'heading_2', heading_2: { rich_text: [{ plain_text: text }] } })
const h1 = (text: string): NotionBlockLite => ({ type: 'heading_1', heading_1: { rich_text: [{ plain_text: text }] } })

describe('splitIntoSections', () => {
  it('番号付きH2で節を切り、前文はsec0になる', () => {
    const secs = splitIntoSections([
      h1('Question'), para('結論と署名'),
      h2('1. 病態'), para('本文A'),
      h2('2. 治療'), para('本文B'),
    ])
    expect(secs.map((s) => [s.sectionNo, s.sectionTitle])).toEqual([
      [0, ''], [1, '病態'], [2, '治療'],
    ])
    expect(secs[0].text).toContain('結論と署名')
    expect(secs[1].text).toContain('本文A')
    // 節見出し自体も本文に含める（見出し語でもヒットさせるため）
    expect(secs[1].text).toContain('病態')
  })
  it('番号なしH2は節境界にしない（現行節に含める）', () => {
    const secs = splitIntoSections([h2('1. 病態'), para('A'), h2('確信度の見方'), para('凡例')])
    expect(secs).toHaveLength(1)
    expect(secs[0].text).toContain('凡例')
  })
  it('バイト上限を超える節は文単位でpart分割する', () => {
    const long = 'あ'.repeat(2000) + '。' + 'い'.repeat(2000) + '。'
    const secs = splitIntoSections([h2('1. 長い'), para(long)])
    expect(secs.length).toBeGreaterThan(1)
    for (const s of secs) {
      expect(Buffer.byteLength(s.text, 'utf8')).toBeLessThanOrEqual(SECTION_MAX_BYTES)
      expect(s.sectionNo).toBe(1)
    }
    expect(secs.map((s) => s.part)).toEqual(secs.map((_, i) => i))
  })
  it('空テキストの節は返さない', () => {
    expect(splitIntoSections([h2('1. 空')])).toHaveLength(1) // 見出しテキストのみでも節にはなる
    expect(splitIntoSections([])).toHaveLength(0)
  })
})

describe('buildSectionRecords', () => {
  const parent = {
    objectID: 'subscription_abc', title: '低Na血症', genre: ['腎臓'], source: 'medical',
    owner: 'subscription', aiSummary: '要約', lastEdited: '2026-07-01',
  }
  it('親の属性を引き継ぎ、節フィールドを上書きする', () => {
    const recs = buildSectionRecords(parent, [
      { sectionNo: 0, sectionTitle: '', part: 0, text: '結論' },
      { sectionNo: 1, sectionTitle: '病態', part: 0, text: '本文' },
    ])
    expect(recs[0]).toMatchObject({
      objectID: 'subscription_abc#sec0', parentId: 'subscription_abc',
      isParent: 0, recordType: 'section', sectionNo: 0, sectionText: '結論',
      title: '低Na血症', genre: ['腎臓'], source: 'medical', owner: 'subscription',
    })
    expect(recs[1].objectID).toBe('subscription_abc#sec1')
  })
  it('part>0はobjectIDに枝番が付く', () => {
    const recs = buildSectionRecords(parent, [{ sectionNo: 2, sectionTitle: 'x', part: 1, text: 't' }])
    expect(recs[0].objectID).toBe('subscription_abc#sec2-1')
  })
  it('空テキストの節はレコードにしない', () => {
    expect(buildSectionRecords(parent, [{ sectionNo: 1, sectionTitle: '', part: 0, text: '  ' }])).toHaveLength(0)
  })
})

describe('extractRelationIds', () => {
  it('relationプロパティからID配列を返す', () => {
    expect(extractRelationIds({ type: 'relation', relation: [{ id: 'a-1' }, { id: 'b-2' }] })).toEqual(['a-1', 'b-2'])
  })
  it('relation以外・空は空配列', () => {
    expect(extractRelationIds({ type: 'rich_text' })).toEqual([])
    expect(extractRelationIds({})).toEqual([])
  })
})
```

- [ ] **Step 3: テストが失敗することを確認**

Run: `npx vitest run src/lib/__tests__/subscription-sections.test.ts`
Expected: FAIL（モジュールが存在しない）

- [ ] **Step 4: 実装を書く**

```ts
// src/lib/subscription-sections.ts
// サブスク同期の「節レコード」化（横断本文検索用）。
// 本文を「N. 」形式のH2で節に切り、Algoliaのレコード上限に収まるようbyte上限で分割する。
import { blockText, type NotionBlockLite } from './content-stats'

export type SectionChunk = { sectionNo: number; sectionTitle: string; part: number; text: string }

// Algoliaレコードは~10KB上限。親から引き継ぐ属性ぶんの余白を残して本文は7500バイトまで。
export const SECTION_MAX_BYTES = 7500

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length
}

// byte上限を超えるテキストを「。」区切りの文単位で詰め直す（1文が上限超なら強制分割）。
function splitByBytes(text: string): string[] {
  if (byteLen(text) <= SECTION_MAX_BYTES) return [text]
  const sentences = text.split(/(?<=。)/)
  const out: string[] = []
  let buf = ''
  for (let s of sentences) {
    while (byteLen(s) > SECTION_MAX_BYTES) {
      // 1文が上限超の異常ケース: 文字単位で上限まで切り出す
      let cut = ''
      for (const ch of s) {
        if (byteLen(cut + ch) > SECTION_MAX_BYTES) break
        cut += ch
      }
      if (buf) { out.push(buf); buf = '' }
      out.push(cut)
      s = s.slice(cut.length)
    }
    if (byteLen(buf + s) > SECTION_MAX_BYTES) { out.push(buf); buf = s }
    else buf += s
  }
  if (buf.trim()) out.push(buf)
  return out
}

const SECTION_HEAD_RE = /^(\d+)\.\s*(.*)$/

// トップレベルブロック列を節に分割する。境界は「N. 」形式のheading_2のみ。
// 最初の境界より前（⚡結論・署名・大前提）は sec0。節見出しテキストも本文に含める。
export function splitIntoSections(blocks: NotionBlockLite[]): SectionChunk[] {
  type Acc = { sectionNo: number; sectionTitle: string; texts: string[] }
  const accs: Acc[] = []
  let cur: Acc | null = null
  for (const block of blocks) {
    const text = blockText(block)
    const m = block.type === 'heading_2' ? text.trim().match(SECTION_HEAD_RE) : null
    if (m) {
      cur = { sectionNo: Number(m[1]), sectionTitle: m[2].trim(), texts: [text] }
      accs.push(cur)
      continue
    }
    if (!cur) {
      cur = { sectionNo: 0, sectionTitle: '', texts: [] }
      accs.push(cur)
    }
    if (text) cur.texts.push(text)
  }
  const out: SectionChunk[] = []
  for (const acc of accs) {
    const joined = acc.texts.join('\n').trim()
    if (!joined) continue
    splitByBytes(joined).forEach((part, i) => {
      out.push({ sectionNo: acc.sectionNo, sectionTitle: acc.sectionTitle, part: i, text: part })
    })
  }
  return out
}

// 節チャンク→Algolia子レコード。親の属性（title/genre/source/owner/要約等）をそのまま引き継ぎ、
// distinct(parentId) 集約とタブ側フィルタ（source/genre等）の整合をとる。
export function buildSectionRecords(
  parent: Record<string, unknown>,
  chunks: SectionChunk[],
): Record<string, unknown>[] {
  const parentID = String(parent.objectID)
  return chunks
    .filter((c) => c.text.trim())
    .map((c) => ({
      ...parent,
      objectID: `${parentID}#sec${c.sectionNo}${c.part > 0 ? `-${c.part}` : ''}`,
      parentId: parentID,
      isParent: 0,
      recordType: 'section',
      sectionNo: c.sectionNo,
      sectionTitle: c.sectionTitle,
      sectionText: c.text,
    }))
}

// Notionのrelationプロパティ→ページID配列（25件超のhas_moreは追わない: ナレッジの文献数は十数件想定）。
export function extractRelationIds(prop: Record<string, unknown>): string[] {
  if (!prop || (prop as { type?: string }).type !== 'relation') return []
  return (((prop as { relation?: Array<{ id: string }> }).relation) || []).map((r) => r.id)
}
```

- [ ] **Step 5: テストが通ることを確認**

Run: `npx vitest run src/lib/__tests__/subscription-sections.test.ts`
Expected: PASS

- [ ] **Step 6: コミット**

```bash
git add src/lib/subscription-sections.ts src/lib/content-stats.ts src/lib/__tests__/subscription-sections.test.ts
git commit -m "feat(sync): 節分割・節レコード生成・relation抽出の純関数"
```

---

### Task 5: sync拡張（節レコード＋参考文献リレーション＋Algolia設定）

**Files:**
- Modify: `src/app/api/subscription/sync/_core.ts`

**Interfaces:**
- Consumes: Task 4 の `splitIntoSections` / `buildSectionRecords` / `extractRelationIds`
- Produces（Algoliaレコード形状 — Task 7/8 が依存）:
  - 親レコード追加フィールド: `parentId`（=自objectID）, `isParent: 1`, `recordType: 'page'`, medical のみ `referenceIds: string[]`
  - 節レコード: `objectID: subscription_<pageId>#sec<N>[-part]`, `isParent: 0`, `recordType: 'section'`, `sectionNo`, `sectionTitle`, `sectionText`＋親の全属性
  - インデックス設定: `distinct(parentId)`・`customRanking: [desc(isParent), desc(lastEdited)]`・`attributesToSnippet: [sectionText:30]`・`attributesToRetrieve: ['*', '-sectionText']`

- [ ] **Step 1: import追加と本文取得の共通化**

`_core.ts` 冒頭に追加:

```ts
import { splitIntoSections, buildSectionRecords, extractRelationIds } from '@/lib/subscription-sections'
```
（`computeContentStats` / `NotionBlockLite` は既に4行目でimport済み。そのまま使う。）

`fetchContentStats`（86-106行目）を「ブロック取得」と「統計」に分離する:

```ts
// ページ本文（トップレベルブロック）を全ページネーションで取得する。
// 失敗してもページ全体の同期は止めない（nullで続行）。統計と節分割の両方がこれを使う。
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
    return blocks
  } catch {
    return null
  }
}
```

`fetchContentStats` は削除し、呼び出し側で `computeContentStats(blocks)` を直接呼ぶ。

- [ ] **Step 2: syncMedicalDb を節レコード＋referenceIds対応にする**

`syncMedicalDb` のループ内（139行目 `const stats = ...` 以降）を修正:

```ts
const blocks = await fetchPageBlocks(notion, page.id)
const stats = blocks ? computeContentStats(blocks) : null
const record: Record<string, unknown> = {
  objectID: `subscription_${page.id}`,
  // distinct(parentId) 用: 親も自分のIDを持つ（無いと親と節が別グループになり検索結果が二重に出る）
  parentId: `subscription_${page.id}`,
  isParent: 1,
  recordType: 'page',
  source: 'medical',
  owner: 'subscription',
  title,
  genre: extractList(props['ジャンル'] || {}),
  detailGenre: extractText(props['詳細ジャンル'] || {}),
  tags: extractText(props['タグ'] || {}),
  knowledgeLevel: extractText(props['知識レベル'] || {}),
  origin: extractText(props['由来'] || {}),
  posterRole: extractText(props['投稿者職種'] || {}),
  posterName: extractText(props['ペンネーム'] || props['投稿者名'] || {}),
  aiSummary: extractText(props['要約'] || {}),
  aiKeywords: extractText(props['キーワード'] || {}),
  // つづけて読む枠の根拠文献（Reference LibraryページID）。プロパティ名はNotion側の実名に一致させる。
  referenceIds: extractRelationIds(props['参考文献'] || {}),
  hasAttachment: extractHasFiles(props),
  lastEdited: (p.last_edited_time as string) || '',
  createdAt: (p.created_time as string) || '',
  notionUrl: (p.url as string) || '',
  contentChars: stats?.contentChars ?? 0,
  sectionCount: stats?.sectionCount ?? 0,
  headings: stats?.headings ?? [],
}
records.push(record)
if (blocks) records.push(...buildSectionRecords(record, splitIntoSections(blocks)))
count++
```

- [ ] **Step 3: syncReferenceDb にも同じパターンを適用**

`syncReferenceDb` のループ内も同様に: `fetchPageBlocks` → `computeContentStats` → レコードを `const record` として組み立て（既存フィールドは維持しつつ `parentId`/`isParent: 1`/`recordType: 'page'` を追加。`referenceIds` は不要）→ `records.push(record)` → `if (blocks) records.push(...buildSectionRecords(record, splitIntoSections(blocks)))`。

- [ ] **Step 4: setSettings を更新**

`runSubscriptionSync` 内の `index.setSettings`（292-313行目）を置き換え:

```ts
await index.setSettings({
  searchableAttributes: [
    'title',
    'aiSummary',
    'aiKeywords',
    'tags',
    'genre',
    'detailGenre',
    'author',
    'journal',
    'sectionTitle',
    'unordered(sectionText)',
  ],
  attributesForFaceting: [
    'filterOnly(owner)',
    'filterOnly(source)',
    'filterOnly(knowledgeLevel)',
    'filterOnly(recordingLevel)',
    'filterOnly(origin)',
    // 節レコードを明示的に除外/限定したいクエリ用（現状の一覧系はdistinctで集約されるので未使用）
    'filterOnly(recordType)',
    'genre',
  ],
  // isParent を先頭に: テキスト一致が同点のとき（空クエリの一覧系など）必ず親レコードが
  // グループ代表になる。本文だけがヒットした場合は節がテキスト優位で代表になる（意図通り）。
  customRanking: ['desc(isParent)', 'desc(lastEdited)'],
  attributeForDistinct: 'parentId',
  distinct: true,
  attributesToSnippet: ['sectionText:30'],
  snippetEllipsisText: '…',
  // 本文全文は応答に載せない（スニペットのみ）。unretrievableAttributes はスニペットまで
  // 消えるため使わない。会員は本文APIで全文取得できるので新たな露出面にはならない。
  attributesToRetrieve: ['*', '-sectionText'],
})
```

- [ ] **Step 5: 既存テストが壊れていないことを確認**

Run: `npm run test`
Expected: PASS（`admin-subscription-sync-route.test.ts` は `runSubscriptionSync` をモックしているため影響なし。落ちたら本タスクの変更点を見直す）

- [ ] **Step 6: コミット**

```bash
git add src/app/api/subscription/sync/_core.ts
git commit -m "feat(sync): 節レコード＋参考文献リレーション同期＋distinct/snippet設定"
```

---

### Task 6: 関連ナレッジ算出の純関数（related-knowledge.ts）

**Files:**
- Create: `src/lib/related-knowledge.ts`
- Test: `src/lib/__tests__/related-knowledge.test.ts`

**Interfaces:**
- Produces:
  - `type RelatedSource = { objectID: string; title: string; genre?: string[]; detailGenre?: string; aiKeywords?: string; lastEdited?: string; isParent?: number; recordType?: string; notionUrl?: string; knowledgeLevel?: string; aiSummary?: string; source?: string; owner?: string; recordingLevel?: string }`
  - `pickRelated(current: RelatedSource, candidates: RelatedSource[], limit?: number): RelatedSource[]`

- [ ] **Step 1: 失敗するテストを書く**

```ts
// src/lib/__tests__/related-knowledge.test.ts
import { describe, it, expect } from 'vitest'
import { pickRelated, type RelatedSource } from '../related-knowledge'

const cur: RelatedSource = {
  objectID: 'subscription_self', title: '低Na血症', genre: ['腎臓', '救急'],
  detailGenre: '電解質', aiKeywords: '低ナトリウム, ODS, 補正速度',
}
const cand = (over: Partial<RelatedSource>): RelatedSource => ({
  objectID: 'subscription_x', title: 'x', ...over,
})

describe('pickRelated', () => {
  it('詳細ジャンル一致 > ジャンル一致 の順に強く効く', () => {
    const a = cand({ objectID: 'a', detailGenre: '電解質' })
    const b = cand({ objectID: 'b', genre: ['腎臓'] })
    expect(pickRelated(cur, [b, a]).map((r) => r.objectID)).toEqual(['a', 'b'])
  })
  it('キーワード重複が加点される', () => {
    const a = cand({ objectID: 'a', genre: ['救急'], aiKeywords: 'ODS, 補正速度' })
    const b = cand({ objectID: 'b', genre: ['救急'] })
    expect(pickRelated(cur, [b, a])[0].objectID).toBe('a')
  })
  it('自分自身・節レコード・スコア0は除外し、limit件に絞る', () => {
    const self = cand({ objectID: 'subscription_self', detailGenre: '電解質' })
    const section = cand({ objectID: 's', detailGenre: '電解質', recordType: 'section' })
    const zero = cand({ objectID: 'z' })
    const ok = cand({ objectID: 'ok', genre: ['腎臓'] })
    const picked = pickRelated(cur, [self, section, zero, ok])
    expect(picked.map((r) => r.objectID)).toEqual(['ok'])
  })
  it('同点はlastEditedが新しい順', () => {
    const a = cand({ objectID: 'a', genre: ['腎臓'], lastEdited: '2026-01-01' })
    const b = cand({ objectID: 'b', genre: ['腎臓'], lastEdited: '2026-07-01' })
    expect(pickRelated(cur, [a, b]).map((r) => r.objectID)).toEqual(['b', 'a'])
  })
})
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `npx vitest run src/lib/__tests__/related-knowledge.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装を書く**

```ts
// src/lib/related-knowledge.ts
// つづけて読む枠の「関連ナレッジ」自動算出。手動キュレーションはしない（腐るため）。
// スコア: 詳細ジャンル一致+3 / ジャンル共通1つ+1 / キーワード重複1語+1。

export type RelatedSource = {
  objectID: string
  title: string
  genre?: string[]
  detailGenre?: string
  aiKeywords?: string
  lastEdited?: string
  isParent?: number
  recordType?: string
  notionUrl?: string
  knowledgeLevel?: string
  aiSummary?: string
  source?: string
  owner?: string
  recordingLevel?: string
}

function keywords(s?: string): Set<string> {
  return new Set(
    (s || '')
      .split(/[、,\/・\s]+/)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length >= 2),
  )
}

function score(current: RelatedSource, cand: RelatedSource): number {
  let n = 0
  if (current.detailGenre && cand.detailGenre && current.detailGenre === cand.detailGenre) n += 3
  const g = new Set(current.genre || [])
  for (const cg of cand.genre || []) if (g.has(cg)) n += 1
  const kw = keywords(current.aiKeywords)
  for (const w of keywords(cand.aiKeywords)) if (kw.has(w)) n += 1
  return n
}

export function pickRelated(
  current: RelatedSource,
  candidates: RelatedSource[],
  limit = 3,
): RelatedSource[] {
  return candidates
    .filter((c) => c.objectID !== current.objectID && c.recordType !== 'section')
    .map((c) => ({ c, s: score(current, c) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || (b.c.lastEdited || '').localeCompare(a.c.lastEdited || ''))
    .slice(0, limit)
    .map((x) => x.c)
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run src/lib/__tests__/related-knowledge.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/related-knowledge.ts src/lib/__tests__/related-knowledge.test.ts
git commit -m "feat(reader): 関連ナレッジ自動算出の純関数"
```

---

### Task 7: つづけて読む枠（ReaderFooter）

**Files:**
- Create: `src/components/reader/ReaderFooter.tsx`
- Modify: `src/components/reader/ReaderOverlay.tsx`（本文の後に配置）

**Interfaces:**
- Consumes: Task 5 のレコード形状（`referenceIds` / `recordingLevel`）、Task 6 の `pickRelated`、`useReader().open`
- Produces: リーダー末尾の「つづけて読む」枠（根拠文献＋関連ナレッジ）

- [ ] **Step 1: ReaderFooter を作る**

```tsx
// src/components/reader/ReaderFooter.tsx
'use client'
// リーダー末尾「つづけて読む」枠。(a)根拠文献（参考文献リレーション実登録分）、
// (b)関連ナレッジ（ジャンル＋キーワードの自動算出・上位3件）。手動キュレーションなし。
// データはAlgolia（会員のSecured Key）から取得。失敗時は静かに何も出さない。
import { useEffect, useState } from 'react'
import { NotebookText, Bookmark, ArrowRight } from 'lucide-react'
import { createSubscriptionSearchClient, getSubscriptionIndexName } from '@/lib/algolia'
import { pickRelated, type RelatedSource } from '@/lib/related-knowledge'
import { stripLeadingEmoji } from '@/lib/title-display'
import { useReader } from './SubscriptionReader'

type FooterData = { references: RelatedSource[]; related: RelatedSource[] }

async function loadFooterData(objectID: string): Promise<FooterData> {
  const index = createSubscriptionSearchClient().initIndex(getSubscriptionIndexName())
  const current = await index.getObject<RelatedSource & { referenceIds?: string[] }>(objectID)
  // 根拠文献: リレーション実登録分のみ。存在しないIDはnullで返るので落とす。
  const refIds = (current.referenceIds || []).map((id) => `subscription_${id}`)
  const refsPromise = refIds.length
    ? index.getObjects<RelatedSource>(refIds).then((r) => r.results.filter(Boolean) as RelatedSource[])
    : Promise.resolve([] as RelatedSource[])
  // 関連ナレッジ候補: 同ジャンルのナレッジ（distinctで親が代表になる）
  const genreFilters = (current.genre || []).map((g) => `genre:${g}`)
  const relatedPromise = genreFilters.length
    ? index
        .search<RelatedSource>('', { facetFilters: [genreFilters], filters: 'source:medical', hitsPerPage: 30 })
        .then((r) => pickRelated(current, r.hits))
    : Promise.resolve([] as RelatedSource[])
  const [references, related] = await Promise.all([refsPromise, relatedPromise])
  return { references, related }
}

export function ReaderFooter({ objectID }: { objectID: string }) {
  const { open } = useReader()
  const [data, setData] = useState<FooterData | null>(null)

  useEffect(() => {
    let alive = true
    setData(null)
    loadFooterData(objectID)
      .then((d) => { if (alive) setData(d) })
      .catch(() => { if (alive) setData({ references: [], related: [] }) })
    return () => { alive = false }
  }, [objectID])

  if (!data || (data.references.length === 0 && data.related.length === 0)) return null

  const openItem = (item: RelatedSource) => {
    open({
      objectID: item.objectID,
      title: item.title,
      notionUrl: item.notionUrl || '',
      knowledgeLevel: item.knowledgeLevel,
      owner: 'subscription',
      source: item.source,
      recordingLevel: item.recordingLevel,
      summary: item.aiSummary,
    })
  }

  return (
    <div className="mt-10 pt-6 border-t border-gray-200 dark:border-gray-700">
      <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">つづけて読む</p>
      {data.references.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">根拠文献</p>
          <ul className="space-y-1">
            {data.references.map((r) => {
              const deep = (r.recordingLevel || '').includes('精読')
              const Icon = deep ? NotebookText : Bookmark
              return (
                <li key={r.objectID}>
                  <button
                    type="button"
                    onClick={() => openItem(r)}
                    className="w-full min-h-[44px] flex items-center gap-2 text-left text-sm text-gray-800 dark:text-gray-200 hover:text-brand-600 dark:hover:text-brand-300"
                  >
                    <Icon className={`h-4 w-4 shrink-0 ${deep ? 'text-amber-600 dark:text-amber-400' : 'text-amber-400 dark:text-amber-500'}`} aria-hidden />
                    <span className="min-w-0 truncate">{stripLeadingEmoji(r.title)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      {data.related.length > 0 && (
        <div>
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">関連ナレッジ</p>
          <ul className="space-y-1">
            {data.related.map((r) => (
              <li key={r.objectID}>
                <button
                  type="button"
                  onClick={() => openItem(r)}
                  className="w-full min-h-[44px] flex items-center gap-2 text-left text-sm text-gray-800 dark:text-gray-200 hover:text-brand-600 dark:hover:text-brand-300"
                >
                  <ArrowRight className="h-4 w-4 shrink-0 text-gray-400 dark:text-gray-500" aria-hidden />
                  <span className="min-w-0 truncate">{stripLeadingEmoji(r.title)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
```

注意: `stripLeadingEmoji` のexport元は `src/lib/title-display.tsx`（ResultCardと同じimport元を確認して合わせる）。`useReader().open` はProviderコンテキスト経由（portalでもcontextは届く）。リーダー内遷移は既存の `open()` がそのまま差し替え表示する（戻るスタックは作らない）。

- [ ] **Step 2: ReaderOverlay に組み込む**

`ReaderOverlay.tsx` の本文描画部（`state === 'idle' && doc` 分岐）で `ReaderBody` の直後に追加:

```tsx
<ReaderFooter objectID={hit.objectID} />
```

import: `import { ReaderFooter } from './ReaderFooter'`

- [ ] **Step 3: 手動検証（プレビュー）**

参考文献リレーションのあるナレッジ（例: 造影剤前投薬）で:
- 末尾に「つづけて読む」枠・根拠文献（📄/🔖アイコン相当）・関連ナレッジ最大3件
- タップでリーダー内遷移（リーダーが閉じない・本文が差し替わる）
- リレーション0件のナレッジでは根拠文献グループごと非表示
※ Task 5 のsyncが本番実行されるまでローカルでは `referenceIds` が無い。ローカル検証は同期済みインデックスに切り替わった後でも可（最終検証タスクで再確認する）。

- [ ] **Step 4: コミット**

```bash
git add src/components/reader/ReaderFooter.tsx src/components/reader/ReaderOverlay.tsx
git commit -m "feat(reader): つづけて読む枠 — 根拠文献＋関連ナレッジの自動表示"
```

---

### Task 8: 横断本文検索の結果表示（ResultCard 本文ヒット＋deep-link）

**Files:**
- Create: `src/components/CurrentQueryContext.ts`
- Modify: `src/app/page.tsx`（`SubscriptionSearchProvider` でProvide）
- Modify: `src/components/ResultCard.tsx`

**Interfaces:**
- Consumes: Task 5 のレコード形状（`recordType`/`parentId`/`sectionNo`/`sectionTitle`/`_snippetResult`）、Task 3 の `open(hit, opts)`
- Produces: 検索結果カードの「本文ヒット」表示＋タップでリーダーが該当節＋ハイライト付きで開く

- [ ] **Step 1: 現在クエリのコンテキストを作る**

```ts
// src/components/CurrentQueryContext.ts
import { createContext } from 'react'

// いま検索ボックスに入っているクエリ。ResultCardが「本文ヒット→リーダーに検索語を引き継ぐ」
// ために読む。InstantSearchコンテキスト外でも安全に使えるよう素のReact contextにする。
export const CurrentQueryCtx = createContext<string>('')
```

- [ ] **Step 2: page.tsx でProvideする**

`SubscriptionSearchProvider`（page.tsx 150行目付近）の返却JSXを修正。import追加:

```ts
import { CurrentQueryCtx } from '@/components/CurrentQueryContext'
```

```tsx
return (
  <SubscriptionHitsContext.Provider value={value}>
    <CurrentQueryCtx.Provider value={query}>
      {children}
      {enableBridge && <SubscriptionIndexBridge />}
    </CurrentQueryCtx.Provider>
  </SubscriptionHitsContext.Provider>
)
```

（サブスク未設定のpassthrough分岐はそのまま。既定値 `''` が効くのでProvide不要。）

- [ ] **Step 3: ResultCard に本文ヒット表示を足す**

`ResultCard.tsx` を修正。

(a) import追加:

```ts
import { useContext } from 'react'
import { Highlight, Snippet } from 'react-instantsearch'
import { CurrentQueryCtx } from '@/components/CurrentQueryContext'
```

(b) `Hit` 型にフィールド追加（既存フィールドの下に）:

```ts
  // 横断本文検索（節レコード）。distinctの代表が節になったときだけ入る。
  recordType?: string
  parentId?: string
  isParent?: number
  sectionNo?: number
  sectionTitle?: string
```

(c) コンポーネント冒頭（`const inAppReader = ...` の下）に追加:

```ts
const currentQuery = useContext(CurrentQueryCtx)
// 節レコードが代表ヒットのとき、リーダーは必ず親ページIDで開く
// （objectIDの #secN サフィックスは本文APIに渡せない）。
const isSectionHit = hit.recordType === 'section' && !!hit.parentId
const readerId = isSectionHit ? hit.parentId! : hit.objectID
const readerHit = isSectionHit ? { ...hit, objectID: readerId } : hit
const sectionSnippet = isSectionHit
  ? (hit as { _snippetResult?: { sectionText?: { value?: string } } })._snippetResult?.sectionText?.value
  : undefined
```

(d) 既存の `hit.objectID` / `hit` 直渡し箇所を置換:
- `toggleExpanded` 内: `recordCqView(hit.objectID, ...)` → `recordCqView(readerId, ...)`、`prefetchReaderDoc(hit.objectID)` → `prefetchReaderDoc(readerId)`
- 既読/★判定: `isRead(hit.objectID)` → `isRead(readerId)`、`isBookmarked(hit.objectID)` → `isBookmarked(readerId)`
- 展開時「本文を読む」: `recordCqView(hit.objectID, hit.owner); openReader(hit)` → `recordCqView(readerId, hit.owner); openReader(readerHit)`
- 要約なし「本文を読む」: 同様に `readerId` / `readerHit` へ。`onPointerEnter`/`onFocus` の prefetch も `readerId`

(e) 本文ヒットボックスを追加。折りたたみ要約（`{!expanded && (...)}`、268-274行目）の直後に:

```tsx
{sectionSnippet && (
  <button
    type="button"
    onClick={(e) => {
      e.stopPropagation()
      recordCqView(readerId, hit.owner)
      openReader(readerHit, {
        searchQuery: currentQuery.trim() || undefined,
        sectionNo: hit.sectionNo != null && hit.sectionNo > 0 ? hit.sectionNo : undefined,
      })
    }}
    className="mt-2 w-full text-left rounded-lg bg-yellow-50 dark:bg-yellow-900/15 border border-yellow-200 dark:border-yellow-700/40 px-3 py-2 hover:border-yellow-300 dark:hover:border-yellow-600"
  >
    <p className="text-[11px] font-medium text-yellow-800 dark:text-yellow-300 mb-0.5">
      本文にヒット{hit.sectionNo != null && hit.sectionNo > 0 ? ` — §${hit.sectionNo} ${hit.sectionTitle || ''}` : ''}
    </p>
    <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed [&_mark]:bg-yellow-200 dark:[&_mark]:bg-yellow-500/40 [&_mark]:rounded-[2px]">
      <Snippet attribute="sectionText" hit={hit as any} />
    </p>
  </button>
)}
```

(f) `openReader` の呼び出し型: `useReader()` は Task 3 で `open(hit, opts?)` になっているのでそのまま通る。

- [ ] **Step 4: 型チェック**

Run: `npx tsc --noEmit`
Expected: 新規エラーなし

- [ ] **Step 5: コミット**

```bash
git add src/components/CurrentQueryContext.ts src/app/page.tsx src/components/ResultCard.tsx
git commit -m "feat(search): 横断本文検索の結果表示 — 本文ヒット＋リーダーdeep-link"
```

---

### Task 9: 最終検証・SW bump・デプロイ手順

**Files:**
- Modify: `public/sw.js`（`CACHE_VERSION`）

- [ ] **Step 1: 全テスト＋ビルド**

```bash
npm run test
npm run build
```
Expected: 両方成功。

- [ ] **Step 2: SW CACHE_VERSION を bump**

`public/sw.js` 18行目: `medinode-v22` → `medinode-v23`（デプロイ時点の最新値+1。他セッションのデプロイで進んでいたらその値+1にする）

```bash
git add public/sw.js
git commit -m "chore(pwa): SW CACHE_VERSION bump — リーダー検索・つづけて読む枠の反映"
```

- [ ] **Step 3: ブラウザ通し検証（dev）**

プレミアム会員状態で:
1. 検索ボックスに本文にしかない語（例: 特定の数値・薬剤名）を入力 → プレミアムカードに「本文にヒット — §N 節タイトル」＋ハイライトスニペット（※ローカルのAlgoliaが同期済みの場合のみ。未同期ならこの項は本番同期後の確認に回す）
2. 本文ヒットをタップ → リーダーが該当節で開き検索語がハイライト済み
3. リーダー単体で検索・prev/next・Esc
4. 記事末尾「つづけて読む」→ 関連ナレッジでリーダー内遷移
5. ダークモードで 1-4 を目視
6. 無料会員プレビュー（設定のトグル）でプレミアム面が出ないこと

- [ ] **Step 4: マージ＋デプロイ（オーナー確認後）**

```bash
git checkout main && git pull && git merge feat/premium-reader-search && git push
```
push で Vercel 自動デプロイ。**デプロイ後の必須手順**:
1. サブスク同期を1回実行（/admin の同期ボタン、または `curl -X POST -H "x-sync-secret: ***" https://<本番>/api/subscription/sync`）— これで節レコード・referenceIds・distinct設定がAlgoliaに入る
2. 本番で Step 3 の 1〜4 を再確認（特に: 一覧・ジャンルタブ・クイズ・今日の1問が二重表示や節混入なく従来通りであること）
3. Algoliaダッシュボードでレコード数が増えていること（40ページ→350前後）を目視

## 実装順とリスクメモ

- 実装順: Task 1→2→3（①完結・単独デプロイ可）→ 4→5（sync）→ 6→7（③）→ 8（②UI）→ 9
- **最大のリスクは Task 5 の distinct 化**が既存の一覧系クエリ（ジャンルタブ・クイズ・今日の1問・新着・解決CQ）に与える影響。`customRanking: desc(isParent)` が空クエリ時に必ず親を代表にするのが防波堤。本番同期後に必ず一覧系を目視すること。
- Notionの`参考文献`リレーションは25件超で has_more になるが追わない（1ナレッジの文献数は十数件想定）。
- 検索ヒットがinline境界（太字の切れ目）をまたぐと mark が2個に割れて件数が2になる。既知の許容事項。
