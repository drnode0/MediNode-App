// 「自分が作者に投げた疑問」の一覧（受付DBのうち自分の分だけ）の純ロジック。
//
// 端末ローカルの記録（cq-dispatch）だけだと端末を変えた時点で「送った」が消える。
// 受付DBには通知に同意した投稿の「通知先ユーザーID」が入っているので、それを鍵に
// 自分の投稿だけを引き直せる。
//
// 返すのは自分の投稿だけ。他人の投稿・投稿者メール・通知先IDは一切外に出さない。
// 通知に同意していない投稿はサーバー側に自分との紐付けが無く、ここには出ない
// （同意の線引きを機能のために広げない。その分は端末ローカルの記録が拾う）。
//
// このファイルは fetch も Notion クライアントも含まない純関数群（vitest対象）。
import type { NotionIntakePage } from './cq-board'
import { readIntakeColumns, type DeclineReason } from './ask-shelf/intake-columns'

// received  … 届いている（板には出ていない）
// onBoard   … 作者が板に出した。票が付きうる
// answered  … 作者が答えた
// closed    … 対応状態が入っているが解決ではない（取り下げ等）
export type MyStage = 'received' | 'onBoard' | 'answered' | 'closed'

export type MySubmission = {
  id: string
  question: string
  stage: MyStage
  createdAt: string
  // closed のとき、見送りの理由（無ければ空文字）。利用者向けの文言は declineMessage が作る。
  declineReason: DeclineReason | ''
}

type Prop = Record<string, unknown> | undefined

function propOf(page: NotionIntakePage, name: string): Prop {
  return (page.properties?.[name] as Record<string, unknown> | undefined) ?? undefined
}

function plainText(p: Prop, key: 'title' | 'rich_text'): string {
  const arr = p?.[key]
  if (!Array.isArray(arr)) return ''
  return arr
    .map((t) => String((t as { plain_text?: unknown })?.plain_text ?? ''))
    .join('')
    .trim()
}

function selectName(p: Prop): string {
  const sel = p?.select as { name?: unknown } | null | undefined
  return sel?.name ? String(sel.name) : ''
}

// 対応状態から段を決める。受付DBの実選択肢は「対応済み」「対応不要」の2つで、
// 答えが出たことを表すのは「対応済み」（admin-daily の RESOLVED_STATES と同じ語彙）。
// 「対応不要」や取り下げを「答えが出た」と言ってしまう方が、何も言わないより悪い。
export function stageOf(status: string, onBoard: boolean): MyStage {
  const trimmed = status.trim()
  if (trimmed === '対応済み' || trimmed.includes('解決')) return 'answered'
  if (trimmed) return 'closed'
  return onBoard ? 'onBoard' : 'received'
}

// 受付DBの行 → 自分の投稿。userId が一致する行だけを、必要な列だけ写して返す。
export function toMySubmissions(pages: NotionIntakePage[], userId: string): MySubmission[] {
  if (!userId) return []
  const out: MySubmission[] = []
  for (const page of pages) {
    if (plainText(propOf(page, '通知先ユーザーID'), 'rich_text') !== userId) continue
    const question = plainText(propOf(page, '疑問'), 'title')
    if (!question) continue
    out.push({
      id: page.id,
      question,
      stage: stageOf(selectName(propOf(page, '対応状態')), propOf(page, 'ボード公開')?.checkbox === true),
      createdAt: page.created_time || '',
      declineReason: readIntakeColumns(page).declineReason,
    })
  }
  return out
}
