// 「外で調べる」で外へ出たことを記録する（どの行き先へ出たか・いつ）。
// 次に同じことを調べたとき「そのときは PubMed を開いています」と出すための材料。
// 検索の記録が無い（記録のスイッチを切っている）ときは何も書かずに成功を返す。
import { requireTrail, notFound, serverError, json } from '@/lib/trail/guard'
import { validOutsideKey, validUuid } from '@/lib/trail/validate'

export const dynamic = 'force-dynamic'

export const GET = notFound
export const HEAD = notFound
export const OPTIONS = notFound
export const PUT = notFound
export const PATCH = notFound
export const DELETE = notFound

export async function POST(req: Request) {
  const g = await requireTrail()
  if (!g.ok) return g.response
  const body = (await req.json().catch(() => null)) as { lookupId?: unknown; dest?: unknown } | null
  const dest = validOutsideKey(body?.dest)
  if (!dest) return json({ error: 'bad_dest' }, 400)
  const lookupId = validUuid(body?.lookupId)
  if (!lookupId) return json({ ok: true, recorded: false })

  const cur = await g.supabase
    .from('trail_lookups')
    .select('outside')
    .eq('id', lookupId)
    .eq('user_id', g.userId)
    .maybeSingle()
  if (cur.error) return serverError('outside: 記録の読み取りに失敗', cur.error)
  // 本人の記録に無い（消した直後など）。外へ出ること自体は止めない。
  if (!cur.data) return json({ ok: true, recorded: false })

  const prev = (cur.data as { outside?: unknown }).outside
  const list = Array.isArray(prev) ? prev.filter((x): x is string => typeof x === 'string') : []
  const outside = list.includes(dest) ? list : [...list, dest]
  const up = await g.supabase
    .from('trail_lookups')
    .update({ outside, outside_at: new Date().toISOString() })
    .eq('id', lookupId)
    .eq('user_id', g.userId)
  if (up.error) return serverError('outside: 記録の書き込みに失敗', up.error)
  return json({ ok: true, recorded: true })
}
