# スプレッドの進捗を「あと何が残っているか」で見せる（管理タブ）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/admin` のスプレッドタブと Essentials タブが、記事ごとに「読者に届くまであと何が残っているか」を6点のストリップと1文で答えるようにする。

**Architecture:** 判定は `src/lib/spread-progress.ts` の純関数1本に集め、API（`/api/admin/spread`）はその入力になる素のデータ（棚にあるか・計画ノートがあるか・オーバレイ・設問・公開状態・制作ステータス）を集めるだけ、画面は関数の結果を描くだけにする。サブスクDBの一覧は既存の `fetchNotionDatabase`、計画ノートの有無は既存のスプレッドノート_DBを1回のクエリで索引にして使う（新しい取得経路を作らない）。

**Tech Stack:** Next.js 16 (App Router) / React 18 / TypeScript / Tailwind / vitest / Notion API / Supabase

## Global Constraints

- 設計書は `docs/superpowers/specs/2026-09-07-spread-progress-dashboard-design.md`。文言・判定の出所はそこ。
- **このリポジトリは公開リポジトリ**。記事名・件数・登録者数などの実データをコード・コメント・コミットメッセージ・テストの固定値に書かない。テストの記事名は `記事A` のような架空の名前を使う。
- 新しい分類語（型・種別の呼び名）をここで作らない。記事の種別は既存の同期と同じく**タイトルの先頭1文字**（`Array.from(title.trim())[0]`）で見る。制作ステータスは既存の `subscription-publish-gate.ts` の先頭数字だけを見る。
- Notion の ID は API がハイフン付き、`reader_spreads.page_id` はハイフン無し32桁の小文字（`canonicalPageId` の形）。**突合する前に必ず正規化する。**
- 環境変数は既存のものだけを使う: `SUBSCRIPTION_NOTION_TOKEN` / `SUBSCRIPTION_MEDICAL_DB_ID` / `SUBSCRIPTION_SPREAD_NOTES_DB` / `ESSENTIALS_NOTION_DB` / `ESSENTIALS_SOURCES_NOTION_DB`。新設しない。
- テストは `npx vitest run <path>` で単体、最後に `npm test` で全件。
- コミットは1タスク1コミット（メッセージ末尾に `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`）。**push と main へのマージはオーナーの承認を取ってから。**

## 2026-09-07 の実測（この計画が前提にしている現物）

計画を書く前に実データで確かめた。実装中に食い違ったら、この節ではなく現物を正とする。

- サブスクDB: 28行。タイトル先頭は 💡27件・📚1件。制作ステータスは 7️⃣ が27件・6️⃣ が1件（0️⃣〜3️⃣ は0件）。
- `reader_spreads`: 6行（`published` 4・`draft` 2）。うち1行は `overlay` が `{}`（＝投入だけされて中身が無い）。
- スプレッドノート_DB: 4行（1回のクエリで全件・`has_more` は false）。ノートのタイトルは「主題名＋ハイフン無し32桁のID」の形。
- Essentials 制作DB: 135行。`6 サブスク移行済` は1件で、その主題名はサブスクDBの 📚 タイトルから先頭の絵文字と末尾の `Essentials` を落とした文字列と一致する。

## オーナー裁定（2026-09-07・設計書に無い2件）

1. **「計画あり」は完了の条件に入れない。** 点としては出すが、`complete` と「次の一手」には使わない。ノートが無いだけで、読者に出ている記事が永久に未完了として上に居座るのを避けるため。
   （再検討ライン: 計画ノートを全記事に持たせる運用に変えたときは、完了の条件に戻す）
2. **未投入も全件出す。** サブスクDBの28件のうちスプレッドがあるのは6件なので、一覧は「未投入」22行を含む28行になる。畳まない。

## File Structure

| ファイル | 役割 |
|---|---|
| `src/lib/spread-progress.ts`（新規） | 6点の判定・「次の一手」・一覧に出す対象かの判定。純関数だけ。画面もAPIもここを通す |
| `src/lib/__tests__/spread-progress.test.ts`（新規） | 上の全パターン |
| `src/lib/subscription-publish-gate.ts`（変更） | 先頭数字の読み取りを `productionStatusDigit` として出す。`isWithheldFromReaders` はその上に載せる（判定の場所を1つにする） |
| `src/lib/spread-notes.ts`（変更） | `fetchSpreadNotesIndex`（ノートDBを1回読んでIDの集合を返す）を足す。記事ごとに問い合わせない |
| `src/app/api/admin/spread/route.ts`（変更・GETのみ） | 行ごとに `plan`・`productionStatus`・`withheld` を足し、スプレッドが無い記事を `missing` として返す |
| `src/app/admin/SpreadCard.tsx`（変更） | 6点ストリップ・次の一手・未投入行・並び |
| `src/lib/essentials-admin.ts`（変更） | 段階に「7 スプレッド公開」を足す。`normalizeSpreadTitle` と `spreadReadyTopicIds` を足す |
| `src/app/api/admin/essentials/route.ts`（変更） | 公開済みで読者に出るスプレッドの主題IDを返す |
| `src/app/admin/EssentialsCard.tsx`（変更） | 7段目の色・注記の直し・段階6の行の促し |

---

### Task 1: 判定の純関数（6点・次の一手・一覧に出す対象）

**Files:**
- Create: `src/lib/spread-progress.ts`
- Create: `src/lib/__tests__/spread-progress.test.ts`
- Modify: `src/lib/subscription-publish-gate.ts`

**Interfaces:**
- Consumes: なし（このタスクが最初）
- Produces:
  - `type SpreadStepKey = 'onShelf' | 'plan' | 'injected' | 'quizzes' | 'published' | 'reaches'`
  - `type SpreadStepState = 'done' | 'todo' | 'unknown'`
  - `type SpreadProgressInput = { onShelf: boolean; hasPlan: boolean | null; overlayEmpty: boolean; quizzes: { reviewed: boolean }[]; status: string; withheld: boolean; stale: boolean; productionStatus?: string }`
  - `type SpreadProgress = { steps: { key: SpreadStepKey; label: string; state: SpreadStepState }[]; next: string; complete: boolean }`
  - `spreadProgress(input: SpreadProgressInput): SpreadProgress`
  - `isSpreadCandidate(row: { title: string; productionStatus: string }): boolean`
  - `subscriptionRowOf(page: { id: string; properties?: Record<string, NotionPropLite | undefined> }): { pageId: string; title: string; productionStatus: string }`
  - `SPREAD_STEP_LABELS: Record<SpreadStepKey, string>`
  - `productionStatusDigit(status: string | undefined | null): number | null`（`subscription-publish-gate.ts` から）

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/spread-progress.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  spreadProgress,
  isSpreadCandidate,
  subscriptionRowOf,
  SPREAD_STEP_LABELS,
  type SpreadProgressInput,
} from '../spread-progress'
import { productionStatusDigit, isWithheldFromReaders } from '../subscription-publish-gate'

// 全点そろった行。各テストは必要な点だけを崩す。
const DONE: SpreadProgressInput = {
  onShelf: true,
  hasPlan: true,
  overlayEmpty: false,
  quizzes: [{ reviewed: true }, { reviewed: true }],
  status: 'published',
  withheld: false,
  stale: false,
  productionStatus: '7️⃣ サブスク移行済',
}
const state = (p: ReturnType<typeof spreadProgress>, key: string) => p.steps.find((s) => s.key === key)?.state

describe('spreadProgress の6点', () => {
  it('点は棚→計画→投入→設問→公開→読者の順に6つ出る', () => {
    const p = spreadProgress(DONE)
    expect(p.steps.map((s) => s.key)).toEqual(['onShelf', 'plan', 'injected', 'quizzes', 'published', 'reaches'])
    expect(p.steps.map((s) => s.label)).toEqual([
      SPREAD_STEP_LABELS.onShelf,
      SPREAD_STEP_LABELS.plan,
      SPREAD_STEP_LABELS.injected,
      SPREAD_STEP_LABELS.quizzes,
      SPREAD_STEP_LABELS.published,
      SPREAD_STEP_LABELS.reaches,
    ])
    expect(p.steps.every((s) => s.state === 'done')).toBe(true)
    expect(p.complete).toBe(true)
    expect(p.next).toBe('完了')
  })

  it('オーバレイが空なら「投入済」は立たない', () => {
    const p = spreadProgress({ ...DONE, overlayEmpty: true })
    expect(state(p, 'injected')).toBe('todo')
  })

  it('設問が0問なら「設問承認」は立たない', () => {
    expect(state(spreadProgress({ ...DONE, quizzes: [] }), 'quizzes')).toBe('todo')
  })

  it('1問でも未承認なら「設問承認」は立たない', () => {
    expect(state(spreadProgress({ ...DONE, quizzes: [{ reviewed: true }, { reviewed: false }] }), 'quizzes')).toBe('todo')
  })

  it('制作ステータスが門に掛かる記事は「読者に出る」が立たない', () => {
    expect(state(spreadProgress({ ...DONE, withheld: true }), 'reaches')).toBe('todo')
  })

  it('計画ノートの有無が分からないときは「計画あり」を不明にする', () => {
    expect(state(spreadProgress({ ...DONE, hasPlan: null }), 'plan')).toBe('unknown')
  })
})

