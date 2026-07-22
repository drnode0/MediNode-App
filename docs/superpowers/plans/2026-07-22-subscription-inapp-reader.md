# サブスクDB 本文アプリ内リーダー Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プレミアムのサブスクDB本文を、公開URLを作らずアプリ内で会員ゲート付きレンダリングし、Notion Web公開をやめられる状態にする。

**Architecture:** 新規GETルート `/api/subscription/page` が `SUBSCRIPTION_NOTION_TOKEN` でNotionページのブロックを（子まで再帰）取得→ハウス書式に限定した ReaderDoc JSON に変換して返す。ルートは `daily-question` と同じ会員判定で403ゲート。フロントはSPA（ルーターなし）なので Context 駆動モーダル `SubscriptionReader` が JSON を取得し、新規ブロックレンダラ `ReaderBody` で描画。`ResultCard` のサブスクカードは「Notionで開く」外部リンクをリーダー起動に差し替える（個人/部署は外部リンクのまま）。

**Tech Stack:** Next.js 16 App Router, TypeScript (strict), React, Tailwind (brand=green, darkMode:'media'), `@notionhq/client`, Supabase (session/entitlement), Vitest 4。

## Global Constraints

- 対象は **サブスクDB（`owner === 'subscription'`）のみ**。個人DB・部署DBは一切変更しない（回帰禁止）。
- APIルートは proxy で保護されない（matcher が `/api` を除外）。**認証・会員判定は各ルート内で行う**。
- サブスクNotionトークンは `process.env.SUBSCRIPTION_NOTION_TOKEN`（server-only）。`src/lib/notion.ts`（`NOTION_TOKEN`）は使わない。
- 会員判定の正典は `getActiveStatusByUserId(userId).active`（`@/lib/supabase/subscriptions`）＋ `isAdminEmail(email)`（`@/lib/maintenance`）。`daily-question/route.ts:83-90` が既存の手本。
- 逐語レンダ：要約・言い換えをしない。未対応ブロックは落とさずテキスト表示。
- テスト実行：`npm test`（=`vitest run`）。単体：`npx vitest run <file> -t '<name>'`。型：`npx tsc --noEmit`。**lintは存在しない**（コミット手順に入れない）。
- テストは `src/lib/__tests__/*.test.ts` に配置。Notionは `vi.hoisted` + `vi.mock('@notionhq/client', () => ({ Client: class {...} }))`（class必須、`new`されるため）。
- Reactコンポーネントの自動テスト基盤（jsdom）は無い。UIタスクの検証は preview/ブラウザで手動確認する（repo実態に合わせる）。
- コミットはこまめに。ブランチは運用と別（`git switch -c feat/subscription-inapp-reader` を Task 1 冒頭で作成）。

---

## ファイル構成

- Create `src/lib/reader-doc.ts` — 純関数 `mapBlocksToReaderDoc(page, blocks)` と型（`ReaderDoc`/`ReaderBlock`/`ReaderInline`）。テスト容易。
- Create `src/lib/notion-page.ts` — `fetchPageBlocks(notion, blockId)`（子再帰）。Notionクライアント注入でテスト。
- Create `src/lib/premium-access.ts` — `decidePremium(...)`（純）と `resolveRequestPremium(deps?)`（DI）。
- Create `src/app/api/subscription/page/route.ts` — GETルート（ゲート＋取得＋変換）。
- Create `src/components/reader/ReaderBody.tsx` — ReaderDoc→JSX（ブロックレンダラ、連続リストを ul/ol にグルーピング）。
- Create `src/components/reader/SubscriptionReader.tsx` — `ReaderProvider`/`useReader()`＋モーダル（fetch・ローディング・エラー・画像ズーム）。
- Modify `src/components/ResultCard.tsx` — 型に `thumbnailUrl?` は Phase 2。Phase 1 は2箇所の `<a href={hit.notionUrl}>`（285, 306行）をサブスク時リーダー起動に差し替え。
- Modify `src/app/page.tsx` — `ReaderProvider` を両モードツリーに挿入。
- （Phase 2）Create `src/app/api/subscription/thumbnail/route.ts`、Modify `_core.ts`/`ResultCard.tsx`。

---

## Phase 1 — 本文アプリ内リーダー（抜け道を塞ぐ核）

### Task 1: ReaderDoc 変換（純関数）

**Files:**
- Create: `src/lib/reader-doc.ts`
- Test: `src/lib/__tests__/reader-doc.test.ts`

**Interfaces:**
- Produces:
  - Types `ReaderInline = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string }`
  - `ReaderBlock =`
    `{ kind: 'heading'; level: 1|2|3; inlines: ReaderInline[] }` |
    `{ kind: 'paragraph'; inlines: ReaderInline[] }` |
    `{ kind: 'list_item'; ordered: boolean; inlines: ReaderInline[] }` |
    `{ kind: 'callout'; icon: string | null; color: string | null; blocks: ReaderBlock[] }` |
    `{ kind: 'image'; url: string; caption: string | null }` |
    `{ kind: 'divider' }` |
    `{ kind: 'table'; rows: ReaderInline[][][] }` |
    `{ kind: 'unsupported'; text: string }`
  - `ReaderDoc = { title: string; icon: string | null; cover: string | null; lastEdited: string | null; blocks: ReaderBlock[] }`
  - `mapBlocksToReaderDoc(page: RawPage, blocks: RawBlock[]): ReaderDoc`
  - `mapBlocks(blocks: RawBlock[]): ReaderBlock[]` (exported for tests)
- Consumes: raw Notion shapes (`RawBlock` has `type`, `has_children`, optional `children?: RawBlock[]`, and per-type payloads with `rich_text`).

- [ ] **Step 1: ブランチ作成**

Run: `cd ~/medical-search-public && git switch -c feat/subscription-inapp-reader`
Expected: `Switched to a new branch 'feat/subscription-inapp-reader'`

- [ ] **Step 2: 失敗するテストを書く**

