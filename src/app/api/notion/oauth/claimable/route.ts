// 引き取れる接続があるかだけを返す。アプリ起動時に1回だけ聞き、あれば claim を実行する。
// 中身（トークン）は一切返さない。
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sessionHasFeature } from '@/lib/supabase/early-access'
import { findClaimable } from '@/lib/supabase/oauth-states'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ claimable: false })

  if (!(await sessionHasFeature('easy_connect'))) return NextResponse.json({ claimable: false })

  const row = await findClaimable(user.id, Date.now())
  return NextResponse.json({ claimable: !!row?.token_enc })
}
