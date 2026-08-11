// 職種（アカウント属性）API。
// GET  /api/account/profile … ログイン本人の { occupation: string | null }。未ログインは401。
// POST /api/account/profile … { occupation } を保存。リスト外は400。未ログインは401。
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getUserOccupation, saveUserOccupation, isValidOccupation } from '@/lib/account-profile'

function ready(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export async function GET() {
  // Supabase未設定環境（ローカル等）では「職種なし」として静かに通す。
  if (!ready()) return NextResponse.json({ occupation: null })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'login_required' }, { status: 401 })
  const occupation = await getUserOccupation(createAdminClient(), user.id)
  return NextResponse.json({ occupation })
}

export async function POST(req: NextRequest) {
  if (!ready()) return NextResponse.json({ ok: false, error: 'not_configured' }, { status: 503 })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'login_required' }, { status: 401 })
  let body: { occupation?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 })
  }
  if (!isValidOccupation(body.occupation)) {
    return NextResponse.json({ ok: false, error: 'invalid_occupation' }, { status: 400 })
  }
  try {
    await saveUserOccupation(createAdminClient(), user.id, body.occupation)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: 'save_failed' }, { status: 500 })
  }
}
