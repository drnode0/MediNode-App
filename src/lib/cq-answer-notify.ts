// 投稿した臨床疑問に答えが出たときのメール通知（cron cq-answer-notify）の純ロジック。
//
// 受付DBで対応状態が「対応済み」になった行のうち、通知に同意した投稿
// （通知先ユーザーIDあり）だけを対象にする。誰にどのページを通知したかは
// trial-lifecycle と同じく auth の user_metadata に残す（DBマイグレーション不要・
// ページ単位の map なので同じ回答を二度送らない）。
//
// このファイルは fetch も Notion クライアントも含まない純関数群（vitest対象）。
import type { NotionIntakePage } from './cq-board'
import { toMySubmissions } from './cq-mine'
import { APP_URL } from './trial-end-content'

// user_metadata 内の記録キー。値は { [受付DBページID]: 通知日時ISO } の map。
export const CQ_ANSWER_NOTIFIED_META_KEY = 'cq_answer_notified'

export type AnswerNotification = {
  pageId: string
  userId: string
  question: string
}

function plainText(prop: Record<string, unknown> | undefined, key: 'rich_text' | 'title'): string {
  const arr = prop?.[key] as Array<{ plain_text?: unknown }> | undefined
  if (!Array.isArray(arr)) return ''
  return arr.map((t) => (t?.plain_text ? String(t.plain_text) : '')).join('')
}

// 受付DBの行 → 通知対象（対応済み・通知同意あり・疑問文あり）。
export function answeredNotifications(pages: NotionIntakePage[]): AnswerNotification[] {
  const out: AnswerNotification[] = []
  for (const page of pages) {
    const userId = plainText(
      page.properties?.['通知先ユーザーID'] as Record<string, unknown> | undefined,
      'rich_text',
    )
    if (!userId) continue
    // stage 判定は cq-mine と同じ実装を通す（answered の定義を二重に持たない）。
    const [mine] = toMySubmissions([page], userId)
    if (!mine || mine.stage !== 'answered') continue
    out.push({ pageId: page.id, userId, question: mine.question })
  }
  return out
}

// 記録済み（user_metadata の map にページIDがある）ものを除く。
export function filterUnnotified(
  items: AnswerNotification[],
  meta: Record<string, unknown>,
): AnswerNotification[] {
  const raw = meta[CQ_ANSWER_NOTIFIED_META_KEY]
  const notified = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return items.filter((i) => !(i.pageId in notified))
}

// 通知に成功したページを map へ追記した新しい user_metadata を返す。
export function markNotified(
  meta: Record<string, unknown>,
  pageIds: string[],
  whenIso: string,
): Record<string, unknown> {
  const raw = meta[CQ_ANSWER_NOTIFIED_META_KEY]
  const notified = raw && typeof raw === 'object' ? { ...(raw as Record<string, string>) } : {}
  for (const id of pageIds) notified[id] = whenIso
  return { ...meta, [CQ_ANSWER_NOTIFIED_META_KEY]: notified }
}

// 通知メールの件名と本文。文面は 2026-08-14 の手動フォローメールと同じ調子に揃える。
export function answerNoticeEmail(questions: string[]): { subject: string; text: string } {
  if (questions.length === 0) throw new Error('通知する疑問がありません')
  const body =
    questions.length === 1
      ? `「${questions[0]}」に回答がつきました。アプリからご確認いただけます。`
      : ['以下の疑問に回答がつきました。アプリからご確認いただけます。', ...questions.map((q) => `・「${q}」`)].join('\n')
  return {
    subject: 'MediNodeへご投稿いただいた臨床疑問に回答がつきました',
    text: [
      'MediNodeへ臨床疑問をご投稿いただき、ありがとうございました。',
      '',
      body,
      APP_URL,
      '',
      '---',
      'MediNode　Dr.ノード',
    ].join('\n'),
  }
}
