// 調べた言葉の記録をすべて消す（本人の操作）。残したもの（saved_items）は消さない
// （残したものは本人がそのつど選んだもので、検索の記録とは別に扱う。つながりだけが外れる）。
import { requireTrail, serverError, json, notFound } from '@/lib/trail/guard'

export const dynamic = 'force-dynamic'

export const GET = notFound
export const HEAD = notFound
export const OPTIONS = notFound
export const POST = notFound
export const PUT = notFound
export const PATCH = notFound

export async function DELETE() {
  const g = await requireTrail()
  if (!g.ok) return g.response
  const { error } = await g.supabase.from('trail_lookups').delete().eq('user_id', g.userId)
  if (error) return serverError('lookups: 削除に失敗', error)
  return json({ ok: true })
}
