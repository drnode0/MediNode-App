# モニターフィードバック改善 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** モニターフィードバック4項目（3択順序＋文言／PWA案内バナー／一覧の充実度表示／登録時自動3日トライアル）をMediNode（medical-search-public）に実装する。

**Architecture:** Next.js App Router（`src/app`）＋クライアントコンポーネント（`src/components`）。プレミアム契約はSupabase `subscriptions` テーブルでサーバー管理。検索はAlgolia、サブスク用インデックスは `/api/subscription/sync/_core.ts` がNotionから同期。純ロジックは `src/lib` に切り出してvitestでテストする（コンポーネントのテスト基盤は無いのでUIは型チェック＋ブラウザ確認）。

**Tech Stack:** Next.js / React / TypeScript / Tailwind / Supabase / Algolia / @notionhq/client / vitest

## Global Constraints

- リポジトリ: `/Users/tatsukinonaka/medical-search-public`（作業ディレクトリはここ）
- **`public/sw.js` と `src/components/PwaRuntime.tsx` は別セッションのWIP差分があるため、絶対に編集・ステージしない。** コミットは必ず `git add <個別パス>` で行う（`git add -A` 禁止）
- `SetupWizard.tsx` の `targets` 初期値 `{ personal: true, team: false, premium: false }` は変更しない（handleRedoが依存）
- 自動トライアルは固定3日。note特典コード式（14日・`/api/premium/trial`）は変更しない
- 各タスク完了時: `npx tsc --noEmit` と `npx vitest run` が通ること（既存45テストを壊さない）
- コミットメッセージ末尾: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`

---

### Task 1: セットアップ3択をプレミアム先頭に＋おすすめバッジ＋文言の噛み砕き

**Files:**
- Modify: `src/components/SetupWizard.tsx:1249-1274`（startステップの選択カード配列）
- Modify: `src/components/OnboardingScreen.tsx:74-76`（「3つの知識源」）、`:109`（設定説明）

**Interfaces:**
- Consumes: なし
- Produces: なし（表示のみ。`targets` のキー・初期値は不変）

- [ ] **Step 1: SetupWizard の選択カード配列を並べ替え＋バッジ追加**

`src/components/SetupWizard.tsx` の1249行付近、配列リテラルを次に置き換える（premiumを先頭へ、`badge` フィールド追加、personal descの用語補足）:

```tsx
              {([
                // tone はオンボーディング「3つの知識源」と同じ配色（個人=常盤・部署=空・プレミアム=琥珀）。
                // プレミアムを先頭に置く（モニターFB: 設定不要で始められる選択肢が一番下だと戸惑う）。
                { key: 'premium' as const, Icon: Star, tone: 'bg-amber-50 text-amber-600 dark:bg-amber-900/40 dark:text-amber-300', title: '専門医の知識を使う', sub: 'プレミアム', badge: 'おすすめ・設定不要', desc: '作者（専門医）が配信する医療ナレッジを検索します。難しい設定はなく、すぐ使えます。' },
                { key: 'personal' as const, Icon: User, tone: 'bg-brand-50 text-brand-600 dark:bg-brand-900/40 dark:text-brand-300', title: '自分の知識を使う', sub: '個人のNotion', badge: '', desc: '自分のNotionに作った医療メモを検索します。Notionとつなぐ合鍵（コネクトToken）と、DBのリンクを使います。' },
                { key: 'team' as const, Icon: Users, tone: 'bg-sky-50 text-sky-600 dark:bg-sky-900/40 dark:text-sky-300', title: 'みんなの知識を使う', sub: '部署の共有DB', badge: '', desc: '職場で共有しているDBを検索します。代表者からもらったTokenとURLを貼るだけでOK（自分のNotionは不要）。' },
              ]).map((opt) => {
```

- [ ] **Step 2: バッジの描画を追加**

同ファイル1269行付近（`{opt.sub}` のspanの直後）に追加:

```tsx
                      {opt.badge && (
                        <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/50 px-1.5 py-0.5 rounded-full">{opt.badge}</span>
                      )}
```

- [ ] **Step 3: OnboardingScreen「3つの知識源」を同じ順（プレミアム→個人→部署）に並べ替え**

`src/components/OnboardingScreen.tsx` 74-76行を次に置き換える:

```tsx
      { Icon: Star, title: '専門医の知識（プレミアム）', desc: '作者（専門医）が配信するナレッジを検索。設定なしですぐ使えます', tone: 'amber' },
      { Icon: UserRound, title: '自分の知識（個人のNotion）', desc: '自分で書きためた医療メモを検索。自分のNotionをつなぎます', tone: 'brand' },
      { Icon: Building2, title: 'みんなの知識（部署の共有DB）', desc: '職場で共有しているDBを検索。代表者からもらった情報を入れるだけ', tone: 'sky' },
```

109行の設定説明の用語も補足:

```tsx
      { Icon: KeyRound, title: '選んだものを設定', desc: 'Notionを使うなら合鍵（コネクトToken）を入力。プレミアムだけなら設定はほぼ不要', tone: 'violet' },
```

- [ ] **Step 4: 型チェックとテスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: エラーなし・45 passed

- [ ] **Step 5: Commit**

```bash
git add src/components/SetupWizard.tsx src/components/OnboardingScreen.tsx
git commit -m "feat(setup): 3択の先頭をプレミアムに変更＋おすすめバッジ＋用語の噛み砕き（モニターFB）"
```

---

### Task 2: PWA「ホーム画面に追加」案内バナー＋FAQ

**Files:**
- Modify: `src/components/AppBanners.tsx`（新バナー `PwaInstallBanner` を追加）
- Modify: `src/app/page.tsx:2691-2692, 2777-2778`（マウント。`<UpdateBanner />` の直前に置く）
- Modify: `src/lib/help-faq.ts`（FAQ項目 `pwa-install` を追加）

**Interfaces:**
- Consumes: なし
- Produces: `export function PwaInstallBanner(): JSX.Element | null`（AppBanners.tsxから）

- [ ] **Step 1: PwaInstallBanner を AppBanners.tsx 末尾に追加**

lucideのimport行に `Smartphone, Share, ChevronDown, ChevronUp` を追加した上で、ファイル末尾に:

```tsx
// ── PWAインストール案内バナー ──
// ブラウザ（未インストール）で開いている人にだけ「ホーム画面に追加」を案内する。
// スタンドアロン起動（=already installed）では出さない。×で永続的に消せる。
const PWA_BANNER_DISMISS_KEY = 'medinode_pwa_banner_dismissed_v1'

export function PwaInstallBanner() {
  const [show, setShow] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    try {
      if (localStorage.getItem(PWA_BANNER_DISMISS_KEY)) return
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true
      if (!standalone) setShow(true)
    } catch {}
  }, [])
  if (!show) return null
  const dismiss = () => {
    try { localStorage.setItem(PWA_BANNER_DISMISS_KEY, '1') } catch {}
    setShow(false)
  }
  return (
    <div className="max-w-2xl mx-auto px-4 pt-3 animate-fade-in-up">
      <div className="bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 rounded-xl px-4 py-3">
        <div className="flex items-center gap-3">
          <Smartphone className="w-5 h-5 text-brand-500 shrink-0" />
          <button onClick={() => setOpen((v) => !v)} className="flex-1 min-w-0 text-left">
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">ホーム画面に追加すると、アプリのように使えます</p>
            <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
              アイコンを1タップで起動。手順を見る
              {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </p>
          </button>
          <button onClick={dismiss} className="text-gray-300 hover:text-gray-500 dark:hover:text-gray-300 shrink-0 p-1 -m-1" title="閉じる" aria-label="閉じる"><X className="w-4 h-4" /></button>
        </div>
        {open && (
          <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 space-y-2 text-xs text-gray-600 dark:text-gray-300 leading-relaxed">
            <p><strong>iPhone（Safari）:</strong> 画面下の共有ボタン<Share className="inline w-3.5 h-3.5 mx-0.5 -mt-0.5" />→「ホーム画面に追加」→「追加」</p>
            <p><strong>Android（Chrome）:</strong> 右上の「⋮」メニュー →「ホーム画面に追加」（または「アプリをインストール」）</p>
            <p><strong>パソコン（Chrome/Edge）:</strong> アドレスバー右端のインストールアイコンをクリック</p>
            <p className="text-gray-400 dark:text-gray-500">追加後はホーム画面のMediNodeアイコンから、アプリと同じようにワンタップで開けます。</p>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: page.tsx の2箇所にマウント**

`src/app/page.tsx` のimport行（71行）の `UpdateBanner,` の並びに `PwaInstallBanner,` を追加し、`<UpdateBanner />` が出てくる2箇所（2691行付近・2777行付近）それぞれの直前の行に `<PwaInstallBanner />` を追加する。

- [ ] **Step 3: FAQ項目を追加**

`src/lib/help-faq.ts` の `FAQ_ENTRIES` の「セットアップ」グループ末尾（`id: 'setup-case-db-relation'` のエントリの後）に追加:

```ts
  {
    id: 'pwa-install',
    category: 'セットアップ',
    q: 'アプリとしてホーム画面から使うには？（ホーム画面に追加）',
    a: 'MediNodeはWebアプリなので、App Storeからのインストールは不要です。ブラウザの「ホーム画面に追加」を使うと、ホーム画面のアイコンからアプリと同じように1タップで起動できます。iPhoneはSafariで開いて共有ボタン→「ホーム画面に追加」、AndroidはChromeの「⋮」メニュー→「ホーム画面に追加」（または「アプリをインストール」）、パソコンはChrome/Edgeのアドレスバー右端のインストールアイコンです。',
    keywords: 'PWA アプリ化 インストール ホーム画面 アイコン ショートカット iphone android safari chrome app store',
  },
```

- [ ] **Step 4: 型チェックとテスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: エラーなし・45 passed（help-faq.test.ts はID重複チェック等があるため新IDでも通ること）

- [ ] **Step 5: Commit**

```bash
git add src/components/AppBanners.tsx src/app/page.tsx src/lib/help-faq.ts
git commit -m "feat(pwa): ホーム画面追加の案内バナーとFAQを追加（モニターFB）"
```

---

### Task 3: 本文充実度の純関数 content-stats（TDD）

**Files:**
- Create: `src/lib/content-stats.ts`
- Test: `src/lib/__tests__/content-stats.test.ts`

**Interfaces:**
- Produces:
  - `type NotionBlockLite = { type: string } & Record<string, unknown>`
  - `computeContentStats(blocks: NotionBlockLite[]): { contentChars: number; sectionCount: number; headings: string[] }`
  - `readingMinutes(contentChars: number): number`（600字/分・切り上げでなく四捨五入・最低1分、0以下は0）

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/content-stats.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeContentStats, readingMinutes } from '@/lib/content-stats'

const rt = (text: string) => [{ plain_text: text }]

describe('computeContentStats', () => {
  it('段落・見出しの文字数を合算し、H2をセクションとして数える', () => {
    const blocks = [
      { type: 'heading_2', heading_2: { rich_text: rt('結論') } },
      { type: 'paragraph', paragraph: { rich_text: rt('あいうえお') } },
      { type: 'heading_2', heading_2: { rich_text: rt('背景') } },
      { type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt('かきくけこ') } },
    ]
    const s = computeContentStats(blocks)
    expect(s.contentChars).toBe(14) // 結論(2)+あいうえお(5)+背景(2)+かきくけこ(5)
    expect(s.sectionCount).toBe(2)
    expect(s.headings).toEqual(['結論', '背景'])
  })

  it('headingsは先頭5件まで', () => {
    const blocks = Array.from({ length: 7 }, (_, i) => ({
      type: 'heading_2',
      heading_2: { rich_text: rt(`H${i + 1}`) },
    }))
    const s = computeContentStats(blocks)
    expect(s.sectionCount).toBe(7)
    expect(s.headings).toEqual(['H1', 'H2', 'H3', 'H4', 'H5'])
  })

  it('rich_textを持たないブロック（divider等）は無視する', () => {
    const blocks = [
      { type: 'divider', divider: {} },
      { type: 'image', image: { file: { url: 'x' } } },
      { type: 'paragraph', paragraph: { rich_text: rt('abc') } },
    ]
    const s = computeContentStats(blocks)
    expect(s.contentChars).toBe(3)
    expect(s.sectionCount).toBe(0)
    expect(s.headings).toEqual([])
  })
})

describe('readingMinutes', () => {
  it('600字/分・最低1分', () => {
    expect(readingMinutes(0)).toBe(0)
    expect(readingMinutes(100)).toBe(1)
    expect(readingMinutes(600)).toBe(1)
    expect(readingMinutes(4200)).toBe(7)
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/lib/__tests__/content-stats.test.ts`
Expected: FAIL（`Cannot find module '@/lib/content-stats'` 等）

- [ ] **Step 3: 実装**

`src/lib/content-stats.ts`:

```ts
// Notionページ本文の「充実度」統計（文字数・H2セクション数・見出しリスト）。
// サブスク同期（/api/subscription/sync/_core.ts）がAlgoliaレコードに載せ、
// 一覧カード（ResultCard）が「約N分・Mセクション」を表示するために使う。
// モニターFB「中にどれだけ入っているかが一覧から分からない」への対応。

export type NotionBlockLite = { type: string } & Record<string, unknown>

const MAX_HEADINGS = 5
// 日本語の平均読速の目安（600字/分）。医療文書はやや遅めに読む前提で控えめな値。
const CHARS_PER_MINUTE = 600

function blockText(block: NotionBlockLite): string {
  const payload = block[block.type] as { rich_text?: Array<{ plain_text?: string }> } | undefined
  if (!payload || !Array.isArray(payload.rich_text)) return ''
  return payload.rich_text.map((t) => t.plain_text || '').join('')
}

export function computeContentStats(blocks: NotionBlockLite[]): {
  contentChars: number
  sectionCount: number
  headings: string[]
} {
  let contentChars = 0
  let sectionCount = 0
  const headings: string[] = []
  for (const block of blocks) {
    const text = blockText(block)
    contentChars += text.length
    if (block.type === 'heading_2') {
      sectionCount++
      if (headings.length < MAX_HEADINGS && text) headings.push(text)
    }
  }
  return { contentChars, sectionCount, headings }
}

export function readingMinutes(contentChars: number): number {
  if (contentChars <= 0) return 0
  return Math.max(1, Math.round(contentChars / CHARS_PER_MINUTE))
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run`
Expected: 全テストPASS（45＋新規）

- [ ] **Step 5: Commit**

```bash
git add src/lib/content-stats.ts src/lib/__tests__/content-stats.test.ts
git commit -m "feat(density): 本文充実度の計算関数 content-stats を追加（TDD）"
```

---

### Task 4: サブスク同期で充実度フィールドをインデックスする

**Files:**
- Modify: `src/app/api/subscription/sync/_core.ts`

**Interfaces:**
- Consumes: `computeContentStats`, `NotionBlockLite`（Task 3）
- Produces: Algoliaレコードの新フィールド `contentChars: number` / `sectionCount: number` / `headings: string[]`（Task 5のHit型が読む）

- [ ] **Step 1: 本文取得ヘルパーを追加**

`src/app/api/subscription/sync/_core.ts` の import に追加:

```ts
import { computeContentStats, type NotionBlockLite } from '@/lib/content-stats'
```

`extractHasFiles` の後に追加:

```ts
// ページ本文（トップレベルブロック）を全ページネーションで取得し、充実度統計を返す。
// 失敗してもページ全体の同期は止めない（統計なしで続行）。対象は現状40ページ弱なので
// ページごとの逐次取得でもcron実行時間・レート制限とも問題にならない。
async function fetchContentStats(
  notion: Client,
  pageId: string,
): Promise<{ contentChars: number; sectionCount: number; headings: string[] } | null> {
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
    return computeContentStats(blocks)
  } catch {
    return null
  }
}
```

- [ ] **Step 2: medical/reference 両方のレコードに統計を追加**

`syncMedicalDb` 内、`records.push({...})` の直前に:

```ts
      const stats = await fetchContentStats(notion, page.id)
```

`records.push` のオブジェクトに追加（`notionUrl` の後）:

```ts
        contentChars: stats?.contentChars ?? 0,
        sectionCount: stats?.sectionCount ?? 0,
        headings: stats?.headings ?? [],
```

`syncReferenceDb` にも同じ2箇所の変更を入れる。

- [ ] **Step 3: 型チェックとテスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: エラーなし・全PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/api/subscription/sync/_core.ts
git commit -m "feat(density): サブスク同期で本文文字数・セクション数・見出しをインデックス"
```

---

### Task 5: ResultCard に充実度バッジ＋収録内容（目次）を表示

**Files:**
- Modify: `src/components/ResultCard.tsx`

**Interfaces:**
- Consumes: `readingMinutes`（Task 3）、Hitの `contentChars` / `sectionCount` / `headings`（Task 4）
- Produces: Hit型の新フィールド（GenreBrowse等は既存の `type Hit` importで自動追随）

- [ ] **Step 1: Hit型にフィールド追加**

`src/components/ResultCard.tsx` の `export type Hit` に追加（`hasAttachment?: boolean` の後）:

```ts
  // サブスク同期が計算する本文充実度（プレミアムのみ）。一覧から「中身の濃さ」を伝える。
  contentChars?: number
  sectionCount?: number
  headings?: string[]
```

import行に `BookOpen` を追加し、`readingMinutes` をimport:

```ts
import { readingMinutes } from '@/lib/content-stats'
```

- [ ] **Step 2: バッジを追加**

`ResultCard` 本体の `const ownerLabel = ...` の後に:

```ts
  // 充実度（プレミアムのみ）。「タイトル＋要約だけで中身の量が伝わらない」FBへの対応。
  const minutes = hit.owner === 'subscription' ? readingMinutes(hit.contentChars ?? 0) : 0
  const densityLabel = minutes > 0
    ? `本文 約${minutes}分${hit.sectionCount ? `・${hit.sectionCount}セクション` : ''}`
    : null
```

バッジ行（`{recLevel && (...)}` の並び、genreバッジの手前）に追加:

```tsx
          {densityLabel && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
              <BookOpen className="h-3 w-3 shrink-0" strokeWidth={2.2} />
              {densityLabel}
            </span>
          )}
```

- [ ] **Step 3: 展開時に収録内容（目次）を表示**

展開ブロック（`{expanded && displaySummary && (...)}` 内、`{hit.aiKeywords && ...}` の直前）に追加:

```tsx
          {hit.owner === 'subscription' && hit.headings && hit.headings.length > 0 && (
            <div className="mt-3 rounded-lg bg-gray-50 dark:bg-gray-700/40 px-3 py-2">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1">Notionページの収録内容</p>
              <ul className="space-y-0.5">
                {hit.headings.map((h, i) => (
                  <li key={i} className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">・{h}</li>
                ))}
                {(hit.sectionCount ?? 0) > hit.headings.length && (
                  <li className="text-xs text-gray-400 dark:text-gray-500">…ほか{(hit.sectionCount ?? 0) - hit.headings.length}セクション</li>
                )}
              </ul>
            </div>
          )}
```

- [ ] **Step 4: 型チェックとテスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: エラーなし・全PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ResultCard.tsx
git commit -m "feat(density): プレミアムカードに読了目安・セクション数・収録内容を表示（モニターFB）"
```

---

### Task 6: 登録時自動トライアル（3日）のAPIとロジック（TDD）

**Files:**
- Create: `src/lib/auto-trial.ts`
- Test: `src/lib/__tests__/auto-trial.test.ts`
- Create: `src/app/api/premium/auto-trial/route.ts`
- Modify: `src/lib/supabase/subscriptions.ts`（`hasSubscriptionRecord` を追加）
- Modify: `src/app/api/premium/status/route.ts`（レスポンスに `trialEndsAt` を追加）

**Interfaces:**
- Consumes: `grantTrialByUserId(userId, days)`（既存）、`rateLimit`（`@/lib/rate-limit`、`/api/premium/trial` と同じ使い方）、`createClient`/`createAdminClient`（`@/lib/supabase/server`）
- Produces:
  - `AUTO_TRIAL_DAYS = 3`、`isAutoTrialEligible(opts: { grantedAt: string | null | undefined; hasSubscriptionRow: boolean }): boolean`
  - `hasSubscriptionRecord(userId: string): Promise<boolean>`
  - `POST /api/premium/auto-trial` → `{ ok: true, granted: true, trialDays, trialEndsAt }` | `{ ok: true, already: true }` | `{ ok: false, reason: string }`
  - `GET /api/premium/status` のレスポンスに `trialEndsAt: string | null`（active時）

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/auto-trial.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { AUTO_TRIAL_DAYS, isAutoTrialEligible } from '@/lib/auto-trial'

describe('auto-trial', () => {
  it('日数は3日固定', () => {
    expect(AUTO_TRIAL_DAYS).toBe(3)
  })

  it('付与済みフラグがあれば対象外', () => {
    expect(isAutoTrialEligible({ grantedAt: '2026-07-18T00:00:00Z', hasSubscriptionRow: false })).toBe(false)
  })

  it('サブスク記録（コード式トライアル/契約/comp）があれば対象外', () => {
    expect(isAutoTrialEligible({ grantedAt: null, hasSubscriptionRow: true })).toBe(false)
  })

  it('どちらもなければ対象', () => {
    expect(isAutoTrialEligible({ grantedAt: null, hasSubscriptionRow: false })).toBe(true)
    expect(isAutoTrialEligible({ grantedAt: undefined, hasSubscriptionRow: false })).toBe(true)
  })
})
```

- [ ] **Step 2: 失敗を確認**

Run: `npx vitest run src/lib/__tests__/auto-trial.test.ts`
Expected: FAIL（module not found）

- [ ] **Step 3: 純ロジックを実装**

`src/lib/auto-trial.ts`:

```ts
// 登録時自動トライアル（モニターFB「コードなしでも最初の数日は見れる方がいい」対応）。
// note特典のコード式トライアル（14日・/api/premium/trial）とは独立した固定3日。
// 判定はサーバー（/api/premium/auto-trial）が行い、ここは純ロジックのみ。

export const AUTO_TRIAL_DAYS = 3

// 付与条件: 過去に自動付与されておらず（user_metadata.auto_trial_granted_at なし）、
// かつ subscriptions に記録が一切ない（コード式トライアル・契約・comp のどれでもない）。
// 記録がある人に付与すると、note特典14日→3日への降格が起きるため必ず除外する。
export function isAutoTrialEligible(opts: {
  grantedAt: string | null | undefined
  hasSubscriptionRow: boolean
}): boolean {
  if (opts.grantedAt) return false
  if (opts.hasSubscriptionRow) return false
  return true
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `npx vitest run`
Expected: 全PASS

- [ ] **Step 5: hasSubscriptionRecord を subscriptions.ts に追加**

`src/lib/supabase/subscriptions.ts` の `getActiveStatusByUserId` の後に:

```ts
// subscriptions に行があるか（状態・期限は問わない）。自動トライアルの対象判定に使う。
// 行がある＝過去に何らかの契約・トライアル・compがあった人。
export async function hasSubscriptionRecord(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('subscriptions')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  return !!data
}
```

- [ ] **Step 6: APIルートを実装**

`src/app/api/premium/auto-trial/route.ts`:

```ts
// 登録時自動トライアル（3日・コード不要）。
//
// POST /api/premium/auto-trial
//   - 認証: Supabaseセッション（Cookie）。未ログインは 401。
//   - 条件: user_metadata.auto_trial_granted_at が無い かつ subscriptions に記録が無い。
//   - 処理: 先にフラグを立ててから grantTrialByUserId（/api/welcome と同じ二重実行対策）。
//   - 呼び出し: PremiumSync がログイン確認後に叩く（何度呼んでもフラグでno-op）。
//   - note特典コード（14日・/api/premium/trial）とは独立。記録がある人には触れない。

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { grantTrialByUserId, hasSubscriptionRecord } from '@/lib/supabase/subscriptions'
import { AUTO_TRIAL_DAYS, isAutoTrialEligible } from '@/lib/auto-trial'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  if (!rateLimit(`auto-trial:${clientIp(req)}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ ok: false, reason: 'rate_limited' }, { status: 429 })
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, reason: 'supabase_not_configured' })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, reason: 'login_required' }, { status: 401 })
  }

  const grantedAt = (user.user_metadata?.auto_trial_granted_at as string | undefined) ?? null
  if (grantedAt) {
    return NextResponse.json({ ok: true, already: true })
  }

  const hasRow = await hasSubscriptionRecord(user.id)
  if (!isAutoTrialEligible({ grantedAt, hasSubscriptionRow: hasRow })) {
    // 記録がある人（コード式/契約/comp）には二度と自動付与しないようフラグだけ立てる。
    const admin = createAdminClient()
    await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...user.user_metadata, auto_trial_granted_at: new Date().toISOString() },
    })
    return NextResponse.json({ ok: true, already: true })
  }

  // 先にフラグ（多タブ同時アクセスでの二重付与をほぼ防ぐ。upsertなので実害も出ない）。
  const admin = createAdminClient()
  const { error: flagErr } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { ...user.user_metadata, auto_trial_granted_at: new Date().toISOString() },
  })
  if (flagErr) {
    return NextResponse.json({ ok: false, reason: 'flag_update_failed' }, { status: 500 })
  }

  try {
    const trialEndsAt = await grantTrialByUserId(user.id, AUTO_TRIAL_DAYS)
    return NextResponse.json({ ok: true, granted: true, trialDays: AUTO_TRIAL_DAYS, trialEndsAt })
  } catch (err) {
    console.error('auto-trial: 付与失敗:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, reason: 'grant_failed' }, { status: 500 })
  }
}
```

※ `rateLimit` / `clientIp` のimportパス・シグネチャは `/api/premium/trial/route.ts` の先頭を見て完全に同じ形にすること。

- [ ] **Step 7: status レスポンスに trialEndsAt を追加**

`src/app/api/premium/status/route.ts` の最後の `NextResponse.json({...})`（active時）に1行追加:

```ts
    trialEndsAt: sub.trialEndsAt ?? null,
```

※ `isAdmin` 分岐で作るオブジェクトには `trialEndsAt` が無いため、`{ active: true, status: 'comp_admin', currentPeriodEnd: null }` を `{ active: true, status: 'comp_admin', currentPeriodEnd: null, trialEndsAt: null }` に変更する（型エラー防止）。

- [ ] **Step 8: 型チェックとテスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: エラーなし・全PASS

- [ ] **Step 9: Commit**

```bash
git add src/lib/auto-trial.ts src/lib/__tests__/auto-trial.test.ts src/app/api/premium/auto-trial/route.ts src/lib/supabase/subscriptions.ts src/app/api/premium/status/route.ts
git commit -m "feat(trial): 登録時自動トライアル（3日・コード不要）のAPIを追加"
```

---

### Task 7: クライアント連携（PremiumSync・文言・お知らせ）

**Files:**
- Modify: `src/components/auth/PremiumSync.tsx:56-83`
- Modify: `src/components/SetupWizard.tsx`（プレミアム説明・トライアル説明の文言）
- Modify: `src/components/AppBanners.tsx`（ANNOUNCEMENTS 先頭に1件）
- Modify: `src/lib/help-faq.ts`（`premium-trial` の回答を更新）

**Interfaces:**
- Consumes: `POST /api/premium/auto-trial`、`GET /api/premium/status` の `trialEndsAt`（Task 6）
- Produces: なし

- [ ] **Step 1: PremiumSync で自動トライアルを試行し、trialEndsAt を保存**

`src/components/auth/PremiumSync.tsx` の async IIFE 冒頭（`const res = await fetch('/api/premium/status', ...)` の前）に追加:

```ts
        // 登録時自動トライアル（3日・コード不要）。対象外・付与済みはサーバーがno-op。
        // statusより先に呼ぶことで、付与直後の初回ログインでもこの後のstatusがactiveになる。
        try { await fetch('/api/premium/auto-trial', { method: 'POST' }) } catch {}
```

active時の保存条件と保存内容を変更（`subscriptionTrialEndsAt: ''` を実値に）:

```ts
        if (data.active && data.algolia) {
          const trialEndsAt: string = data.trialEndsAt || ''
          if (
            current.subscriptionSearchKey !== data.algolia.searchKey ||
            current.subscriptionAppId !== data.algolia.appId ||
            (current.subscriptionTrialEndsAt || '') !== trialEndsAt
          ) {
            saveSettings({
              ...current,
              subscriptionAppId: data.algolia.appId,
              subscriptionSearchKey: data.algolia.searchKey,
              subscriptionIndex: data.algolia.index,
              // トライアル（自動/コード式）はサーバーの期限を保存 → 設定画面の
              // 「無料トライアル中（残りN日）」表示が別端末でも正しく出る。
              // Stripe正式契約は null → '' となり従来どおり無期限扱い。
              subscriptionTrialEndsAt: trialEndsAt,
            })
            window.location.reload()
          }
        }
```

- [ ] **Step 2: SetupWizard の文言を更新**

`src/components/SetupWizard.tsx`:

1. Task 1で並べ替えたstartステップのプレミアムカードのdescを更新:
   `'作者（専門医）が配信する医療ナレッジを検索します。難しい設定はなく、アカウント登録だけで3日間無料でお試しできます。'`
2. 186行付近のトライアルコード説明（`note記事…14日間`）の段落の直前に説明が続く形なら、その段落の文頭に次の一文を追加:
   `アカウント登録だけで3日間の無料お試しが自動で始まります。さらに、`
   （結果: 「アカウント登録だけで3日間の無料お試しが自動で始まります。さらに、note記事などに記載のコードを入力すると、カード登録なし・14日間プレミアムをお試しいただけます。」）

- [ ] **Step 3: お知らせ（ANNOUNCEMENTS）先頭に追加**

`src/components/AppBanners.tsx` のimportに `Gift` を追加し、`ANNOUNCEMENTS` 配列の先頭に:

```ts
  {
    id: '2026-07-18-auto-trial',
    date: '2026-07-18',
    Icon: Gift,
    title: '登録するだけで、プレミアムを3日間お試しできるようになりました',
    body: 'アカウント登録（無料）するだけで、専門医が配信するプレミアムナレッジを3日間そのまま閲覧できます。コード入力は不要です。noteの特典コードをお持ちの方は、設定 → プレミアムで入力すると14日間のお試しになります。',
  },
```

- [ ] **Step 4: FAQ premium-trial の回答を更新**

`src/lib/help-faq.ts` の `id: 'premium-trial'` エントリを開き、回答（a）の先頭に次の一文を追加する（既存の説明は残す）:

`アカウント登録（無料）をすると、コード入力なしで3日間の無料お試しが自動で始まります。`

keywordsに `自動 3日 登録だけ` を追記する。

- [ ] **Step 5: 型チェックとテスト**

Run: `npx tsc --noEmit && npx vitest run`
Expected: エラーなし・全PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/auth/PremiumSync.tsx src/components/SetupWizard.tsx src/components/AppBanners.tsx src/lib/help-faq.ts
git commit -m "feat(trial): 自動トライアルのクライアント連携と告知文言（モニターFB）"
```

---

### Task 8: ビルド＋ブラウザ動作確認

**Files:** なし（検証のみ）

- [ ] **Step 1: 本番ビルド**

Run: `npm run build`
Expected: ビルド成功（`public/sw.js`・`PwaRuntime.tsx` のWIP差分が原因のエラーが出た場合はその旨を報告し、勝手に直さない）

- [ ] **Step 2: devサーバーで確認（Browser paneを使用）**

.claude/launch.json のdevサーバー（無ければ `npm run dev`・port 3000 で作成）を preview_start で起動し、以下を確認:

1. セットアップ（新規扱い: シークレット相当のlocalStorageクリア or ウィザード再実行導線）で3択がプレミアム先頭＋「おすすめ・設定不要」バッジ表示
2. ブラウザ表示でPWAバナーが出る・展開で手順表示・×で消えて再読込後も出ない
3. お知らせバナーに自動トライアル告知が出る
4. `npx vitest run` 全PASSの最終確認

- [ ] **Step 3: 検証結果を報告**

スクリーンショットを添えて、変更点と確認結果をユーザーに報告する。充実度表示（Task 4-5）は本番Algoliaへの再同期後に反映される点（`POST /api/subscription/sync` の手動実行 or cron待ち）も明記する。
