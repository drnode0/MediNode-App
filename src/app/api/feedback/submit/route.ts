// アプリ内フィードバック（バグ・要望・感想）→ 作者の継続フィードバック_DB。
//
// これまでの外部Notionフォームと同じ受付DBにページを作る（作者のトリアージ運用は
// 変えない）。書き込みはサーバー専用の作者トークンで行い、クライアントには渡さない。
//
// env（サーバー専用）:
//   FEEDBACK_NOTION_TOKEN … 受付DBに書き込めるIntegrationトークン
//   FEEDBACK_DB_ID        … 受付DBのID
// 両方が設定されるまで available:false ＝ クライアントは従来の外部フォームへ
// フォールバックする（環境変数だけで段階公開できる）。
//
// ログインは必須にしない。REQUIRE_LOGIN=true でもセットアップ中は未ログインで
// 通る導線があり、そこで詰まった人こそ報告したい人だから。未ログインは
// IP単位のレート制限だけで守る（cq/submit と同じ流儀）。

import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { createClient } from '@/lib/supabase/server'
import { rateLimitAsync, clientIp } from '@/lib/rate-limit'
import {
  validateFeedback,
  buildFeedbackProperties,
  formatAutoContext,
  redactPath,
  type FeedbackPropSchema,
} from '@/lib/feedback-submit'

export const dynamic = 'force-dynamic'

function feedbackEnv(): { token: string; dbId: string } | null {
  const token = process.env.FEEDBACK_NOTION_TOKEN || ''
  const dbId = process.env.FEEDBACK_DB_ID || ''
  if (!token || !dbId) return null
  return { token, dbId }
}

// クライアントがモーダルを開くときの事前確認（受付の準備ができているかだけ）。
export async function GET() {
  return NextResponse.json({ available: !!feedbackEnv() })
}

export async function POST(req: NextRequest) {
  const env = feedbackEnv()
  if (!env) {
    return NextResponse.json(
      { error: 'アプリ内での送信は現在準備中です。お手数ですがフォームをご利用ください。', code: 'not_configured' },
      { status: 503 },
    )
  }

  // ログイン済みなら本人の user_id / メールを使えるようにする（未ログインでも送れる）。
  let userId: string | null = null
  let sessionEmail = ''
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id ?? null
    sessionEmail = user?.email ?? ''
  } catch {
    // Supabase未設定・セッション取得不可でも、フィードバック自体は受け付ける。
  }

  // 連投・スパムを抑える。誠実な利用（1日数件）は妨げない。
  const DAY_MS = 24 * 60 * 60_000
  const key = userId ? `feedback:${userId}` : `feedback-ip:${clientIp(req)}`
  const limit = userId ? 10 : 5
  if (!(await rateLimitAsync(key, limit, DAY_MS))) {
    return NextResponse.json(
      { error: '本日の送信上限に達しました。明日また送ってください。' },
      { status: 429 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'リクエストの形式が不正です。' }, { status: 400 })
  }
  const raw = (body ?? {}) as Record<string, unknown>

  // 返信希望でメール未入力なら、ログイン中のメールを使う（打たせない）。
  if (raw.replyWanted === true && !raw.email && sessionEmail) raw.email = sessionEmail

  const validated = validateFeedback(raw)
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  // 自動収集する状況。クライアントの申告値をそのまま信じず、ここで形を整える。
  // パスはクエリを落とす（利用者の検索語を受付DBに残さない）。
  const ctxIn = (raw.context ?? {}) as Record<string, unknown>
  const errors = Array.isArray(ctxIn.errors)
    ? (ctxIn.errors as unknown[]).slice(0, 5).map((e) => String(e).slice(0, 200))
    : []
  const autoContext = formatAutoContext({
    screen: String(ctxIn.screen ?? '').slice(0, 40),
    searchMode: String(ctxIn.searchMode ?? '').slice(0, 20),
    membership: String(ctxIn.membership ?? '').slice(0, 20),
    appVersion: String(ctxIn.appVersion ?? '').slice(0, 40),
    device: String(ctxIn.device ?? '').slice(0, 80),
    errors,
  })
  const path = redactPath(String(ctxIn.path ?? ''))
  const contextText = [autoContext, path && `パス: ${path}`, userId && `ユーザーID: ${userId}`]
    .filter(Boolean)
    .join('\n')

  try {
    const notion = new Client({ auth: env.token })

    // 受付DBのスキーマを見て、存在する列にだけ値を積む（列が無くても送信は成立する）。
    const db = await notion.databases.retrieve({ database_id: env.dbId })
    const schema = ((db as unknown as Record<string, unknown>).properties || {}) as FeedbackPropSchema

    const built = buildFeedbackProperties(schema, validated.value, contextText)
    if ('error' in built) {
      return NextResponse.json({ error: built.error }, { status: 500 })
    }

    await notion.pages.create({
      parent: { database_id: env.dbId },
      properties: built.properties as Parameters<typeof notion.pages.create>[0]['properties'],
    })

    return NextResponse.json({ ok: true })
  } catch {
    // 作者側の設定・Notion障害は利用者に対処のしようがない。生エラーは出さず、
    // 外部フォームという逃げ道がある旨だけ返す。
    return NextResponse.json(
      { error: '送信を受け付けられませんでした。時間をおいて再度お試しいただくか、フォームをご利用ください。' },
      { status: 500 },
    )
  }
}
