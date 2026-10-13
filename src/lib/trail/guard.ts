// 調べた記録（trail）のルートの共通ガード。recall/guard.ts と同じ考え方：
// 機能が閉じている利用者には本文の無い 404 を返し、機能があること自体を見せない。
// 開いている利用者の読み書きは、本人のセッション（RLS で本人の行だけ）で行う。
// service_role は使わない（本人以外の行に触る理由が無いため、鍵ごと持たせない）。
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sessionHasFeature } from '@/lib/supabase/early-access'
import type { PastLookup, SavedItem } from './match'

export function notFound(): NextResponse {
  return new NextResponse(null, { status: 404 })
}

export async function requireTrail(): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; userId: string }
  | { ok: false; response: NextResponse }
> {
  if (!(await sessionHasFeature('trail'))) return { ok: false, response: notFound() }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'login_required' }, { status: 401 }) }
  return { ok: true, supabase, userId: user.id }
}

// PostgREST/Postgres の生のメッセージ（表名・列名・RLS の診断）は返さない。ログにだけ残す。
// 調べた言葉そのものはログにも書かない（where には場所だけを書く）。
export function serverError(where: string, error: { message: string }): NextResponse {
  console.error(`[trail] ${where}: ${error.message}`)
  return NextResponse.json({ error: 'server_error' }, { status: 500, headers: NO_STORE })
}

// 本人の記録なので、どの層にも残させない。
export const NO_STORE = { 'Cache-Control': 'private, no-store' } as const

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE })
}

// 照合のために1回で読む上限。段階1は本人だけが使う前提で、全件を読んで TypeScript で照合する
// （照合の正を match.ts の1か所に保つため）。件数が増えて読む量が負担になったら、
// PGroonga（0031 と同じ拡張）で候補を絞ってから match.ts に渡す形へ変える。
export const LOOKUPS_READ_LIMIT = 500
export const SAVED_READ_LIMIT = 500

export const LOOKUP_COLS = 'id, query, norm, first_searched_at, last_searched_at, times, outside'
export const SAVED_COLS = 'id, lookup_id, query, title, note, body, url, origin, outside, created_at'
// 一覧に返す列。本文（body）は返さない（一覧には要らず、量だけが増える）。
export const SAVED_LIST_COLS = 'id, lookup_id, query, title, note, url, origin, outside, created_at'

type Row = Record<string, unknown>

export function lookupFromRow(r: Row): PastLookup {
  return {
    id: String(r.id),
    query: String(r.query ?? ''),
    norm: String(r.norm ?? ''),
    firstSearchedAt: String(r.first_searched_at ?? ''),
    lastSearchedAt: String(r.last_searched_at ?? ''),
    times: Number(r.times ?? 1),
    outside: Array.isArray(r.outside) ? (r.outside as unknown[]).filter((x): x is string => typeof x === 'string') : [],
  }
}

export function savedFromRow(r: Row): SavedItem {
  return {
    id: String(r.id),
    lookupId: typeof r.lookup_id === 'string' ? r.lookup_id : null,
    query: typeof r.query === 'string' ? r.query : null,
    title: String(r.title ?? ''),
    note: String(r.note ?? ''),
    body: String(r.body ?? ''),
    url: typeof r.url === 'string' ? r.url : null,
    origin: String(r.origin ?? ''),
    outside: typeof r.outside === 'string' ? r.outside : null,
    createdAt: String(r.created_at ?? ''),
  }
}

// Postgres の一意制約違反。同じ言葉の検索が同時に2回届いたときに起きうる。
export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === '23505'
}
