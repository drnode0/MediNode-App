// 「解決した」を押した直後から、同期が追いつくまでの間だけ泡を伏せておく控え。
//
// パワーモードの泡の一覧は Algolia から引く。「解決した」は Notion のページを
// 書き換えるので、再同期するまで Algolia は ❓CQ のままで、リロードすると
// 片づけたはずの泡が戻ってくる。押した側からは操作が無かったのと同じに見える。
//
// そこで押した objectID を端末に控え、一覧から落とす。同期が回れば Notion 側が
// 💡ナレッジになって一覧から自然に消えるので、この控えは役目を終える。
// 期限を切って捨てるのは、消えた理由（同期済み）を確かめる術が無いまま溜め続けないため。
//
// 「元に戻す」を押したら控えからも外す（泡が戻る）。

const KEY = 'medinode_locally_resolved_v1'
// 控えを保つ期間。これを過ぎた分は落とす（普通は数分〜数時間で同期が回る）。
const TTL_MS = 60 * 24 * 60 * 60 * 1000

type Store = Record<string, number>

function read(): Store {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Store
  } catch {
    return {}
  }
}

function write(store: Store): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store))
  } catch {}
}

// 期限切れを落として返す（読むたびに掃除する）。
export function readLocallyResolved(now = Date.now()): Set<string> {
  const store = read()
  const live: Store = {}
  let dropped = false
  for (const [id, at] of Object.entries(store)) {
    if (typeof at === 'number' && now - at < TTL_MS) live[id] = at
    else dropped = true
  }
  if (dropped) write(live)
  return new Set(Object.keys(live))
}

export function markLocallyResolved(objectID: string, now = Date.now()): void {
  if (!objectID) return
  write({ ...read(), [objectID]: now })
}

export function unmarkLocallyResolved(objectID: string): void {
  const store = read()
  if (!(objectID in store)) return
  delete store[objectID]
  write(store)
}
