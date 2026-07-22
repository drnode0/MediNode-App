import type { ReaderDoc } from './reader-doc'

// アプリ内リーダー本文のクライアントキャッシュ＋プリフェッチ。
// 「本文を読む」を押してからNotion API往復を待つとストレスになるため、
// 読みそうな瞬間（カード展開・答え表示・ホバー）に先読みしておき、
// 開く時はキャッシュから即表示する。
const TTL_MS = 10 * 60 * 1000
const docs = new Map<string, { doc: ReaderDoc; at: number }>()
const inflight = new Map<string, Promise<ReaderDoc>>()

export function fetchReaderDoc(objectID: string): Promise<ReaderDoc> {
  const hit = docs.get(objectID)
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.doc)
  const pending = inflight.get(objectID)
  if (pending) return pending
  const p = fetch(`/api/subscription/page?id=${encodeURIComponent(objectID)}`)
    .then(async (r) => {
      if (!r.ok) throw new Error(String(r.status))
      return r.json()
    })
    .then((d) => {
      docs.set(objectID, { doc: d.doc as ReaderDoc, at: Date.now() })
      return d.doc as ReaderDoc
    })
    .finally(() => {
      inflight.delete(objectID)
    })
  inflight.set(objectID, p)
  return p
}

export function getCachedReaderDoc(objectID: string): ReaderDoc | null {
  const hit = docs.get(objectID)
  if (!hit) return null
  if (Date.now() - hit.at >= TTL_MS) {
    docs.delete(objectID)
    return null
  }
  return hit.doc
}

// 先読み専用。失敗は握りつぶす（エラーはキャッシュしないので、開く時に普通に再試行される）。
export function prefetchReaderDoc(objectID: string): void {
  void fetchReaderDoc(objectID).catch(() => {})
}

export function clearReaderDocCache(): void {
  docs.clear()
  inflight.clear()
}
