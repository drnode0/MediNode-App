# reader内CQ捕捉 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** プレミアムナレッジのreader（ボトムシート）を読んでいる最中に、その場でCQ捕捉モーダルを開けるようにする。

**Architecture:** 既存の `CqCaptureProvider`（`useCqCapture()` で開く関数を配る）と、readerの `ReaderOverlay`（`data-reader-portal` 付き要素以外を `inert` 化するボトムシート）を繋ぐ。readerヘッダーにCQボタンを足し、`useCqCapture()` で捕捉モーダルを開く。捕捉モーダルには `data-reader-portal` を付けてreaderの `inert` を確実に逃がし、readerを背面に残したまま重ねて開く。captureは会員個人のNotion Medical DBへ既存 `/api/notion/create-cq` で保存（変更なし）。

**Tech Stack:** Next.js 16 / React 18 / TypeScript / Tailwind / lucide-react / vitest（pure-libのみ・node環境）。

## Global Constraints

- 既存 `/api/notion/create-cq` は**変更しない**（由来＝記事のCQ保存はSpec 2でAPIを触る時に行う）。
- アイコンは lucide を使う（装飾絵文字を足さない ― emoji/icon方針）。データ由来の❓等の絵文字は触らない。
- readerが `inert` 化から除外する目印は属性 `data-reader-portal`（値は空文字 `""`）。body直下ポータルのモーダル根 `div` に付ける。
- reader内CQボタンは `useCqCapture()` が **null のとき描画しない**（未接続・非表示・`CqCaptureProvider` 非包含ブランチをすべて安全に処理。既存 `CqCaptureSuggestion` と同じgateパターン）。
- 既存の captureモーダルのz: `z-[9999]`。readerシートも `z-[9999]`、reader zoom lightboxは `z-[10000]`。captureモーダルはreaderより後にmountされ同z上で上に描画される。zは変更しない。
- コンポーネント単体テストの基盤は無い（vitestはnode環境のpure-libのみ）。UI挙動はブラウザプレビューで検証し、型は `npx tsc --noEmit`、回帰は `npm test` で担保する。新たなテスト基盤（jsdom等）は導入しない。
- テキスト欄は reader起点では**空**で開く。記事は「ソースchip」として表示のみ。

---

### Task 1: CqCapture に「ソース文脈」を通し、モーダルを inert から逃がす

`useCqCapture()` の開く関数へ任意の記事文脈（`CqSource`）を渡せるようにし、捕捉モーダル上部に「「{記事タイトル}」を読んで」chipを表示（表示のみ）。あわせて捕捉モーダルと設定ガイドの根 `div` に `data-reader-portal=""` を付け、readerの `inert` から確実に除外する。既存呼び出し（ホームFAB／ゼロ件サジェスト）は第2引数省略で無変更。

**Files:**
- Modify: `src/components/CqCapture.tsx`

**Interfaces:**
- Produces:
  - `export type CqSource = { title?: string; url?: string }`
  - `useCqCapture(): ((prefill?: string, source?: CqSource) => void) | null`（第2引数を追加。省略時は従来どおり）
- Consumes: なし（Task 2 がこの `useCqCapture` の新シグネチャを使う）

- [ ] **Step 1: `CqSource` 型とコンテキスト型を拡張**

`src/components/CqCapture.tsx` 冒頭の import 群の直後、`CqCaptureContext` 定義を差し替える。

```tsx
// 開く関数の任意第2引数。reader等から「どの記事を読んでいたか」を文脈として渡す（表示のみ）。
export type CqSource = { title?: string; url?: string }

const CqCaptureContext = createContext<
  ((prefill?: string, source?: CqSource) => void) | null
>(null)

// 開く関数を返す。個人のNotionが未設定（部署のみ／プレミアムのみ等）なら null。
export function useCqCapture() {
  return useContext(CqCaptureContext)
}
```

- [ ] **Step 2: Provider に source 状態を持たせ、openCapture を拡張**

`CqCaptureProvider` 内の `prefill` state の隣に `source` state を足し、`openCapture` の引数を拡張する。既存の `const [prefill, setPrefill] = useState('')` の直後に追加し、`openCapture` を差し替える。

```tsx
  const [source, setSource] = useState<CqSource | undefined>(undefined)

  const openCapture = useCallback((p?: string, s?: CqSource) => {
    setPrefill(p || '')
    setSource(s)
    setOpen(true)
    track('cq_capture_open', { prefilled: p ? 'yes' : 'no', fromReader: s ? 'yes' : 'no' })
  }, [])
```

- [ ] **Step 3: モーダルへ source を渡す**

`CqCaptureProvider` の return 内、`<CqCaptureModal ... />` に `source={source}` を追加する。

```tsx
          <CqCaptureModal
            initialTitle={prefill}
            searchMode={settings?.searchMode || 'algolia'}
            source={source}
            onClose={() => setOpen(false)}
          />
```

- [ ] **Step 4: `CqCaptureModal` の props に source を足し、chipを描画、根に data-reader-portal**

