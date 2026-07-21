import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { DEFAULT_PREFS } from '@/lib/push'
import { getUserPrefs, saveUserPrefs, mergePrefs } from '@/lib/push-prefs'

function ready(): boolean {
  return !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export async function GET() {
  if (!ready()) return NextResponse.json({ prefs: DEFAULT_PREFS })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ prefs: DEFAULT_PREFS })
  try {
    const prefs = await getUserPrefs(createAdminClient(), user.id)
    return NextResponse.json({ prefs })
  } catch {
    return NextResponse.json({ prefs: DEFAULT_PREFS })
  }
}

export async function POST(req: NextRequest) {
  if (!ready()) return NextResponse.json({ ok: false, prefs: DEFAULT_PREFS })
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, prefs: DEFAULT_PREFS })
  let body: { prefs?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, prefs: DEFAULT_PREFS })
  }
  const prefs = mergePrefs(body.prefs)
  try {
    await saveUserPrefs(createAdminClient(), user.id, prefs)
    return NextResponse.json({ ok: true, prefs })
  } catch {
    return NextResponse.json({ ok: false, prefs })
  }
}
