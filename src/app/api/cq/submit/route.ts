import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { resolveRequestPremium } from '@/lib/premium-access'
import { rateLimitAsync, clientIp } from '@/lib/rate-limit'
import { validateCqSubmission, buildIntakeProperties, type IntakePropSchema } from '@/lib/cq-submit'
import { createAdminClient, createClient } from '@/lib/supabase/server'
import { isAdminEmail } from '@/lib/maintenance'
import { logCqSubmission } from '@/lib/cq-submission-log'

// プレミアムへの臨床疑問投稿（アプリ内フォーム → 作者の受付DB）。
//
// これまでの外部Notionフォームと同じ受付DBにページを作る（作者のトリアージ運用は
// 変えない）。書き込みはサーバー専用の作者トークンで行い、クライアントには一切渡さない。
//
// env（サーバー専用）:
//   CQ_INTAKE_NOTION_TOKEN … 受付DBに書き込めるIntegrationトークン
//   CQ_INTAKE_DB_ID        … 受付DBのID
// 両方が設定されるまで available:false ＝ クライアントは従来の外部フォームへ
// フォールバックする（環境変数だけで段階公開できる）。

function intakeEnv(): { token: string; dbId: string } | null {
  const token = process.env.CQ_INTAKE_NOTION_TOKEN || ''
  const dbId = process.env.CQ_INTAKE_DB_ID || ''
  if (!token || !dbId) return null
  return { token, dbId }
}

// クライアントがモーダルを開くときの事前確認。受付の準備ができているかだけを返す
// （会員判定はしない: 未設定なら誰にとっても外部フォームの案内に切り替わる）。
// 受付可否と、叩いた人が作者かどうか。
// owner のときクライアントは届け先を受付DBだけに固定する（作者の疑問は
// 個人のMy Medical DBではなくサブスクの制作キューへ流す、という運用のため）。
export async function GET() {
  let email: string | null = null
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    email = user?.email ?? null
  } catch {}
  return NextResponse.json({ available: !!intakeEnv(), owner: isAdminEmail(email) })
}

export async function POST(req: NextRequest) {
  const env = intakeEnv()
  if (!env) {
    return NextResponse.json(
      { error: 'アプリ内での投稿は現在準備中です。お手数ですが投稿フォームをご利用ください。', code: 'not_configured' },
      { status: 503 },
    )
  }

  // 会員判定。未ログインとプレミアム未加入は区別して返す（クライアントの案内を変えるため）。
  const { premium, userId } = await resolveRequestPremium()
  if (!userId) {
    return NextResponse.json(
      { error: '投稿にはログインが必要です。', code: 'login_required' },
      { status: 401 },
    )
  }
  if (!premium) {
    return NextResponse.json(
      { error: '臨床疑問の投稿はプレミアム会員の機能です。', code: 'premium_required' },
      { status: 403 },
    )
  }

  // 書き込み系のレート制限。誠実な利用（1日数件）は妨げず、連投・スパムだけを抑える。
  const DAY_MS = 24 * 60 * 60_000
  if (!(await rateLimitAsync(`cq-submit:${userId}`, 5, DAY_MS))) {
    return NextResponse.json(
      { error: '本日の投稿上限（5件）に達しました。明日また投稿してください。' },
      { status: 429 },
    )
  }
  if (!(await rateLimitAsync(`cq-submit-ip:${clientIp(req)}`, 20, DAY_MS))) {
    return NextResponse.json(
      { error: '短時間に投稿が集中しています。少し待ってから再度お試しください。' },
      { status: 429 },
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'リクエストの形式が不正です。' }, { status: 400 })
  }

  const validated = validateCqSubmission((body ?? {}) as Record<string, unknown>)
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 })
  }

  try {
    const notion = new Client({ auth: env.token })

    // 受付DBのスキーマを見て、存在するプロパティにだけ値を積む（列が無くても
    // タイトル＝疑問文さえ残れば受付は成立する。作者がDBに列を足せば自動で載る）。
    const db = await notion.databases.retrieve({ database_id: env.dbId })
    const schema = ((db as unknown as Record<string, unknown>).properties || {}) as IntakePropSchema

    const built = buildIntakeProperties(schema, validated.value, validated.value.notify ? userId : null)
    if ('error' in built) {
      return NextResponse.json({ error: built.error }, { status: 500 })
    }

    // 作者自身の投稿は、既定で板に出す（＝/cq の「みんなが待っている問い」に並び、
    // 会員が「気になる」を押せる）。作者の疑問はサブスクの制作キューそのものなので、
    // 1件ずつNotionでチェックを入れさせない。出したくない分はNotion側で外す。
    let ownerSubmission = false
    try {
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      ownerSubmission = isAdminEmail(user?.email ?? null)
    } catch {}
    if (ownerSubmission && schema['ボード公開']?.type === 'checkbox') {
      ;(built.properties as Record<string, unknown>)['ボード公開'] = { checkbox: true }
    }

    const created = await notion.pages.create({
      parent: { database_id: env.dbId },
      properties: built.properties as Parameters<typeof notion.pages.create>[0]['properties'],
    })

    // 管理用記録（best-effort）。createAdminClient は env 不足で throw しうるので中で握る。
    try {
      await logCqSubmission(createAdminClient(), {
        userId,
        notionPageId: (created as { id?: string }).id ?? null,
        value: validated.value,
      })
    } catch {
      // 記録できなくても投稿は成立している。
    }

    return NextResponse.json({ ok: true })
  } catch {
    // 作者側の設定・Notion障害はユーザーに対処のしようがない。生エラーは出さず、
    // 外部フォームという逃げ道がある旨だけ返す。
    return NextResponse.json(
      { error: '投稿を受け付けられませんでした。時間をおいて再度お試しいただくか、投稿フォームをご利用ください。' },
      { status: 500 },
    )
  }
}
