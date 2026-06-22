// comp（無料解放）付与時のオーナー通知＆棚卸し台帳への記録。
//
// 目的:
//   - 招待コードで誰かが無期限プレミアム（comp）を取得したら、オーナーに気づける。
//   - 「誰に・いつ・どのコードで」を Notion ログDBに残し、棚卸し（一覧確認）できるようにする。
//
// 設計方針:
//   - すべて best-effort。通知やログ記録が失敗しても comp 付与自体は成功扱いにする
//     （ここで throw すると、ユーザーは解放されたのに 500 になってしまうため）。
//   - 環境変数が未設定なら、その経路は黙ってスキップする（任意機能）。
//
// 必要な環境変数（いずれも任意。設定された経路だけ動く）:
//   メール通知（Resend HTTP API）:
//     - RESEND_API_KEY    ... Resend の API キー
//     - COMP_NOTIFY_TO    ... 通知先（オーナー）メール
//     - COMP_NOTIFY_FROM  ... 送信元（例: noreply@drnode0.com。検証済みドメイン）
//   Notion 台帳:
//     - NOTION_TOKEN          ... Notion インテグレーショントークン（既存）
//     - COMP_NOTIFY_NOTION_DB ... comp付与を記録する Notion データベースID

import { notion } from '@/lib/notion'

export type CompGrantInfo = {
  userId: string
  email: string | null
  code: string // 入力された招待コード（正規化後）
}

// Resend でオーナーへメール通知（best-effort）。
async function sendOwnerEmail(info: CompGrantInfo): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  const to = process.env.COMP_NOTIFY_TO
  const from = process.env.COMP_NOTIFY_FROM
  if (!apiKey || !to || !from) return // 未設定ならスキップ

  const when = new Date().toISOString()
  const subject = 'MediNode: 招待コードで無料解放（comp）が付与されました'
  const text = [
    '招待コードによる無料解放（comp）が行われました。',
    '',
    `ユーザーID: ${info.userId}`,
    `メール: ${info.email ?? '(不明)'}`,
    `使用コード: ${info.code}`,
    `日時(UTC): ${when}`,
    '',
    '※ 取り消す場合は revoke API もしくは Supabase の subscriptions テーブルで status=canceled に。',
  ].join('\n')

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from, to, subject, text }),
    })
  } catch {
    // 通知失敗は無視（comp付与は継続）。
  }
}

// Notion ログDBへ1行追記（棚卸し台帳）（best-effort）。
async function appendNotionLog(info: CompGrantInfo): Promise<void> {
  const dbId = process.env.COMP_NOTIFY_NOTION_DB
  if (!dbId || !process.env.NOTION_TOKEN) return // 未設定ならスキップ

  const when = new Date().toISOString()
  // タイトル列名は環境によって異なるため「名前」を想定しつつ、
  // 失敗してもログ自体は best-effort なので握りつぶす。
  try {
    await notion.pages.create({
      parent: { database_id: dbId },
      properties: {
        名前: {
          title: [{ text: { content: info.email ?? info.userId } }],
        },
        メール: {
          rich_text: [{ text: { content: info.email ?? '' } }],
        },
        ユーザーID: {
          rich_text: [{ text: { content: info.userId } }],
        },
        使用コード: {
          rich_text: [{ text: { content: info.code } }],
        },
        付与日時: {
          date: { start: when },
        },
        状態: {
          rich_text: [{ text: { content: 'active' } }],
        },
      },
    } as Parameters<typeof notion.pages.create>[0])
  } catch {
    // 列名不一致などは無視（メール通知が主、台帳は補助）。
  }
}

// comp付与時に呼ぶ。メール通知とNotion台帳記録を並行で実行（どちらも失敗を握りつぶす）。
export async function notifyCompGranted(info: CompGrantInfo): Promise<void> {
  await Promise.allSettled([sendOwnerEmail(info), appendNotionLog(info)])
}
