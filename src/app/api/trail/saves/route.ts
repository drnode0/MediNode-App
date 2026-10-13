// 残したもの（saved_items）の一覧・追加・削除。
// 保存1件 = 本人が選んだ原文・出所＋任意の一言（制作計画3章の形）。保存の成立先は MediNode の
// アカウントで、Notion への書き込みは待たない（アプリから Notion は書き換えない）。
import { requireTrail, serverError, json, notFound, savedFromRow, SAVED_LIST_COLS } from '@/lib/trail/guard'
import { parseSaveBody, validUuid } from '@/lib/trail/validate'

export const dynamic = 'force-dynamic'

export const HEAD = notFound
export const OPTIONS = notFound
export const PUT = notFound
export const PATCH = notFound

// ホームの「最近残したもの」に出す数。全部を並べる画面は段階2（ライブラリ）で作る。
const LIST_LIMIT = 20

function toClient(r: Record<string, unknown>) {
  const s = savedFromRow(r)
  return { id: s.id, query: s.query, title: s.title, note: s.note, url: s.url, origin: s.origin, outside: s.outside, createdAt: s.createdAt }
}

export async function GET() {
  const g = await requireTrail()
  if (!g.ok) return g.response
  const { data, error } = await g.supabase
    .from('saved_items')
    .select(SAVED_LIST_COLS)
    .eq('user_id', g.userId)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT)
  if (error) return serverError('saves: 一覧の読み取りに失敗', error)
  return json({ items: (data ?? []).map((r) => toClient(r as Record<string, unknown>)) })
}

export async function POST(req: Request) {
  const g = await requireTrail()
  if (!g.ok) return g.response
  const parsed = parseSaveBody(await req.json().catch(() => null))
  if (!parsed.ok) return json({ error: parsed.error }, 400)
  const v = parsed.value

  // 検索の記録へのつながりは、本人の記録に実在するときだけ付ける（よその行の id を付けさせない）。
  // 無ければつながりだけを外して残す（残すこと自体は止めない）。
  let lookupId = v.lookupId
  if (lookupId) {
    const own = await g.supabase.from('trail_lookups').select('id').eq('id', lookupId).eq('user_id', g.userId).maybeSingle()
    if (own.error) return serverError('saves: 検索の記録の確認に失敗', own.error)
    if (!own.data) lookupId = null
  }

  const { data, error } = await g.supabase
    .from('saved_items')
    .insert({
      user_id: g.userId,
      origin: v.origin,
      lookup_id: lookupId,
      query: v.query,
      url: v.url,
      title: v.title,
      note: v.note,
      body: v.body,
      outside: v.outside,
    })
    .select(SAVED_LIST_COLS)
    .single()
  if (error || !data) return serverError('saves: 書き込みに失敗', error ?? { message: 'insert returned no row' })
  return json({ item: toClient(data as Record<string, unknown>) }, 201)
}

export async function DELETE(req: Request) {
  const g = await requireTrail()
  if (!g.ok) return g.response
  const id = validUuid(new URL(req.url).searchParams.get('id'))
  if (!id) return json({ error: 'bad_id' }, 400)
  const { error } = await g.supabase.from('saved_items').delete().eq('id', id).eq('user_id', g.userId)
  if (error) return serverError('saves: 削除に失敗', error)
  return json({ ok: true })
}
