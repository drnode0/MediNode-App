// oauth_states への読み書き。かんたん接続の state を扱うのはこのファイルだけにする
// （token_enc に触れる場所を1つに閉じるため）。すべて service_role 経由。
import { createAdminClient } from '@/lib/supabase/server'
import { generateState, isPendingExpired, isClaimExpired } from '@/lib/oauth-state'

export type OAuthStateRow = {
  state: string
  user_id: string
  status: 'pending' | 'completed' | 'claimed'
  token_enc: string | null
  created_at: string
  completed_at: string | null
}

const COLUMNS = 'state, user_id, status, token_enc, created_at, completed_at'

// 認可へ出る直前に発行する。失敗しても例外は投げず null を返す（呼び出し側が静かに戻す）。
export async function createPendingState(userId: string, nowMs: number): Promise<string | null> {
  const state = generateState()
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('oauth_states').insert({
      state,
      user_id: userId,
      status: 'pending',
      created_at: new Date(nowMs).toISOString(),
    })
    if (error) return null
    return state
  } catch {
    return null
  }
}

// callback から呼ぶ。pending かつ期限内の行だけを返す。
// 期限切れ・すでに completed / claimed・行なし・読み取り失敗はすべて null（同じ静かなエラーへ倒す）。
export async function takePendingState(state: string, nowMs: number): Promise<OAuthStateRow | null> {
  if (!state) return null
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('oauth_states')
      .select(COLUMNS)
      .eq('state', state)
      .maybeSingle()
    if (error || !data) return null
    const row = data as OAuthStateRow
    if (row.status !== 'pending') return null
    if (isPendingExpired(row.created_at, nowMs)) return null
    return row
  } catch {
    return null
  }
}

// トークンを暗号化して置き、pending → completed に進める。
// where に status='pending' を含めることで、同じ state で二重に交換されても
// 後勝ちで上書きされない（一方向を DB 側でも担保する）。
export async function markCompleted(state: string, tokenEnc: string, nowIso: string): Promise<boolean> {
  try {
    const admin = createAdminClient()
    const { error } = await admin
      .from('oauth_states')
      .update({ status: 'completed', token_enc: tokenEnc, completed_at: nowIso })
      .eq('state', state)
      .eq('status', 'pending')
    return !error
  } catch {
    return false
  }
}

// claim から呼ぶ。自分の completed のうち、猶予内で最も新しいもの。
export async function findClaimable(userId: string, nowMs: number): Promise<OAuthStateRow | null> {
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('oauth_states')
      .select(COLUMNS)
      .eq('user_id', userId)
      .eq('status', 'completed')
      .order('completed_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error || !data) return null
    const row = data as OAuthStateRow
    if (isClaimExpired(row.completed_at, nowMs)) return null
    return row
  } catch {
    return null
  }
}

// 引き取り完了。token_enc は保持し続ける理由が無いので落とす。
export async function markClaimed(state: string): Promise<boolean> {
  try {
    const admin = createAdminClient()
    const { error } = await admin
      .from('oauth_states')
      .update({ status: 'claimed', token_enc: null })
      .eq('state', state)
      .eq('status', 'completed')
    return !error
  } catch {
    return false
  }
}

// 自分の古い行の掃除。best-effort（失敗しても主処理は続ける）。cronは足さない。
export async function purgeExpired(userId: string, nowMs: number): Promise<void> {
  try {
    const admin = createAdminClient()
    // completed の猶予（60分）より古いものは pending / completed / claimed を問わず不要。
    const cutoff = new Date(nowMs - 60 * 60_000).toISOString()
    await admin.from('oauth_states').delete().eq('user_id', userId).lt('created_at', cutoff)
  } catch {
    // 掃除の失敗は無視してよい
  }
}
