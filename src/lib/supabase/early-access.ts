// 検索ルート等で、クライアント改ざんを防ぐために earlyAccess をサーバー側で再判定する。
import { createClient } from '@/lib/supabase/server'
import { resolveEarlyAccess } from '@/lib/feature-access'

export async function getSessionEarlyAccess(): Promise<boolean> {
  try {
    // GA が立っていればユーザー確定前に true（誰でも利用可）。
    if (resolveEarlyAccess({ email: null, ledgerEarlyAccess: null })) return true

    const supabaseReady = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
    if (!supabaseReady) return false

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false

    // env/email で決まるなら DB 照会を省く。
    if (resolveEarlyAccess({ email: user.email, ledgerEarlyAccess: null })) return true

    const { data: us } = await supabase
      .from('user_settings')
      .select('early_access')
      .eq('user_id', user.id)
      .maybeSingle()
    return resolveEarlyAccess({ email: user.email, ledgerEarlyAccess: (us?.early_access as boolean | undefined) ?? null })
  } catch {
    return false
  }
}