describe('完了の判定', () => {
  it('計画ノートが無くても完了になる（2026-09-07 裁定）', () => {
    const p = spreadProgress({ ...DONE, hasPlan: false })
    expect(state(p, 'plan')).toBe('todo')
    expect(p.complete).toBe(true)
    expect(p.next).toBe('完了')
  })

  it('原本が更新されていれば完了にしない', () => {
    expect(spreadProgress({ ...DONE, stale: true }).complete).toBe(false)
  })

  it('公開済みでも読者に出ていなければ完了にしない', () => {
    expect(spreadProgress({ ...DONE, withheld: true }).complete).toBe(false)
  })
})

describe('次の一手', () => {
  it('棚に無い記事は棚へ移すことから', () => {
    expect(spreadProgress({ ...DONE, onShelf: false }).next).toBe(
      '原本がサブスク用DBにありません。棚へ移して、移行先のページIDで投入し直す',
    )
  })

  it('未投入は見せ方の相談から', () => {
    expect(spreadProgress({ ...DONE, overlayEmpty: true, status: '', quizzes: [] }).next).toBe(
      'スプレッド未投入。見せ方の相談から',
    )
  })

  it('原本が動いていれば再生成が先（設問の未承認より先に出す）', () => {
    expect(spreadProgress({ ...DONE, stale: true, quizzes: [{ reviewed: false }] }).next).toBe(
      '原本が更新されている。再生成してから承認',
    )
  })

  it('設問が0問なら設問を作るところから', () => {
    expect(spreadProgress({ ...DONE, quizzes: [], status: 'draft' }).next).toBe(
      '設問がまだない。「スプレッドを整える」で設問を作る',
    )
  })

  it('未承認の設問の数を出す', () => {
    expect(spreadProgress({ ...DONE, quizzes: [{ reviewed: false }, { reviewed: false }, { reviewed: true }] }).next).toBe(
      '設問2問が未承認',
    )
  })

  it('設問まで済んで未公開なら公開', () => {
    expect(spreadProgress({ ...DONE, status: 'draft' }).next).toBe('公開する')
  })

  it('公開済みで門に掛かっていれば制作ステータスを添えて出す', () => {
    expect(spreadProgress({ ...DONE, withheld: true, productionStatus: '3️⃣ 原文照合済' }).next).toBe(
      '公開済みだが制作ステータス 3️⃣ 原文照合済 のため読者に出ていない。7️⃣ に上げる',
    )
  })

  it('制作ステータスが読めないときも文は出す', () => {
    expect(spreadProgress({ ...DONE, withheld: true, productionStatus: '' }).next).toBe(
      '公開済みだが制作ステータスが制作途中のため読者に出ていない。7️⃣ に上げる',
    )
  })
})

describe('一覧に出す対象', () => {
  it('📚 は制作ステータスに関わらず出す', () => {
    expect(isSpreadCandidate({ title: '📚 記事A Essentials', productionStatus: '' })).toBe(true)
    expect(isSpreadCandidate({ title: '📚 記事A Essentials', productionStatus: '2️⃣ ファクト済' })).toBe(true)
  })

  it('💡 は制作ステータスが 3️⃣ 以上のときだけ出す', () => {
    expect(isSpreadCandidate({ title: '💡 記事B', productionStatus: '7️⃣ サブスク移行済' })).toBe(true)
    expect(isSpreadCandidate({ title: '💡 記事B', productionStatus: '3️⃣ 原文照合済' })).toBe(true)
    expect(isSpreadCandidate({ title: '💡 記事B', productionStatus: '2️⃣ ファクト済' })).toBe(false)
    expect(isSpreadCandidate({ title: '💡 記事B', productionStatus: '' })).toBe(false)
  })

  it('📚 でも 💡 でもない記事は出さない', () => {
    expect(isSpreadCandidate({ title: '❓ 記事C', productionStatus: '7️⃣ サブスク移行済' })).toBe(false)
    expect(isSpreadCandidate({ title: '', productionStatus: '7️⃣ サブスク移行済' })).toBe(false)
  })
})

describe('サブスクDBの1行の読み取り', () => {
  it('IDをハイフン無しの小文字に揃え、タイトルと制作ステータスを取る', () => {
    const row = subscriptionRowOf({
      id: '3CBFD756-7370-8141-85E3-DA90F1864550',
      properties: {
        名前: { title: [{ plain_text: '📚 記事A ' }, { plain_text: 'Essentials' }] },
        制作ステータス: { select: { name: '7️⃣ サブスク移行済' } },
      },
    })
    expect(row).toEqual({
      pageId: '3cbfd7567370814185e3da90f1864550',
      title: '📚 記事A Essentials',
      productionStatus: '7️⃣ サブスク移行済',
    })
  })

  it('列名が タイトル / Name でも読む。無いときは空文字', () => {
    expect(subscriptionRowOf({ id: 'a'.repeat(32), properties: { Name: { title: [{ plain_text: '💡 記事B' }] } } }).title).toBe('💡 記事B')
    expect(subscriptionRowOf({ id: 'a'.repeat(32) }).productionStatus).toBe('')
  })
})