`CqCaptureModal` の props 型に `source` を足す。`BookOpen` を lucide import に追加する（既存 import 行 `import { MessageCircleQuestion, X, ExternalLink, Settings, CheckCircle2, HelpCircle } from 'lucide-react'` に `BookOpen` を加える）。

props 型（`function CqCaptureModal({ ... }: { ... })`）を次に差し替える。

```tsx
function CqCaptureModal({
  initialTitle,
  searchMode,
  source,
  onClose,
}: {
  initialTitle: string
  searchMode: string
  source?: CqSource
  onClose: () => void
}) {
```

モーダル根の `div`（現状 `<div className="fixed inset-0 z-[9999] bg-black/40" onClick={onClose}>`）に `data-reader-portal=""` を付ける。

```tsx
    <div data-reader-portal="" className="fixed inset-0 z-[9999] bg-black/40" onClick={onClose}>
```

入力ビュー（`!done` の `<>` 直下）で、説明文 `<p>`（「あとで調べる疑問を…」）の**前**にソースchipを足す。

```tsx
              {source?.title && (
                <div className="mb-2 inline-flex max-w-full items-center gap-1.5 rounded-lg bg-purple-50 dark:bg-purple-900/20 px-2.5 py-1.5 text-xs text-purple-700 dark:text-purple-300">
                  <BookOpen className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">「{source.title}」を読んで</span>
                </div>
              )}
```

- [ ] **Step 5: 設定ガイドモーダルの根にも data-reader-portal（防御的）**

`CqSetupGuideModal` の根 `div`（`<div className="fixed inset-0 z-[9999] bg-black/40" onClick={onClose}>`）にも `data-reader-portal=""` を付ける。将来readerからガイドが開かれても inert に巻き込まれないようにする。値だけ足す。

```tsx
    <div data-reader-portal="" className="fixed inset-0 z-[9999] bg-black/40" onClick={onClose}>
```

- [ ] **Step 6: 型チェック**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし（終了コード0）。特に既存呼び出し `openCq(query.trim())`（page.tsx:1120）が第2引数省略で通ること。

- [ ] **Step 7: 既存テスト回帰**

Run: `cd ~/medical-search-public && npm test`
Expected: 全てPASS（このタスクはpure-lib非対象・回帰確認のみ）。

- [ ] **Step 8: ブラウザ検証（ホーム側の無変更確認）**

preview_start で dev サーバ（`.claude/launch.json` のdev。無ければ `npm run dev`）を起動し、ホームでCQ FABを押す。
Expected: 従来どおり捕捉モーダルが開く。**ソースchipは出ない**（source未指定のため）。保存導線に変化なし。

- [ ] **Step 9: コミット**

```bash
cd ~/medical-search-public && git add src/components/CqCapture.tsx && git commit -m "feat(cq): 開く関数にソース文脈を追加しモーダルをinert除外対象に

useCqCapture の開く関数に任意の記事文脈(CqSource)を追加し、捕捉モーダルに
「〜を読んで」chipを表示(表示のみ)。捕捉モーダル/設定ガイドの根に
data-reader-portal を付与し、reader の inert から確実に除外する。
既存呼び出しは第2引数省略で無変更。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: reader ヘッダーに CQ ボタンを追加

`ReaderOverlay` のヘッダー行（プレミアム/Star の並び）にCQ捕捉ボタンを足し、今読んでいる記事の `title`/`notionUrl` を文脈として `useCqCapture()` で捕捉モーダルを開く。`useCqCapture()` が null（未接続・非表示・Provider非包含ブランチ）のときはボタンを出さない。readerは背面に残り、モーダルを閉じると読書位置に戻る（Task 1 で inert 除外済みのため成立）。

**Files:**
- Modify: `src/components/reader/ReaderOverlay.tsx`

**Interfaces:**
- Consumes: `useCqCapture(): ((prefill?: string, source?: CqSource) => void) | null`（Task 1）
- Produces: なし（UI終端）

- [ ] **Step 1: import を追加**

`src/components/reader/ReaderOverlay.tsx` の import 群に追加する。lucide の既存 import 行 `import { X, Star } from 'lucide-react'` に `MessageCircleQuestion` を足し、`useCqCapture` を import する。

```tsx
import { X, Star, MessageCircleQuestion } from 'lucide-react'
import { useCqCapture } from '@/components/CqCapture'
```

- [ ] **Step 2: フック取得**

`ReaderOverlay` 本体の他フック（例: `const { isBookmarked, toggleBookmark, markRead } = useReaderMarks()`）の近くに追加する。

```tsx
  // reader内からのCQ捕捉。未接続・非表示・Provider非包含ブランチでは null → ボタン非表示。
  const openCq = useCqCapture()
