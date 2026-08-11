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

export async function saveUserOccupation(
  admin: SupabaseClient,
  userId: string,
  occupation: string,
): Promise<void> {
  const { error } = await admin
    .from('user_settings')
    .upsert({ user_id: userId, occupation }, { onConflict: 'user_id' })
  if (error) throw new Error(error.message)
}