describe('制作ステータスの先頭数字', () => {
  it('数字を返す。読めない値は null', () => {
    expect(productionStatusDigit('7️⃣ サブスク移行済')).toBe(7)
    expect(productionStatusDigit('0️⃣ 下書き')).toBe(0)
    expect(productionStatusDigit('サブスク移行済')).toBe(null)
    expect(productionStatusDigit('')).toBe(null)
    expect(productionStatusDigit(null)).toBe(null)
  })

  it('門の判定は今までどおり 0️⃣〜3️⃣ だけを止める', () => {
    expect(isWithheldFromReaders('3️⃣ 原文照合済')).toBe(true)
    expect(isWithheldFromReaders('4️⃣ 図解済')).toBe(false)
    expect(isWithheldFromReaders('')).toBe(false)
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/spread-progress.test.ts`
Expected: FAIL（`Failed to resolve import "../spread-progress"`）

- [ ] **Step 3: 先頭数字の読み取りを1か所にする**

`src/lib/subscription-publish-gate.ts` の定数と関数を置き換える（ファイル冒頭のコメントはそのまま）:

```ts
// 制作ステータスの先頭の数字絵文字。0️⃣下書き 〜 7️⃣サブスク移行済 のどれか。
const LEADING_DIGIT = /^([0-9])️?⃣/

/**
 * 制作ステータスの先頭の数字を返す。読めない形・空・未設定は null。
 *
 * 「読者に出すか」の門（下の isWithheldFromReaders）と、スプレッドの一覧に出す対象の
 * 判定（spread-progress.ts）が同じ読み取りを使うので、ここ1か所に置く。
 */
export function productionStatusDigit(status: string | undefined | null): number | null {
  const m = LEADING_DIGIT.exec((status ?? '').trim())
  return m ? Number(m[1]) : null
}

// 制作途中とみなす上限。0️⃣下書き 1️⃣未査読 2️⃣ファクト済 3️⃣原文照合済 までは読者に出さない。
const WITHHELD_MAX_DIGIT = 3

/**
 * 制作ステータスの値から、読者に出さない記事かどうかを判定する。
 *
 * 判定は**先頭の数字絵文字だけ**を見る。ラベルの文言（「未査読（内容は揃った）」等）は
 * 変わりうるので当てにしない。ステータスが空・未設定・読めない形のときは false を返す
 * （載せる）。門を足したせいで既存の記事が黙って消えるほうが、害が大きいため。
 */
export function isWithheldFromReaders(status: string | undefined | null): boolean {
  const digit = productionStatusDigit(status)
  return digit !== null && digit <= WITHHELD_MAX_DIGIT
}
```

- [ ] **Step 4: 純関数を書く**

`src/lib/spread-progress.ts`（新規）:

```ts
// スプレッドの進み具合（/admin スプレッドタブ）の判定。
//
// 「この記事は、読者に届くまであと何が残っているか」に答えるための6点と、その1文。
// 画面（SpreadCard）もAPI（/api/admin/spread）もこの関数の結果を使い、判定をここ以外に置かない。
// 工程が変わったとき直す場所を1つにするため（設計 2026-09-07）。
import { productionStatusDigit } from './subscription-publish-gate'

export type SpreadStepKey = 'onShelf' | 'plan' | 'injected' | 'quizzes' | 'published' | 'reaches'

// 'unknown' は「判定できなかった」。計画ノートDBが未設定・取得失敗のときだけ使う。
// 分からないものを「無い」と描くと、直す必要のない行を直しに行かせてしまう。
export type SpreadStepState = 'done' | 'todo' | 'unknown'

export const SPREAD_STEP_LABELS: Record<SpreadStepKey, string> = {
  onShelf: '棚にある',
  plan: '計画あり',
  injected: '投入済',
  quizzes: '設問承認',
  published: '公開',
  reaches: '読者に出る',
}

export type SpreadProgressInput = {
  /** 原本がサブスク用DB（読者に届く棚）にあるか */
  onShelf: boolean
  /** スプレッドノート_DB にこの記事のノート（＝見せ方の計画）があるか。null は判定できなかった */
  hasPlan: boolean | null
  /** reader_spreads.overlay が {}（投入だけで中身が無い）か。行が無い記事も true */
  overlayEmpty: boolean
  quizzes: { reviewed: boolean }[]
  /** reader_spreads.status。行が無い記事は '' */
  status: string
  /** 制作ステータスが同期の門に掛かっている（読者に出ない） */
  withheld: boolean
  /** 原本が更新されていて、スプレッドが古いまま */
  stale: boolean
  /** 制作ステータスの値そのもの。「次の一手」に添えるだけ */
  productionStatus?: string
}

export type SpreadProgress = {
  steps: { key: SpreadStepKey; label: string; state: SpreadStepState }[]
  next: string
  complete: boolean
}

export function spreadProgress(input: SpreadProgressInput): SpreadProgress {
  const injected = !input.overlayEmpty
  // 設問は「1問以上あって、全問が目視済み」で立つ。0問は未達（読者に問いが出ない）。
  const quizzesDone = input.quizzes.length > 0 && input.quizzes.every((q) => q.reviewed)
  const published = input.status === 'published'
  const mark = (done: boolean): SpreadStepState => (done ? 'done' : 'todo')

  const steps: SpreadProgress['steps'] = [
    { key: 'onShelf', label: SPREAD_STEP_LABELS.onShelf, state: mark(input.onShelf) },
    { key: 'plan', label: SPREAD_STEP_LABELS.plan, state: input.hasPlan === null ? 'unknown' : mark(input.hasPlan) },
    { key: 'injected', label: SPREAD_STEP_LABELS.injected, state: mark(injected) },
    { key: 'quizzes', label: SPREAD_STEP_LABELS.quizzes, state: mark(quizzesDone) },
    { key: 'published', label: SPREAD_STEP_LABELS.published, state: mark(published) },
    { key: 'reaches', label: SPREAD_STEP_LABELS.reaches, state: mark(!input.withheld) },
  ]

  // 「計画あり」は完了の条件に入れない（2026-09-07 オーナー裁定）。スプレッドノートは
  // 見せ方の相談を始めてから作る運用に途中で変わったので、それ以前に公開した記事は
  // ノートを持たない。点としては出すが、これで未完了に落とすと読者に出ている記事が
  // 永久に上に居座る。再検討ライン: 全記事にノートを持たせる運用に変えたら条件に戻す。
  const complete = input.onShelf && injected && quizzesDone && published && !input.withheld && !input.stale

  return { steps, next: nextStep(input, { injected, quizzesDone, published }), complete }
}

// 「次の一手」は、いちばん手前で止まっている関門を1つだけ言う。
// 並びは工程の順（棚→投入→再生成→設問→公開→門）。手前が止まっているうちに
// 先の話（公開しろ）を出すと、押せないボタンを勧めることになる。
function nextStep(
  input: SpreadProgressInput,
  d: { injected: boolean; quizzesDone: boolean; published: boolean },
): string {
  if (!input.onShelf) return '原本がサブスク用DBにありません。棚へ移して、移行先のページIDで投入し直す'
  if (!d.injected) return 'スプレッド未投入。見せ方の相談から'
  // 原本が動いている行は、承認も公開も先に再生成が要る（承認APIは 409 で止める）。
  if (input.stale) return '原本が更新されている。再生成してから承認'
  if (input.quizzes.length === 0) return '設問がまだない。「スプレッドを整える」で設問を作る'
  const unreviewed = input.quizzes.filter((q) => !q.reviewed).length
  if (unreviewed > 0) return `設問${unreviewed}問が未承認`
  if (!d.published) return '公開する'
  if (input.withheld) {
    return input.productionStatus
      ? `公開済みだが制作ステータス ${input.productionStatus} のため読者に出ていない。7️⃣ に上げる`
      : '公開済みだが制作ステータスが制作途中のため読者に出ていない。7️⃣ に上げる'
  }
  return '完了'
}

// ---- サブスクDBの1行 ---------------------------------------------------------

// 💡 のうち一覧に出す下限。3️⃣ 原文照合済 から先はスプレッドを組み始める段階。
const CANDIDATE_MIN_DIGIT = 3

/**
 * サブスクDBの1行を、スプレッドの一覧に出すか。
 *
 * 種別は既存の同期と同じくタイトルの先頭1文字で見る（新しい分類語をここで作らない）。
 * 📚 は制作ステータスに関わらず出す。💡 は 3️⃣ 以上だけ。
 */
export function isSpreadCandidate(row: { title: string; productionStatus: string }): boolean {
  const kind = Array.from(row.title.trim())[0] ?? ''
  if (kind === '📚') return true
  if (kind !== '💡') return false
  const digit = productionStatusDigit(row.productionStatus)
  return digit !== null && digit >= CANDIDATE_MIN_DIGIT
}

type NotionPropLite = {
  title?: { plain_text?: string }[]
  select?: { name?: string } | null
}

/**
 * サブスクDBのクエリ結果1件から、この画面が使う3つだけを取り出す。
 *
 * page_id は reader_spreads と突き合わせるので、ハイフン無し32桁の小文字に揃える
 * （Notion API はハイフン付きを返す。揃えないと全件が「スプレッドなし」に見える）。
 */
export function subscriptionRowOf(page: {
  id: string
  properties?: Record<string, NotionPropLite | undefined>
}): { pageId: string; title: string; productionStatus: string } {
  const p = page.properties ?? {}
  const titleProp = p['名前'] ?? p['title'] ?? p['タイトル'] ?? p['Name']
  const title = (titleProp?.title ?? []).map((t) => t.plain_text ?? '').join('').trim()
  return {
    pageId: page.id.replace(/-/g, '').toLowerCase(),
    title,
    productionStatus: p['制作ステータス']?.select?.name?.trim() ?? '',
  }
}
```

- [ ] **Step 5: テストが通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/spread-progress.test.ts src/lib/__tests__/subscription-publish-gate.test.ts`
Expected: PASS（既存の門のテストも通ること。落ちたら `isWithheldFromReaders` の振る舞いを変えてしまっている）

- [ ] **Step 6: コミット**

```bash
git add src/lib/spread-progress.ts src/lib/__tests__/spread-progress.test.ts src/lib/subscription-publish-gate.ts
git commit -m "$(cat <<'EOF'
feat(admin): スプレッドの進み具合（6点・次の一手）を純関数にする

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: 計画ノートの索引（1回のクエリで全件）

**Files:**
- Modify: `src/lib/spread-notes.ts`
- Create: `src/lib/__tests__/spread-notes-index.test.ts`

**Interfaces:**
- Consumes: `NotesClient`（既存・`spread-notes.ts`）
- Produces: `fetchSpreadNotesIndex(notion: NotesClient): Promise<Set<string> | null>` — ノートDBのタイトルに現れるハイフン無し32桁のIDの集合。環境変数が無い・取得に失敗したときは `null`（＝判定できなかった）

**なぜ索引にするか:** 既存の `findSpreadNotesPageId` は1記事につきノートDBを最大500件走査する。一覧は28行あるので、そのまま呼ぶと28回のクエリになる。ノートDBは実測4行・1回のクエリで全件返るので、1回読んで集合にする。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/spread-notes-index.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fetchSpreadNotesIndex } from '../spread-notes'

const ID_A = '3cbfd7567370814185e3da90f1864550'
const ID_B = '3b0fd7567370814da58ffdf00a15e8b2'

function client(pages: { title: string }[][], onQuery?: () => void) {
  let call = 0
  return {
    blocks: { children: { list: async () => ({ results: [], has_more: false, next_cursor: null }) } },
    databases: {
      query: async () => {
        onQuery?.()
        const page = pages[call] ?? []
        const hasMore = call < pages.length - 1
        call += 1
        return {
          results: page.map((p, i) => ({
            id: `row${i}`,
            properties: { 名前: { type: 'title', title: [{ plain_text: p.title }] } },
          })),
          has_more: hasMore,
          next_cursor: hasMore ? 'next' : null,
        }
      },
    },
  } as unknown as Parameters<typeof fetchSpreadNotesIndex>[0]
}

beforeEach(() => {
  process.env.SUBSCRIPTION_SPREAD_NOTES_DB = 'notesdb'
})
afterEach(() => {
  delete process.env.SUBSCRIPTION_SPREAD_NOTES_DB
})

describe('fetchSpreadNotesIndex', () => {
  it('タイトルに含まれるIDを集合にする', async () => {
    const idx = await fetchSpreadNotesIndex(client([[{ title: `記事A Essentials ${ID_A}` }, { title: `記事B ${ID_B}` }]]))
    expect(idx).toEqual(new Set([ID_A, ID_B]))
  })

  it('ハイフン付き・大文字で書かれたIDも同じ形にそろえる', async () => {
    const hyphenated = '3cbfd756-7370-8141-85e3-da90f1864550'.toUpperCase()
    const idx = await fetchSpreadNotesIndex(client([[{ title: `記事A ${hyphenated}` }]]))
    expect(idx?.has(ID_A)).toBe(true)
  })

  it('IDを含まないタイトルは何も足さない', async () => {
    const idx = await fetchSpreadNotesIndex(client([[{ title: '見せ方のメモ' }]]))
    expect(idx?.size).toBe(0)
  })

  it('一覧の件数ぶん問い合わせない（1回のクエリで読む）', async () => {
    let calls = 0
    const idx = await fetchSpreadNotesIndex(client([[{ title: `記事A ${ID_A}` }]], () => { calls += 1 }))
    expect(calls).toBe(1)
    expect(idx?.size).toBe(1)
  })

  it('環境変数が無ければ null（判定できなかった）', async () => {
    delete process.env.SUBSCRIPTION_SPREAD_NOTES_DB
    expect(await fetchSpreadNotesIndex(client([[]]))).toBe(null)
  })

  it('取得に失敗したら null。空の集合（＝全部ノート無し）にしない', async () => {
    const broken = {
      blocks: { children: { list: async () => ({ results: [], has_more: false, next_cursor: null }) } },
      databases: { query: async () => { throw new Error('boom') } },
    } as unknown as Parameters<typeof fetchSpreadNotesIndex>[0]
    expect(await fetchSpreadNotesIndex(broken)).toBe(null)
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/spread-notes-index.test.ts`
Expected: FAIL（`fetchSpreadNotesIndex is not a function`）

- [ ] **Step 3: 索引を書く**

`src/lib/spread-notes.ts` の末尾に足す:

```ts
// タイトルに書かれた記事のID（ハイフン無し32桁）。ノートページは
// 「主題名＋ID」の約束で作るので、そこから拾う。
const NOTES_TITLE_ID = /[0-9a-f]{32}/g

/**
 * ノートDBを1回読んで、ノートを持つ記事のIDの集合を返す。
 *
 * 一覧（/admin スプレッドタブ）は記事ごとに「計画があるか」を出すが、
 * findSpreadNotesPageId を記事の数だけ呼ぶとその都度DBを全件走査することになる。
 * ノートDBは記事1件につき1行しかないので、まとめて読んで集合にする。
 *
 * 環境変数が無い・取得に失敗したときは null を返す（空の集合と区別する）。
 * 空の集合を返すと、画面が全記事を「計画なし」と描いてしまう。
 */
export async function fetchSpreadNotesIndex(notion: NotesClient): Promise<Set<string> | null> {
  const dbId = process.env.SUBSCRIPTION_SPREAD_NOTES_DB
  if (!dbId) return null
  const found = new Set<string>()
  try {
    let cursor: string | undefined
    let page = 0
    do {
      const res = await notion.databases.query({ database_id: dbId, start_cursor: cursor, page_size: 100 })
      for (const row of res.results as unknown as { properties?: Record<string, unknown> }[]) {
        const title = pageTitleOf(row.properties as Parameters<typeof pageTitleOf>[0])
          .replace(/-/g, '')
          .toLowerCase()
        for (const m of title.matchAll(NOTES_TITLE_ID)) found.add(m[0])
      }
      page++
      cursor = res.has_more && page < MAX_NOTES_PAGES ? (res.next_cursor ?? undefined) : undefined
    } while (cursor)
    return found
  } catch {
    return null
  }
}
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/spread-notes-index.test.ts`
Expected: PASS

- [ ] **Step 5: コミット**

```bash
git add src/lib/spread-notes.ts src/lib/__tests__/spread-notes-index.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): スプレッドノートの有無を1回のクエリで索引にする

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: 一覧APIに「計画」「制作ステータス」「未投入の記事」を足す

**Files:**
- Modify: `src/app/api/admin/spread/route.ts`（`GET` だけ。`PUT`・`PATCH` は触らない）
- Modify: `src/lib/__tests__/admin-spread-route.test.ts`

**Interfaces:**
- Consumes: `fetchSpreadNotesIndex`（Task 2）、`isSpreadCandidate` / `subscriptionRowOf`（Task 1）、`isWithheldFromReaders`（既存）、`fetchNotionDatabase`（既存・`@/lib/essentials-admin`）
- Produces: `GET /api/admin/spread?check=1` の応答
  ```ts
  {
    spreads: Array<{
      page_id: string; status: string; source_last_edited: string | null; verified_at: string | null
      updated_at: string; title: string | null; quizzes: SpreadQuiz[]
      stale?: boolean; offShelf?: boolean
      plan?: boolean | null          // 計画ノートの有無。null は判定できなかった
      productionStatus?: string      // サブスクDBの制作ステータス。棚に無い記事は ''
      withheld?: boolean             // 同期の門に掛かっている
    }>
    missing?: Array<{ page_id: string; title: string; productionStatus: string; plan: boolean | null; withheld: boolean }>
    sourceListFailed?: boolean       // サブスクDBの一覧が引けなかった（missing は空）
  }
  ```
  `?check=1` を付けない GET は今までどおり（`spreads` だけ）。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/admin-spread-route.test.ts` の先頭のモック群に足す（既存の `vi.mock` の並びの最後）:

```ts
// サブスクDBの一覧（fetchNotionDatabase）と、計画ノートの索引を差し替える。
// どちらも GET ?check=1 でしか呼ばれない。
const fetchNotionDatabaseMock = vi.fn()
vi.mock('@/lib/essentials-admin', () => ({ fetchNotionDatabase: (...a: unknown[]) => fetchNotionDatabaseMock(...a) }))
const fetchSpreadNotesIndexMock = vi.fn()
vi.mock('@/lib/spread-notes', () => ({
  fetchSpreadNotesBlocks: async () => null,
  fetchSpreadNotesIndex: () => fetchSpreadNotesIndexMock(),
}))
```

同ファイルの `beforeEach` の末尾に足す:

```ts
  fetchNotionDatabaseMock.mockResolvedValue({ ok: true, pages: [] })
  fetchSpreadNotesIndexMock.mockResolvedValue(null)
```

同ファイルの末尾に足す:

```ts
// サブスクDBの1行を作る。properties の形は Notion のクエリ応答と同じ。
const subPage = (id: string, title: string, status: string) => ({
  id,
  properties: {
    名前: { title: [{ plain_text: title }] },
    制作ステータス: { select: { name: status } },
  },
})

// ページID2つはこの後のテストでも使うので、describe の外に置く。
const PAGE_A = 'a'.repeat(32)
const PAGE_B = 'b'.repeat(32)

describe('GET /api/admin/spread?check=1 の進み具合', () => {
  it('スプレッドがある行に計画・制作ステータス・門の判定を足す', async () => {
    selectRows = [
      { page_id: PAGE_A, status: 'published', source_last_edited: '2026-08-20T00:00:00.000Z',
        verified_at: null, updated_at: '2026-08-20T00:00:00.000Z', title: '💡 記事A', overlay: { quizzes: [] } },
    ]
    fetchNotionDatabaseMock.mockResolvedValue({ ok: true, pages: [subPage(PAGE_A, '💡 記事A', '3️⃣ 原文照合済')] })
    fetchSpreadNotesIndexMock.mockResolvedValue(new Set([PAGE_A]))

    const res = await GET(new Request('http://localhost/api/admin/spread?check=1'))
    const body = await res.json()
    expect(body.spreads[0].plan).toBe(true)
    expect(body.spreads[0].productionStatus).toBe('3️⃣ 原文照合済')
    expect(body.spreads[0].withheld).toBe(true)
  })

  it('棚にあってスプレッドが無い記事を missing に出す', async () => {
    selectRows = []
    fetchNotionDatabaseMock.mockResolvedValue({
      ok: true,
      pages: [subPage(PAGE_B, '💡 記事B', '7️⃣ サブスク移行済')],
    })
    fetchSpreadNotesIndexMock.mockResolvedValue(new Set<string>())

    const res = await GET(new Request('http://localhost/api/admin/spread?check=1'))
    const body = await res.json()
    expect(body.missing).toEqual([
      { page_id: PAGE_B, title: '💡 記事B', productionStatus: '7️⃣ サブスク移行済', plan: false, withheld: false },
    ])
  })

  it('一覧に出す対象でない記事（💡の 2️⃣・❓）は missing に出さない', async () => {
    selectRows = []
    fetchNotionDatabaseMock.mockResolvedValue({
      ok: true,
      pages: [subPage(PAGE_B, '💡 記事B', '2️⃣ ファクト済'), subPage('c'.repeat(32), '❓ 記事C', '7️⃣ サブスク移行済')],
    })
    const res = await GET(new Request('http://localhost/api/admin/spread?check=1'))
    expect((await res.json()).missing).toEqual([])
  })

  it('Notion のIDがハイフン付きで返っても、スプレッドがある記事は missing に出さない', async () => {
    const hyphenated = '3cbfd756-7370-8141-85e3-da90f1864550'
    const bare = hyphenated.replace(/-/g, '')
    selectRows = [
      { page_id: bare, status: 'draft', source_last_edited: null, verified_at: null,
        updated_at: '2026-08-20T00:00:00.000Z', title: '📚 記事D', overlay: {} },
    ]
    fetchNotionDatabaseMock.mockResolvedValue({ ok: true, pages: [subPage(hyphenated, '📚 記事D', '7️⃣ サブスク移行済')] })
    const res = await GET(new Request('http://localhost/api/admin/spread?check=1'))
    const body = await res.json()
    expect(body.missing).toEqual([])
    expect(body.spreads[0].productionStatus).toBe('7️⃣ サブスク移行済')
  })

  it('サブスクDBの一覧が引けなければ sourceListFailed を立て、missing は空にする', async () => {
    selectRows = []
    fetchNotionDatabaseMock.mockResolvedValue({ ok: false, reason: 'not_shared', status: 404 })
    const res = await GET(new Request('http://localhost/api/admin/spread?check=1'))
    const body = await res.json()
    expect(body.sourceListFailed).toBe(true)
    expect(body.missing).toEqual([])
  })

  it('?check=1 を付けない GET は今までどおり spreads だけ返す', async () => {
    selectRows = [
      { page_id: PAGE_A, status: 'draft', source_last_edited: null, verified_at: null,
        updated_at: '2026-08-20T00:00:00.000Z', title: '💡 記事A', overlay: {} },
    ]
    const res = await GET(new Request('http://localhost/api/admin/spread'))
    const body = await res.json()
    expect(body.missing).toBeUndefined()
    expect(fetchNotionDatabaseMock).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/admin-spread-route.test.ts`
Expected: FAIL（`body.spreads[0].plan` が undefined、`body.missing` が undefined）

- [ ] **Step 3: GET を書き換える**

`src/app/api/admin/spread/route.ts` の import に足す:

```ts
import { fetchSpreadNotesBlocks, fetchSpreadNotesIndex } from '@/lib/spread-notes'
import { isSpreadCandidate, subscriptionRowOf } from '@/lib/spread-progress'
import { isWithheldFromReaders } from '@/lib/subscription-publish-gate'
// サブスクDBの一覧は Essentials タブが使っている取得関数をそのまま使う（新しい取得経路を作らない）。
import { fetchNotionDatabase } from '@/lib/essentials-admin'
```

（既存の `import { fetchSpreadNotesBlocks } from '@/lib/spread-notes'` は上の行に置き換える）

GET の `?check=1` の分岐から下を、次に置き換える:

```ts
  const check = new URL(req.url).searchParams.get('check') === '1'
  const token = process.env.SUBSCRIPTION_NOTION_TOKEN
  if (!check || !token) return NextResponse.json({ spreads: rows })

  const notion = new Client({ auth: token })
  const dbId = process.env.SUBSCRIPTION_MEDICAL_DB_ID
  // 3つを並行して集める。原本ごとの retrieve（stale・棚の判定）、サブスクDBの一覧
  // （制作ステータスと、まだスプレッドが無い記事）、計画ノートの索引。
  const [withStale, listing, notesIndex] = await Promise.all([
    Promise.all(
      rows.map(async (r) => {
        try {
          const page = await notion.pages.retrieve({ page_id: r.page_id })
          const last = (page as { last_edited_time?: string }).last_edited_time ?? null
          // 原本の最終更新が、このスプレッドを組んだ時点の原本更新より新しければ再生成が要る。
          const stale = !!last && !!r.source_last_edited && new Date(last) > new Date(r.source_last_edited)
          // 原本が棚（サブスク用DB）に無い行。公開中でも読者はその記事に届いていない。
          const offShelf = isSubscriptionSourcePage(page) === false
          return { ...r, stale, offShelf }
        } catch {
          // 原本が引けない（削除・権限変更等）ときは判定しない。誤って「更新あり」と出さない。
          return { ...r, stale: false, offShelf: false }
        }
      }),
    ),
    dbId ? fetchNotionDatabase(dbId, token) : Promise.resolve({ ok: false, reason: 'http_error' } as const),
    fetchSpreadNotesIndex(notion),
  ])

  // サブスクDBの一覧を page_id（ハイフン無し32桁）で引ける形にする。
  const source = new Map<string, { title: string; productionStatus: string }>()
  if (listing.ok) {
    for (const page of listing.pages) {
      const row = subscriptionRowOf(page)
      source.set(row.pageId, { title: row.title, productionStatus: row.productionStatus })
    }
  }
  const planOf = (pageId: string): boolean | null => (notesIndex ? notesIndex.has(pageId) : null)

  const spreads = withStale.map((r) => {
    const src = source.get(r.page_id)
    return {
      ...r,
      plan: planOf(r.page_id),
      productionStatus: src?.productionStatus ?? '',
      withheld: isWithheldFromReaders(src?.productionStatus),
    }
  })

  // 棚にあるのにスプレッドがまだ無い記事。ここに出ないと、投入して初めて一覧に載るので
  // 「まだ手を付けていない記事」が管理タブから見えない（設計 2026-09-07）。
  const have = new Set(rows.map((r) => r.page_id))
  const missing = listing.ok
    ? [...source.entries()]
        .filter(([pageId, s]) => !have.has(pageId) && isSpreadCandidate(s))
        .map(([pageId, s]) => ({
          page_id: pageId,
          title: s.title,
          productionStatus: s.productionStatus,
          plan: planOf(pageId),
          withheld: isWithheldFromReaders(s.productionStatus),
        }))
        .sort((a, b) => a.title.localeCompare(b.title, 'ja'))
    : []

  return NextResponse.json({ spreads, missing, ...(listing.ok ? {} : { sourceListFailed: true }) })
```

- [ ] **Step 4: テストが通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/admin-spread-route.test.ts`
Expected: PASS（既存の PUT・PATCH のテストも通ること。`@/lib/spread-notes` をモックしたので `fetchSpreadNotesBlocks` が null を返す点は従来と同じ）

- [ ] **Step 5: 型を確かめる**

Run: `npx tsc --noEmit`
Expected: エラーなし

- [ ] **Step 6: コミット**

```bash
git add src/app/api/admin/spread/route.ts src/lib/__tests__/admin-spread-route.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): スプレッド一覧に計画・制作ステータス・未投入の記事を足す

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: スプレッドタブに6点のストリップと「次の一手」を出す

**Files:**
- Modify: `src/app/api/admin/spread/route.ts`（GET の行の組み立て）
- Modify: `src/lib/__tests__/admin-spread-route.test.ts`
- Modify: `src/app/admin/SpreadCard.tsx`

**Interfaces:**
- Consumes: Task 3 の GET 応答、`spreadProgress` / `SpreadProgress`（Task 1）
- Produces: GET の各行に `overlayEmpty: boolean` が増える。画面は他のタスクから参照されない

- [ ] **Step 1: 「投入済」をサーバーが返すテストを書く**

`src/lib/__tests__/admin-spread-route.test.ts` の `const PAGE_A`・`PAGE_B` を、Task 3 で足した describe の中ではなくファイルの上（`beforeEach` の前）に置き直す:

```ts
const PAGE_A = 'a'.repeat(32)
const PAGE_B = 'b'.repeat(32)
```

そのうえで末尾に足す:

```ts
describe('GET /api/admin/spread の投入済の判定', () => {
  it('overlay が空の行は overlayEmpty を立てて返す（overlay 自体は返さない）', async () => {
    selectRows = [
      { page_id: PAGE_A, status: 'draft', source_last_edited: null, verified_at: null,
        updated_at: '2026-08-20T00:00:00.000Z', title: '💡 記事A', overlay: {} },
      { page_id: PAGE_B, status: 'draft', source_last_edited: null, verified_at: null,
        updated_at: '2026-08-20T00:00:00.000Z', title: '💡 記事B', overlay: { quizzes: [] } },
    ]
    const res = await GET(new Request('http://localhost/api/admin/spread'))
    const body = await res.json()
    expect(body.spreads[0].overlayEmpty).toBe(true)
    expect(body.spreads[1].overlayEmpty).toBe(false)
    expect(body.spreads[0].overlay).toBeUndefined()
  })
})
```

Run: `npx vitest run src/lib/__tests__/admin-spread-route.test.ts`
Expected: FAIL（`overlayEmpty` が undefined）

- [ ] **Step 2: サーバーが overlayEmpty を返す**

`src/app/api/admin/spread/route.ts` の GET、`rows` を作る `map` の `return` を次にする:

```ts
    const { overlay, ...rest } = row
    // overlay そのものは返さない（重い・設問以外は画面が使わない）。「中身が入っているか」
    // だけを真偽で返す。投入だけして中身が空の行を「投入済」と描かないため
    // （実データに overlay が {} のまま公開待ちになっている行がある）。
    return { ...rest, quizzes: overlay?.quizzes ?? [], overlayEmpty: Object.keys(overlay ?? {}).length === 0 }
```

Run: `npx vitest run src/lib/__tests__/admin-spread-route.test.ts`
Expected: PASS

- [ ] **Step 3: 画面の型と取得を広げる**

`SpreadCard.tsx` の import に足す:

```ts
import { spreadProgress, type SpreadProgress } from '@/lib/spread-progress'
```

`type Row` に足す（既存の行の下）:

```ts
  // overlay が {}（投入だけで中身が無い）か。サーバーが真偽だけを返す。
  overlayEmpty?: boolean
  // 計画ノート（スプレッドノート_DB）があるか。null は判定できなかった。
  plan?: boolean | null
  // サブスクDBの制作ステータス。棚に無い記事は ''。
  productionStatus?: string
  // 制作ステータスが同期の門に掛かっている（公開しても読者に出ない）。
  withheld?: boolean
```

`type Row` の下に足す:

```ts
// 棚にあるのにスプレッドがまだ無い記事。一覧では reader_spreads の行と並べて出す。
type MissingRow = {
  page_id: string
  title: string
  productionStatus: string
  plan: boolean | null
  withheld: boolean
}

// 一覧の1行。row が null なら未投入（reader_spreads にまだ行が無い）。
type ListedRow = { row: Row | null; pageId: string; title: string | null; progress: SpreadProgress }
```

`const [rows, setRows] = useState<Row[] | null>(null)` の下に足す:

```ts
  const [missing, setMissing] = useState<MissingRow[]>([])
  // サブスクDBの一覧が引けなかった。未投入の行を出せていないことを画面に出す
  // （0件と見分けが付かないと「全部スプレッド化済み」に見える）。
  const [sourceListFailed, setSourceListFailed] = useState(false)
  // 完了した行を開いているか。既定は畳む。
  const [showDone, setShowDone] = useState(false)
```

`load` の `.then` と `.catch` を次にする:

```ts
      .then((d) => {
        if (!d.spreads) {
          // spreads が無いレスポンス（500のエラーJSON等）は「0件」ではなく読み込み失敗。
          setLoadFailed(true)
          setRows([])
          setMissing([])
          return
        }
        setRows(d.spreads)
        setMissing(d.missing ?? [])
        setSourceListFailed(d.sourceListFailed === true)
      })
      .catch(() => {
        setLoadFailed(true)
        setRows([])
        setMissing([])
      })
```

- [ ] **Step 4: 進み具合を1本の並びにする**

`existingRow` の `useMemo` の下に足す:

```ts
  // 一覧に出す行。reader_spreads の行と未投入の記事を、同じ「進み具合」の形にそろえる。
  // 判定は spreadProgress ひとつに通す（画面はその結果を描くだけ）。
  const listed: ListedRow[] = useMemo(() => {
    const fromRows = (rows ?? []).map((r) => ({
      row: r,
      pageId: r.page_id,
      title: r.title,
      progress: spreadProgress({
        onShelf: r.offShelf !== true,
        hasPlan: r.plan ?? null,
        overlayEmpty: r.overlayEmpty === true,
        quizzes: r.quizzes,
        status: r.status,
        withheld: r.withheld === true,
        stale: r.stale === true,
        productionStatus: r.productionStatus,
      }),
    }))
    const fromMissing = missing.map((m) => ({
      row: null,
      pageId: m.page_id,
      title: m.title,
      progress: spreadProgress({
        onShelf: true,
        hasPlan: m.plan,
        overlayEmpty: true,
        quizzes: [],
        status: '',
        withheld: m.withheld,
        stale: false,
        productionStatus: m.productionStatus,
      }),
    }))
    return [...fromRows, ...fromMissing]
  }, [rows, missing])

  // 未完了を上、完了は下に畳む。同じ記事名の別 page_id は両方出る（「棚にある」で見分ける）。
  const pending = listed.filter((x) => !x.progress.complete)
  const done = listed.filter((x) => x.progress.complete)
```

- [ ] **Step 5: ストリップを描く部品を足す**

`SpreadCard.tsx` の `failureMessage` の下（コンポーネントの外）に足す:

```tsx
// 6点のストリップ。済んだ点は塗り、残っている点は枠だけ、判定できなかった点は破線。
function ProgressStrip({ progress }: { progress: SpreadProgress }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {progress.steps.map((s) => (
        <span
          key={s.key}
          title={s.state === 'unknown' ? `${s.label}（判定できませんでした）` : s.label}
          className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] leading-none border ${
            s.state === 'done'
              ? 'bg-brand-100 text-brand-700 border-brand-200 dark:bg-brand-900/30 dark:text-brand-300 dark:border-brand-800/60'
              : s.state === 'unknown'
                ? 'border-dashed border-gray-300 text-gray-400 dark:border-gray-600 dark:text-gray-500'
                : 'border-gray-200 text-gray-400 dark:border-gray-700 dark:text-gray-500'
          }`}
        >
          {s.label}
        </span>
      ))}
    </span>
  )
}
```

- [ ] **Step 6: 一覧を組み替える**

`SpreadCard` の中（`return` の前）に、行を描くローカル関数を足す。既存の `<li>` の中身（記事名・公開中バッジ・棚に無いバッジ・原本が更新されていますバッジ・更新時刻・再生成・スプレッドを整える・公開・理解チェックのボタンとパネル）を**そのまま**この関数へ移し、記事名の `<span className="basis-full …">` の直後にストリップと次の一手の段を足す:

```tsx
  // 1行。busy・armed・run・reviewQuiz 等を閉じ込めて使うので、コンポーネントの中に置く。
  const renderRow = (item: ListedRow) => {
    const r = item.row
    const progress = item.progress
    // 未投入の記事。まだ reader_spreads に行が無いので、操作は投入窓へ送るだけ。
    if (!r) {
      return (
        <li key={item.pageId} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs py-1.5 border-b border-gray-50 dark:border-gray-700/50 last:border-0">
          <span className="basis-full flex items-baseline gap-2 min-w-0">
            <span className="font-semibold text-[13px] text-gray-800 dark:text-gray-100 truncate">{item.title || '（記事名なし）'}</span>
            <code className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0" title={item.pageId}>{item.pageId.slice(0, 8)}</code>
          </span>
          <span className="basis-full flex flex-wrap items-center gap-x-2 gap-y-1">
            <ProgressStrip progress={progress} />
            <span className="text-[11px] text-gray-600 dark:text-gray-300">{progress.next}</span>
          </span>
          <button
            type="button"
            onClick={() => setNewPageId(item.pageId)}
            className="inline-flex items-center gap-1.5 min-h-[44px] px-2.5 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
          >
            <FilePlus2 className="w-3.5 h-3.5" aria-hidden />
            この記事を投入窓に入れる
          </button>
        </li>
      )
    }
    // 既存の行。中身は今までのまま（ここに移す）＋ 1段目の下にストリップと次の一手。
    const published = r.status === 'published'
    const stale = r.stale === true
    const offShelf = r.offShelf === true
    const unreviewed = r.quizzes.filter((q) => !q.reviewed)
    const quizOpen = openQuiz.has(r.page_id)
    return (
      <li key={r.page_id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs py-1.5 border-b border-gray-50 dark:border-gray-700/50 last:border-0">
        {/* …記事名の span（既存のまま）… */}
        <span className="basis-full flex flex-wrap items-center gap-x-2 gap-y-1">
          <ProgressStrip progress={progress} />
          <span className="text-[11px] text-gray-600 dark:text-gray-300">{progress.next}</span>
        </span>
        {/* …公開中バッジ以降、既存の中身をそのまま… */}
      </li>
    )
  }
```

一覧の描画（`rows !== null && rows.length > 0 && (<ul>…</ul>)`）を次に置き換える:

```tsx
      {sourceListFailed && (
        <p className="text-xs mb-2 text-amber-700 dark:text-amber-300">
          <AlertTriangle className="w-3.5 h-3.5 inline-block mr-1 -mt-0.5" aria-hidden />
          サブスク用DBの一覧が引けませんでした。まだスプレッドが無い記事はこの一覧に出ていません。
        </p>
      )}

      {listed.length > 0 && (
        <>
          <ul className="space-y-2">{pending.map(renderRow)}</ul>
          {done.length > 0 && (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowDone((v) => !v)}
                aria-expanded={showDone}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
              >
                完了 {done.length}件を{showDone ? '畳む' : '開く'}
              </button>
              {showDone && <ul className="space-y-2 mt-2">{done.map(renderRow)}</ul>}
            </div>
          )}
        </>
      )}
