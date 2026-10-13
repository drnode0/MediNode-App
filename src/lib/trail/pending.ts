// 外部サイトのボタンで外へ出たことを、戻ってくるまで端末に覚えておく（localStorage）。
// アプリに戻った瞬間に残すシートを出すための材料。サーバーには送らない
// （外へ出た事実そのものは /api/trail/outside が検索の記録に書く。ここは画面の段取りだけ）。
//
// PWA はバックグラウンドで止められて読み込み直されることがあるので、メモリではなく
// localStorage に置く（読み込み直しても、戻ったときにシートを出せる）。

export type TrailPending = {
  lookupId: string | null
  query: string
  dest: string
  at: number
}

const KEY = 'medinode_trail_pending'

// 外へ出てすぐ戻ったのは押し間違いとみなし、シートを出さない。
export const RETURN_MIN_AWAY_MS = 4 * 1000
// 長く経ってから戻ったときは、もう別の用事。古い問いでシートを出さない。
export const RETURN_MAX_AGE_MS = 3 * 60 * 60 * 1000

// シートを手で開く（検索画面の「残す」）ときの合図。detail は TrailSaveRequest。
export const TRAIL_SAVE_OPEN_EVENT = 'medinode:trail-save-open'
// 1件残したあとの合図。メモの一覧と検索の結果が読み直す。
export const TRAIL_SAVED_EVENT = 'medinode:trail-saved'

export type TrailSaveRequest = { lookupId: string | null; query: string; dest: string | null }

export function setPending(p: TrailPending): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)) } catch {}
}

export function clearPending(): void {
  try { localStorage.removeItem(KEY) } catch {}
}

export function getPending(): TrailPending | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return parsePending(JSON.parse(raw))
  } catch {
    return null
  }
}

// 壊れた値・古い形は null（別のバージョンが書いた値でも落ちない）。
export function parsePending(v: unknown): TrailPending | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (typeof o.query !== 'string' || typeof o.dest !== 'string' || typeof o.at !== 'number') return null
  const lookupId = typeof o.lookupId === 'string' ? o.lookupId : null
  return { lookupId, query: o.query, dest: o.dest, at: o.at }
}

// 戻ってきたときにシートを出すか。
export function shouldOfferReturn(p: TrailPending | null, now: number): boolean {
  if (!p) return false
  const away = now - p.at
  return away >= RETURN_MIN_AWAY_MS && away <= RETURN_MAX_AGE_MS
}

export function requestSaveSheet(detail: TrailSaveRequest): void {
  try { window.dispatchEvent(new CustomEvent<TrailSaveRequest>(TRAIL_SAVE_OPEN_EVENT, { detail })) } catch {}
}
