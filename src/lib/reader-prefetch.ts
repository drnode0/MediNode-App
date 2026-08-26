import type { ReaderDoc } from './reader-doc'
import type { SpreadDoc } from './reader-spread'
import { getSettings } from './settings'
import { clearStoredDocs, writeStoredDoc } from './reader-doc-store'
import { clearIndex } from './notion-index-store'

// アプリ内リーダー本文のクライアントキャッシュ＋プリフェッチ。
// 「本文を読む」を押してからNotion API往復を待つとストレスになるため、
// 読みそうな瞬間（カード展開・答え表示・ホバー）に先読みしておき、
// 開く時はキャッシュから即表示する。
// objectID の接頭辞で取得先を分ける:
//   subscription_… → GET /api/subscription/page（サーバーのトークン・共有キャッシュ）
//   personal_/team_… → POST /api/personal/page（自分のトークンを都度渡す・降格式リーダー）
const TTL_MS = 10 * 60 * 1000
const docs = new Map<string, { doc: ReaderDoc; at: number }>()
// 誌面は本文と同じ応答で届くので、同じタイミングで別のMapに置く。
// fetchReaderDoc の戻り値（ReaderDoc）は変えない。呼び出し側が10箇所以上あるため。
const spreads = new Map<string, SpreadDoc | null>()
const inflight = new Map<string, Promise<ReaderDoc>>()

function requestFor(objectID: string): Promise<Response> {
  if (/^(personal|team)_/.test(objectID)) {
    const s = getSettings()
    return fetch('/api/personal/page', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: objectID,
        notionToken: s?.notionToken || undefined,
        teamNotionToken: s?.teamNotionToken || undefined,
        additionalTeams: (s?.additionalTeams || []).map((t) => ({ notionToken: t.notionToken })),
      }),
    })
  }
  return fetch(`/api/subscription/page?id=${encodeURIComponent(objectID)}`)
}

export function fetchReaderDoc(objectID: string): Promise<ReaderDoc> {
  const hit = docs.get(objectID)
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.doc)
  const pending = inflight.get(objectID)
  if (pending) return pending
  const p = requestFor(objectID)
    .then(async (r) => {
      if (!r.ok) throw new Error(String(r.status))
      return r.json()
    })
    .then((d) => {
      const doc = d.doc as ReaderDoc
      const spread = (d.spread as SpreadDoc | undefined) ?? null
      docs.set(objectID, { doc, at: Date.now() })
      spreads.set(objectID, spread)
      // 端末にも残す（リロード・PWA再起動を跨いで速く開くため）。失敗は握り潰される。
      void writeStoredDoc(objectID, doc, spread)
      return doc
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

export function getCachedSpread(objectID: string): SpreadDoc | null {
  return spreads.get(objectID) ?? null
}

// 先読み専用。失敗は握りつぶす（エラーはキャッシュしないので、開く時に普通に再試行される）。
export function prefetchReaderDoc(objectID: string): void {
  void fetchReaderDoc(objectID).catch(() => {})
}

// アカウント切り替え時に呼ばれる（AuthProvider）。端末に残した本文も一緒に消す ——
// 前の持ち主の個人・部署ページを次のユーザーに見せないため。
export function clearReaderDocCache(): void {
  docs.clear()
  spreads.clear()
  inflight.clear()
  void clearStoredDocs()
  // 端末内インデックス（一覧）も消す。本文だけ消しても、前の持ち主のページタイトル・
  // 要約が検索結果に出てしまう。
  void clearIndex()
}
