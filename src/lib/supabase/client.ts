// ブラウザ（クライアントコンポーネント）用 Supabase クライアント。
// マジックリンク／OTP認証・セッション取得に使う。
// anon（公開可能）キーのみを使用するため、ブラウザに出ても安全（RLSで保護）。

import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('Supabaseの環境変数（NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY）が設定されていません')
  }
  return createBrowserClient(url, anonKey)
}

// 環境変数が揃っているか（ログイン機能を出すかの判定に使う）。
export function isSupabaseConfigured(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
}
