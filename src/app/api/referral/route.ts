import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimit, clientIp } from '@/lib/rate-limit'
import {
  getOrCreateReferralCode,
  countReferralRedemptions,
} from '@/lib/supabase/referrals'
import { REFERRAL_REWARD_CAP } from '@/lib/referral'
import { REFERRAL_NEW_USER_DAYS, REFERRAL_REWARD_DAYS } from '@/lib/campaign'

/**
 * 友達紹介: 自分の紹介コードと成立数を返す（無ければこのタイミングで発行）。
 *
 * GET /api/referral
 *   - 認証: Supabaseセッション（Cookie）。未ログインは 401。
 *   - 返り値: { code, count, cap, newUserDays, rewardDays }
 *   - 呼び出し: 設定画面の「友達に紹介する」欄の表示時。
 * コードの利用（償還）は /api/premium/trial が受け持つ（入力欄は既存のまま）。
 */
export async function GET(req: NextRequest) {
  if (!rateLimit(`referral:${clientIp(req)}`, 30, 10 * 60 * 1000)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: 'supabase_not_configured' }, { status: 503 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 })
  }

  try {
    const [code, count] = await Promise.all([
      getOrCreateReferralCode(user.id),
      countReferralRedemptions(user.id),
    ])
    return NextResponse.json({
      code,
      count,
      cap: REFERRAL_REWARD_CAP,
      newUserDays: REFERRAL_NEW_USER_DAYS,
      rewardDays: REFERRAL_REWARD_DAYS,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
