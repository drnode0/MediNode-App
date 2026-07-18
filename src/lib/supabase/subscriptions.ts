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
  // 解約予約（Stripe cancel_at_period_end）。期間末までは利用可能だが以降更新されない。
  // migration 0008 で追加。未適用環境では書き込み時にこのキーを落として再試行する。
  cancel_at_period_end?: boolean
}

// migration 0008（cancel_at_period_end 列）未適用の本番でも webhook / verify が
// 落ちないように、列起因のエラーならこのキーを外した形へ退避できるか判定する。
function isCancelColumnError(message: string | undefined): boolean {
  return !!message && message.includes('cancel_at_period_end')
}

// user_id をキーに契約状態を upsert する。
export async function upsertSubscriptionByUserId(row: SubscriptionRow): Promise<void> {
  const admin = createAdminClient()
  const payload = { ...row, updated_at: new Date().toISOString() }
  const { error } = await admin
    .from('subscriptions')
    .upsert(payload, { onConflict: 'user_id' })
  if (error && isCancelColumnError(error.message) && 'cancel_at_period_end' in payload) {
    // 列が無い環境（migration 0008 未適用）: フラグ抜きで保存を成立させる。
    const { cancel_at_period_end: _omit, ...rest } = payload
    const { error: retryErr } = await admin
      .from('subscriptions')
      .upsert(rest, { onConflict: 'user_id' })
    if (retryErr) throw new Error(`subscriptions upsert失敗: ${retryErr.message}`)
    return
  }
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
// plan は出自の区別のみ（挙動は同一）: 'trial'=コード式（note特典等）／'auto_trial'=登録時自動3日。
export async function grantTrialByUserId(
  userId: string,
  trialDays: number,
  plan: 'trial' | 'auto_trial' = 'trial',
): Promise<string> {
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
        plan,
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
const FREE_PLANS = ['comp', 'trial', 'auto_trial'] as const

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

// customer起点でステータスだけ更新する（解約・解約予約・支払い失敗・更新時）。
export async function updateStatusByCustomer(
  customerId: string,
  status: string,
  currentPeriodEnd?: string | null,
  cancelAtPeriodEnd?: boolean,
): Promise<void> {
  const admin = createAdminClient()
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
  if (currentPeriodEnd !== undefined) patch.current_period_end = currentPeriodEnd
  if (cancelAtPeriodEnd !== undefined) patch.cancel_at_period_end = cancelAtPeriodEnd
  const { error } = await admin
    .from('subscriptions')
    .update(patch)
    .eq('stripe_customer_id', customerId)
  if (error && isCancelColumnError(error.message) && 'cancel_at_period_end' in patch) {
    // 列が無い環境（migration 0008 未適用）: フラグ抜きで status/period だけ更新する。
    delete patch.cancel_at_period_end
    const { error: retryErr } = await admin
      .from('subscriptions')
      .update(patch)
      .eq('stripe_customer_id', customerId)
    if (retryErr) throw new Error(`subscriptions status更新失敗: ${retryErr.message}`)
    return
  }
  if (error) throw new Error(`subscriptions status更新失敗: ${error.message}`)
}

// ユーザーが現在プレミアム有効か（active / trialing）を返す。
// cancelAtPeriodEnd は「解約手続き済みだが期間末までは利用可能」の表示用
// （migration 0008 未適用環境では常に false）。
export async function getActiveStatusByUserId(userId: string): Promise<{
  active: boolean
  status: string | null
  currentPeriodEnd: string | null
  trialEndsAt: string | null
  cancelAtPeriodEnd: boolean
}> {
  const admin = createAdminClient()
  let { data, error } = await admin
    .from('subscriptions')
    .select('status, current_period_end, trial_ends_at, cancel_at_period_end')
    .eq('user_id', userId)
    .maybeSingle()
  if (error && isCancelColumnError(error.message)) {
    // 列が無い環境（migration 0008 未適用）: フラグ抜きで従来どおり判定する。
    const fallback = await admin
      .from('subscriptions')
      .select('status, current_period_end, trial_ends_at')
      .eq('user_id', userId)
      .maybeSingle()
    data = fallback.data as typeof data
  }
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
    cancelAtPeriodEnd: !!(data as { cancel_at_period_end?: boolean } | null)?.cancel_at_period_end,
  }
}

// subscriptions に行があるか（状態・期限は問わない）。自動トライアルの対象判定に使う。
// 行がある＝過去に何らかの契約・トライアル・compがあった人。
export async function hasSubscriptionRecord(userId: string): Promise<boolean> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('subscriptions')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  return !!data
}
