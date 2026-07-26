import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireAdminSession } from '@/lib/api-guard'

/**
 * 管理者専用：メール配信（Resend）の疎通テスト。
 *
 * POST /api/admin/email-test
 *   - 認証: COMP_ADMIN_EMAILS の管理者のみ（requireAdminSession）。
 *   - 動作: ログイン中の管理者「自分自身」宛にテストメールを1通送る。他ユーザーには一切送らない。
 *   - 返り値: RESEND設定の有無・Resendのステータス/エラー詳細を返し、原因切り分けに使う。
 *
 * 体験終了メール（/api/cron/trial-lifecycle）と同じ Resend 経路なので、これが届けば終了メールも届く。
 */
export async function POST() {
  const guard = await requireAdminSession()
  if (guard) return guard

  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM
  const configured = { apiKey: !!apiKey, from: !!from }
  if (!apiKey || !from) {
    // env未設定＝そもそもアプリからメールが一切飛んでいない状態。
    return NextResponse.json({ ok: false, reason: 'not_configured', configured })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const to = user?.email
  if (!to) {
    return NextResponse.json({ ok: false, reason: 'no_email', configured }, { status: 400 })
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from,
        to: [to],
        subject: 'MediNode メール配信テスト',
        html:
          `<div style="font-family:-apple-system,'Hiragino Sans',sans-serif;line-height:1.8;color:#1f2937">` +
          `これは管理者用のメール配信テストです。<br>この文面が届いていれば、Resend からのメール送信（体験終了メールを含む）は正常に動いています。` +
          `<p style="font-size:12px;color:#9ca3af">— MediNode</p></div>`,
      }),
    })
    const detail = (await res.text()).slice(0, 300)
    if (!res.ok) {
      // ドメイン未認証・From不正などは Resend が具体的な理由を返すので、そのまま渡す。
      return NextResponse.json(
        { ok: false, reason: 'send_failed', configured, resendStatus: res.status, detail },
        { status: 502 },
      )
    }
    return NextResponse.json({ ok: true, configured, resendStatus: res.status, to })
  } catch (err) {
    return NextResponse.json(
      { ok: false, reason: 'send_error', configured, detail: err instanceof Error ? err.message : String(err) },
      { status: 502 },
    )
  }
}