```

「まだスプレッドはありません」の空表示の条件は `rows.length === 0` から `listed.length === 0` に変える（未投入の記事があるなら空ではない）。

- [ ] **Step 7: 型とビルドを確かめる**

```bash
npx tsc --noEmit && npm run build
```
Expected: 型エラーなし・ビルド成功

- [ ] **Step 8: コミット**

```bash
git add src/app/admin/SpreadCard.tsx src/app/api/admin/spread/route.ts src/lib/__tests__/admin-spread-route.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): スプレッドタブに6点のストリップと次の一手を出す

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Essentials の段階に「7 スプレッド公開」を足す

**Files:**
- Modify: `src/lib/essentials-admin.ts`
- Modify: `src/app/admin/EssentialsCard.tsx`
- Modify: `src/lib/__tests__/essentials-admin.test.ts`

**Interfaces:**
- Consumes: なし
- Produces: `ESSENTIALS_STAGES` に8つ目の `'7 スプレッド公開'`

**先に手で済ませること（コードではない）:** Notion の Essentials 制作DB「段階」の選択肢に **「7 スプレッド公開」を追加**する。**既存の選択肢を改名しない**（改名は削除＋新規作成になり、付いていたタグが黙って外れる。2026-09-03 に2回発生）。

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/essentials-admin.test.ts` に足す:

```ts
describe('段階の選択肢', () => {
  it('7 スプレッド公開 までの8段', () => {
    expect(ESSENTIALS_STAGES).toEqual([
      '0 未収集',
      '1 収集中',
      '2 収集済',
      '3 骨子済',
      '4 本文済',
      '5 層3済',
      '6 サブスク移行済',
      '7 スプレッド公開',
    ])
  })

  it('本文がある段階の判定は 4 本文済 以降のまま（7 も含む）', () => {
    expect(hasBody('4 本文済')).toBe(true)
    expect(hasBody('7 スプレッド公開')).toBe(true)
    expect(hasBody('3 骨子済')).toBe(false)
  })
})
```

（`hasBody` を import に足す）

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/essentials-admin.test.ts`
Expected: FAIL（8つ目が無い）

