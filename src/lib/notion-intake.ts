// 受付DB（CQ_INTAKE_DB_ID）の読み書き。/admin の「聞ける棚」パネル専用の入出力。
//
// Notion クライアントの作り方は既存の cq/board・cq/submit と同じ
// （CQ_INTAKE_NOTION_TOKEN・CQ_INTAKE_DB_ID）。ここではこの2つだけを切り出す。
//   listIntakePages()      … 未対応（対応状態が空）の依頼を新しい順で返す
//   listAllIntakePages()   … 対応状態を問わず全件を新しい順で返す（月5件の上限を数えるため）
//   getIntakePage(id)      … 受付DBの1ページを1件だけ読む（着地画面用）
//   updateIntakePage(id, props) … 受付DBの1ページへプロパティを書き戻す
//
// 書き込みは buildIntakeShelfProperties（src/lib/ask-shelf/intake-columns.ts）と同じ約束を守る:
// 受付DBに無い列・型が違う列には積まない。加えてこのファイルだけの約束として、
// 「対応状態」と「正本主張ID」／「対応状態」と「見送りの理由」は同時に書く組み合わせなので、
// 片方だけが列不足で落ちる場合は両方とも書かない（中途半端な状態を作らない。継ぎ目5）。

import { Client } from '@notionhq/client'
import type { NotionIntakePage } from './cq-board'

function intakeEnv(): { token: string; dbId: string } | null {
  const token = process.env.CQ_INTAKE_NOTION_TOKEN || ''
  const dbId = process.env.CQ_INTAKE_DB_ID || ''
  if (!token || !dbId) return null
  return { token, dbId }
}

// 未対応（対応状態が空）の依頼を新しい順で返す。/admin の一覧はこれをそのまま使う
// （「一覧は受付DBの未対応を新しい順」という画面の決まりを、この関数の側で満たす）。
export async function listIntakePages(): Promise<NotionIntakePage[]> {
  const env = intakeEnv()
  if (!env) return []
  const notion = new Client({ auth: env.token })
  const res = await notion.databases.query({
    database_id: env.dbId,
    filter: { property: '対応状態', select: { is_empty: true } },
    sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    page_size: 100,
  })
  return res.results as unknown as NotionIntakePage[]
}

// 対応状態を問わず全件を新しい順で返す（月5件の上限は「まだ未対応か」ではなく
// 「今月ぶん送ったか」を数えるため、対応済み・見送り済みも含めて全部見る必要がある）。
// page_size は既存の QUERY_LIMIT（cq/board・cron）と同じ100件に揃える。
// このアプリの現在の投稿量では十分で、ページングは組まない。
export async function listAllIntakePages(): Promise<NotionIntakePage[]> {
  const env = intakeEnv()
  if (!env) return []
  const notion = new Client({ auth: env.token })
  const res = await notion.databases.query({
    database_id: env.dbId,
    sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    page_size: 100,
  })
  return res.results as unknown as NotionIntakePage[]
}

// 受付DBの1ページを1件だけ読む（回答の着地画面 /cq/answered/[id] 用）。
// 「本人だけが開ける」の判定はこの関数の外（呼び出し側）が担う。ここは単なる取得。
// 存在しない・アーカイブ済みページは Notion SDK が例外を投げるので null に落とす。
// 本人以外にも1文字も返さない、という慎重な扱いに合わせ、失敗は「見つからない」と同じに扱う。
export async function getIntakePage(id: string): Promise<NotionIntakePage | null> {
  const env = intakeEnv()
  if (!env) return null
  const notion = new Client({ auth: env.token })
  try {
    const page = await notion.pages.retrieve({ page_id: id })
    return page as unknown as NotionIntakePage
  } catch {
    return null
  }
}

type NotionPropSchema = Record<string, { type?: string } | undefined>

// 値オブジェクトの形からNotionのプロパティ型を当てる（rich_text/select/checkbox/multi_select/title）。
function propTypeOf(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  for (const t of ['select', 'rich_text', 'checkbox', 'multi_select', 'title'] as const) {
    if (t in (value as Record<string, unknown>)) return t
  }
  return null
}

// 通知の合図として同時に書く組み合わせ。片方だけが列不足で落ちるくらいなら、
// どちらも書かない方が安全（対応済みなのに正本主張IDが無い、を作らない）。
const JOINT_PAIRS: Array<[string, string]> = [
  ['正本主張ID', '対応状態'],
  ['見送りの理由', '対応状態'],
]

export async function updateIntakePage(id: string, props: Record<string, unknown>): Promise<void> {
  const env = intakeEnv()
  if (!env) throw new Error('受付DBの設定（CQ_INTAKE_NOTION_TOKEN・CQ_INTAKE_DB_ID）がありません')
  const notion = new Client({ auth: env.token })

  // スキーマを見て、存在する列・同じ型の列にだけ積む（buildIntakeShelfProperties と同じ約束）。
  // スキーマ自体が引けない場合は、確認できないまま書くよりは何もしない方が安全。
  let schema: NotionPropSchema
  try {
    const db = await notion.databases.retrieve({ database_id: env.dbId })
    schema = ((db as unknown as { properties?: NotionPropSchema }).properties) ?? {}
  } catch {
    return
  }

  const filtered: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(props)) {
    const expected = propTypeOf(value)
    if (expected && schema[name]?.type === expected) filtered[name] = value
  }

  for (const [a, b] of JOINT_PAIRS) {
    const intended = a in props && b in props
    if (!intended) continue
    const bothSurvived = a in filtered && b in filtered
    if (!bothSurvived) {
      // 片方だけ書ける状態。通知の合図が壊れるので両方見送る。
      delete filtered[a]
      delete filtered[b]
    }
  }

  if (Object.keys(filtered).length === 0) return
  await notion.pages.update({
    page_id: id,
    properties: filtered as Parameters<typeof notion.pages.update>[0]['properties'],
  })
}
