// 友達紹介のDBアクセスと紹介者還元。service_role を使うため必ずサーバーからのみ呼ぶこと。
// 純ロジック（コード形式・可否判定）は @/lib/referral、日数は @/lib/campaign を参照。

import Stripe from 'stripe'
import { createAdminClient } from './server'
import { generateReferralCode } from '@/lib/referral'
import { REFERRAL_REWARD_DAYS } from '@/lib/campaign'
import { grantTrialByUserId } from './subscriptions'

// 自分の紹介コードを取得（無ければ発行）。unique衝突時は生成し直して再試行。
export async function getOrCreateReferralCode(userId: string): Promise<string> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('referral_codes')
    .select('code')
    .eq('user_id', userId)
    .maybeSingle()
  if (data?.code) return data.code

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode()
    const { error } = await admin
      .from('referral_codes')
      .insert({ user_id: userId, code })
    if (!error) return code
    // 同時アクセスで自分の行が先に入った場合はそれを返す。コード衝突なら生成し直す。
    const { data: retry } = await admin
      .from('referral_codes')
      .select('code')
      .eq('user_id', userId)
      .maybeSingle()
    if (retry?.code) return retry.code
  }
  throw new Error('紹介コードの発行に失敗しました')
}

// 紹介コードの持ち主を引く（実在しなければ null）。
export async function findReferralCodeOwner(code: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('referral_codes')
    .select('user_id')
    .eq('code', code)
    .maybeSingle()
  return data?.user_id ?? null
}

// 新規側（コードを入力した人）の受け取り可否判定に使う状態。
//   hasStripeHistory: Stripe決済歴（カード登録トライアル含む）があれば「新規」ではない
//   hasComp: 無期限comp保持者は30日trialで上書きすると降格になるため対象外
export async function getRedeemerContext(
  userId: string,
): Promise<{ hasStripeHistory: boolean; hasComp: boolean }> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('subscriptions')
    .select('plan, status, stripe_customer_id')
    .eq('user_id', userId)
    .maybeSingle()
  return {
    hasStripeHistory: !!data?.stripe_customer_id,
    hasComp: data?.plan === 'comp' && data?.status === 'active',
  }
}

// この人はすでに紹介特典を受け取ったか（生涯1回）。
export async function hasRedeemedReferral(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('referral_redemptions')
    .select('id')
    .eq('referred_user_id', userId)
    .maybeSingle()
  return !!data
}

// 紹介者の成立数（設定画面の表示・還元上限の判定）。
export async function countReferralRedemptions(referrerId: string): Promise<number> {
  const admin = createAdminClient()
  const { count } = await admin
    .from('referral_redemptions')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_user_id', referrerId)
  return count ?? 0
}

// 成立記録を挿入。referred_user_id UNIQUE により同時リクエストの二重受け取りはDBが弾く。
// 戻り値: true=挿入できた / false=すでに記録があった（unique違反）。
export async function insertReferralRedemption(opts: {
  referrerId: string
  referredId: string
  code: string
}): Promise<boolean> {
  const admin = createAdminClient()
  const { error } = await admin.from('referral_redemptions').insert({
    referrer_user_id: opts.referrerId,
    referred_user_id: opts.referredId,
    code: opts.code,
  })
  if (!error) return true
  if (error.code === '23505') return false // unique_violation
  throw new Error(`紹介成立の記録に失敗: ${error.message}`)
}

// 付与が失敗したときの巻き戻し（best-effort）。残すと「受け取り済み」で再試行できなくなる。
export async function deleteReferralRedemption(referredId: string): Promise<void> {
  const admin = createAdminClient()
  await admin.from('referral_redemptions').delete().eq('referred_user_id', referredId)
}

export type ReferrerRewardResult =
  | 'stripe_extended' // Stripe課金中: 次回請求を後ろ倒し
  | 'trial_extended'  // トライアル中: trial_ends_at を延長
  | 'trial_granted'   // 無料/失効: 新たに14日トライアル付与
  | 'skipped'         // comp等、延長の意味がない/できない

// 紹介者への +14日 還元。契約状態に応じて手段を変える。
// best-effort 前提: 呼び出し側は失敗しても新規側の付与を成功扱いにすること。
export async function grantReferrerReward(referrerId: string): Promise<ReferrerRewardResult> {
  const admin = createAdminClient()
  const { data: row } = await admin
    .from('subscriptions')
    .select('plan, status, trial_ends_at, stripe_subscription_id, stripe_customer_id')
    .eq('user_id', referrerId)
    .maybeSingle()

  const rewardMs = REFERRAL_REWARD_DAYS * 24 * 60 * 60 * 1000

  // 無期限comp（および不明なactive行）は延長のしようがない。成立記録だけ残す。
  if (row?.plan === 'comp') return 'skipped'

  // Stripe課金中/カードトライアル中: trial_end を先に送って次回請求を14日後ろ倒し。
  const stripeActive =
    !!row?.stripe_subscription_id && (row.status === 'active' || row.status === 'trialing')
  if (stripeActive) {
    const stripeKey = process.env.STRIPE_SECRET_KEY
    if (!stripeKey) return 'skipped'
    const stripe = new Stripe(stripeKey)
    const sub = await stripe.subscriptions.retrieve(row!.stripe_subscription_id!)
    // 基準は「現トライアル終了」か「現期間の終わり」の遅い方（現在より過去なら現在）。
    const item = sub.items?.data?.[0]
    const baseSec = Math.max(
      sub.trial_end ?? 0,
      item?.current_period_end ?? 0,
      Math.floor(Date.now() / 1000),
    )
    await stripe.subscriptions.update(row!.stripe_subscription_id!, {
      trial_end: baseSec + REFERRAL_REWARD_DAYS * 24 * 60 * 60,
      proration_behavior: 'none',
    })
    return 'stripe_extended'
  }

  // コード式/自動トライアル中（期限が生きている）: 期限を+14日。
  const trialAlive =
    row?.status === 'trialing' &&
    !!row.trial_ends_at &&
    new Date(row.trial_ends_at).getTime() > Date.now()
  if (trialAlive) {
    const newEnd = new Date(new Date(row!.trial_ends_at!).getTime() + rewardMs).toISOString()
    const { error } = await admin
      .from('subscriptions')
      .update({ trial_ends_at: newEnd, updated_at: new Date().toISOString() })
      .eq('user_id', referrerId)
    if (error) throw new Error(`紹介者の期限延長に失敗: ${error.message}`)
    return 'trial_extended'
  }

  // 無料・失効・行なし: いまから14日のトライアルを付与。
  // Stripe解約歴のある行は customer 逆引き（findUserIdByCustomer）を壊さないよう
  // stripe_* を残したまま update する（grantTrialByUserId の upsert は null で上書きするため）。
  if (row?.stripe_customer_id) {
    const newEnd = new Date(Date.now() + rewardMs).toISOString()
    const { error } = await admin
      .from('subscriptions')
      .update({
        status: 'trialing',
        plan: 'trial',
        trial_ends_at: newEnd,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', referrerId)
    if (error) throw new Error(`紹介者へのトライアル付与に失敗: ${error.message}`)
    return 'trial_granted'
  }
  await grantTrialByUserId(referrerId, REFERRAL_REWARD_DAYS)
  return 'trial_granted'
}
