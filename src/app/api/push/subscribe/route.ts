// Web Push 購読の登録/解除。ログイン中ユーザーの購読を user 単位で保存する。
// env/migration 未整備・未ログインは静かに {ok:false}（アプリは通常どおり）。
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

function ready(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export async function POST(req: NextRequest) {
  if (!ready()) return NextResponse.json({ ok: false })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false })

  let body: { endpoint?: string; keys?: { p256dh?: string; auth?: string }; ua?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false })
  }
  const endpoint = body.endpoint
  const p256dh = body.keys?.p256dh
  const auth = body.keys?.auth
  if (!endpoint || !p256dh || !auth) return NextResponse.json({ ok: false })

  try {
    const admin = createAdminClient()
    const { error } = await admin.from('push_subscriptions').upsert(
      { endpoint, user_id: user.id, p256dh, auth, ua: body.ua ?? null, revoked_at: null },
      { onConflict: 'endpoint' },
    )
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}

export async function DELETE(req: NextRequest) {
  if (!ready()) return NextResponse.json({ ok: false })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false })
  let body: { endpoint?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false })
  }
  if (!body.endpoint) return NextResponse.json({ ok: false })
  try {
    const admin = createAdminClient()
    await admin
      .from('push_subscriptions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('endpoint', body.endpoint)
      .eq('user_id', user.id)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false })
  }
}