- [ ] **Step 3: 定数と色を足す**

`src/lib/essentials-admin.ts` の `ESSENTIALS_STAGES` を次にする:

```ts
export const ESSENTIALS_STAGES = [
  '0 未収集',
  '1 収集中',
  '2 収集済',
  '3 骨子済',
  '4 本文済',
  '5 層3済',
  '6 サブスク移行済',
  // 移行しただけでは読者に出ない（スプレッドを公開して制作ステータスを 7️⃣ に上げるまで）。
  // 工程の存在しない段階があると、完了に見えて届いていない本が生まれる（設計 2026-09-07）。
  '7 スプレッド公開',
] as const
```

`src/app/admin/EssentialsCard.tsx` の `STAGE_STYLE` を次にする。**青の濃淡は既存の6値をそのまま1段ずつ後ろへずらし、いちばん薄い側に1値だけ足す**（濃い側に足すと light の最終段が黒に近づいて段の差が読めなくなる）:

```ts
const STAGE_STYLE: Record<EssentialsStage, { stroke: string; bg: string }> = {
  '0 未収集': { stroke: 'stroke-gray-300 dark:stroke-gray-600', bg: 'bg-gray-300 dark:bg-gray-600' },
  '1 収集中': { stroke: 'stroke-[#b8d4f6] dark:stroke-[#0d3268]', bg: 'bg-[#b8d4f6] dark:bg-[#0d3268]' },
  '2 収集済': { stroke: 'stroke-[#86b6ef] dark:stroke-[#184f95]', bg: 'bg-[#86b6ef] dark:bg-[#184f95]' },
  '3 骨子済': { stroke: 'stroke-[#5598e7] dark:stroke-[#256abf]', bg: 'bg-[#5598e7] dark:bg-[#256abf]' },
  '4 本文済': { stroke: 'stroke-[#2a78d6] dark:stroke-[#3987e5]', bg: 'bg-[#2a78d6] dark:bg-[#3987e5]' },
  '5 層3済': { stroke: 'stroke-[#1c5cab] dark:stroke-[#6da7ec]', bg: 'bg-[#1c5cab] dark:bg-[#6da7ec]' },
  '6 サブスク移行済': { stroke: 'stroke-[#104281] dark:stroke-[#9ec5f4]', bg: 'bg-[#104281] dark:bg-[#9ec5f4]' },
  '7 スプレッド公開': { stroke: 'stroke-[#082448] dark:stroke-[#cde2fb]', bg: 'bg-[#082448] dark:bg-[#cde2fb]' },
}
```