Create `src/lib/__tests__/reader-doc.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { mapBlocks, mapBlocksToReaderDoc } from '../reader-doc'

const rt = (text: string, extra: Record<string, unknown> = {}) => ({
  type: 'text', text: { content: text, link: null }, plain_text: text,
  annotations: { bold: false, italic: false, code: false }, href: null, ...extra,
})

describe('mapBlocks', () => {
  it('heading_2 を level2 見出しに', () => {
    const out = mapBlocks([{ type: 'heading_2', heading_2: { rich_text: [rt('セクション')] } } as any])
    expect(out).toEqual([{ kind: 'heading', level: 2, inlines: [{ text: 'セクション' }] }])
  })

  it('paragraph のリンクを inline href に', () => {
    const out = mapBlocks([{ type: 'paragraph', paragraph: { rich_text: [
      rt('出典', { href: 'https://x.test', text: { content: '出典', link: { url: 'https://x.test' } } }),
    ] } } as any])
    expect(out[0]).toEqual({ kind: 'paragraph', inlines: [{ text: '出典', href: 'https://x.test' }] })
  })

  it('bulleted_list_item は ordered:false', () => {
    const out = mapBlocks([{ type: 'bulleted_list_item', bulleted_list_item: { rich_text: [rt('a')] } } as any])
    expect(out[0]).toEqual({ kind: 'list_item', ordered: false, inlines: [{ text: 'a' }] })
  })

  it('callout はアイコン・色・本文を保持', () => {
    const out = mapBlocks([{ type: 'callout', has_children: false, callout: {
      rich_text: [rt('この問いへの答え')], icon: { type: 'emoji', emoji: '⚡' }, color: 'yellow_background',
    } } as any])
    expect(out[0]).toEqual({
      kind: 'callout', icon: '⚡', color: 'yellow_background',
      blocks: [{ kind: 'paragraph', inlines: [{ text: 'この問いへの答え' }] }],
    })
  })

  it('image(file) は url と caption', () => {
    const out = mapBlocks([{ type: 'image', image: {
      type: 'file', file: { url: 'https://img.test/x.png' }, caption: [rt('図')],
    } } as any])
    expect(out[0]).toEqual({ kind: 'image', url: 'https://img.test/x.png', caption: '図' })
  })

  it('bold 注釈を保持', () => {
    const out = mapBlocks([{ type: 'paragraph', paragraph: { rich_text: [
      rt('太字', { annotations: { bold: true, italic: false, code: false } }),
    ] } } as any])
    expect(out[0]).toEqual({ kind: 'paragraph', inlines: [{ text: '太字', bold: true }] })
  })

  it('未対応ブロックは unsupported で落とさない', () => {
    const out = mapBlocks([{ type: 'equation', equation: { expression: 'E=mc^2' } } as any])
    expect(out[0].kind).toBe('unsupported')
  })
})

describe('mapBlocksToReaderDoc', () => {
  it('page から title/icon/cover/lastEdited を拾う', () => {
    const page = {
      last_edited_time: '2026-07-20T06:11:00.000Z',
      icon: { type: 'emoji', emoji: '💡' },
      cover: { type: 'file', file: { url: 'https://cov.test/c.png' } },
      properties: { 名前: { type: 'title', title: [rt('低Na補正')] } },
    }
    const doc = mapBlocksToReaderDoc(page as any, [])
    expect(doc.title).toBe('低Na補正')
    expect(doc.icon).toBe('💡')
    expect(doc.cover).toBe('https://cov.test/c.png')
    expect(doc.lastEdited).toBe('2026-07-20T06:11:00.000Z')
  })
})
```

- [ ] **Step 3: 失敗を確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/reader-doc.test.ts`
Expected: FAIL（`Cannot find module '../reader-doc'`）

- [ ] **Step 4: 実装を書く**

Create `src/lib/reader-doc.ts`:

```ts
export type ReaderInline = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string }

export type ReaderBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; inlines: ReaderInline[] }
  | { kind: 'paragraph'; inlines: ReaderInline[] }
  | { kind: 'list_item'; ordered: boolean; inlines: ReaderInline[] }
  | { kind: 'callout'; icon: string | null; color: string | null; blocks: ReaderBlock[] }
  | { kind: 'image'; url: string; caption: string | null }
  | { kind: 'divider' }
  | { kind: 'table'; rows: ReaderInline[][][] }
  | { kind: 'unsupported'; text: string }

export type ReaderDoc = {
  title: string
  icon: string | null
  cover: string | null
  lastEdited: string | null
  blocks: ReaderBlock[]
}

type RichText = {
  plain_text?: string
  href?: string | null
  annotations?: { bold?: boolean; italic?: boolean; code?: boolean }
  text?: { content?: string; link?: { url?: string } | null }
}
export type RawBlock = { type: string; has_children?: boolean; children?: RawBlock[] } & Record<string, any>
export type RawPage = { last_edited_time?: string; icon?: any; cover?: any; properties?: Record<string, any> }

function inlines(rich: RichText[] | undefined): ReaderInline[] {
  if (!Array.isArray(rich)) return []
  return rich.map((r) => {
    const text = r.plain_text ?? r.text?.content ?? ''
    const href = r.href ?? r.text?.link?.url ?? undefined
    const a = r.annotations ?? {}
    const out: ReaderInline = { text }
    if (a.bold) out.bold = true
    if (a.italic) out.italic = true
    if (a.code) out.code = true
    if (href) out.href = href
    return out
  })
}

function iconOf(icon: any): string | null {
  if (icon?.type === 'emoji') return icon.emoji ?? null
  if (icon?.type === 'external') return icon.external?.url ?? null
  if (icon?.type === 'file') return icon.file?.url ?? null
  return null
}

function fileUrlOf(node: any): string | null {
  if (!node) return null
  if (node.type === 'external') return node.external?.url ?? null
  if (node.type === 'file') return node.file?.url ?? null
  return node.external?.url ?? node.file?.url ?? null
}

function plain(rich: RichText[] | undefined): string {
  return inlines(rich).map((i) => i.text).join('')
}

