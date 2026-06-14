// サーバー（Route Handler / Server Component）用 Supabase クライアント。
// Cookieベースでセッションを読み書きする（@supabase/ssr）。
// anon キーを使い、ユーザーのセッションに紐づくRLS適用下で動作する。

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('Supabaseの環境変数が設定されていません')
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          )
        } catch {
          // Server Component から呼ばれた場合は set 不可。middleware/route handler 側で更新される。
        }
      },
    },
  })
}

// service_role（秘密）キーを使う管理クライアント。
// RLSをバイパスするため、サーバー内（webhook / verify 等）でのみ使用。絶対にクライアントへ渡さない。
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    throw new Error('Supabase管理クライアントの環境変数（SUPABASE_SERVICE_ROLE_KEY）が設定されていません')
  }
  return createSupabaseClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
