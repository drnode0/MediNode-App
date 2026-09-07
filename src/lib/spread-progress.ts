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