> 足した2値（light `#b8d4f6` / dark `#0d3268`）は配色検証を通していない。**画面を見たオーナーが薄すぎると判断したら差し替える**（Task 7 の確認項目）。

- [ ] **Step 4: 注記を直す**

`EssentialsCard.tsx` の数字4つの節、`Stat label="サブスク移行済"` の行を次に置き換える:

```tsx
        <Stat label="サブスク移行済" value={overall.counts['6 サブスク移行済']} note="スプレッド待ち" />
        <Stat label="スプレッド公開" value={overall.counts['7 スプレッド公開']} note="読者に出ている" />
```

（4つ並びが5つになるので、同じ節の `grid-cols-2 sm:grid-cols-4` を `grid-cols-2 sm:grid-cols-3 lg:grid-cols-5` にする）

同ファイルの help 文（「段階は 0 未収集 → …」の行）の末尾に `→ 7 スプレッド公開` を足す。

- [ ] **Step 5: テストが通ることを確かめる**

Run: `npx vitest run src/lib/__tests__/essentials-admin.test.ts && npx tsc --noEmit`
Expected: PASS・型エラーなし（`stageCounts` の `Object.keys` を見る既存テストも8段になって通る）

- [ ] **Step 6: コミット**

```bash
git add src/lib/essentials-admin.ts src/app/admin/EssentialsCard.tsx src/lib/__tests__/essentials-admin.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): Essentials の段階に「7 スプレッド公開」を足す

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: 段階6のまま読者に出ている本に「段階を7に上げる」を出す

**Files:**
- Modify: `src/lib/essentials-admin.ts`
- Modify: `src/app/api/admin/essentials/route.ts`
- Modify: `src/app/admin/EssentialsCard.tsx`
- Modify: `src/lib/__tests__/essentials-admin.test.ts`
- Modify: `src/lib/__tests__/admin-essentials-route.test.ts`

**Interfaces:**
- Consumes: `isWithheldFromReaders`・`subscriptionRowOf`（Task 1・3 で使った形）
- Produces:
  - `normalizeSpreadTitle(title: string): string` — 先頭の絵文字・記号と、末尾の `Essentials` を落とした主題名
  - `spreadReadyTopicIds(topics: EssentialsTopic[], readyTitles: string[]): string[]` — 段階6のまま読者に出ている主題のID
  - `EssentialsPayload` の ready 分岐に `spreadReadyTopicIds: string[]`

- [ ] **Step 1: 失敗するテストを書く**

`src/lib/__tests__/essentials-admin.test.ts` に足す:

```ts
describe('スプレッドが読者に出ている主題', () => {
  const topic = (id: string, name: string, stage: string) =>
    mapTopicPage({ id, properties: { 名前: { title: [{ plain_text: name }] }, 段階: { select: { name: stage } } } })

  it('先頭の絵文字と末尾の Essentials を落として主題名にそろえる', () => {
    expect(normalizeSpreadTitle('📚 記事A Essentials')).toBe('記事A')
    expect(normalizeSpreadTitle('💡 記事B')).toBe('記事B')
    expect(normalizeSpreadTitle('  記事C  ')).toBe('記事C')
  })

  it('段階6のまま読者に出ている主題だけを返す', () => {
    const topics = [
      topic('a'.repeat(32), '記事A', '6 サブスク移行済'),
      topic('b'.repeat(32), '記事B', '6 サブスク移行済'),
      topic('c'.repeat(32), '記事C', '5 層3済'),
      topic('d'.repeat(32), '記事D', '7 スプレッド公開'),
    ]
    // 記事A・記事C・記事D のスプレッドは読者に出ている
    const ready = ['📚 記事A Essentials', '📚 記事C Essentials', '📚 記事D Essentials']
    expect(spreadReadyTopicIds(topics, ready)).toEqual(['a'.repeat(32)])
  })

  it('名前が一致しなければ促さない（部分一致で当てにいかない）', () => {
    const topics = [topic('a'.repeat(32), '呼吸不全', '6 サブスク移行済')]
    expect(spreadReadyTopicIds(topics, ['📚 急性呼吸不全 Essentials'])).toEqual([])
  })
})
```

（import に `normalizeSpreadTitle`・`spreadReadyTopicIds`・`mapTopicPage` を足す）

- [ ] **Step 2: 落ちることを確かめる**

Run: `npx vitest run src/lib/__tests__/essentials-admin.test.ts`
Expected: FAIL（関数が無い）

- [ ] **Step 3: 純関数を書く**

`src/lib/essentials-admin.ts` の「集計」節の末尾に足す:

```ts
// ---- Essentials とスプレッドの突合 ---------------------------------------------
//
// サブスクDBの記事は制作DBの主題を複製して作るので、両者のページIDは別物になる。
// 突き合わせられるのは名前だけ。サブスク側のタイトル（「📚 ○○ Essentials」）から
// 先頭の絵文字と末尾の Essentials を落として、主題名と完全一致で照合する。
// 部分一致にすると「呼吸不全」が「急性呼吸不全」を拾うため、当てにいかない。

