// マジックリンクをタップした際の着地点。
// Supabaseが付与する token_hash / type を検証してセッションCookieを確立し、トップへ戻す。

import { type EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = searchParams.get('next') ?? '/'

  // Supabaseが直接エラーを付けてくるケース（リンク期限切れ等）。
  const incomingError = searchParams.get('error_description') || searchParams.get('error')
  if (incomingError) {
    return NextResponse.redirect(
      `${origin}/?auth_error=${encodeURIComponent(incomingError)}`,
    )
  }

  if (token_hash && type) {
    const supabase = await createClient()
    const { error } = await supabase.auth.verifyOtp({ type, token_hash })
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`)
    }
    // 失敗の原因をURLに載せて切り分けできるようにする。
    console.error('auth/confirm verifyOtp error:', error.message)
    return NextResponse.redirect(
      `${origin}/?auth_error=${encodeURIComponent(error.message)}`,
    )
  }

  // token_hash / type が無い＝テンプレートのリンク形式が想定外。
  return NextResponse.redirect(`${origin}/?auth_error=missing_token_hash`)
}
