# サブスク本文リーダー v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** サブスク公開ナレッジのアプリ内リーダーを、署名記事としての忠実レンダリング＋結論バー/目次・確信度フィルタ・読了/ブックマークで「また開きたくなる」読書体験に引き上げる。

**Architecture:** 純ロジック（`reader-doc` 追加関数・`reader-confidence`・`reader-marks`）を先に TDD で固め、その上に React コンポーネント（`ReaderBody` 忠実描画・`ReaderNavBar`・`ConfidenceChips`・`ReaderMarksProvider`・`BookmarksList`）を積む。状態は端末ローカル（localStorage）のみ、context で共有。

**Tech Stack:** Next.js(App Router) / React / TypeScript / Tailwind / lucide-react / vitest。既存 `src/components/reader/*`（v1）と `src/lib/reader-doc.ts` を拡張。

## Global Constraints

- テスト: `npx vitest run <file>` で個別実行。全体は `npm test`（`vitest run`）。`import { describe, it, expect } from 'vitest'`。
- 端末ローカル保存は必ず try/catch（プライベートブラウズで落とさない）。新しい個人用 localStorage キーは **必ず `PERSONAL_DEVICE_KEYS`（`src/lib/personal-data.ts`）へ登録**（別ユーザー切替で wipe されるため）。
- 禁句: 本文に「暫定 / 要検証 / AI下書き」を出さない（データ側の話。リーダーは Notion 本文を忠実描画するだけ）。
- 確信度マーク意味: ✅=確立（証拠が強い・"安全/やっていい"の意味ではない）／⚠️=諸説・施設差／❓=不明確。表記はこの3語で固定。
- 確信度は**色だけに依存しない**（形状の異なる3グリフ＋`sr-only` の語）。淡色化は AA 4.5:1 を満たす濃さ。`prefers-reduced-motion` で全モーション撤廃。
- 対象は `owner === 'subscription'` のサブスクカードのみ（`inAppReader`）。
- コミットはこの計画の各タスク末尾で行う（`feat/subscription-inapp-reader` ブランチ上）。
- 既存の `reader-doc.ts` の `mapBlocks` が返す callout 形状 `{kind,icon,color,blocks}` は変えない（既存テストを壊さないため）。role はレンダリング時に純関数で導出する。

---

## File Structure

新規:
- `src/lib/reader-confidence.ts` — 確信度マーク検出・淡色化判定（純関数）
- `src/lib/reader-marks.ts` — 読了set＋ブックマークlist（端末ローカル）
- `src/components/reader/ReaderMarksProvider.tsx` — 読了/ブックマーク context
- `src/components/reader/ReaderNavBar.tsx` — 結論バー＋目次＋読了インク
- `src/components/reader/ConfidenceChips.tsx` — ✅⚠️❓ チップ行
- `src/components/reader/ConfidenceMark.tsx` — 確信度グリフ＋sr-only語（本文/凡例/チップ共用）
- `src/components/BookmarksList.tsx` — 空状態のブックマーク一覧
- `public/brand/drnode-avatar.png` — 署名アバター資産（透過）
- `src/lib/__tests__/reader-confidence.test.ts` / `reader-marks.test.ts`

変更:
- `src/lib/reader-doc.ts` — `calloutRole` / `findTldr` / `tocSections` / `parseSectionHeading` / `isRecapText`
- `src/lib/__tests__/reader-doc.test.ts` — 上記の追加テスト
- `src/lib/personal-data.ts` / `__tests__/personal-data.test.ts` — 新キー2つ登録
- `src/components/reader/ReaderBody.tsx` — 忠実描画（callout型別・番号チップ・確信度グリフ・recap・署名アバター・更新日）＋淡色化配線
- `src/components/reader/SubscriptionReader.tsx` — dialog a11y・ヘッダ★・markRead・スケルトン・nav/chips 配線
- `src/components/ResultCard.tsx` — 既読ドット＋トーン・金★
- `src/app/page.tsx` — `ReaderMarksProvider` で包む＋空状態に `BookmarksList`

---

## Task 1: reader-doc 追加純関数（role / TLDR / 目次 / 番号 / recap）

**Files:**
- Modify: `src/lib/reader-doc.ts`（末尾に追加）
- Test: `src/lib/__tests__/reader-doc.test.ts`（追記）

**Interfaces:**
- Consumes: 既存 `ReaderBlock`, `ReaderDoc`, `ReaderInline`（`reader-doc.ts`）
- Produces:
  - `type CalloutRole = 'conclusion'|'signature'|'stamp'|'evidence'|'disclaimer'|'plain'`
  - `calloutRole(icon: string | null): CalloutRole`
  - `findTldr(doc: ReaderDoc): Extract<ReaderBlock,{kind:'callout'}> | null`
  - `tocSections(doc: ReaderDoc): { n: number; title: string; index: number }[]`（index = doc.blocks 内の位置）
  - `parseSectionHeading(inlines: ReaderInline[]): { n: number; rest: string } | null`
  - `isRecapText(text: string): boolean`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/reader-doc.test.ts` の末尾に追記:

```ts
import { calloutRole, findTldr, tocSections, parseSectionHeading, isRecapText } from '../reader-doc'
import type { ReaderDoc } from '../reader-doc'

describe('calloutRole', () => {
  it('アイコンから役割を導出（絵文字の異体字にも耐える）', () => {
    expect(calloutRole('⚡')).toBe('conclusion')
    expect(calloutRole('🧑‍⚕️')).toBe('signature')
    expect(calloutRole('🤖')).toBe('stamp')
    expect(calloutRole('📚')).toBe('evidence')
    expect(calloutRole('⚠️')).toBe('disclaimer')
    expect(calloutRole('💡')).toBe('plain')
    expect(calloutRole(null)).toBe('plain')
  })
})

const doc = (blocks: any[]): ReaderDoc => ({ title: 'T', icon: null, cover: null, lastEdited: null, blocks })