export function mapBlocks(blocks: RawBlock[]): ReaderBlock[] {
  const out: ReaderBlock[] = []
  for (const b of blocks || []) {
    switch (b.type) {
      case 'heading_1': out.push({ kind: 'heading', level: 1, inlines: inlines(b.heading_1?.rich_text) }); break
      case 'heading_2': out.push({ kind: 'heading', level: 2, inlines: inlines(b.heading_2?.rich_text) }); break
      case 'heading_3': out.push({ kind: 'heading', level: 3, inlines: inlines(b.heading_3?.rich_text) }); break
      case 'paragraph': out.push({ kind: 'paragraph', inlines: inlines(b.paragraph?.rich_text) }); break
      case 'bulleted_list_item':
        out.push({ kind: 'list_item', ordered: false, inlines: inlines(b.bulleted_list_item?.rich_text) }); break
      case 'numbered_list_item':
        out.push({ kind: 'list_item', ordered: true, inlines: inlines(b.numbered_list_item?.rich_text) }); break
      case 'callout': {
        const body: ReaderBlock[] = []
        const rich = inlines(b.callout?.rich_text)
        if (rich.length) body.push({ kind: 'paragraph', inlines: rich })
        body.push(...mapBlocks(b.children || []))
        out.push({ kind: 'callout', icon: iconOf(b.callout?.icon), color: b.callout?.color ?? null, blocks: body })
        break
      }
      case 'image':
        out.push({ kind: 'image', url: fileUrlOf(b.image) ?? '', caption: plain(b.image?.caption) || null }); break
      case 'divider': out.push({ kind: 'divider' }); break
      case 'quote': out.push({ kind: 'paragraph', inlines: inlines(b.quote?.rich_text) }); break
      case 'table': {
        const rows = (b.children || [])
          .filter((r) => r.type === 'table_row')
          .map((r) => (r.table_row?.cells || []).map((cell: RichText[]) => inlines(cell)))
        out.push({ kind: 'table', rows }); break
      }
      default:
        out.push({ kind: 'unsupported', text: `[未対応ブロック: ${b.type}]` })
    }
  }
  return out
}

function titleOf(props: Record<string, any> | undefined): string {
  if (!props) return ''
  for (const p of Object.values(props)) {
    if (p?.type === 'title') return plain(p.title)
  }
  return ''
}

export function mapBlocksToReaderDoc(page: RawPage, blocks: RawBlock[]): ReaderDoc {
  return {
    title: titleOf(page.properties),
    icon: iconOf(page.icon),
    cover: fileUrlOf(page.cover),
    lastEdited: page.last_edited_time ?? null,
    blocks: mapBlocks(blocks),
  }
}
```

- [ ] **Step 5: テスト成功を確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/reader-doc.test.ts`
Expected: PASS（全ケース）

- [ ] **Step 6: コミット**

```bash
cd ~/medical-search-public
git add src/lib/reader-doc.ts src/lib/__tests__/reader-doc.test.ts
git commit -m "feat(reader): add ReaderDoc mapping from Notion blocks (house vocabulary)"
```

---

### Task 2: ブロック再帰取得

**Files:**
- Create: `src/lib/notion-page.ts`
- Test: `src/lib/__tests__/notion-page.test.ts`

**Interfaces:**
- Consumes: a Notion-like client `{ blocks: { children: { list(args) } } }`.
- Produces: `fetchPageBlocks(notion: BlockLister, blockId: string): Promise<RawBlock[]>` — トップレベル配列。子は各ブロックの `children` に格納。`type BlockLister = { blocks: { children: { list: (a: { block_id: string; page_size?: number; start_cursor?: string }) => Promise<{ results: any[]; has_more: boolean; next_cursor: string | null }> } } }`

- [ ] **Step 1: 失敗するテストを書く**

Create `src/lib/__tests__/notion-page.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { fetchPageBlocks } from '../notion-page'

function clientFrom(byBlock: Record<string, any[]>) {
  const list = vi.fn(async ({ block_id }: { block_id: string }) => ({
    results: byBlock[block_id] ?? [],
    has_more: false,
    next_cursor: null,
  }))
  return { client: { blocks: { children: { list } } }, list }
}

describe('fetchPageBlocks', () => {
  it('トップレベルを取得する', async () => {
    const { client } = clientFrom({ page1: [{ id: 'a', type: 'paragraph', has_children: false }] })
    const out = await fetchPageBlocks(client as any, 'page1')
    expect(out.map((b) => b.id)).toEqual(['a'])
  })

  it('has_children の子を再帰取得して children に格納', async () => {
    const { client, list } = clientFrom({
      page1: [{ id: 'callout1', type: 'callout', has_children: true }],
      callout1: [{ id: 'child1', type: 'paragraph', has_children: false }],
    })
    const out = await fetchPageBlocks(client as any, 'page1')
    expect(out[0].children.map((c: any) => c.id)).toEqual(['child1'])
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ block_id: 'callout1' }))
  })

  it('ページネーションを辿る', async () => {
    const list = vi.fn()
      .mockResolvedValueOnce({ results: [{ id: 'a', has_children: false }], has_more: true, next_cursor: 'c2' })
      .mockResolvedValueOnce({ results: [{ id: 'b', has_children: false }], has_more: false, next_cursor: null })
    const out = await fetchPageBlocks({ blocks: { children: { list } } } as any, 'page1')
    expect(out.map((b) => b.id)).toEqual(['a', 'b'])
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/notion-page.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: 実装を書く**

Create `src/lib/notion-page.ts`:

```ts
import type { RawBlock } from './reader-doc'

export type BlockLister = {
  blocks: { children: { list: (a: { block_id: string; page_size?: number; start_cursor?: string }) => Promise<{
    results: any[]; has_more: boolean; next_cursor: string | null
  }> } }
}

