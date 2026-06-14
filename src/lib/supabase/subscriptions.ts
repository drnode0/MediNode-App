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
  const active = status === 'active' || status === 'trialing'
  return {
    active,
    status,
    currentPeriodEnd: data?.current_period_end ?? null,
    trialEndsAt: data?.trial_ends_at ?? null,
  }
}