describe('findTldr', () => {
  it('⚡ callout を結論として返す', () => {
    const c = { kind: 'callout', icon: '⚡', color: 'yellow_background', blocks: [] }
    expect(findTldr(doc([{ kind: 'heading', level: 1, inlines: [] }, c]))).toBe(c)
  })
  it('⚡ が無ければ null', () => {
    expect(findTldr(doc([{ kind: 'callout', icon: '💡', color: null, blocks: [] }]))).toBeNull()
  })
})

describe('parseSectionHeading', () => {
  it('先頭番号と残りを分解', () => {
    expect(parseSectionHeading([{ text: '2. 補正速度の上限で過補正を避ける' }])).toEqual({ n: 2, rest: '補正速度の上限で過補正を避ける' })
  })
  it('番号無しは null', () => {
    expect(parseSectionHeading([{ text: '確信度の見方' }])).toBeNull()
  })
})

describe('tocSections', () => {
  it('level2 の番号付き見出しだけを目次に', () => {
    const d = doc([
      { kind: 'heading', level: 2, inlines: [{ text: '1. なぜ制限するか' }] },
      { kind: 'paragraph', inlines: [{ text: 'x' }] },
      { kind: 'heading', level: 2, inlines: [{ text: '2. 上限' }] },
      { kind: 'heading', level: 2, inlines: [{ text: '確信度の見方' }] },
    ])
    expect(tocSections(d)).toEqual([
      { n: 1, title: 'なぜ制限するか', index: 0 },
      { n: 2, title: '上限', index: 2 },
    ])
  })
})

