// かんたん接続の明示的な却下（Finding4・§10b step4「このままの接続を続ける（変更しない）」）。
//
// conflict / claimCheckFailed 画面で「このままの接続を続ける」を選んだときに呼ぶ。
// この時点では何も保存されていない（claim できていない）ので、端末側で戻すものは無い。
// だが呼ばないと、サーバー側の completed 行がそのまま claimable と判定され続け、
// 次のコールドスタートのたびに全画面の仕上げシートが再び開いてしまう
// （claim の猶予＝CLAIM_WINDOW_MS が尽きるまで）。
//
// トークンの中身には一切触れない。することは discardClaimable が token_enc を
// 落として claimable ではなくするだけで、それ以外の応答契約は claim/claimable と揃える
// （機能の有無・引き取り対象の有無を、応答の形から推測させない）。
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sessionHasFeature } from '@/lib/supabase/early-access'
import { discardClaimable } from '@/lib/supabase/oauth-states'
import { rateLimitAsync } from '@/lib/rate-limit'

// claim/claimable と同じ判定式（createClient=セッション確認用、discardClaimableが使う
// createAdminClient=service role の両方が要る）。
function supabaseReady(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

export async function POST() {
  if (!supabaseReady()) {
    return NextResponse.json({ ok: false })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false })

  // claim/claimable と同じ順序（レート制限をfeatureチェックより先に置く）。逆順だと、
  // 機能を持たない呼び出し元はバケットを消費せず ok:false を返し続け、機能を持つ
  // 呼び出し元だけが上限で弾かれるという応答の違いから機能の有無が判別できてしまう。
  if (!(await rateLimitAsync(`notion-oauth-discard:${user.id}`, 20, 10 * 60 * 1000))) {
    return NextResponse.json({ ok: false })
  }

  if (!(await sessionHasFeature('easy_connect'))) {
    return NextResponse.json({ ok: false })
  }

  const ok = await discardClaimable(user.id)
  return NextResponse.json({ ok })
}
