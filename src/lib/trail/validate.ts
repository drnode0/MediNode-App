// trail の API が受け取る本文の検証。純ロジック（ルートから切り出してテストで固める）。
// 書き込む前に形をそろえ、合わないものは理由の鍵（error）を付けて断る。
// 長すぎる入力は切り詰めずに断る（本人の書いたものを黙って変えない）。
import { QUERY_MAX_LEN, cleanQuery } from './match'
import { OUTSIDE_KEYS } from './outside'

export const SAVE_LIMITS = { url: 2000, title: 300, note: 2000, body: 10000 } as const

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function validUuid(value: unknown): string | null {
  return typeof value === 'string' && UUID_RE.test(value.trim()) ? value.trim().toLowerCase() : null
}

export function validOutsideKey(value: unknown): string | null {
  return typeof value === 'string' && OUTSIDE_KEYS.includes(value) ? value : null
}

// http(s) だけを通す。javascript: などの別の仕組みのリンクを残すと、後で開いたときに
// 本人の画面で動いてしまうため。
export function cleanUrl(value: unknown): string | null | 'invalid' {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return 'invalid'
  const s = value.trim()
  if (!s) return null
  if (s.length > SAVE_LIMITS.url) return 'invalid'
  try {
    const u = new URL(s)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'invalid'
    return u.toString()
  } catch {
    return 'invalid'
  }
}

function cleanText(value: unknown, max: number): string | 'invalid' {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') return 'invalid'
  const s = value.trim()
  return s.length > max ? 'invalid' : s
}

// 残したもの1件の出どころ。段階1は「外で調べて戻ってきた」と「貼り付け」の2つだけ。
// 共有ボタン・LINE・メール・取り込みは後の段階でここに足す（鍵の名前は変えない）。
export type SaveOrigin = 'lookup' | 'paste'

export type SaveInput = {
  lookupId: string | null
  query: string | null
  url: string | null
  title: string
  note: string
  body: string
  origin: SaveOrigin
  outside: string | null
}

export type SaveError = 'bad_request' | 'bad_url' | 'too_long' | 'empty'

export function parseSaveBody(raw: unknown): { ok: true; value: SaveInput } | { ok: false; error: SaveError } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'bad_request' }
  const b = raw as Record<string, unknown>
  // 文字列であるべき欄に別の型が来たら、長さの問題ではなく形の問題として断る。
  for (const k of ['title', 'note', 'body', 'query'] as const) {
    if (b[k] !== undefined && b[k] !== null && typeof b[k] !== 'string') return { ok: false, error: 'bad_request' }
  }

  const url = cleanUrl(b.url)
  if (url === 'invalid') return { ok: false, error: 'bad_url' }
  const title = cleanText(b.title, SAVE_LIMITS.title)
  const note = cleanText(b.note, SAVE_LIMITS.note)
  const body = cleanText(b.body, SAVE_LIMITS.body)
  if (title === 'invalid' || note === 'invalid' || body === 'invalid') return { ok: false, error: 'too_long' }

  // 問いは任意。あるときは検索と同じ整え方にそろえる（照合で同じ扱いにするため）。
  let query: string | null = null
  if (b.query !== undefined && b.query !== null && b.query !== '') {
    if (typeof b.query !== 'string' || b.query.length > QUERY_MAX_LEN) return { ok: false, error: 'too_long' }
    query = cleanQuery(b.query)
  }

  // 何も無い1件は残さない（あとで見返しても何のことか分からない）。問いだけでは足りない。
  // 問いは検索の記録としてすでに残っているので、ここで重ねる意味が無い。
  if (!url && !title && !note && !body) return { ok: false, error: 'empty' }

  const lookupId = validUuid(b.lookupId)
  const outside = validOutsideKey(b.outside)
  // 出どころはサーバーが決める（呼び手の申告を信じない）。外の行き先か検索の記録に
  // つながっていれば「外で調べて残した」、そうでなければ「貼り付け」。
  const origin: SaveOrigin = lookupId || outside ? 'lookup' : 'paste'

  return { ok: true, value: { lookupId, query, url, title, note, body, origin, outside } }
}
