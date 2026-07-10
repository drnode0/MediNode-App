// 設定の端末間同期（SettingsSync）API。
// ログイン中ユーザーの全 AppSettings を暗号化してサーバー保存し、別端末で復元できるようにする。
//
// GET  /api/user-settings
//   - 認証: Supabaseセッション（Cookie）。未ログインなら { loggedIn:false }。
//   - 戻り: { loggedIn:true, settings, updatedAt } / 行なしは { loggedIn:true, settings:null }
// POST /api/user-settings
//   - body: AppSettings（JSON）。暗号化して service_role で upsert（updated_at=now()）。
//   - 未ログインは 401。
//
// 機密（Notion Token / Algolia キー）を含むため、DB には AES-256-GCM 暗号化文字列のみを置く。
// 暗号鍵 SETTINGS_ENC_KEY はサーバー内（このAPI）だけで使い、クライアントへは出さない。

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { encryptSettings, decryptSettingsDetailed, isCryptoReady } from '@/lib/crypto'

function supabaseReady(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export async function GET() {
  if (!supabaseReady()) {
    return NextResponse.json({ loggedIn: false, reason: 'supabase_not_configured' })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ loggedIn: false })
  }

  // 暗号鍵が無い環境では復号できないため、設定なし扱いで返す（既存ローカル設定は壊さない）。
  if (!isCryptoReady()) {
    return NextResponse.json({ loggedIn: true, settings: null, reason: 'enc_key_not_configured' })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('user_settings')
    .select('settings_enc, updated_at')
    .eq('user_id', user.id)
    .maybeSingle()

  if (error || !data || !data.settings_enc) {
    return NextResponse.json({ loggedIn: true, settings: null })
  }

  try {
    const { json, needsReencrypt } = decryptSettingsDetailed(data.settings_enc)
    const settings = JSON.parse(json)

    // 鍵ローテーションの遅延移行: 旧鍵・旧形式で復号できた行は、この場で現行鍵の
    // v2形式に暗号化し直して保存する（best-effort。失敗しても読み取りは成功させる）。
    // 全ユーザーが次回アクセスで自動移行するため、user_settings の全消しが不要になる。
    if (needsReencrypt) {
      try {
        const { error: reencErr } = await admin
          .from('user_settings')
          .update({ settings_enc: encryptSettings(json) })
          .eq('user_id', user.id)
        if (reencErr) console.error('user-settings: 再暗号化保存に失敗:', reencErr.message)
      } catch (e) {
        console.error('user-settings: 再暗号化に失敗:', e instanceof Error ? e.message : e)
      }
    }

    return NextResponse.json({ loggedIn: true, settings, updatedAt: data.updated_at })
  } catch {
    // 復号失敗（旧鍵も不一致等）。設定なし扱いにしてローカルを優先させる。
    return NextResponse.json({ loggedIn: true, settings: null, reason: 'decrypt_failed' })
  }
}

export async function POST(req: NextRequest) {
  if (!supabaseReady()) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 })
  }
  if (!isCryptoReady()) {
    return NextResponse.json({ error: 'enc_key_not_configured' }, { status: 503 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  let settings: unknown
  try {
    settings = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  if (!settings || typeof settings !== 'object') {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }

  let settings_enc: string
  try {
    settings_enc = encryptSettings(JSON.stringify(settings))
  } catch {
    return NextResponse.json({ error: 'encrypt_failed' }, { status: 500 })
  }

  const admin = createAdminClient()
  const updatedAt = new Date().toISOString()
  const { error } = await admin
    .from('user_settings')
    .upsert(
      { user_id: user.id, settings_enc, updated_at: updatedAt },
      { onConflict: 'user_id' },
    )
  if (error) {
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, updatedAt })
}