describe('isRecapText', () => {
  it('→ 始まりを recap と判定', () => {
    expect(isRecapText('→ だから上限を守る')).toBe(true)
    expect(isRecapText('  → まとめ')).toBe(true)
    expect(isRecapText('通常の主張。')).toBe(false)
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/lib/__tests__/reader-doc.test.ts`
Expected: FAIL（`calloutRole is not a function` 等）

- [ ] **Step 3: 実装を追加**

`src/lib/reader-doc.ts` の末尾に:

```ts
export type CalloutRole = 'conclusion' | 'signature' | 'stamp' | 'evidence' | 'disclaimer' | 'plain'

// アイコン絵文字は異体字セレクタ/ZWJ を含みうるため includes で判定する。
export function calloutRole(icon: string | null): CalloutRole {
  if (!icon) return 'plain'
  if (icon.includes('⚡')) return 'conclusion'
  if (icon.includes('⚕')) return 'signature' // 🧑‍⚕️
  if (icon.includes('🤖')) return 'stamp'
  if (icon.includes('📚')) return 'evidence'
  if (icon.includes('⚠')) return 'disclaimer'
  return 'plain'
}

export function findTldr(doc: ReaderDoc): (ReaderBlock & { kind: 'callout' }) | null {
  for (const b of doc.blocks) {
    if (b.kind === 'callout' && calloutRole(b.icon) === 'conclusion') return b
  }
  return null
}

export function parseSectionHeading(inlines: ReaderInline[]): { n: number; rest: string } | null {
  const text = inlines.map((i) => i.text).join('').trim()
  const m = text.match(/^(\d+)\.\s*(.+)$/)
  if (!m) return null
  return { n: Number(m[1]), rest: m[2].trim() }
}

export function tocSections(doc: ReaderDoc): { n: number; title: string; index: number }[] {
  const out: { n: number; title: string; index: number }[] = []
  doc.blocks.forEach((b, index) => {
    if (b.kind === 'heading' && b.level === 2) {
      const p = parseSectionHeading(b.inlines)
      if (p) out.push({ n: p.n, title: p.rest, index })
    }
  })
  return out
}

export function isRecapText(text: string): boolean {
  return /^\s*→/.test(text)
}
```

- [ ] **Step 4: 成功を確認**

Run: `npx vitest run src/lib/__tests__/reader-doc.test.ts`
Expected: PASS（既存テストも緑のまま）

- [ ] **Step 5: コミット**

```bash
git add src/lib/reader-doc.ts src/lib/__tests__/reader-doc.test.ts
git commit -m "feat(reader-doc): add role/tldr/toc/section/recap pure helpers"
```

---

## Task 2: reader-confidence（確信度マーク検出・淡色化判定）

**Files:**
- Create: `src/lib/reader-confidence.ts`
- Test: `src/lib/__tests__/reader-confidence.test.ts`

**Interfaces:**
- Consumes: `ReaderBlock`（`reader-doc`）
- Produces:
  - `type Confidence = 'ok' | 'caut' | 'unk'`
  - `const CONFIDENCE_MARKS: Record<Confidence, string>`（`{ ok:'✅', caut:'⚠️', unk:'❓' }`）
  - `const CONFIDENCE_LABEL: Record<Confidence, string>`（`{ ok:'確立', caut:'諸説あり・施設差', unk:'不明確' }`）
  - `blockConfidence(block: ReaderBlock): Confidence[]`（本文行が含むマーク・順序 ok,caut,unk）
  - `docConfidenceMarks(blocks: ReaderBlock[]): Confidence[]`（本文全体に実在するマーク）
  - `isDimmed(block: ReaderBlock, active: Set<Confidence>): boolean`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/reader-confidence.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { blockConfidence, docConfidenceMarks, isDimmed } from '../reader-confidence'
import type { ReaderBlock } from '../reader-doc'

const li = (text: string): ReaderBlock => ({ kind: 'list_item', ordered: false, inlines: [{ text }] })
const p = (text: string): ReaderBlock => ({ kind: 'paragraph', inlines: [{ text }] })
const h = (text: string): ReaderBlock => ({ kind: 'heading', level: 2, inlines: [{ text }] })

describe('blockConfidence', () => {
  it('行末の確信度マークを検出', () => {
    expect(blockConfidence(li('上限は8〜10。✅ 出典'))).toEqual(['ok'])
    expect(blockConfidence(li('施設差あり。⚠️ 総説'))).toEqual(['caut'])
    expect(blockConfidence(li('議論あり。❓ 検索例'))).toEqual(['unk'])
    expect(blockConfidence(p('→ だからまとめ'))).toEqual([])
  })
})

describe('docConfidenceMarks', () => {
  it('本文に実在するマークのみ（順序固定）', () => {
    expect(docConfidenceMarks([li('a❓'), li('b✅'), h('見出し✅')])).toEqual(['ok', 'unk'])
  })
})

describe('isDimmed', () => {
  const active = (...cs: any[]) => new Set(cs)
  it('active 空なら淡色化しない', () => {
    expect(isDimmed(li('a✅'), active())).toBe(false)
  })
  it('見出し等の構造は常に保護', () => {
    expect(isDimmed(h('1. 見出し'), active('caut'))).toBe(false)
    expect(isDimmed({ kind: 'divider' }, active('caut'))).toBe(false)
    expect(isDimmed({ kind: 'callout', icon: '⚡', color: null, blocks: [] }, active('caut'))).toBe(false)
  })
  it('⚠️・❓ 行は常に保護（安全要件）', () => {
    expect(isDimmed(li('施設差。⚠️ x'), active('ok'))).toBe(false)
    expect(isDimmed(li('議論。❓ x'), active('ok'))).toBe(false)
  })
  it('✅ 行は active に ok が無ければ淡色化', () => {
    expect(isDimmed(li('確立。✅ x'), active('caut'))).toBe(true)
    expect(isDimmed(li('確立。✅ x'), active('ok'))).toBe(false)
  })
  it('無マーク/recap 行は active があれば淡色化', () => {
    expect(isDimmed(p('→ まとめ'), active('caut'))).toBe(true)
    expect(isDimmed(p('ただの解説'), active('ok'))).toBe(true)
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/lib/__tests__/reader-confidence.test.ts`
Expected: FAIL（モジュール未作成）

- [ ] **Step 3: 実装**

`src/lib/reader-confidence.ts`:

```ts
import type { ReaderBlock, ReaderInline } from './reader-doc'

export type Confidence = 'ok' | 'caut' | 'unk'
export const CONFIDENCE_MARKS: Record<Confidence, string> = { ok: '✅', caut: '⚠️', unk: '❓' }
export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  ok: '確立', caut: '諸説あり・施設差', unk: '不明確',
}
const ORDER: Confidence[] = ['ok', 'caut', 'unk']

function textOf(inlines: ReaderInline[]): string {
  return inlines.map((i) => i.text).join('')
}

// 本文行（paragraph / list_item）が含む確信度マーク。順序は ok,caut,unk。
export function blockConfidence(block: ReaderBlock): Confidence[] {
  if (block.kind !== 'paragraph' && block.kind !== 'list_item') return []
  const t = textOf(block.inlines)
  return ORDER.filter((c) => t.includes(CONFIDENCE_MARKS[c]))
}

export function docConfidenceMarks(blocks: ReaderBlock[]): Confidence[] {
  const present = new Set<Confidence>()
  for (const b of blocks) blockConfidence(b).forEach((c) => present.add(c))
  return ORDER.filter((c) => present.has(c))
}

// 淡色化するか。構造ブロックと ⚠️/❓ 行は常に保護。✅行は ok が active に無ければ淡色化。
// 無マーク/recap 行は active が非空なら淡色化。
export function isDimmed(block: ReaderBlock, active: Set<Confidence>): boolean {
  if (active.size === 0) return false
  if (block.kind !== 'paragraph' && block.kind !== 'list_item') return false
  const marks = blockConfidence(block)
  if (marks.includes('caut') || marks.includes('unk')) return false
  const hit = marks.some((m) => active.has(m))
  return !hit
}
```

- [ ] **Step 4: 成功を確認**

Run: `npx vitest run src/lib/__tests__/reader-confidence.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/reader-confidence.ts src/lib/__tests__/reader-confidence.test.ts
git commit -m "feat(reader): confidence mark detection + dim rule (⚠️❓ protected)"
```

---

## Task 3: reader-marks（読了set＋ブックマークlist）

**Files:**
- Create: `src/lib/reader-marks.ts`
- Test: `src/lib/__tests__/reader-marks.test.ts`

**Interfaces:**
- Produces:
  - `type BookmarkEntry = { objectID: string; title: string; notionUrl: string; knowledgeLevel?: string; owner?: string; summary?: string; at: string }`
  - `const MAX_READS = 500`, `const MAX_BOOKMARKS = 60`
  - `pushRead(list: string[], id: string): string[]`
  - `toggleBookmark(list: BookmarkEntry[], entry: BookmarkEntry): BookmarkEntry[]`
  - `isBookmarked(list: BookmarkEntry[], id: string): boolean`
  - `sanitizeReads(raw: unknown): string[]` / `sanitizeBookmarks(raw: unknown): BookmarkEntry[]`
  - `loadReads(): string[]` / `recordRead(id: string): void`
  - `loadBookmarks(): BookmarkEntry[]` / `saveBookmarks(list): void` / `clearBookmarks(): void`
  - `READ_KEY`, `BOOKMARKS_KEY`（string 定数・personal-data 登録用）

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/reader-marks.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  pushRead, toggleBookmark, isBookmarked, sanitizeReads, sanitizeBookmarks,
  MAX_READS, MAX_BOOKMARKS, type BookmarkEntry,
} from '../reader-marks'

const bm = (id: string): BookmarkEntry => ({
  objectID: id, title: `T${id}`, notionUrl: `https://n/${id}`, at: '2026-07-23T00:00:00.000Z',
})

describe('pushRead', () => {
  it('先頭追加・重複を引き上げ・上限で切り捨て', () => {
    expect(pushRead(['a'], 'b')).toEqual(['b', 'a'])
    expect(pushRead(['a', 'b'], 'b')).toEqual(['b', 'a'])
    let l: string[] = []
    for (let i = 0; i < MAX_READS + 3; i++) l = pushRead(l, String(i))
    expect(l).toHaveLength(MAX_READS)
    expect(l.includes('0')).toBe(false)
  })
})

describe('toggleBookmark / isBookmarked', () => {
  it('無ければ追加、あれば除去', () => {
    const added = toggleBookmark([], bm('a'))
    expect(added.map((e) => e.objectID)).toEqual(['a'])
    expect(isBookmarked(added, 'a')).toBe(true)
    const removed = toggleBookmark(added, bm('a'))
    expect(removed).toEqual([])
    expect(isBookmarked(removed, 'a')).toBe(false)
  })
  it('追加は先頭・上限で切り捨て', () => {
    let l: BookmarkEntry[] = []
    for (let i = 0; i < MAX_BOOKMARKS + 2; i++) l = toggleBookmark(l, bm(String(i)))
    expect(l).toHaveLength(MAX_BOOKMARKS)
    expect(l[0].objectID).toBe(String(MAX_BOOKMARKS + 1))
  })
})

describe('sanitize', () => {
  it('reads は文字列配列のみ', () => {
    expect(sanitizeReads(['a', 1, null, 'b'])).toEqual(['a', 'b'])
    expect(sanitizeReads('x')).toEqual([])
  })
  it('bookmarks は必須フィールドを検証', () => {
    expect(sanitizeBookmarks([bm('a'), { objectID: 'x' }, null])).toEqual([bm('a')])
    expect(sanitizeBookmarks('x')).toEqual([])
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/lib/__tests__/reader-marks.test.ts`
Expected: FAIL

- [ ] **Step 3: 実装**

`src/lib/reader-marks.ts`（`recent-views.ts` に倣う）:

```ts
// 読了（見た）水位＋ブックマークの端末ローカル保存。サーバー同期しない（recent-views と同方針）。
export const READ_KEY = 'medinode_reader_read_v1'
export const BOOKMARKS_KEY = 'medinode_reader_bookmarks_v1'
export const MAX_READS = 500
export const MAX_BOOKMARKS = 60

export type BookmarkEntry = {
  objectID: string
  title: string
  notionUrl: string
  knowledgeLevel?: string
  owner?: string
  summary?: string
  at: string
}

export function pushRead(list: string[], id: string): string[] {
  return [id, ...list.filter((x) => x !== id)].slice(0, MAX_READS)
}

export function toggleBookmark(list: BookmarkEntry[], entry: BookmarkEntry): BookmarkEntry[] {
  if (list.some((e) => e.objectID === entry.objectID)) {
    return list.filter((e) => e.objectID !== entry.objectID)
  }
  return [entry, ...list].slice(0, MAX_BOOKMARKS)
}

export function isBookmarked(list: BookmarkEntry[], id: string): boolean {
  return list.some((e) => e.objectID === id)
}

export function sanitizeReads(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string').slice(0, MAX_READS)
}

export function sanitizeBookmarks(raw: unknown): BookmarkEntry[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (v): v is BookmarkEntry =>
        !!v && typeof v === 'object' &&
        typeof (v as BookmarkEntry).objectID === 'string' &&
        typeof (v as BookmarkEntry).title === 'string' &&
        typeof (v as BookmarkEntry).notionUrl === 'string',
    )
    .slice(0, MAX_BOOKMARKS)
}

export function loadReads(): string[] {
  try { return sanitizeReads(JSON.parse(localStorage.getItem(READ_KEY) || '[]')) } catch { return [] }
}
export function recordRead(id: string): void {
  try { localStorage.setItem(READ_KEY, JSON.stringify(pushRead(loadReads(), id))) } catch {}
}
export function loadBookmarks(): BookmarkEntry[] {
  try { return sanitizeBookmarks(JSON.parse(localStorage.getItem(BOOKMARKS_KEY) || '[]')) } catch { return [] }
}
export function saveBookmarks(list: BookmarkEntry[]): void {
  try { localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(list)) } catch {}
}
export function clearBookmarks(): void {
  try { localStorage.removeItem(BOOKMARKS_KEY) } catch {}
}
```

- [ ] **Step 4: 成功を確認**

Run: `npx vitest run src/lib/__tests__/reader-marks.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/reader-marks.ts src/lib/__tests__/reader-marks.test.ts
git commit -m "feat(reader): reader-marks store (reads + bookmarks, device-local)"
```

---

## Task 4: 個人データキー登録（personal-data）

**Files:**
- Modify: `src/lib/personal-data.ts:14-27`（`PERSONAL_DEVICE_KEYS` 配列）
- Test: `src/lib/__tests__/personal-data.test.ts`（追記）

**Interfaces:**
- Consumes: `READ_KEY`, `BOOKMARKS_KEY`（Task 3）

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/personal-data.test.ts` の先頭 import 群の後に追記:

```ts
import { READ_KEY, BOOKMARKS_KEY } from '../reader-marks'

describe('reader-marks キーは個人データに含まれる', () => {
  it('READ_KEY / BOOKMARKS_KEY が登録済み', () => {
    expect(PERSONAL_DEVICE_KEYS).toContain(READ_KEY)
    expect(PERSONAL_DEVICE_KEYS).toContain(BOOKMARKS_KEY)
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/lib/__tests__/personal-data.test.ts`
Expected: FAIL（未登録）

- [ ] **Step 3: 実装**

`src/lib/personal-data.ts` の `PERSONAL_DEVICE_KEYS` 配列末尾（`] as const` の直前）に追加:

```ts
  'medinode_reader_read_v1', // リーダー既読（見た）水位
  'medinode_reader_bookmarks_v1', // リーダーのブックマーク
```

- [ ] **Step 4: 成功を確認**

Run: `npx vitest run src/lib/__tests__/personal-data.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/personal-data.ts src/lib/__tests__/personal-data.test.ts
git commit -m "feat(reader): register reader read/bookmark keys as personal data"
```

---

## Task 5: 署名アバター資産の追加

**Files:**
- Create: `public/brand/drnode-avatar.png`（透過・最適化 128px相当）

**Interfaces:** なし（静的資産。`/brand/drnode-avatar.png` で参照）

- [ ] **Step 1: 透過アバターを生成**

元画像 `~/Dr.nodeアイコン.png` から羽化αで切り出し、`public/brand/` に配置:

```bash
mkdir -p ~/medical-search-public/public/brand
python3 - <<'PY'
from PIL import Image
src="/Users/tatsukinonaka/Dr.nodeアイコン.png"
im=Image.open(src).convert("RGB"); w,h=im.size; px=im.load()
out=Image.new("RGBA",(w,h),(0,0,0,0)); op=out.load()
LO,HI=180.0,248.0
for y in range(h):
  for x in range(w):
    r,g,b=px[x,y]; m=min(r,g,b)
    a=255 if m<=LO else 0 if m>=HI else int(round((HI-m)/(HI-LO)*255))
    op[x,y]=(r,g,b,a)
cut=out.crop(out.getbbox())
side=max(cut.size); sq=Image.new("RGBA",(side,side),(0,0,0,0))
sq.paste(cut,((side-cut.size[0])//2,(side-cut.size[1])//2),cut)
sq.resize((256,256),Image.LANCZOS).save("/Users/tatsukinonaka/medical-search-public/public/brand/drnode-avatar.png",optimize=True)
print("saved")
PY
```

- [ ] **Step 2: 生成物を確認**

Run: `ls -l ~/medical-search-public/public/brand/drnode-avatar.png`
Expected: ファイルが存在（数十KB・透過PNG）

- [ ] **Step 3: コミット**

```bash
git add public/brand/drnode-avatar.png
git commit -m "feat(reader): add Dr.node signature avatar asset (transparent)"
```

---

## Task 6: ConfidenceMark コンポーネント（グリフ＋sr-only語）

**Files:**
- Create: `src/components/reader/ConfidenceMark.tsx`

**Interfaces:**
- Consumes: `Confidence`, `CONFIDENCE_LABEL`（Task 2）, lucide `CircleCheck`,`TriangleAlert`,`CircleHelp`
- Produces: `ConfidenceMark({ kind, className? }: { kind: Confidence; className?: string })`（インライン span：色付きグリフ＋`sr-only` の語）
- Produces: `MARK_COLOR: Record<Confidence,string>`（Tailwind クラス・light/dark 両対応）

> 注: lucide-react のアイコン名はバージョンで異なる。`CircleCheck / TriangleAlert / CircleHelp` が無ければ `CheckCircle2 / AlertTriangle / HelpCircle` を使う（import 時に確認）。

- [ ] **Step 1: 実装**

`src/components/reader/ConfidenceMark.tsx`:

```tsx
'use client'
import { CircleCheck, TriangleAlert, CircleHelp } from 'lucide-react'
import { CONFIDENCE_LABEL, type Confidence } from '@/lib/reader-confidence'

const ICON = { ok: CircleCheck, caut: TriangleAlert, unk: CircleHelp } as const
// コントラスト実測済みトークン（light は AA/3:1 が取れる濃さ、dark は明側）
export const MARK_COLOR: Record<Confidence, string> = {
  ok: 'text-teal-700 dark:text-teal-300',
  caut: 'text-amber-700 dark:text-amber-300',
  unk: 'text-red-700 dark:text-red-300',
}

export function ConfidenceMark({ kind, className = '' }: { kind: Confidence; className?: string }) {
  const Icon = ICON[kind]
  return (
    <span className={`inline-flex items-baseline ${MARK_COLOR[kind]} ${className}`}>
      <Icon className="w-[1em] h-[1em] shrink-0 self-center" aria-hidden="true" strokeWidth={2.2} />
      <span className="sr-only">（確信度: {CONFIDENCE_LABEL[kind]}）</span>
    </span>
  )
}
```

- [ ] **Step 2: 型チェック**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし（アイコン名が無ければ上記注のフォールバック名に変更）

- [ ] **Step 3: コミット**

```bash
git add src/components/reader/ConfidenceMark.tsx
git commit -m "feat(reader): ConfidenceMark glyph with sr-only label"
```

---

## Task 7: ReaderBody 忠実レンダリング＋淡色化

**Files:**
- Modify: `src/components/reader/ReaderBody.tsx`（全面改修）
- Consumes: `calloutRole`,`parseSectionHeading`,`isRecapText`（Task 1）, `blockConfidence`,`isDimmed`,`CONFIDENCE_MARKS`,`CONFIDENCE_LABEL`,`Confidence`（Task 2）, `ConfidenceMark`,`MARK_COLOR`（Task 6）
- Produces: `ReaderBody({ doc, onImageClick, active }: { doc: ReaderDoc; onImageClick: (u:string)=>void; active: Set<Confidence> })`（`active` は淡色化フィルタ。TLDR/目次は Task 8 の `ReaderNavBar` が担うため本体は本文描画に専念）

**実装方針（既存 `ReaderBody.tsx` を置換）:**
- 先頭に **更新日**（`doc.lastEdited` を `YYYY-MM-DD` 整形して `text-muted` 小サイズ）→ カバー → タイトル → 本文。
- `RenderedBlocks` の各ブロック描画で:
  - `heading` level2 かつ `parseSectionHeading` が番号を返す → 番号 teal チップ＋見出し。
  - `callout` は `calloutRole(block.icon)` で分岐:
    - `conclusion`: 黄アクセント（`bg-amber-50 dark:bg-amber-900/20 border-l-4 border-amber-400`・角丸）。この callout に `data-tldr` 属性を付与（Task 8 が監視）。
    - `signature`: 緑（`bg-emerald-50 dark:bg-emerald-900/20 border-l-4 border-emerald-500`）＋著者アバター（`/brand/drnode-avatar.png`・`object-contain`・淡緑丸）＋callout先頭の太字行を見出しに。
    - `stamp`: 地なし・上下境界の帯＋`CircleCheck`（teal）。
    - `evidence` / `disclaimer` / `plain`: 既存 `CALLOUT_TONE` 準拠（disclaimer=gray）。
  - `paragraph`/`list_item`: `Inlines` 内で ✅⚠️❓ を `ConfidenceMark` に置換。`isRecapText` なら recap スタイル（`border-l-2 border-teal-500/30 pl-2.5 text-gray-500`）。`isDimmed(block, active)` が true なら本文色を淡色（AA準拠：`text-gray-500 dark:text-gray-400`）へ、160ms transition（`motion-reduce:transition-none`）。マークの色は残す。
- `Inlines` 改修: テキストノードを ✅/⚠️/❓ で分割し、マーク位置に `ConfidenceMark` を差し込む。マーク直後のリンク（`href` あり）は下線をマーク意味色に寄せるが、確信度の一次表現は `ConfidenceMark`（sr-only 語）に置く。リンクに `aria-label`（リンクテキスト）を付す。

- [ ] **Step 1: ReaderBody を改修**

`src/components/reader/ReaderBody.tsx` を以下に置換（要点実装。既存の list グルーピング `groupBlocks` は維持）:

```tsx
'use client'
import Image from 'next/image'
import { calloutRole, parseSectionHeading, isRecapText, type ReaderDoc, type ReaderBlock, type ReaderInline } from '@/lib/reader-doc'
import { CONFIDENCE_MARKS, isDimmed, type Confidence } from '@/lib/reader-confidence'
import { ConfidenceMark, MARK_COLOR } from './ConfidenceMark'

const MARK_OF: Record<string, Confidence> = { '✅': 'ok', '⚠️': 'caut', '❓': 'unk' }
const MARK_RE = /(✅|⚠️|❓)/

// テキストを確信度マークで分割し、マークを ConfidenceMark へ。
function renderText(text: string, key: string) {
  const parts = text.split(MARK_RE)
  return parts.map((seg, i) =>
    MARK_OF[seg]
      ? <ConfidenceMark key={`${key}-${i}`} kind={MARK_OF[seg]} className="mx-0.5 align-baseline" />
      : <span key={`${key}-${i}`}>{seg}</span>,
  )
}

function Inlines({ items, k }: { items: ReaderInline[]; k: string }) {
  return (
    <>
      {items.map((n, i) => {
        const cls = [n.bold ? 'font-medium' : '', n.italic ? 'italic' : '',
          n.code ? 'font-mono text-[0.85em] bg-gray-100 dark:bg-gray-700 px-1 rounded' : ''].join(' ')
        if (n.href) {
          const mk = items[i - 1] && MARK_OF[items[i - 1].text?.trim() ?? '']
          const linkColor = mk ? MARK_COLOR[mk] : 'text-brand-600 dark:text-brand-300'
          return (
            <a key={i} href={n.href} target="_blank" rel="noopener noreferrer" aria-label={`出典: ${n.text}`}
              className={`${cls} ${linkColor} underline underline-offset-2`}>{n.text}</a>
          )
        }
        return <span key={i} className={cls}>{renderText(n.text, `${k}-${i}`)}</span>
      })}
    </>
  )
}

const CALLOUT_TONE: Record<string, string> = {
  yellow_background: 'bg-amber-50 dark:bg-amber-900/20 border-amber-400',
  green_background: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-500',
  gray_background: 'bg-gray-50 dark:bg-gray-700/40 border-gray-400',
  blue_background: 'bg-blue-50 dark:bg-blue-900/20 border-blue-400',
}
```

（続く JSX は「実装方針」の分岐を素直に書き下す。conclusion callout に `data-tldr` を付ける、signature は avatar 付き、stamp は帯、番号見出しはチップ、本文行は `isDimmed(block, active)` で淡色化＋`isRecapText` で recap スタイル。`Block`/`RenderedBlocks`/`ReaderBody` を上記ヘルパを使って再構成し、`ReaderBody` の props に `active: Set<Confidence>` を追加。）

**署名アバターの JSX（signature 分岐内）:**

```tsx
<div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0 overflow-hidden">
  <Image src="/brand/drnode-avatar.png" alt="" width={40} height={40} className="object-contain p-1" />
</div>
```

**更新日（ReaderBody 冒頭）:**

```tsx
{doc.lastEdited && (
  <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
    更新 {new Date(doc.lastEdited).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })}
  </p>
)}
```

**番号見出しチップ（heading level2 分岐）:**

```tsx
{(() => {
  const p = parseSectionHeading(block.inlines)
  if (block.level === 2 && p) return (
    <div className="flex items-start gap-2 mt-6 mb-2">
      <span className="text-[13px] font-bold tabular-nums text-teal-700 dark:text-teal-300 bg-teal-500/12 w-[22px] h-[22px] rounded-md inline-flex items-center justify-center shrink-0 mt-0.5">{p.n}</span>
      <h3 className="text-base font-medium text-gray-900 dark:text-gray-100 leading-snug">{p.rest}</h3>
    </div>
  )
  return <h3 className="...既存の見出しスタイル...">...</h3>
})()}
```

**本文行の淡色化（paragraph/list_item 描画）:**

```tsx
const dim = isDimmed(block, active)
const recap = block.kind !== 'callout' && isRecapText((block as any).inlines?.map((x: ReaderInline) => x.text).join('') ?? '')
const base = 'text-sm leading-relaxed transition-colors duration-150 motion-reduce:transition-none'
const color = dim ? 'text-gray-500 dark:text-gray-400'
  : recap ? 'text-gray-500 dark:text-gray-400 border-l-2 border-teal-500/30 pl-2.5'
  : 'text-gray-800 dark:text-gray-200'
```

- [ ] **Step 2: 型チェック**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 3: ブラウザで目視（プレビュー）**

`preview_start` で dev を起動 → プレミアムで実ページ（低Na補正）をリーダーで開く。確認:
- 最上部に「更新 …」／⚡黄結論＋査読メタ／🧑‍⚕️緑署名＋りんごアバター／🤖→tealチェック帯／番号 teal チップ／✅⚠️❓ がグリフで色付き／recap（→行）左罫。
- スクリーンリーダー（VoiceOver）でマーク行が「…（確信度: 確立）出典 …」と読まれる。

- [ ] **Step 4: コミット**

```bash
git add src/components/reader/ReaderBody.tsx
git commit -m "feat(reader): faithful ReaderBody (callout roles, glyphs, chips, signature avatar, updated date, dimming)"
```

---

## Task 8: ReaderNavBar（結論バー＋目次＋読了インク）

**Files:**
- Create: `src/components/reader/ReaderNavBar.tsx`

**Interfaces:**
- Consumes: `findTldr`,`tocSections`（Task 1）, `ReaderDoc`,`ReaderBlock`, `docConfidenceMarks`,`CONFIDENCE_MARKS`,`ConfidenceMark`
- Produces: `ReaderNavBar({ doc, scrollRef, active }: { doc: ReaderDoc; scrollRef: React.RefObject<HTMLDivElement>; active: Set<Confidence> })`

**実装方針:**
- `findTldr(doc)` が無ければ何も描かない。
- スクロール容器（`scrollRef`）内で `data-tldr` 要素を `IntersectionObserver(root=scrollRef)` で監視。⚡ が画面外（`isIntersecting=false`）でバー表示（ヒステリシスは `rootMargin: '-8px 0px 0px 0px'`）。IO 非対応なら常に非表示。
- バー: sticky top-0・「この問いへの答え・目次」・`aria-expanded`・chevron。右に active マークの `ConfidenceMark`（タップで chips へスクロール = `scrollRef.current.scrollTo({top:0})`）。
- 底辺 2px 読了インク（`scrollTop/(scrollHeight-clientHeight)`・`motion-reduce` で静的）。
- タップでドロップダウン（`aria-controls`）: 「答え（結論 callout の要約）」＋「セクション」= `tocSections(doc)` の各項目（タップで `scrollRef` 内の対応見出しへスクロール＋その見出しに `focus()`）。凡例（`docConfidenceMarks` の語）を末尾に常設。
- スクロールで自動収納。

- [ ] **Step 1: 実装**（`ReaderNavBar.tsx` を新規作成。上記方針を素直に。IO とスクロール監視は `useEffect`、状態は `useState`。目次ジャンプは `scrollRef.current.querySelectorAll('[data-block-index]')` で対象へ。ReaderBody 側の各トップレベルブロックに `data-block-index={i}` を付与しておく＝Task 7 に1行追加。）

- [ ] **Step 2: 型チェック** — Run: `npx tsc --noEmit` / Expected: エラーなし

- [ ] **Step 3: ブラウザ目視** — ⚡が流れるとバー出現／タップで答え＋§ジャンプ／読了インクが伸びる／`prefers-reduced-motion` で静的。

- [ ] **Step 4: コミット**

```bash
git add src/components/reader/ReaderNavBar.tsx src/components/reader/ReaderBody.tsx
git commit -m "feat(reader): conclusion nav bar with TOC jump + reading ink"
```

---

## Task 9: ConfidenceChips（絞り込みチップ）

**Files:**
- Create: `src/components/reader/ConfidenceChips.tsx`

**Interfaces:**
- Consumes: `docConfidenceMarks`,`CONFIDENCE_LABEL`,`Confidence`, `ConfidenceMark`
- Produces: `ConfidenceChips({ marks, active, onToggle }: { marks: Confidence[]; active: Set<Confidence>; onToggle: (c: Confidence) => void })`

**実装方針:** `marks` が空なら何も描かない。各チップ = `ConfidenceMark`＋語。選択=塗り（意味色淡地）／非選択=意味色アウトライン。`aria-pressed`。実効44px。フィルタ有無の状態文（「◯を強調中・全表示に戻す／注意・不明確の行は常に表示」）＋`aria-live="polite"` は親（SubscriptionReader）側で件数を通知。

- [ ] **Step 1: 実装**（上記方針で新規作成）
- [ ] **Step 2: 型チェック** — `npx tsc --noEmit`
- [ ] **Step 3: コミット**

```bash
git add src/components/reader/ConfidenceChips.tsx
git commit -m "feat(reader): confidence filter chips"
```

---

## Task 10: ReaderMarksProvider（読了/ブックマーク context）

**Files:**
- Create: `src/components/reader/ReaderMarksProvider.tsx`

**Interfaces:**
- Consumes: `loadReads`,`recordRead`,`loadBookmarks`,`saveBookmarks`,`clearBookmarks`,`toggleBookmark`,`isBookmarked`,`BookmarkEntry`（Task 3）, `useAuth`（`@/components/auth/AuthProvider`）
- Produces:
  - `ReaderMarksProvider({ children })`
  - `useReaderMarks(): { isRead(id:string):boolean; isBookmarked(id:string):boolean; markRead(id:string):void; toggleBookmark(hit:BookmarkEntry):void; bookmarks: BookmarkEntry[]; clearBookmarks():void }`

**実装方針:** state に `reads:string[]`・`bookmarks:BookmarkEntry[]`。`useAuth()` の `user?.id`/`loading` 変化で再読込（`RecentViews` と同じ理由＝別ユーザー切替後に空を出す）。`markRead` は `recordRead`＋state更新（重複時は no-op で再レンダ抑制）。`toggleBookmark` は `saveBookmarks`＋state更新。`useReaderMarks` は Provider 外でも安全な no-op を返す。

- [ ] **Step 1: 実装**（`SubscriptionReader` の `ReaderProvider` 同様の形。context＋`useMemo`）
- [ ] **Step 2: 型チェック** — `npx tsc --noEmit`
- [ ] **Step 3: コミット**

```bash
git add src/components/reader/ReaderMarksProvider.tsx
git commit -m "feat(reader): ReaderMarksProvider (reads + bookmarks context)"
```

---

## Task 11: SubscriptionReader 統合（dialog a11y・★・markRead・スケルトン・nav/chips）

**Files:**
- Modify: `src/components/reader/SubscriptionReader.tsx`

**Interfaces:**
- Consumes: `ReaderNavBar`,`ConfidenceChips`,`ReaderMarksProvider(useReaderMarks)`,`docConfidenceMarks`,`Confidence`,`ReaderBody(active)`

**実装方針:**
- `ReaderOverlay`: `role="dialog"` `aria-modal="true"`・開時にシートへフォーカス移動・背面 `aria-hidden`/`inert`・`Esc` 既存踏襲・閉時トリガー復帰。
- ヘッダ: 「プレミアム」隣に ★ トグル（`useReaderMarks`・金 `text-amber-500`・`aria-pressed`・`aria-label="ブックマーク"`・✕から離す）。
- スクロール容器に `ref={scrollRef}`。中に `ConfidenceChips`（本文冒頭・`docConfidenceMarks(doc.blocks)` から）→ `ReaderBody`（`active` 付き）。容器の外（sticky）に `ReaderNavBar`。
- フィルタ状態 `active: Set<Confidence>` を `ReaderOverlay` state に。`aria-live="polite"` の状態文（「◯を強調中・N件」）。
- ローディング: 「読み込み中…」を **スケルトン**（タイトル帯＋数行のパルス・`motion-reduce` で静的）に置換。
- `ReaderProvider.open`: 既存 `recordRecentView` に加え、`useReaderMarks().markRead` を **スクロール50%到達時**に呼ぶ（`scrollRef` の scroll ハンドラ。到達最大深度で判定・無音）。※ `markRead` を open 時でなくスクロールで呼ぶため、ハンドラは `ReaderOverlay` 内に置く。

- [ ] **Step 1: 改修**（上記方針。`ReaderProvider` は `useReaderMarks` を使うため `ReaderMarksProvider` の内側で使われる前提＝Task 12 の `page.tsx` 配線に依存）
- [ ] **Step 2: 型チェック** — `npx tsc --noEmit`
- [ ] **Step 3: ブラウザ目視** — ★保存・スクロール50%で既読ドット（無音）・チップ絞り込みで✅淡色/⚠️❓保護・`aria-live` 通知・スケルトン・Esc/フォーカス。
- [ ] **Step 4: コミット**

```bash
git add src/components/reader/SubscriptionReader.tsx
git commit -m "feat(reader): dialog a11y, star bookmark, scroll-based read, skeleton, filter wiring"
```

---

## Task 12: ResultCard 印＋BookmarksList＋page 配線

**Files:**
- Modify: `src/components/ResultCard.tsx`, `src/app/page.tsx`
- Create: `src/components/BookmarksList.tsx`

**Interfaces:**
- Consumes: `useReaderMarks`（Task 10）, `useReader`（既存）, `BookmarkEntry`

**実装方針:**
- `ResultCard`（`inAppReader` のカードのみ）: `useReaderMarks()` から `isRead(hit.objectID)` で **タイトル左に淡いドット＋カードを軽くトーンダウン**（`opacity-[0.72]` は避け、`text` 側を落とすか薄い印に留める）、`isBookmarked` で **小さな金★**（ピルにしない・カード右）。
- `BookmarksList`: `useReaderMarks().bookmarks` を空状態（`RecentViews` の隣）に。各項目＝タイトル＋`summary` プレビュー＋`isBookmarked` の金★。タップで `useReader().open(entry)`（アプリ内リーダー）。クリアボタン＝`clearBookmarks`。認証解決後に読む（`RecentViews` と同様）。
- `page.tsx`: 既存の `ReaderProvider` の**外側**を `ReaderMarksProvider` で包む。空状態（`RecentViewsList` を出している箇所）の隣に `<BookmarksList />`。
- `SubscriptionReader.ReaderProvider.open` の `toggleBookmark`/`markRead` が `useReaderMarks` を参照できるよう、`ReaderMarksProvider` → `ReaderProvider` の順で入れ子。

- [ ] **Step 1: BookmarksList 作成 → ResultCard 改修 → page.tsx 配線**
- [ ] **Step 2: 型チェック** — `npx tsc --noEmit`
- [ ] **Step 3: ブラウザ目視** — ★保存→カード金★・空状態にブックマーク一覧（要約プレビュー・タップでリーダー）・50%到達したカードに既読ドット。別ユーザー切替で消えることを確認（`personal-data` 経由）。
- [ ] **Step 4: コミット**

```bash
git add src/components/ResultCard.tsx src/components/BookmarksList.tsx src/app/page.tsx
git commit -m "feat(reader): card read/bookmark indicators + bookmarks list + provider wiring"
```

---

## Task 13: 全体テスト＋回帰確認

**Files:** なし（検証のみ）

- [ ] **Step 1: 全テスト**

Run: `cd ~/medical-search-public && npm test`
Expected: 全 PASS（v1 の 247 + 追加分）

- [ ] **Step 2: 型チェック/ビルド**

Run: `npx tsc --noEmit` および `npm run build`
Expected: エラーなし

- [ ] **Step 3: ダークモード＋reduced-motion 目視**

`resize_window` で dark／`prefers-reduced-motion` を切替、確信度色・淡色化コントラスト・アニメ停止を確認。

- [ ] **Step 4: コミット（必要なら微修正）**

```bash
git add -A && git commit -m "test(reader): v2 regression pass + dark/reduced-motion polish"
```

---

## Self-Review 記録（spec 対応表）

- 忠実レンダリング（callout役割/番号/マーク/recap/署名/更新日）→ Task 1,6,7
- 結論バー＋目次 → Task 8
- 確信度フィルタ（⚠️❓保護・aria-live・AA淡色）→ Task 2,9,11
- 読了（中立・スクロール50%・無音）/ブックマーク（★金・空状態一覧）→ Task 3,10,11,12
- 個人データ登録 → Task 4
- 署名アバター資産 → Task 5
- a11y要件（dialog/focus/aria-expanded/reduced-motion/コントラスト/リンクlabel）→ Task 6,7,8,11
- craft（スケルトン/カバー/イージング）→ Task 7,11
- コンテンツ申し送り（査読主語・GLリンク等）→ 実装外（別途・昇格スキル）
