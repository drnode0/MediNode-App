// 初回ログイン時のウェルカムメール送信。
//
// POST /api/welcome
//   - 認証: Supabaseセッション（Cookie）。未ログインは 401。
//   - 送信済み判定: auth の user_metadata.welcome_sent_at（DBマイグレーション不要）。
//   - 送信: Resend REST API（SDK依存なし）。
//
// 必要な環境変数（両方揃わなければ何もしない no-op。既存環境を壊さない）:
//   - RESEND_API_KEY ... Resend のAPIキー（re_...）
//   - RESEND_FROM    ... 送信元（例: "MediNode <hello@yourdomain.com>"。Resendで
//                        ドメイン認証済みのアドレスであること）
//
// クライアント（PremiumSync）がログイン確認後に fire-and-forget で叩く。
// 二重送信防止のため「先にフラグを立ててから送る」（送信失敗より二重送信の方が体験が悪い）。

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

const APP_URL = 'https://medical-search-public.vercel.app'
const GUIDE_URL = 'https://foregoing-feta-45b.notion.site/MediNode-378fd756737081a2bc23f1acb5f3a4bc'

function welcomeHtml(): string {
  return `
<div style="font-family: -apple-system, 'Hiragino Sans', sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937; line-height: 1.8;">
  <h2 style="color: #2563eb;">MediNode へようこそ 🎉</h2>
  <p>ご登録ありがとうございます。MediNode は、Notion に貯めた医療知識をスマホから即座に検索・復習できるアプリです。</p>
  <p style="margin: 20px 0;">
    <a href="${APP_URL}" style="background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: bold;">アプリを開く</a>
  </p>
  <p><b>最初の3ステップ</b></p>
  <ol>
    <li>ホーム画面にアプリを追加（PWA）— 通勤中・当直中もワンタップで起動</li>
    <li>Notion データベースを接続 — <a href="${GUIDE_URL}">セットアップガイド</a>の手順どおりでOK</li>
    <li>検索してみる — タイトルだけでなく要約・キーワードからもヒットします</li>
  </ol>
  <p style="font-size: 13px; color: #6b7280;">ログインすると設定は暗号化のうえ同期され、別の端末でもログインするだけで復元されます。<br/>ご不明点は設定パネル内のサポートフォームからお気軽にどうぞ。</p>
  <p style="font-size: 12px; color: #9ca3af;">— MediNode</p>
</div>`.trim()
}

export async function POST() {
  const apiKey = process.env.RESEND_API_KEY
  const from = process.env.RESEND_FROM
  // 未設定環境では静かに何もしない（機能フラグを兼ねる）。
  if (!apiKey || !from) {
    return NextResponse.json({ ok: false, reason: 'not_configured' })
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, reason: 'supabase_not_configured' })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 })
  }

  // 送信済みならスキップ。
  if (user.user_metadata?.welcome_sent_at) {
    return NextResponse.json({ ok: true, already: true })
  }

  const admin = createAdminClient()

  // 先にフラグを立てる（多タブ同時アクセス等での二重送信をほぼ防ぐ。
  // フラグ更新後の送信失敗は best-effort として許容する）。
  const { error: flagErr } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { ...user.user_metadata, welcome_sent_at: new Date().toISOString() },
  })
  if (flagErr) {
    return NextResponse.json({ ok: false, reason: 'flag_update_failed' }, { status: 500 })
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [user.email],
        subject: 'MediNode へようこそ 🎉 最初の3ステップ',
        html: welcomeHtml(),
      }),
    })
    if (!res.ok) {
      const body = await res.text()
      console.error('welcome: Resend送信失敗:', res.status, body.slice(0, 200))
      return NextResponse.json({ ok: false, reason: 'send_failed' }, { status: 502 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('welcome: Resend送信エラー:', err instanceof Error ? err.message : err)
    return NextResponse.json({ ok: false, reason: 'send_failed' }, { status: 502 })
  }
}
