// comp（無料解放）の棚卸し・無効化のための管理用エンドポイント。
//
//   GET  /api/premium/comp        … 現在 comp を持つユーザー一覧を返す（棚卸し）
//   POST /api/premium/comp        … 指定ユーザーの comp を取り消す（無効化 / revoke）
//                                    Body: { userId: string }
//
// アクセス制御:
//   - ログイン必須。さらに COMP_ADMIN_EMAILS に含まれるメール（=オーナー）のみ許可。
//   - 一般ユーザーや未ログインには 401/403 を返し、一覧も操作もさせない。
//
// 無効化の二段構え（ユーザー要望）:
//   1) コード失効 … Vercel の COMP_INVITE_CODES から該当コードを外す → 以後そのコードは使えない
//                   （このAPIではなく環境変数操作。既存付与には影響しない）
//   2) 個別revoke … このエンドポイントで、すでに付与済みユーザーの comp を取り消す

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listComplimentary, revokeComplimentaryByUserId } from '@/lib/supabase/subscriptions'

// ログインユーザーがオーナー（COMP_ADMIN_EMAILS）かどうかを判定する。
async function requireAdmin(): Promise<
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

// 棚卸し: comp 一覧を返す。
export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  try {
    const rows = await listComplimentary()
    return NextResponse.json({ ok: true, count: rows.length, items: rows })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// 無効化: 指定ユーザーの comp を取り消す。
export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  try {
    const { userId } = await req.json()
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId を指定してください' }, { status: 400 })
    }
    const revoked = await revokeComplimentaryByUserId(userId)
    if (!revoked) {
      return NextResponse.json({ ok: false, error: '対象の comp 行が見つかりません' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, userId, status: 'canceled' })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
