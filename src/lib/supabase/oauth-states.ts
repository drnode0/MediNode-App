// oauth_states への読み書き。かんたん接続の state を扱うのはこのファイルだけにする
// （token_enc に触れる場所を1つに閉じるため）。すべて service_role 経由。
import { createAdminClient } from '@/lib/supabase/server'
import {
  generateState,
  isPendingExpired,
  isClaimExpired,
  PENDING_TTL_MS,
  CLAIM_WINDOW_MS,
} from '@/lib/oauth-state'

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
  try {
    const state = generateState()
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
    const { data, error } = await admin
      .from('oauth_states')
      .update({ status: 'completed', token_enc: tokenEnc, completed_at: nowIso })
      .eq('state', state)
      .eq('status', 'pending')
      .select('state')
    // 述語に一致した行が実際にあったかを見る。無ければ横取りされたとみなし false を返す。
    return !error && !!data && data.length > 0
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
    const { data, error } = await admin
      .from('oauth_states')
      .update({ status: 'claimed', token_enc: null })
      .eq('state', state)
      .eq('status', 'completed')
      .select('state')
    // 述語に一致した行が実際にあったかを見る。無ければ横取りされたとみなし false を返す。
    return !error && !!data && data.length > 0
  } catch {
    return false
  }
}

// claim成功後に呼ぶ。同じユーザーの他のcompleted行（今引き取った状態は除く）を
// 無効化し、token_encを落とす。これをしないと、対応済みのconflict行が
// completed_at順で再び最新として浮上し、claimable/claimが毎起動そのまま再実行されてしまう
// （§findClaimable は user_id×status=completed で最新の1件を返すだけで、他の
// completed行がいくつ残っていても気にしないため）。
export async function retireOtherCompleted(userId: string, exceptState: string): Promise<boolean> {
  try {
    const admin = createAdminClient()
    const { error } = await admin
      .from('oauth_states')
      .update({ token_enc: null })
      .eq('user_id', userId)
      .eq('status', 'completed')
      .neq('state', exceptState)
    return !error
  } catch {
    return false
  }
}

// 自分の古い行の掃除。best-effort（失敗しても主処理は続ける）。cronは足さない。
//
// Finding1: token_enc に入っているのは無期限に有効なNotionのOAuthアクセストークンなので、
// 「行が消えるまで残る」では足りない。認可だけして二度と戻らなかった行（＝claimの猶予を
// 過ぎたcompleted行）は、行削除のcutoff（PENDING_TTL_MS+CLAIM_WINDOW_MS、もっと先）を
// 待たずに、ここでtoken_encだけ先に落とす。ただしこの掃除自体が「同じユーザーが次にstartか
// claimを叩いたとき」にしか走らないため、そのユーザーが二度と戻ってこなければ、行削除の
// cutoffに達するまではtoken_encが残る（0022のコメント参照）。
export async function purgeExpired(userId: string, nowMs: number): Promise<void> {
  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch {
    return
  }

  try {
    // created_at起点で見て、その行がまだ引き取り可能でありうる最遅時刻は
    // 「pendingの猶予を使い切ってからcompletedになり、そこからさらにclaimの猶予を使い切る」
    // ケース（PENDING_TTL_MS + CLAIM_WINDOW_MS）。これより古い行だけを不要と判断する。
    const deleteCutoff = new Date(nowMs - (PENDING_TTL_MS + CLAIM_WINDOW_MS)).toISOString()
    await admin.from('oauth_states').delete().eq('user_id', userId).lt('created_at', deleteCutoff)
  } catch {
    // 掃除の失敗は無視してよい
  }

  try {
    // completedのままclaimの猶予（CLAIM_WINDOW_MS）を過ぎた行は、上の行削除cutoffより
    // ずっと早い時点でtoken_encだけ落とす。findClaimableはcompleted_at起点で猶予切れを
    // 判定して既に使わせないが、DB上のtoken_encはこの掃除が来るまで残ってしまうため。
    const claimCutoff = new Date(nowMs - CLAIM_WINDOW_MS).toISOString()
    await admin
      .from('oauth_states')
      .update({ token_enc: null })
      .eq('user_id', userId)
      .eq('status', 'completed')
      .lt('completed_at', claimCutoff)
  } catch {
    // 掃除の失敗は無視してよい
  }
}

// 完了ページで「どのアカウントへ保存するか」を出すために、state の持ち主のメールを引く。
// completed の行に限る（pending の state を踏ませてメールを覗く経路を作らない）。
export async function findStateOwnerEmail(state: string): Promise<string | null> {
  if (!state) return null
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('oauth_states')
      .select('user_id, status')
      .eq('state', state)
      .maybeSingle()
    if (error || !data) return null
    const row = data as { user_id: string; status: string }
    if (row.status !== 'completed') return null
    const { data: u, error: uErr } = await admin.auth.admin.getUserById(row.user_id)
    if (uErr || !u?.user) return null
    return u.user.email ?? null
  } catch {
    return null
  }
}
