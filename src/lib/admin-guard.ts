// 管理者（オーナー）専用APIの共通ガード。
//
// ログイン必須。さらに COMP_ADMIN_EMAILS（カンマ区切り）に含まれるメールのみ許可する。
// /api/premium/comp（棚卸し・revoke）と /api/admin/ledger（アカウント台帳）で共用。

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function requireAdmin(): Promise<
  | { ok: true; email: string }
  | { ok: false; response: NextResponse }
> {
  const supabaseReady = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  if (!supabaseReady) {
    return { ok: false, response: NextResponse.json({ error: 'サーバー設定が不足しています' }, { status: 500 }) }
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: 'login_required' }, { status: 401 }) }
  }
  const adminEmails = (process.env.COMP_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  const isAdmin = !!user.email && adminEmails.includes(user.email.toLowerCase())
  if (!isAdmin) {
    return { ok: false, response: NextResponse.json({ error: 'forbidden' }, { status: 403 }) }
  }
  return { ok: true, email: user.email! }
}
