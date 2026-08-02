// 引き取れる接続があるかだけを返す。アプリ起動時に1回だけ聞き、あれば claim を実行する。
// 中身（トークン）は一切返さない。
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sessionHasFeature } from '@/lib/supabase/early-access'
import { findClaimable } from '@/lib/supabase/oauth-states'
import { isCryptoReady } from '@/lib/crypto'

// このルートは createClient()（anonキー）だけを使う。/api/user-settings と同じ考え方で、
// env未設定時の生の throw を漏らさず、静かな claimable:false へ倒す。
function supabaseReady(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}

export async function GET() {
  if (!supabaseReady()) {
    return NextResponse.json({ claimable: false, reason: 'supabase_not_configured' })
  }

  // claim はトークンの復号にこの鍵を使う。ここが未設定だと claimable:true を返しても
  // claim は必ず即500で落ちるので、同じ判定をここでも行い false に倒す。
  if (!isCryptoReady()) {
    return NextResponse.json({ claimable: false, reason: 'enc_key_not_configured' })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ claimable: false })

  if (!(await sessionHasFeature('easy_connect'))) return NextResponse.json({ claimable: false })

  const row = await findClaimable(user.id, Date.now())
  return NextResponse.json({ claimable: !!row?.token_enc })
}
