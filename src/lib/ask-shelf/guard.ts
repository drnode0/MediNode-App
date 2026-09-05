// 聞ける棚のルートの共通ガード。機能が閉じている利用者には 404 を返し、存在を見せない。
// recall/guard.ts と同型（拒否に本文を持たせない・未実装メソッドも同じ 404 で塞ぐ）。
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sessionHasFeature } from '@/lib/supabase/early-access'

export function notFound(): NextResponse {
  return new NextResponse(null, { status: 404 })
}

// Next が自動で埋める OPTIONS(204)・他(405) は requireAskShelf を通らないため、
// 存在しない経路との違いが1リクエストで分かってしまう。同じ 404 で塞ぐ。
export const HEAD = notFound
export const OPTIONS = notFound
export const PUT = notFound
export const PATCH = notFound
export const DELETE = notFound

export async function requireAskShelf(): Promise<
  | {
      ok: true
      supabase: Awaited<ReturnType<typeof createClient>>
      admin: () => ReturnType<typeof createAdminClient>
      userId: string
      email: string | null
    }
  | { ok: false; response: NextResponse }
> {
  if (!(await sessionHasFeature('ask_shelf'))) return { ok: false, response: notFound() }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'login_required' }, { status: 401 }) }
  return { ok: true, supabase, admin: () => createAdminClient(), userId: user.id, email: user.email ?? null }
}

export function serverError(where: string, error: { message: string }): NextResponse {
  console.error(`[ask-shelf] ${where}: ${error.message}`)
  return NextResponse.json({ error: 'server_error' }, { status: 500 })
}
