// 契約状態（subscriptions テーブル）をサーバー側で読み書きするヘルパー。
// service_role キーの管理クライアントを使うため、必ずサーバー（route handler）からのみ呼ぶこと。

import { createAdminClient } from './server'

export type SubscriptionRow = {
  user_id: string
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  status?: string | null
  current_period_end?: string | null
  trial_ends_at?: string | null
  plan?: string | null
}

// user_id をキーに契約状態を upsert する。
export async function upsertSubscriptionByUserId(row: SubscriptionRow): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin
    .from('subscriptions')
    .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'user_id' })
  if (error) throw new Error(`subscriptions upsert失敗: ${error.message}`)
}

// 招待コードによる無料解放（complimentary）を user_id に紐付けて書き込む。
// Stripe決済を介さない無期限の無料プレミアム。
//   - status='active'         … getActiveStatusByUserId がそのまま有効と判定する
//   - plan='comp'             … Stripe由来(premium)と区別。webhookは customer 起点で更新するため
//                               stripe_customer_id=null のこの行には触れない（解約で上書きされない）
//   - current_period_end=null … 無期限
export async function grantComplimentaryByUserId(userId: string): Promise<void> {
  const admin = createAdminClient()
  const { error } = await admin
    .from('subscriptions')
    .upsert(
      {
        user_id: userId,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        status: 'active',
        current_period_end: null,
        trial_ends_at: null,
        plan: 'comp',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
  if (error) throw new Error(`comp付与失敗: ${error.message}`)
}

// 期限付きトライアル（note特典など一般向け・カード不要・自動失効）を user_id に紐付ける。
// comp（無期限）との違い:
//   - plan='trial'           … comp と区別。棚卸し・revoke で「期限付き」を見分けられる
//   - status='trialing'      … getActiveStatusByUserId が active と判定する（期限内のみ。下の期限チェック参照）
//   - trial_ends_at=付与+日数 … この日時を過ぎたら getActiveStatusByUserId が active=false に倒す
//   - stripe_customer_id=null … Stripe webhook（customer起点）に触られない
export async function grantTrialByUserId(userId: string, trialDays: number): Promise<string> {
  const admin = createAdminClient()
  const days = Number.isFinite(trialDays) && trialDays > 0 ? trialDays : 30
  const trialEndsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await admin
    .from('subscriptions')
    .upsert(
      {
        user_id: userId,
        stripe_customer_id: null,
        stripe_subscription_id: null,
        status: 'trialing',
        current_period_end: null,
        trial_ends_at: trialEndsAt,
        plan: 'trial',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' },
    )
  if (error) throw new Error(`トライアル付与失敗: ${error.message}`)
  return trialEndsAt
}

// comp（無料解放）を取り消す（無効化 / revoke）。
//   - status='canceled' に更新するだけで、getActiveStatusByUserId は active 判定から外れる。
//   - 行は残すので「いつ付与し、いつ取り消したか」が追える（棚卸し台帳と整合）。
//   - 対象が comp（plan='comp'）の行のみを安全側で更新し、通常のStripe契約には触れない。
// 無料解放を取り消す対象プラン。無期限comp と 期限付きtrial のどちらも棚卸し・revoke の対象にする
// （Stripe由来の plan='premium' には触れない）。
const FREE_PLANS = ['comp', 'trial'] as const

export async function revokeComplimentaryByUserId(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('subscriptions')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .in('plan', FREE_PLANS as unknown as string[])
    .select('user_id')
  if (error) throw new Error(`comp取り消し失敗: ${error.message}`)
  // 1行でも更新されれば成功（= comp/trial行が存在して取り消せた）。
  return Array.isArray(data) && data.length > 0
}

// 現在 無料解放（comp/trial）を持つユーザー一覧を返す（棚卸し用）。
// active/canceled どちらも含め、現状を一覧できるようにする。
// plan と trial_ends_at も返すので「無期限comp」「期限付きtrial」を見分けられる。
export async function listComplimentary(): Promise<
  Array<{
    user_id: string
    plan: string | null
    status: string | null
    trial_ends_at: string | null
    updated_at: string | null
  }>
> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('subscriptions')
    .select('user_id, plan, status, trial_ends_at, updated_at')
    .in('plan', FREE_PLANS as unknown as string[])
    .order('updated_at', { ascending: false })
  if (error) throw new Error(`comp一覧取得失敗: ${error.message}`)
  return (data ?? []).map((r) => ({
    user_id: r.user_id,
    plan: r.plan ?? null,
    status: r.status ?? null,
    trial_ends_at: r.trial_ends_at ?? null,
    updated_at: r.updated_at ?? null,
  }))
}

// stripe_customer_id から user_id を逆引きする（webhookでcustomer起点のイベントを処理する用）。
export async function findUserIdByCustomer(customerId: string): Promise<string | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('subscriptions')
    .select('user_id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle()
  if (error || !data) return null
  return data.user_id
}

// customer起点でステータスだけ更新する（解約・支払い失敗・更新時）。
export async function updateStatusByCustomer(
  customerId: string,
  status: string,
  currentPeriodEnd?: string | null,
): Promise<void> {
  const admin = createAdminClient()
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  if (currentPeriodEnd !== undefined) patch.current_period_end = currentPeriodEnd
  const { error } = await admin
    .from('subscriptions')
    .update(patch)
    .eq('stripe_customer_id', customerId)
  if (error) throw new Error(`subscriptions status更新失敗: ${error.message}`)
}

// ユーザーが現在プレミアム有効か（active / trialing）を返す。
export async function getActiveStatusByUserId(userId: string): Promise<{
  active: boolean
  status: string | null
  currentPeriodEnd: string | null
  trialEndsAt: string | null
}> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('subscriptions')
    .select('status, current_period_end, trial_ends_at')
    .eq('user_id', userId)
    .maybeSingle()
  const status = data?.status ?? null
  const trialEndsAt = data?.trial_ends_at ?? null
  // 期限付きトライアル（trial_ends_at あり）は、その日時を過ぎていたら有効扱いしない。
  // これがサーバー側の唯一の失効判定。これが無いと別端末の /api/premium/status が
  // 期限を無視して常に active を返し、30日トライアルが実質無期限になってしまう。
  const trialExpired = !!trialEndsAt && Date.now() > new Date(trialEndsAt).getTime()
  const active = (status === 'active' || status === 'trialing') && !trialExpired
  return {
    active,
    status,
    currentPeriodEnd: data?.current_period_end ?? null,
    trialEndsAt,
  }
}
