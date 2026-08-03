// 引き取れる接続があるかだけを返す。アプリ起動時に1回だけ聞き、あれば claim を実行する。
// 中身（トークン）は一切返さない。
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sessionHasFeature } from '@/lib/supabase/early-access'
import { findClaimable } from '@/lib/supabase/oauth-states'
import { isCryptoReady } from '@/lib/crypto'
import { rateLimitAsync } from '@/lib/rate-limit'

// このルートは createClient()（anonキー・セッション確認用）に加えて、findClaimable経由で
// createAdminClient()（service role・oauth_states読み取り用）も使う。claimと同じ判定式
// にしないと、service role未設定時にここだけ「準備OK」と誤判定してfindClaimableが
// 静かに空振りし続けるだけになる（claimの方は503で早期に気付ける）。
// 生の throw は漏らさず、静かな claimable:false へ倒す。
function supabaseReady(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
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

  // Finding2: レート制限をfeatureチェックより先に置く。逆順だと、機能を持たない呼び出し元は
  // バケットを消費せず claimable:false を返し続け、機能を持つ呼び出し元だけが31回目で
  // rate_limited になるという応答の違いから機能の有無が判別できてしまう。順序を入れ替え、
  // 超過時の応答も reason フィールドを持たない同じ claimable:false にすることで、
  // 機能の有無に関わらず同じ回数叩けば同じ応答になるようにする。
  //
  // アプリ起動時に毎回叩かれる想定の経路（claimより先に呼ばれ、claimより高頻度になりうる）。
  // authコール・台帳読み取り・行クエリの3つを毎回行うため、claim（20回/10分）と同様に
  // ユーザーID単位で絞るが、通常の起動を絶対に締め出さないよう余裕を持たせる。
  if (!(await rateLimitAsync(`notion-oauth-claimable:${user.id}`, 30, 10 * 60 * 1000))) {
    return NextResponse.json({ claimable: false })
  }

  if (!(await sessionHasFeature('easy_connect'))) return NextResponse.json({ claimable: false })

  const row = await findClaimable(user.id, Date.now())
  return NextResponse.json({ claimable: !!row?.token_enc })
}
