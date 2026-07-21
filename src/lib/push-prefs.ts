// 通知設定（NotifyPrefs）の保存・取得・部分マージ。API と送信側で共用する。
import type { SupabaseClient } from '@supabase/supabase-js'
import { parsePrefs, DEFAULT_PREFS, type NotifyPrefs } from './push'

// 部分入力を既定にマージして正規化する（純関数・テスト対象）。
export function mergePrefs(patch: unknown): NotifyPrefs {
  const base = DEFAULT_PREFS
  const o = (patch && typeof patch === 'object' ? patch : {}) as Partial<NotifyPrefs>
  return parsePrefs({ ...base, ...o })
}

export async function getUserPrefs(admin: SupabaseClient, userId: string): Promise<NotifyPrefs> {
  const { data } = await admin
    .from('push_notify_prefs')
    .select('prefs')
    .eq('user_id', userId)
    .maybeSingle()
  return parsePrefs(data?.prefs)
}

export async function saveUserPrefs(
  admin: SupabaseClient,
  userId: string,
  prefs: NotifyPrefs,
): Promise<void> {
  await admin.from('push_notify_prefs').upsert(
    { user_id: userId, prefs, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' },
  )
}
