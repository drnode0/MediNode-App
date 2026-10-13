// 検索を1件記録し、「前にも調べています」に出すものを返す。
// 照合と書き方の判断は src/lib/trail/match.ts（純ロジック）が持ち、ここは読み書きだけをする。
// record: false のときは書かずに照合だけを返す（本人が記録のスイッチを切っている場合）。
import { cleanQuery, normalizeQuery, pickPrevious, planLookupWrite, type PastLookup } from '@/lib/trail/match'
import {
  requireTrail, notFound, serverError, json, isUniqueViolation, lookupFromRow, savedFromRow,
  LOOKUP_COLS, SAVED_COLS, LOOKUPS_READ_LIMIT, SAVED_READ_LIMIT,
} from '@/lib/trail/guard'

export const dynamic = 'force-dynamic'

// POST だけが本業。ほかのメソッドは機能の有無にかかわらず同じ 404 で閉じる
// （Next が自動で埋める 405/204 との違いから、機能の存在が分からないようにする）。
export const GET = notFound
export const HEAD = notFound
export const OPTIONS = notFound
export const PUT = notFound
export const PATCH = notFound
export const DELETE = notFound

export async function POST(req: Request) {
  const g = await requireTrail()
  if (!g.ok) return g.response
  const body = (await req.json().catch(() => null)) as { query?: unknown; record?: unknown } | null
  const query = cleanQuery(body?.query)
  if (!query) return json({ error: 'bad_query' }, 400)
  const record = body?.record !== false
  const norm = normalizeQuery(query)
  const now = Date.now()

  const [lk, sv] = await Promise.all([
    g.supabase
      .from('trail_lookups')
      .select(LOOKUP_COLS)
      .eq('user_id', g.userId)
      .order('last_searched_at', { ascending: false })
      .limit(LOOKUPS_READ_LIMIT),
    g.supabase
      .from('saved_items')
      .select(SAVED_COLS)
      .eq('user_id', g.userId)
      .order('created_at', { ascending: false })
      .limit(SAVED_READ_LIMIT),
  ])
  if (lk.error) return serverError('lookup: 記録の読み取りに失敗', lk.error)
  if (sv.error) return serverError('lookup: 残したものの読み取りに失敗', sv.error)
  const lookups = (lk.data ?? []).map(lookupFromRow)
  const saved = (sv.data ?? []).map(savedFromRow)

  // 照合は書く前の記録で行う（書いたあとだと、今の検索が「前の検索」として自分に一致してしまう）。
  const previous = pickPrevious({ query, now, lookups, saved })
  if (!record) return json({ lookupId: null, previous })

  const written = await writeLookup(g, { query, norm, now, lookups })
  if ('error' in written) return serverError(`lookup: 記録の書き込みに失敗（${written.where}）`, written.error)
  return json({ lookupId: written.id, previous })
}

type Guarded = Extract<Awaited<ReturnType<typeof requireTrail>>, { ok: true }>
type WriteResult = { id: string } | { error: { message: string; code?: string }; where: string }

async function writeLookup(
  g: Guarded,
  input: { query: string; norm: string; now: number; lookups: PastLookup[] },
): Promise<WriteResult> {
  const { query, norm, now, lookups } = input
  const at = new Date(now).toISOString()
  const plan = planLookupWrite({ norm, now, lookups })
  const timesOf = (id: string) => lookups.find((l) => l.id === id)?.times ?? 1

  if (plan.kind === 'touch' || plan.kind === 'touchAndDrop') {
    const patch: Record<string, unknown> = { query, last_searched_at: at }
    if (plan.newOccasion) patch.times = timesOf(plan.id) + 1
    const up = await g.supabase.from('trail_lookups').update(patch).eq('id', plan.id).eq('user_id', g.userId)
    if (up.error) return { error: up.error, where: 'touch' }
    if (plan.kind === 'touchAndDrop') {
      // 断片の行を消す。失敗しても今の検索の記録は済んでいるので、ログに残して続ける。
      const del = await g.supabase.from('trail_lookups').delete().eq('id', plan.dropId).eq('user_id', g.userId)
      if (del.error) console.error(`[trail] lookup: 断片の削除に失敗: ${del.error.message}`)
    }
    return { id: plan.id }
  }

  if (plan.kind === 'replace') {
    const up = await g.supabase
      .from('trail_lookups')
      .update({ query, norm, last_searched_at: at })
      .eq('id', plan.id)
      .eq('user_id', g.userId)
    if (!up.error) return { id: plan.id }
    // 読んだ範囲（新しい順 LOOKUPS_READ_LIMIT 件）の外に同じ言葉の行があった。そちらを進める。
    if (!isUniqueViolation(up.error)) return { error: up.error, where: 'replace' }
    return touchExisting(g, { query, norm, at })
  }

  const ins = await g.supabase
    .from('trail_lookups')
    .insert({ user_id: g.userId, query, norm, first_searched_at: at, last_searched_at: at })
    .select('id')
    .single()
  if (!ins.error && ins.data) return { id: String((ins.data as { id: unknown }).id) }
  // 同じ言葉の検索が同時に届いた、または読んだ範囲の外に同じ言葉の行があった。
  if (ins.error && isUniqueViolation(ins.error)) return touchExisting(g, { query, norm, at })
  return { error: ins.error ?? { message: 'insert returned no row' }, where: 'insert' }
}

async function touchExisting(g: Guarded, input: { query: string; norm: string; at: string }): Promise<WriteResult> {
  const found = await g.supabase
    .from('trail_lookups')
    .select('id')
    .eq('user_id', g.userId)
    .eq('norm', input.norm)
    .maybeSingle()
  if (found.error || !found.data) return { error: found.error ?? { message: 'row vanished' }, where: 'touchExisting' }
  const id = String((found.data as { id: unknown }).id)
  const up = await g.supabase
    .from('trail_lookups')
    .update({ query: input.query, last_searched_at: input.at })
    .eq('id', id)
    .eq('user_id', g.userId)
  if (up.error) return { error: up.error, where: 'touchExisting' }
  return { id }
}
