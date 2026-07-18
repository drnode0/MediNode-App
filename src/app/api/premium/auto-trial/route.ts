// 登録時自動トライアル（3日・コード不要）。
//
// POST /api/premium/auto-trial
//   - 認証: Supabaseセッション（Cookie）。未ログインは 401。
//   - 条件: user_metadata.auto_trial_granted_at が無い かつ subscriptions に記録が無い。
//   - 処理: 先にフラグを立ててから grantTrialByUserId（/api/welcome と同じ二重実行対策）。
//   - 呼び出し: PremiumSync がログイン確認後に叩く（何度呼んでもフラグでno-op）。
//   - note特典コード（14日・/api/premium/trial）とは独立。記録がある人には触れない。

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { grantTrialByUserId, hasSubscriptionRecord } from '@/lib/supabase/subscriptions'
import { AUTO_TRIAL_DAYS, isAutoTrialEligible } from '@/lib/auto-trial'
import { rateLimit, clientIp } from '@/lib/rate-limit'

export async function POST(req: NextRequest) {
  if (!rateLimit(`auto-trial:${clientIp(req)}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json({ ok: false, reason: 'rate_limited' }, { status: 429 })
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ ok: false, reason: 'supabase_not_configured' })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ ok: false, reason: 'login_required' }, { status: 401 })
  }

  const grantedAt = (user.user_metadata?.auto_trial_granted_at as string | undefined) ?? null
  if (grantedAt) {
    return NextResponse.json({ ok: true, already: true })
  }

  const hasRow = await hasSubscriptionRecord(user.id)
  if (!isAutoTrialEligible({ grantedAt, hasSubscriptionRow: hasRow })) {
    // 記録がある人（コード式/契約/comp）には二度と自動付与しないようフラグだけ立てる。
    // フラグ更新の失敗はここでは無視してよい（次回も hasSubscriptionRecord が
    // 必ず再検証するため、付与漏れ・二重付与のどちらも起きない）。
    const admin = createAdminClient()
    await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...user.user_metadata, auto_trial_granted_at: new Date().toISOString() },
    })
    return NextResponse.json({ ok: true, already: true })
  }

  // 先にフラグ（多タブ同時アクセスでの二重付与をほぼ防ぐ。upsertなので実害も出ない）。
  const admin = createAdminClient()
  const { error: flagErr } = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { ...user.user_metadata, auto_trial_granted_at: new Date().toISOString() },
  })
  if (flagErr) {
    return NextResponse.json({ ok: false, reason: 'flag_update_failed' }, { status: 500 })
  }

  try {
    const trialEndsAt = await grantTrialByUserId(user.id, AUTO_TRIAL_DAYS)
    return NextResponse.json({ ok: true, granted: true, trialDays: AUTO_TRIAL_DAYS, trialEndsAt })
  } catch (err) {
    console.error('auto-trial: 付与失敗:', err instanceof Error ? err.message : err)
    // 付与に失敗したのにフラグだけ残ると、次回以降 already 扱いになり永久に付与されない。
    // ベストエフォートでフラグを戻して、次回ログイン時に再試行できるようにする。
    try {
      await admin.auth.admin.updateUserById(user.id, {
        user_metadata: { ...user.user_metadata, auto_trial_granted_at: null },
      })
    } catch {}
    return NextResponse.json({ ok: false, reason: 'grant_failed' }, { status: 500 })
  }
}
