// アカウント台帳の区分判定（純粋ロジック）。
//
// 「誰がプレミアムで、誰が永続無料か」を1つのラベルに落とす。
// プレミアムの権利は3系統あり、判定の優先順位は次のとおり:
//   1) admin        … COMP_ADMIN_EMAILS に載っているメール（DB行なしで常時無料。/api/premium/status 参照）
//   2) comp         … 招待コード（COMP_INVITE_CODES）による無期限無料。subscriptions に plan='comp'
//   3) premium      … Stripe 決済で実際に課金中（plan='premium' か stripe_customer_id あり・status='active'）
//      stripe_trial … Stripe のカード登録つき無料トライアル期間中（同上・status='trialing'。
//                     STRIPE_TRIAL_DAYS 経過後に自動で課金開始＝premium へ移る）
//   4) trial        … 無料コード（TRIAL_CODES）の期限付きトライアル。カード登録なし・期限で自動失効
//   5) free         … 上記いずれもなし（無料利用）
// revoke 済み（status='canceled'）や期限切れは expired として区別する。

export type MemberKind =
  | 'admin'
  | 'comp'
  | 'premium'
  | 'stripe_trial'
  | 'trial'
  | 'expired'
  | 'free'

export type SubscriptionSummary = {
  plan: string | null
  status: string | null
  trial_ends_at: string | null
  stripe_customer_id: string | null
}

// now はテストと日次表示の安定のため呼び出し側から渡す。
export function deriveMemberKind(
  isAdmin: boolean,
  sub: SubscriptionSummary | null | undefined,
  now: Date,
): MemberKind {
  if (isAdmin) return 'admin'
  if (!sub || !sub.status) return 'free'

  const active = sub.status === 'active' || sub.status === 'trialing'
  const trialExpired =
    !!sub.trial_ends_at && now.getTime() > new Date(sub.trial_ends_at).getTime()

  if (!active || trialExpired) return 'expired'

  if (sub.plan === 'comp') return 'comp'
  if (sub.plan === 'trial') return 'trial'
  // Stripe 由来（plan='premium' か、customer が紐づいている行）。
  // status='trialing' はカード登録済みの無料期間中、'active' は課金中。
  if (sub.plan === 'premium' || sub.stripe_customer_id) {
    return sub.status === 'trialing' ? 'stripe_trial' : 'premium'
  }
  // plan 不明だが active な行（旧データ等）は安全側でプレミアム扱いにして目視確認を促す。
  return 'premium'
}

export const MEMBER_KIND_LABEL: Record<MemberKind, string> = {
  admin: '管理者（常時無料）',
  comp: '永続無料（招待コード）',
  premium: 'サブスク中（課金）',
  stripe_trial: 'トライアル中（カード登録）',
  trial: 'トライアル中（無料コード）',
  expired: '失効・取消',
  free: '無料',
}
