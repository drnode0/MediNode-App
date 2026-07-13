// マジックリンクをタップした際の着地点。
// Supabaseが付与する token_hash / type を検証してセッションCookieを確立し、トップへ戻す。

import { type EmailOtpType } from '@supabase/supabase-js'
import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// オープンリダイレクト防止: 同一サイト内の相対パスのみ許可する（LoginClient と同じ規則）。
// "/" 始まり以外（".evil.com" 等は origin と連結するとホストが変わる）と
// "//" 始まり（プロトコル相対URL）を拒否する。
function safeNext(raw: string | null): string {
  if (!raw) return '/'
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw
  return '/'
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type') as EmailOtpType | null
  const next = safeNext(searchParams.get('next'))

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
      // 新規登録だったか既存ログインだったかを、着地ページで一度だけ告知するための印。
      // created_at の新しさで判定（LoginModal のOTP経路と同じ規則）。失敗しても遷移は妨げない。
      let welcome = ''
      try {
        const { data: { user } } = await supabase.auth.getUser()
        const createdAt = user?.created_at ? new Date(user.created_at).getTime() : 0
        if (createdAt > 0) {
          welcome = Date.now() - createdAt < 30 * 60 * 1000 ? 'new' : 'existing'
        }
      } catch {
        // 判定に失敗しても告知を省くだけ（ログインは成立している）。
      }
      const sep = next.includes('?') ? '&' : '?'
      const dest = welcome ? `${origin}${next}${sep}welcome=${welcome}` : `${origin}${next}`
      return NextResponse.redirect(dest)
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
