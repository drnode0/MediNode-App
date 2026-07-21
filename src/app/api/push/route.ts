// push の段階公開。GET=管理者にstageを返す・POST=stage切替（off/preview/on）。
// daily-question route の stage 切替と同型。
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin-guard'
import { isAdminEmail } from '@/lib/maintenance'
import { PUSH_FLAG_KEY, parseStage, readPushStage, pushEnabledFor, __resetPushStageCache } from '@/lib/push'

export async function GET() {
  const stage = await readPushStage()
  let email: string | null = null
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    email = user?.email ?? null
  } catch {}
  const enabled = pushEnabledFor(stage, email)
  return NextResponse.json({ enabled, ...(isAdminEmail(email) ? { stage } : {}) })
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  let body: { stage?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSONが不正です' }, { status: 400 })
  }
  if (body.stage !== 'off' && body.stage !== 'preview' && body.stage !== 'on') {
    return NextResponse.json({ error: 'stage は off / preview / on で指定してください' }, { status: 400 })
  }
  const stage = parseStage(body.stage)
  try {
    const admin = createAdminClient()
    const { error } = await admin.from('app_flags').upsert(
      { key: PUSH_FLAG_KEY, value: stage !== 'off', stage, updated_at: new Date().toISOString(), updated_by: auth.email },
      { onConflict: 'key' },
    )
    if (error) throw new Error(error.message)
    __resetPushStageCache()
    return NextResponse.json({ ok: true, stage })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : '不明なエラー' }, { status: 500 })
  }
}
