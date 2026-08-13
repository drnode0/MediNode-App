'use client'
// シンプルモード検索の「端末内インデックス」の保管庫（IndexedDB）。
//
// 走査キャッシュ（サーバー側）で打鍵ごとのNotion往復は消えたが、打鍵ごとの
// サーバー往復1回（実測100〜300ms）は残っていた。個人DBの一覧は数百件〜1500件で、
// タイトル・要約・キーワードだけなら端末に載る。載せてしまえば検索は端末内で完結し、
// ネットワークが一切要らなくなる（2026-08-13）。
//
// 保存はレコード配列を丸ごと1エントリ。差分更新はしない —— 一覧は常に全件で取り直す方が
// 単純で、取り直しはアプリを開いたときの裏側1回だけなので割に合う。
//
// reader-doc-store と同じくIndexedDBだが、DBを分けている。本文（60件・数MB）と
// 一覧（1件・最大1MB程度）は寿命も消し方も違うため、片方の事情でもう片方を
// 巻き込まないようにする。

const DB_NAME = 'medinode-index'
const DB_VERSION = 1
const STORE = 'index'
const KEY = 'personal'

export type IndexEntry<T> = { records: T[]; at: number }

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(null)
    let req: IDBOpenDBRequest
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION)
    } catch {
      return resolve(null)
    }
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
  return dbPromise
}

function store(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore | null {
  try {
    return db.transaction(STORE, mode).objectStore(STORE)
  } catch {
    return null
  }
}

// 失敗（プライベートモード・容量超過・非対応）はすべて握り潰す。インデックスが
// 無ければサーバー検索にそのまま落ちるだけで、検索が壊れることはない。
export async function readIndex<T>(): Promise<IndexEntry<T> | null> {
  const db = await openDb()
  if (!db) return null
  const s = store(db, 'readonly')
  if (!s) return null
  return new Promise((resolve) => {
    const req = s.get(KEY)
    req.onsuccess = () => resolve((req.result as IndexEntry<T> | undefined) ?? null)
    req.onerror = () => resolve(null)
  })
}

export async function writeIndex<T>(records: T[], now = Date.now()): Promise<void> {
  const db = await openDb()
  if (!db) return
  const s = store(db, 'readwrite')
  if (!s) return
  try {
    s.put({ records, at: now } satisfies IndexEntry<T>, KEY)
  } catch {
    // 容量超過など。次に開いたときサーバー検索へ落ちるだけ。
  }
}

// アカウント切り替え時に呼ぶ（前の持ち主の一覧を次のユーザーに見せない）。
export async function clearIndex(): Promise<void> {
  const db = await openDb()
  if (!db) return
  const s = store(db, 'readwrite')
  if (!s) return
  try {
    s.delete(KEY)
  } catch {
    // 消せなくても次の取得で上書きされる。
  }
}
