// メンテナンスモードの状態取得と切替。
//   GET  /api/maintenance … 公開。現在の状態＋このセッションがオーナーかを返す。
//                           オーナーには通行cookie（maint_bypass）を付与する。
//   POST /api/maintenance … 管理者限定（requireAdmin）。フラグを更新する。
// クライアント（MaintenanceGate）と管理UI（/admin/maintenance）から呼ばれる。

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin-guard'
import {
  MAINTENANCE_BYPASS_COOKIE,
  MAINTENANCE_FLAG_KEY,
  isAdminEmail,
  signBypassToken,
  readMaintenanceFlag,
  __resetMaintenanceFlagCache,
} from '@/lib/maintenance'

export async function GET() {
  const maintenance = await readMaintenanceFlag()

  let isAdmin = false
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    isAdmin = isAdminEmail(user?.email)
  } catch {
    // 未ログイン等は非オーナー扱い。
  }

  const res = NextResponse.json({ maintenance, isAdmin })
  if (isAdmin) {
    const token = await signBypassToken()
    if (token) {
      res.cookies.set(MAINTENANCE_BYPASS_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 7 * 24 * 60 * 60,
      })
    }
  }
  return res
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body: { maintenance?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSONが不正です' }, { status: 400 })
  }
  if (typeof body.maintenance !== 'boolean') {
    return NextResponse.json(
      { error: 'maintenance は boolean で指定してください' },
      { status: 400 },
    )
  }

  try {
    const admin = createAdminClient()
    const { error } = await admin.from('app_flags').upsert(
      {
        key: MAINTENANCE_FLAG_KEY,
        value: body.maintenance,
        updated_at: new Date().toISOString(),
        updated_by: auth.email,
      },
      { onConflict: 'key' },
    )
    if (error) throw new Error(error.message)
    __resetMaintenanceFlagCache() // このインスタンスは次の読取で即最新化
    return NextResponse.json({ ok: true, maintenance: body.maintenance })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