```

- [ ] **Step 3: ヘッダーにCQボタンを描画**

ヘッダー左グループ（`<div className="flex items-center gap-1">` … プレミアム label ＋ Star ボタンを含む div）の中、Star ボタンの**後**にCQボタンを足す。`openCq` が真のときだけ描画し、押下で空プレフィル＋記事文脈を渡す。

```tsx
            {openCq && (
              <button
                type="button"
                onClick={() => openCq(undefined, { title: hit.title, url: hit.notionUrl })}
                aria-label="この記事を読んで浮かんだ疑問をCQとして残す"
                title="疑問をCQとして残す"
                className="inline-flex items-center gap-1 min-h-[44px] px-2 text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 transition-colors"
              >
                <MessageCircleQuestion className="w-5 h-5" strokeWidth={2.2} />
                <span className="text-xs font-bold">CQ</span>
              </button>
            )}
```

- [ ] **Step 4: 型チェック**

Run: `cd ~/medical-search-public && npx tsc --noEmit`
Expected: エラーなし。`hit.title` は `string`、`hit.notionUrl` は `ReaderHit` のフィールド（`SubscriptionReader.tsx` 参照）で型が合うこと。

- [ ] **Step 5: 既存テスト回帰**

Run: `cd ~/medical-search-public && npm test`
Expected: 全てPASS。

- [ ] **Step 6: ブラウザ検証（本命の挙動）**

dev サーバでプレミアム記事のカードから reader を開く（個人Notion接続済みの状態＝`useCqCapture()` 非null）。次を確認する:
- ヘッダーにCQボタンが見え、押せる（inertで無効化されない）。
- 押すと捕捉モーダルが reader の**上**に開き、reader は背面に残る（backdrop越しに本文が見える）。
- モーダルに「「{記事タイトル}」を読んで」chipが正しい題名で出る。テキスト欄は空。
- 疑問文を入力→「CQとして保存する」で保存できる（`/api/notion/create-cq` 成功）。
- モーダルを閉じると reader の**読書位置（スクロール位置）が保たれている**。
- reader zoom（画像拡大）と z 競合しない。

read_console_messages でエラーが無いことも確認する。スクリーンショットを1枚取り、reader上にモーダルが重なっている様子を証跡として残す。

- [ ] **Step 7: 未接続/非表示の確認（任意・可能なら）**

設定でCQボタンを非表示（`hideCqButton`）にする、または個人Notion未接続の状態で reader を開く。
Expected: reader内CQボタンが**出ない**（`openCq` が null）。クラッシュしない。

- [ ] **Step 8: コミット**

```bash
cd ~/medical-search-public && git add src/components/reader/ReaderOverlay.tsx && git commit -m "feat(reader): ヘッダーにCQ捕捉ボタンを追加

プレミアムナレッジ読書中に、その場でCQを残せるボタンをreaderヘッダーへ追加。
今読んでいる記事の題名/URLを文脈(ソースchip)として渡す。useCqCapture が
null(未接続/非表示/Provider非包含)のときは非表示。readerは背面に残り、
閉じると読書位置に戻る。

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- 「reader内に起動口を追加」→ Task 2 Step 3。✓
- 「inert回避（data-reader-portal＋重ね表示）」→ Task 1 Step 4/5、Task 2 Step 6検証。✓
- 「ソースchip（表示のみ）」→ Task 1 Step 4。✓
- 「読書位置保持で復帰」→ Task 2 Step 6検証（readerを背面に残す設計＝モーダルが別ポータルでreaderをunmountしないため成立）。✓
- 「未接続時の扱い」→ 設計変更: 単体テストの過程で `useCqCapture()` が未接続時に null を返すこと、及び中央render分岐に `CqCaptureProvider` が無いことを確認。よってreader内では**ボタン非表示**に統一（in-readerガイドは出さない）。既存 `CqCaptureSuggestion` と同じgateパターン。Spec §4 を本方針へ更新済み。✓
- 「hideCqButton尊重」→ `hideCqButton` 時は Provider が context 値を null にするため、reader内ボタンも非表示（Task 2 Step 2/3 のgate）。✓
- 「API不変更」→ Global Constraints。✓

**2. Placeholder scan:** TBD/TODO・曖昧指示なし。全stepに実コード。✓

**3. Type consistency:** `CqSource = { title?: string; url?: string }`（Task 1 定義）を Task 2 で `{ title: hit.title, url: hit.notionUrl }` として使用。`useCqCapture` の戻り値シグネチャは両タスクで一致。既存呼び出し `openCq(query.trim())` は第2引数省略で互換。✓

## 補足（実装者への注意）

- readerの `inert` 化は `ReaderOverlay` の mount時（`[]` deps）に `document.body.children` を一度スナップショットして行う（MutationObserver不使用）。捕捉モーダルはreaderが開いた**後**にbody直下へmountされるため元々スナップショット対象外だが、`data-reader-portal` を付けることで mount順に依らず確実に除外される（Task 1）。
- React context は portal を跨いで**Reactツリー親**に沿って流れる。`ReaderOverlay` は `ReaderProvider`（`CqCaptureProvider` の内側）から描画されるため、DOM上は body直下でも `useCqCapture()` は有効。