export function normalizeSpreadTitle(title: string): string {
  return title
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/\s*Essentials\s*$/i, '')
    .trim()
}

/**
 * 段階が「6 サブスク移行済」のまま、スプレッドが読者に出ている主題のID。
 * 画面はこの主題の行に「段階を7に上げる」を出す（工程が終わっているのに段階が残っている）。
 */
export function spreadReadyTopicIds(topics: EssentialsTopic[], readyTitles: string[]): string[] {
  const ready = new Set(readyTitles.map(normalizeSpreadTitle))
  return topics
    .filter((t) => t.stage === '6 サブスク移行済' && ready.has(t.name.trim()))
    .map((t) => t.id)
}
```

- [ ] **Step 4: API が主題IDを返すようにする**

`src/app/api/admin/essentials/route.ts`:

import に足す:

```ts
import { createAdminClient } from '@/lib/supabase/server'
import { isWithheldFromReaders } from '@/lib/subscription-publish-gate'
import { subscriptionRowOf } from '@/lib/spread-progress'
import { spreadReadyTopicIds } from '@/lib/essentials-admin'
```

`EssentialsPayload` の ready 分岐に足す:

```ts
      // 段階6のまま、スプレッドが読者に出ている主題。画面が「段階を7に上げる」を出す。
      spreadReadyTopicIds: string[]