export async function fetchPageBlocks(notion: BlockLister, blockId: string): Promise<RawBlock[]> {
  const out: RawBlock[] = []
  let cursor: string | undefined = undefined
  do {
    const res = await notion.blocks.children.list({ block_id: blockId, page_size: 100, start_cursor: cursor })
    for (const raw of res.results) {
      const block = raw as RawBlock
      if (block.has_children) block.children = await fetchPageBlocks(notion, block.id as string)
      out.push(block)
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)
  return out
}
```

- [ ] **Step 4: テスト成功を確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/notion-page.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
cd ~/medical-search-public
git add src/lib/notion-page.ts src/lib/__tests__/notion-page.test.ts
git commit -m "feat(reader): recursive Notion block fetch (children + pagination)"
```

---

### Task 3: 会員判定ヘルパー

**Files:**
- Create: `src/lib/premium-access.ts`
- Test: `src/lib/__tests__/premium-access.test.ts`

**Interfaces:**
- Produces:
  - `decidePremium(user: { id: string; email: string | null } | null, active: boolean, adminEmails: string[]): boolean` (純)
  - `resolveRequestPremium(deps?: Partial<PremiumDeps>): Promise<{ premium: boolean; userId: string | null; email: string | null }>` where
    `PremiumDeps = { getUser: () => Promise<{ id: string; email: string | null } | null>; getStatus: (userId: string) => Promise<boolean>; adminEmails: string[] }`
- Consumes（デフォルト実装内で）: `createClient` from `@/lib/supabase/server`, `getActiveStatusByUserId` from `@/lib/supabase/subscriptions`, `isAdminEmail` from `@/lib/maintenance`, `process.env.COMP_ADMIN_EMAILS`.

- [ ] **Step 1: 失敗するテストを書く**

Create `src/lib/__tests__/premium-access.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { decidePremium, resolveRequestPremium } from '../premium-access'

describe('decidePremium', () => {
  const admins = ['owner@x.test']
  it('未ログインは false', () => { expect(decidePremium(null, true, admins)).toBe(false) })
  it('管理者メールは active 無関係に true', () => {
    expect(decidePremium({ id: 'u1', email: 'owner@x.test' }, false, admins)).toBe(true)
  })
  it('一般ユーザーは active に従う', () => {
    expect(decidePremium({ id: 'u2', email: 'a@x.test' }, true, admins)).toBe(true)
    expect(decidePremium({ id: 'u2', email: 'a@x.test' }, false, admins)).toBe(false)
  })
})

describe('resolveRequestPremium (DI)', () => {
  it('active な一般ユーザー', async () => {
    const r = await resolveRequestPremium({
      getUser: async () => ({ id: 'u2', email: 'a@x.test' }),
      getStatus: async () => true,
      adminEmails: ['owner@x.test'],
    })
    expect(r).toEqual({ premium: true, userId: 'u2', email: 'a@x.test' })
  })
  it('未ログインは premium:false', async () => {
    const r = await resolveRequestPremium({
      getUser: async () => null, getStatus: async () => false, adminEmails: [],
    })
    expect(r).toEqual({ premium: false, userId: null, email: null })
  })
  it('getStatus が投げても落ちない（false扱い）', async () => {
    const r = await resolveRequestPremium({
      getUser: async () => ({ id: 'u3', email: 'b@x.test' }),
      getStatus: async () => { throw new Error('db down') },
      adminEmails: [],
    })
    expect(r.premium).toBe(false)
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/premium-access.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: 実装を書く**

Create `src/lib/premium-access.ts`:

```ts
export type PremiumUser = { id: string; email: string | null }
export type PremiumDeps = {
  getUser: () => Promise<PremiumUser | null>
  getStatus: (userId: string) => Promise<boolean>
  adminEmails: string[]
}

export function decidePremium(user: PremiumUser | null, active: boolean, adminEmails: string[]): boolean {
  if (!user) return false
  if (user.email && adminEmails.map((e) => e.toLowerCase().trim()).includes(user.email.toLowerCase())) return true
  return active
}

async function defaultGetUser(): Promise<PremiumUser | null> {
  const { createClient } = await import('@/lib/supabase/server')
  const supabase = await createClient()
  const { data } = await supabase.auth.getUser()
  if (!data.user) return null
  return { id: data.user.id, email: data.user.email ?? null }
}

async function defaultGetStatus(userId: string): Promise<boolean> {
  const { getActiveStatusByUserId } = await import('@/lib/supabase/subscriptions')
  return (await getActiveStatusByUserId(userId)).active
}

function defaultAdminEmails(): string[] {
  return (process.env.COMP_ADMIN_EMAILS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
}

export async function resolveRequestPremium(
  deps: Partial<PremiumDeps> = {},
): Promise<{ premium: boolean; userId: string | null; email: string | null }> {
  const getUser = deps.getUser ?? defaultGetUser
  const getStatus = deps.getStatus ?? defaultGetStatus
  const adminEmails = deps.adminEmails ?? defaultAdminEmails()

  let user: PremiumUser | null = null
  try { user = await getUser() } catch { user = null }
  if (!user) return { premium: false, userId: null, email: null }

  let active = false
  try { active = await getStatus(user.id) } catch { active = false }

  return { premium: decidePremium(user, active, adminEmails), userId: user.id, email: user.email }
}
```

- [ ] **Step 4: テスト成功を確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/premium-access.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
cd ~/medical-search-public
git add src/lib/premium-access.ts src/lib/__tests__/premium-access.test.ts
git commit -m "feat(reader): add request-level premium resolver (reuses subscription entitlement)"
```

---

### Task 4: リーダー用GETルート（会員ゲート）

**Files:**
- Create: `src/app/api/subscription/page/route.ts`
- Test: `src/lib/__tests__/subscription-page-route.test.ts`

**Interfaces:**
- HTTP: `GET /api/subscription/page?id=<pageId|subscription_pageId>` →
  200 `{ doc: ReaderDoc }`（`Cache-Control: private, max-age=120`）／400 missing id／403 `{ error:'premium required' }`／500 未設定／502 取得失敗。
- Consumes: `resolveRequestPremium`（Task 3）, `fetchPageBlocks`（Task 2）, `mapBlocksToReaderDoc`（Task 1）, `Client` from `@notionhq/client`, `requireSessionIfLoginRequired` from `@/lib/api-guard`.

- [ ] **Step 1: 失敗するテストを書く**

Create `src/lib/__tests__/subscription-page-route.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { retrieveMock, listMock, premiumMock, guardMock } = vi.hoisted(() => ({
  retrieveMock: vi.fn(), listMock: vi.fn(), premiumMock: vi.fn(), guardMock: vi.fn(),
}))

vi.mock('@notionhq/client', () => ({
  Client: class { pages = { retrieve: retrieveMock }; blocks = { children: { list: listMock } } },
}))
vi.mock('@/lib/premium-access', () => ({ resolveRequestPremium: premiumMock }))
vi.mock('@/lib/api-guard', () => ({ requireSessionIfLoginRequired: guardMock }))

import { GET } from '../../app/api/subscription/page/route'
import { NextRequest } from 'next/server'

const req = (id?: string) =>
  new NextRequest(`http://localhost/api/subscription/page${id != null ? `?id=${id}` : ''}`)

beforeEach(() => {
  retrieveMock.mockReset(); listMock.mockReset(); premiumMock.mockReset(); guardMock.mockReset()
  guardMock.mockResolvedValue(null)
  process.env.SUBSCRIPTION_NOTION_TOKEN = 'ntn_test'
})

describe('GET /api/subscription/page', () => {
  it('id 未指定は 400', async () => {
    premiumMock.mockResolvedValue({ premium: true })
    const res = await GET(req())
    expect(res.status).toBe(400)
  })

  it('非会員は 403（本文を取得しない）', async () => {
    premiumMock.mockResolvedValue({ premium: false })
    const res = await GET(req('abc123'))
    expect(res.status).toBe(403)
    expect(retrieveMock).not.toHaveBeenCalled()
    expect(listMock).not.toHaveBeenCalled()
  })

  it('会員は 200 で doc を返し subscription_ 接頭辞を剥がす', async () => {
    premiumMock.mockResolvedValue({ premium: true })
    retrieveMock.mockResolvedValue({
      last_edited_time: '2026-07-20T00:00:00.000Z',
      icon: { type: 'emoji', emoji: '💡' }, cover: null,
      properties: { 名前: { type: 'title', title: [{ plain_text: 'T', annotations: {} }] } },
    })
    listMock.mockResolvedValue({
      results: [{ id: 'b1', type: 'heading_2', has_children: false, heading_2: { rich_text: [{ plain_text: 'H', annotations: {} }] } }],
      has_more: false, next_cursor: null,
    })
    const res = await GET(req('subscription_PAGEID'))
    const data = await res.json()
    expect(res.status).toBe(200)
    expect(retrieveMock).toHaveBeenCalledWith({ page_id: 'PAGEID' })
    expect(data.doc.title).toBe('T')
    expect(data.doc.blocks[0]).toEqual({ kind: 'heading', level: 2, inlines: [{ text: 'H' }] })
    expect(res.headers.get('Cache-Control')).toContain('max-age=120')
  })

  it('トークン未設定は 500', async () => {
    premiumMock.mockResolvedValue({ premium: true })
    delete process.env.SUBSCRIPTION_NOTION_TOKEN
    const res = await GET(req('abc'))
    expect(res.status).toBe(500)
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/subscription-page-route.test.ts`
Expected: FAIL（route module not found）

- [ ] **Step 3: 実装を書く**

Create `src/app/api/subscription/page/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { requireSessionIfLoginRequired } from '@/lib/api-guard'
import { resolveRequestPremium } from '@/lib/premium-access'
import { fetchPageBlocks } from '@/lib/notion-page'
import { mapBlocksToReaderDoc } from '@/lib/reader-doc'

export async function GET(req: NextRequest) {
  const denied = await requireSessionIfLoginRequired()
  if (denied) return denied

  const raw = new URL(req.url).searchParams.get('id')
  const pageId = raw?.replace(/^subscription_/, '').trim()
  if (!pageId) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const { premium } = await resolveRequestPremium()
  if (!premium) return NextResponse.json({ error: 'premium required' }, { status: 403 })

  const token = process.env.SUBSCRIPTION_NOTION_TOKEN
  if (!token) return NextResponse.json({ error: 'not configured' }, { status: 500 })

  const notion = new Client({ auth: token })
  try {
    const page = await notion.pages.retrieve({ page_id: pageId })
    const blocks = await fetchPageBlocks(notion as any, pageId)
    const doc = mapBlocksToReaderDoc(page as any, blocks)
    return NextResponse.json({ doc }, { headers: { 'Cache-Control': 'private, max-age=120' } })
  } catch {
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 })
  }
}
```

- [ ] **Step 4: テスト成功を確認**

Run: `cd ~/medical-search-public && npx vitest run src/lib/__tests__/subscription-page-route.test.ts`
Expected: PASS（特に「非会員は403で本文を取得しない」）

- [ ] **Step 5: 型チェック＋全テスト**

Run: `cd ~/medical-search-public && npx tsc --noEmit && npm test`
Expected: 型エラー0・全テストPASS

- [ ] **Step 6: コミット**

```bash
cd ~/medical-search-public
git add src/app/api/subscription/page/route.ts src/lib/__tests__/subscription-page-route.test.ts
git commit -m "feat(reader): add gated GET /api/subscription/page (premium-only body fetch)"
```

---

### Task 5: ブロックレンダラ `ReaderBody`

**Files:**
- Create: `src/components/reader/ReaderBody.tsx`

**Interfaces:**
- Consumes: `ReaderDoc`/`ReaderBlock`/`ReaderInline`（Task 1）。
- Produces: `export function ReaderBody({ doc, onImageClick }: { doc: ReaderDoc; onImageClick: (url: string) => void }): JSX.Element`

**注記:** 本リポにコンポーネント自動テスト基盤（jsdom）は無い。検証は Task 7 で preview 手動確認。連続する `list_item` を `ul`/`ol` にまとめる。callout の色はトーンにマップ。ブランドは緑（`brand`）、ダークは `dark:` を必ず併記。

- [ ] **Step 1: コンポーネントを書く**

Create `src/components/reader/ReaderBody.tsx`:

```tsx
'use client'
import type { ReaderDoc, ReaderBlock, ReaderInline } from '@/lib/reader-doc'

function Inlines({ items }: { items: ReaderInline[] }) {
  return (
    <>
      {items.map((n, i) => {
        const cls = [n.bold ? 'font-medium' : '', n.italic ? 'italic' : '',
          n.code ? 'font-mono text-[0.85em] bg-gray-100 dark:bg-gray-700 px-1 rounded' : ''].join(' ')
        if (n.href) {
          return (
            <a key={i} href={n.href} target="_blank" rel="noopener noreferrer"
              className={`${cls} text-brand-600 dark:text-brand-300 underline underline-offset-2`}>{n.text}</a>
          )
        }
        return <span key={i} className={cls}>{n.text}</span>
      })}
    </>
  )
}

const CALLOUT_TONE: Record<string, string> = {
  yellow_background: 'bg-amber-50 dark:bg-amber-900/20 border-amber-400',
  green_background: 'bg-brand-50 dark:bg-brand-900/30 border-brand-500',
  gray_background: 'bg-gray-50 dark:bg-gray-700/40 border-gray-400',
  blue_background: 'bg-blue-50 dark:bg-blue-900/20 border-blue-400',
}

function Block({ block, onImageClick }: { block: ReaderBlock; onImageClick: (u: string) => void }) {
  switch (block.kind) {
    case 'heading': {
      const size = block.level === 1 ? 'text-lg' : block.level === 2 ? 'text-base' : 'text-sm'
      return <h3 className={`${size} font-medium text-gray-900 dark:text-gray-100 mt-5 mb-1.5`}><Inlines items={block.inlines} /></h3>
    }
    case 'paragraph':
      return <p className="text-sm leading-relaxed text-gray-800 dark:text-gray-200 my-2"><Inlines items={block.inlines} /></p>
    case 'callout': {
      const tone = (block.color && CALLOUT_TONE[block.color]) || CALLOUT_TONE.gray_background
      return (
        <div className={`border-l-4 rounded-r-lg px-3 py-2.5 my-3 ${tone}`}>
          <div className="flex gap-2">
            {block.icon && <span className="shrink-0 text-base leading-6">{block.icon}</span>}
            <div className="min-w-0">{block.blocks.map((b, i) => <Block key={i} block={b} onImageClick={onImageClick} />)}</div>
          </div>
        </div>
      )
    }
    case 'image':
      return (
        <button type="button" onClick={() => onImageClick(block.url)} className="block w-full my-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={block.url} alt={block.caption ?? ''} className="w-full rounded-lg border border-gray-200 dark:border-gray-700" />
          {block.caption && <span className="block text-xs text-gray-500 mt-1">{block.caption}</span>}
        </button>
      )
    case 'divider':
      return <hr className="my-4 border-gray-200 dark:border-gray-700" />
    case 'table':
      return (
        <div className="overflow-x-auto my-3">
          <table className="text-xs border-collapse">
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>{row.map((cell, c) => (
                  <td key={c} className="border border-gray-200 dark:border-gray-700 px-2 py-1"><Inlines items={cell} /></td>
                ))}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'unsupported':
      return <p className="text-xs text-gray-400 my-1">{block.text}</p>
    default:
      return null
  }
}

// 連続する list_item を ul/ol にまとめる
function groupBlocks(blocks: ReaderBlock[]): (ReaderBlock | { kind: 'list'; ordered: boolean; items: ReaderInline[][] })[] {
  const out: any[] = []
  for (const b of blocks) {
    if (b.kind === 'list_item') {
      const last = out[out.length - 1]
      if (last && last.kind === 'list' && last.ordered === b.ordered) last.items.push(b.inlines)
      else out.push({ kind: 'list', ordered: b.ordered, items: [b.inlines] })
    } else out.push(b)
  }
  return out
}

export function ReaderBody({ doc, onImageClick }: { doc: ReaderDoc; onImageClick: (url: string) => void }) {
  const grouped = groupBlocks(doc.blocks)
  return (
    <div>
      {doc.cover && (
        <button type="button" onClick={() => onImageClick(doc.cover!)} className="block w-full mb-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={doc.cover} alt="" className="w-full rounded-lg" />
        </button>
      )}
      <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-3">
        {doc.icon && !doc.icon.startsWith('http') && <span className="mr-1">{doc.icon}</span>}{doc.title}
      </h2>
      {grouped.map((b, i) => {
        if ((b as any).kind === 'list') {
          const l = b as { kind: 'list'; ordered: boolean; items: ReaderInline[][] }
          const Tag = l.ordered ? 'ol' : 'ul'
          return (
            <Tag key={i} className={`${l.ordered ? 'list-decimal' : 'list-disc'} pl-5 my-2 space-y-1 text-sm text-gray-800 dark:text-gray-200`}>
              {l.items.map((it, j) => <li key={j} className="leading-relaxed"><Inlines items={it} /></li>)}
            </Tag>
          )
        }
        return <Block key={i} block={b as ReaderBlock} onImageClick={onImageClick} />
      })}
    </div>
  )
}
```

- [ ] **Step 2: 型チェック**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: 型エラー0

- [ ] **Step 3: コミット**

```bash
cd ~/medical-search-public
git add src/components/reader/ReaderBody.tsx
git commit -m "feat(reader): add ReaderBody block renderer (house format, dark mode)"
```

---

### Task 6: リーダーモーダル＋Context

**Files:**
- Create: `src/components/reader/SubscriptionReader.tsx`

**Interfaces:**
- Produces:
  - `export function ReaderProvider({ children }: { children: React.ReactNode }): JSX.Element`
  - `export function useReader(): { open: (hit: { objectID: string; title: string; notionUrl: string; knowledgeLevel?: string; owner?: string }) => void }`
- Consumes: `ReaderBody`（Task 5）, `recordRecentView` from `@/lib/recent-views`, `GET /api/subscription/page`（Task 4）。
- 参考実装: `src/components/CqCapture.tsx`（context + `createPortal` overlay `fixed inset-0 z-[9999] bg-black/40`, `useBodyScrollLock`）、`SettingsPanel`（bottom-sheet）。

**注記:** overlay は `useBodyScrollLock()`（`@/lib/use-body-scroll-lock`）。開いた瞬間 `recordRecentView(hit)`。画像クリックで全画面ズーム（同オーバレイ内の別レイヤ）。

- [ ] **Step 1: コンポーネントを書く**

Create `src/components/reader/SubscriptionReader.tsx`:

```tsx
'use client'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
import { recordRecentView } from '@/lib/recent-views'
import { ReaderBody } from './ReaderBody'
import type { ReaderDoc } from '@/lib/reader-doc'

type ReaderHit = { objectID: string; title: string; notionUrl: string; knowledgeLevel?: string; owner?: string }
type ReaderCtx = { open: (hit: ReaderHit) => void }
const Ctx = createContext<ReaderCtx | null>(null)

export function useReader(): ReaderCtx {
  const v = useContext(Ctx)
  if (!v) return { open: () => {} }
  return v
}

export function ReaderProvider({ children }: { children: React.ReactNode }) {
  const [hit, setHit] = useState<ReaderHit | null>(null)
  const [doc, setDoc] = useState<ReaderDoc | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [zoom, setZoom] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])
  useBodyScrollLock(!!hit)

  const open = useCallback((h: ReaderHit) => {
    setHit(h); setDoc(null); setState('loading'); setZoom(null)
    recordRecentView(h as any)
    fetch(`/api/subscription/page?id=${encodeURIComponent(h.objectID)}`)
      .then(async (r) => { if (!r.ok) throw new Error(String(r.status)); return r.json() })
      .then((d) => { setDoc(d.doc); setState('idle') })
      .catch(() => setState('error'))
  }, [])

  const close = useCallback(() => { setHit(null); setDoc(null); setZoom(null) }, [])

  useEffect(() => {
    if (!hit) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { zoom ? setZoom(null) : close() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [hit, zoom, close])

  const overlay = hit && (
    <>
      <div className="fixed inset-0 z-[9998] bg-black/40" onClick={close} />
      <div className="fixed inset-x-0 bottom-0 z-[9999] bg-white dark:bg-gray-800 rounded-t-2xl max-h-[92vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700">
          <span className="text-xs font-medium text-purple-600 dark:text-purple-300">プレミアム</span>
          <button type="button" onClick={close} aria-label="閉じる" className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-4 py-4">
          {state === 'loading' && <p className="text-sm text-gray-500 py-8 text-center">読み込み中…</p>}
          {state === 'error' && (
            <div className="py-8 text-center">
              <p className="text-sm text-gray-500 mb-3">本文を表示できませんでした。</p>
              <a href={hit.notionUrl} target="_blank" rel="noopener noreferrer"
                className="text-sm text-brand-600 dark:text-brand-300 underline">Notionで開く</a>
            </div>
          )}
          {state === 'idle' && doc && <ReaderBody doc={doc} onImageClick={(u) => setZoom(u)} />}
        </div>
      </div>
      {zoom && (
        <div className="fixed inset-0 z-[10000] bg-black/90 flex items-center justify-center p-4" onClick={() => setZoom(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={zoom} alt="" className="max-w-full max-h-full object-contain" />
        </div>
      )}
    </>
  )

  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {mounted && overlay ? createPortal(overlay, document.body) : null}
    </Ctx.Provider>
  )
}
```

- [ ] **Step 2: 型チェック**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: 型エラー0（`useBodyScrollLock` のシグネチャが `(active: boolean)` であることを確認。異なる場合は既存呼び出し `SettingsPanel.tsx` に合わせる）

- [ ] **Step 3: コミット**

```bash
cd ~/medical-search-public
git add src/components/reader/SubscriptionReader.tsx
git commit -m "feat(reader): add SubscriptionReader modal + ReaderProvider/useReader"
```

---

### Task 7: 配線（Provider挿入＋ResultCard差し替え）＋手動検証

**Files:**
- Modify: `src/app/page.tsx`（両モードツリーの provider スタックに `ReaderProvider` を追加）
- Modify: `src/components/ResultCard.tsx`（2箇所のサブスク外部リンクをリーダー起動に差し替え）

**Interfaces:**
- Consumes: `ReaderProvider`/`useReader`（Task 6）, `hasSubscriptionConfig` from `@/lib/algolia`。

- [ ] **Step 1: page.tsx に ReaderProvider を挿入**

`src/app/page.tsx` の import に追加:
```tsx
import { ReaderProvider } from '@/components/reader/SubscriptionReader'
```
両モードの provider スタック（Notionモード ~2812-2814 / Algoliaモード ~2900-2902 の `SubscriptionSearchProvider` > `OpenSettingsContext.Provider` > `CqCaptureProvider`）の**最内**に `ReaderProvider` を1段追加する。例（Algoliaモード側、既存構造に合わせて閉じタグも対応させる）:
```tsx
<SubscriptionSearchProvider ...>
  <OpenSettingsContext.Provider value={...}>
    <CqCaptureProvider>
      <ReaderProvider>
        {/* 既存の子 */}
      </ReaderProvider>
    </CqCaptureProvider>
  </OpenSettingsContext.Provider>
</SubscriptionSearchProvider>
```
Notionモード側も同様に1段追加。

- [ ] **Step 2: ResultCard を差し替え**

`src/components/ResultCard.tsx` の import に追加:
```tsx
import { useReader } from '@/components/reader/SubscriptionReader'
import { hasSubscriptionConfig } from '@/lib/algolia'
```
`ResultCard` 関数本体の先頭（`const [expanded, setExpanded] = ...` 付近）に:
```tsx
const { open: openReader } = useReader()
const inAppReader = hit.owner === 'subscription' && hasSubscriptionConfig()
```
2箇所の「Notionで開く」リンクを、`inAppReader` の時だけボタン化する。**285行付近**（要約ありカードのフッター）を次に置換:
```tsx
<div className="flex justify-end mt-3">
  {inAppReader ? (
    <button type="button"
      onClick={(e) => { e.stopPropagation(); recordCqView(hit.objectID, hit.owner); openReader(hit) }}
      className="flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200">
      本文を読む
      <ExternalLink className="w-3.5 h-3.5" />
    </button>
  ) : (
    <a href={hit.notionUrl} target="_blank" rel="noopener noreferrer"
      onClick={(e) => { e.stopPropagation(); recordRecentView(hit) }}
      className="flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200">
      Notionで開く
      <ExternalLink className="w-3.5 h-3.5" />
    </a>
  )}
</div>
```
**306行付近**（`!hasExpandable` の全面リンク）も同様に、`inAppReader` の時は `<button onClick={() => { recordCqView(hit.objectID, hit.owner); openReader(hit) }}>本文を読む</button>`、それ以外は既存の `<a>` を維持する。`recordRecentView` はリーダー側 `open()` でも呼ぶため二重記録になり得るが `recordRecentView` は同一objectIDを先頭へ集約する実装（`recent-views.ts`）なので実害なし。もしボタン経路では `recordRecentView` を呼ばず reader 側に一本化したい場合はボタン側から外す。

- [ ] **Step 3: 型チェック＋全テスト**

Run: `cd ~/medical-search-public && npx tsc --noEmit && npm test`
Expected: 型エラー0・全テストPASS

- [ ] **Step 4: 手動検証（preview）**

ローカルにサブスク設定（`SUBSCRIPTION_NOTION_TOKEN` 等）が入る環境で dev サーバを起動し、プレミアム有効セッションで確認する。確認項目:
1. サブスクカードのフッターが「本文を読む」になっている（個人/部署カードは「Notionで開く」のまま）。
2. 「本文を読む」→ モーダルが開き、実ナレッジ（例:低Na補正）の ⚡答え・🧑‍⚕️実践・番号付き6セクション・確信度マーク（リンク）・参考文献・画像が**欠落なく**表示される。
3. 画像タップで全画面ズーム、Escで戻る／閉じる。
4. 非プレミアム（またはログアウト）セッションでは「本文を読む」を押しても 403 でエラー表示＋「Notionで開く」フォールバックが出る（`/api/subscription/page` が 403）。
5. ダークモードで配色が破綻しない。

問題があればソースを直し Step 3 から再確認。

- [ ] **Step 5: コミット**

```bash
cd ~/medical-search-public
git add src/app/page.tsx src/components/ResultCard.tsx
git commit -m "feat(reader): open in-app reader for subscription cards (keep external link for personal/team)"
```

---

## Phase 2 — ギャラリーのサムネ（見た目パリティ・任意）

> Phase 1 だけで抜け道封鎖は達成できる。サムネはギャラリー見栄えの補完。Notion画像URLは署名付きで失効するため、Algoliaに焼き込まず**オンデマンド解決＋リダイレクト**にする。

### Task 8: サムネ解決ルート

**Files:**
- Create: `src/app/api/subscription/thumbnail/route.ts`
- Test: `src/lib/__tests__/subscription-thumbnail-route.test.ts`

**Interfaces:**
- HTTP: `GET /api/subscription/thumbnail?id=<pageId>` → 302 リダイレクト（`Location` = カバー or 先頭imageブロックの新鮮な署名URL、`Cache-Control: private, max-age=600`）。会員でなければ 403。見つからなければ 404。
- Consumes: `resolveRequestPremium`, `Client`, `fetchPageBlocks`, `mapBlocksToReaderDoc`（cover/最初のimageを再利用）。

- [ ] **Step 1: 失敗するテスト**（Task 4 のモック手法を踏襲。premium false→403、cover あり→302 で Location にcover、cover無しで先頭image→そのurl、両方無し→404）。実装後 PASS を確認。（テスト本文は Task 4 の構造を複製して cover/image ケースを組む。）

- [ ] **Step 2: 実装**

```ts
import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { resolveRequestPremium } from '@/lib/premium-access'
import { fetchPageBlocks } from '@/lib/notion-page'
import { mapBlocksToReaderDoc } from '@/lib/reader-doc'

export async function GET(req: NextRequest) {
  const pageId = new URL(req.url).searchParams.get('id')?.replace(/^subscription_/, '').trim()
  if (!pageId) return NextResponse.json({ error: 'missing id' }, { status: 400 })
  const { premium } = await resolveRequestPremium()
  if (!premium) return NextResponse.json({ error: 'premium required' }, { status: 403 })
  const token = process.env.SUBSCRIPTION_NOTION_TOKEN
  if (!token) return NextResponse.json({ error: 'not configured' }, { status: 500 })
  const notion = new Client({ auth: token })
  try {
    const page = await notion.pages.retrieve({ page_id: pageId })
    const blocks = await fetchPageBlocks(notion as any, pageId)
    const doc = mapBlocksToReaderDoc(page as any, blocks)
    const firstImage = doc.blocks.find((b) => b.kind === 'image') as { url: string } | undefined
    const url = doc.cover || firstImage?.url
    if (!url) return NextResponse.json({ error: 'no image' }, { status: 404 })
    return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'private, max-age=600' } })
  } catch {
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 })
  }
}
```

- [ ] **Step 3: 型チェック＋テスト＋コミット**

```bash
cd ~/medical-search-public
git add src/app/api/subscription/thumbnail/route.ts src/lib/__tests__/subscription-thumbnail-route.test.ts
git commit -m "feat(reader): add on-demand subscription thumbnail resolver route"
```

### Task 9: カードにサムネ表示

**Files:**
- Modify: `src/components/ResultCard.tsx`

- [ ] **Step 1:** サブスクカード（`hit.owner === 'subscription' && hasSubscriptionConfig()`）の先頭に、`<img src={\`/api/subscription/thumbnail?id=${hit.objectID}\`} loading="lazy" onError=hide className="w-full h-24 object-cover rounded-t-lg" />` を追加（読み込み失敗時は非表示にして従来レイアウトに影響しない）。個人/部署カードには出さない。
- [ ] **Step 2:** 型チェック＋preview手動確認（グリッドにサムネが出る・失効/失敗でも崩れない）。
- [ ] **Step 3:** コミット `feat(reader): show infographic thumbnail on subscription cards`

---

## Phase 3 — 無傷移行（運用・コードなし）

### Task 10: パリティ確認とWeb公開OFFのランブック

- [ ] **Step 1:** 本番（またはstaging）で、代表10件のサブスクナレッジをアプリ内リーダーで開き、Notion原本と**逐語一致**（全セクション・数値・callout・確信度マーク・リンク・画像）を目視確認。差分があれば Phase 1 に戻る。
- [ ] **Step 2:** Vercel に `SUBSCRIPTION_NOTION_TOKEN` が設定済みであることを確認（既存 subscription-sync が使用しているので通常設定済み。無ければ設定）。ダッシュボード: https://vercel.com/dashboard → 該当プロジェクト → Settings → Environment Variables。
- [ ] **Step 3:** feature ブランチを main にマージ・本番デプロイ。プレミアム/非プレミアム両方で本番動作を確認（403ゲート含む）。
- [ ] **Step 4:** アプリがNotion閲覧を完全代替できたことを確認後、**Notion「🩺 Medical Knowledge_DB（サブスク用）」および親「MediNode サブスク用」ページのWeb公開をOFF**にする（Notion UI: 各ページ右上「共有」→「Web公開」トグルOFF）。対象ページ: https://app.notion.com/p/37afd756737080d59779ddde2cebb1b6 （サブスク用ルート）配下。
- [ ] **Step 5:** 公開OFF後、ログアウト状態で旧DB URL / 旧ページURLが**閲覧不可（ログイン壁）**になることを確認＝抜け道封鎖の実証。プレミアム会員はアプリ内で従来どおり読めることを確認。
- [ ] **Step 6:** 問題があれば即ロールバック（Notionで再度Web公開ONに戻すだけ・データ移行なし）。
- [ ] **Step 7:** 実装ロードマップDBエントリ（https://app.notion.com/p/3a5fd7567370810998a6f0ec5a7ec247 ）の「状態」チェックを更新し、ステータスを「完了」に。

---

## Self-Review 結果

- **Spec coverage:** 非公開裏DB化=Task10 / pageID取得+会員ゲート=Task2,3,4 / 逐語レンダ=Task1,5 / ギャラリー+サムネ=Task8,9（署名URL失効に対処） / 画像ズーム=Task6,ReaderBody / 個人・部署現状維持=Task7で `owner==='subscription'` 限定 / 無傷移行=Task10 / v1はv2作り込みを含めない=Phase分離。すべてタスクに対応。
- **Placeholder scan:** TBD/TODO 無し。テスト/実装コードは実体を記載。Task8のテスト本文のみ「Task4構造を複製」と指示（同一パターンの反復回避、コードは Task4 に完全掲載済み）。
- **Type consistency:** `mapBlocksToReaderDoc`/`mapBlocks`/`fetchPageBlocks`/`resolveRequestPremium`/`decidePremium`/`ReaderDoc`/`ReaderBlock`/`useReader`/`ReaderProvider` の名称・シグネチャはタスク間で一致。ルートは3ライブラリの公開シグネチャのみ使用。
