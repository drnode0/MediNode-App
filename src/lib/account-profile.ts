// 職種（アカウント属性）の保存・取得。登録フロー（LoginModal）とCQ投稿の自動入力で共用する。
// 保存先は user_settings.occupation（migration 0024）。値は CQ_OCCUPATIONS のみ許可。
import type { SupabaseClient } from '@supabase/supabase-js'
import { CQ_OCCUPATIONS } from './cq-submit'

// 固定リスト内の職種か（純関数・テスト対象）。
export function isValidOccupation(v: unknown): v is string {
  return typeof v === 'string' && (CQ_OCCUPATIONS as readonly string[]).includes(v)
}

// 未登録・行なし・列未適用（migration 0024 前）はすべて null。
export async function getUserOccupation(admin: SupabaseClient, userId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('user_settings')
    .select('occupation')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) return null
  const v = (data as { occupation?: unknown } | null)?.occupation
  return isValidOccupation(v) ? v : null
}

// migration 0024 未適用の環境かどうか（列が無いことによるupsert失敗）。
// Postgres の未定義列エラーは code '42703'、PostgREST 経由だと 'PGRST204' で
// 返ってくることがあるため両方を見る。code が取れない場合の保険として、
// メッセージに 'occupation' と 'column' を含むかも見る。
function isMissingOccupationColumnError(error: { code?: string; message?: string }): boolean {
  if (error.code === '42703' || error.code === 'PGRST204') return true
  const msg = String(error.message || '')
  return msg.includes('occupation') && msg.includes('column')
}

export async function saveUserOccupation(
  admin: SupabaseClient,
  userId: string,
  occupation: string,
): Promise<void> {
  const { error } = await admin
    .from('user_settings')
    .upsert({ user_id: userId, occupation }, { onConflict: 'user_id' })
  if (!error) return
  // migration 0024 適用前（occupation列が無い）は例外にせず、保存なしのスキップ相当で
  // 成功扱いにする。呼び出し元（登録フロー・穴埋め保存）が500で袋小路にならないようにする
  // ための設計上の意図。次回ログイン時にまた職種ステップが出るだけで、壊れはしない。
  if (isMissingOccupationColumnError(error as { code?: string; message?: string })) return
  throw new Error(error.message)
}