```

`body = { ready: true, … }` の直前に足す:

```ts
  // 読者に出ているスプレッドの記事名。サブスクDBの一覧（制作ステータス）と
  // reader_spreads（公開状態）の両方を見ないと「読者に出ている」は決まらない。
  // どちらかが引けなければ促さない（空配列）。誤って段階を上げさせないため。
  const topics = topicsRes.pages.map(mapTopicPage)
  let readyTitles: string[] = []
  const subDb = process.env.SUBSCRIPTION_MEDICAL_DB_ID
  if (subDb) {
    try {
      const admin = createAdminClient()
      const [{ data: spreadRows }, subRes] = await Promise.all([
        admin.from('reader_spreads').select('page_id').eq('status', 'published'),
        fetchNotionDatabase(subDb, token),
      ])
      if (subRes.ok && spreadRows) {
        const published = new Set((spreadRows as { page_id: string }[]).map((r) => r.page_id))
        readyTitles = subRes.pages
          .map(subscriptionRowOf)
          .filter((r) => published.has(r.pageId) && !isWithheldFromReaders(r.productionStatus))
          .map((r) => r.title)
      }
    } catch {
      // 促しが出ないだけ。Essentials タブ自体は出す。
      readyTitles = []
    }
  }
```

`body` を次にする:

```ts
  body = {
    ready: true,
    topics,
    sources: sourcesRes.pages.map(mapSourcePage),
    fetchedAt: new Date().toISOString(),
    topicsDbUrl: notionUrl(topicsDb),
    sourcesDbUrl: notionUrl(sourcesDb),
    spreadReadyTopicIds: spreadReadyTopicIds(topics, readyTitles),
  }
```

`src/lib/__tests__/admin-essentials-route.test.ts` に足す（既存の fetch スタブの流儀に合わせる。Supabase は `vi.mock('@/lib/supabase/server', …)` で `select().eq()` が `{ data: [] }` を返すだけにしておけば、促しは空になる）:

```ts
  it('スプレッドの情報が引けないときは促しを空で返す', async () => {
    // fetch は Notion の2DBだけを返すスタブ（既存の成功ケースと同じ）
    const res = await GET(req())
    const body = await res.json()
    expect(body.ready).toBe(true)
    expect(body.spreadReadyTopicIds).toEqual([])
  })
```

- [ ] **Step 5: 画面に促しを出す**

`EssentialsCard.tsx`:

- `EssentialsSection` の props と呼び出しに `spreadReadyTopicIds: string[]` を通し、`TopicTable` → `TopicRow` へ `nudge: boolean` として渡す（`new Set(spreadReadyTopicIds).has(t.id)`）。
- `TopicRow` の段階セルの下に足す:

```tsx
          {nudge && (
            <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800/60">
              段階を7に上げる
            </span>
          )}
```

- [ ] **Step 6: テストと型を確かめる**

Run: `npx vitest run src/lib/__tests__/essentials-admin.test.ts src/lib/__tests__/admin-essentials-route.test.ts && npx tsc --noEmit`
Expected: PASS・型エラーなし

- [ ] **Step 7: コミット**

```bash
git add src/lib/essentials-admin.ts src/app/api/admin/essentials/route.ts src/app/admin/EssentialsCard.tsx src/lib/__tests__/essentials-admin.test.ts src/lib/__tests__/admin-essentials-route.test.ts
git commit -m "$(cat <<'EOF'
feat(admin): 段階6のまま読者に出ている本に段階7への促しを出す

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: 実データで通して確かめる

**Files:** なし（確認だけ。直しが要ればそのタスクへ戻る）

- [ ] **Step 1: 全件のテストとビルド**

```bash
npm test && npx tsc --noEmit && npm run build
```
Expected: すべて成功。失敗した項目は名前を控えて直す（「たぶん無関係」で流さない）

- [ ] **Step 2: dev サーバで描画を確かめる**

`.claude/launch.json` の dev 設定で Browser pane を開き、`/admin` を出す。**管理者セッションが要るのでログインはオーナーが行う**。Claude は
- コンソールのエラー（`read_console_messages`）
- `/api/admin/spread?check=1` の応答（`read_network_requests`）が `spreads`・`missing`・`sourceListFailed` を含むこと
を確かめる。

- [ ] **Step 3: 実データとの一致を見る（2026-09-07 時点）**

- スプレッドタブが 28行（reader_spreads 6行＋未投入22行）で出ること
- 下書き・設問2問が未承認の 💡1件が「設問2問が未承認」と出ること
- 📚 の1件（制作ステータス 6️⃣）は、門が止めるのは 0️⃣〜3️⃣ だけなので「読者に出る」の点が立ち、公開済み・設問承認済みなので**完了**に畳まれること。ここで「読者に出ていない」と出たら `isWithheldFromReaders` の側を疑う
- 公開済みの2件（計画ノートが無い）が「計画あり」だけ空のまま**完了**に畳まれること
- Essentials タブの段階が8段で描かれ、段階6の1件に「段階を7に上げる」が出ること（📚の1件が公開済み・門を通っている場合）

- [ ] **Step 4: オーナーに見てもらう**

画面（ライト／ダーク両方）をオーナーが目視する。特に **Task 5 で足した薄い青2値**が読めるか。読めなければ値を差し替えて Task 5 のコミットに追加する。

- [ ] **Step 5: 締め**

`superpowers:finishing-a-development-branch` に従い、push・main へのマージの承認を取る。Notion の🎬プロジェクト_DB「MediNode アプリ開発」配下に、今回決めた2件の裁定（計画あり＝完了の条件から外す／未投入も全件出す）を残す。
