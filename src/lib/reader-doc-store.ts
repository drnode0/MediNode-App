'use client'
import type { ReaderDoc } from './reader-doc'
import type { SpreadDoc } from './reader-spread'

// 読んだ本文を端末に残す（IndexedDB）。
//
// なぜ要るか（2026-08-13）: 本文のキャッシュ（reader-prefetch）はメモリのMapだけなので、
// リロード・PWA再起動で全部消える。「一度読んだものは速いが、翌日は全部また初回」という
// 状態だった。永続化すると、昨日読んだページが今日も即座に開く。
//
// localStorage ではなく IndexedDB を使うのは、本文1件が数十KBあり、同期APIで
// 大きなJSONを読み書きすると入力や描画を止めてしまうため（localStorage は同期）。
//
// 保存されるのは利用者本人の端末だけ。サーバーには何も送らない・置かない。
// アカウントが切り替わったら clearStoredDocs() で消す（reader-prefetch の
// clearReaderDocCache から呼ばれる）。

const DB_NAME = 'medinode-reader'
const DB_VERSION = 1
const STORE = 'docs'

// 残す本数。1件が数十KB程度なので、60件でも数MB —— ブラウザがオリジンに割り当てる
// 容量（数百MB〜）から見れば桁が違う。超えたら古い順に捨てる。
export const MAX_STORED_DOCS = 60

// spread は後から足したキー。既存エントリには無いので必ず optional として扱う。
type Entry = { objectID: string; doc: ReaderDoc; spread?: SpreadDoc | null; at: number }

// 失敗（プライベートモード・容量超過・非対応）は握り潰す。ここが原因で本文が
// 開かなくなることは絶対に避ける。呼び出し側は常にネットワーク取得を並行して走らせる。
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
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'objectID' })
        store.createIndex('at', 'at')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
    req.onblocked = () => resolve(null)
  })
  return dbPromise
}

function tx(db: IDBDatabase, mode: IDBTransactionMode): IDBObjectStore | null {
  try {
    return db.transaction(STORE, mode).objectStore(STORE)
  } catch {
    return null
  }
}

export async function readStoredDoc(objectID: string): Promise<ReaderDoc | null> {
  const db = await openDb()
  if (!db) return null
  const store = tx(db, 'readonly')
  if (!store) return null
  return new Promise((resolve) => {
    const req = store.get(objectID)
    req.onsuccess = () => resolve((req.result as Entry | undefined)?.doc ?? null)
    req.onerror = () => resolve(null)
  })
}

// Entry から誌面を取り出す純関数（テスト可能にするため分けてある）。
export function pickStoredSpread(entry: Entry | undefined): SpreadDoc | null {
  return entry?.spread ?? null
}

export async function readStoredSpread(objectID: string): Promise<SpreadDoc | null> {
  const db = await openDb()
  if (!db) return null
  const store = tx(db, 'readonly')
  if (!store) return null
  return new Promise((resolve) => {
    const req = store.get(objectID)
    req.onsuccess = () => resolve(pickStoredSpread(req.result as Entry | undefined))
    req.onerror = () => resolve(null)
  })
}

export async function writeStoredDoc(
  objectID: string,
  doc: ReaderDoc,
  spread: SpreadDoc | null = null,
  now = Date.now(),
): Promise<void> {
  const db = await openDb()
  if (!db) return
  const store = tx(db, 'readwrite')
  if (!store) return
  try {
    store.put({ objectID, doc, spread, at: now } satisfies Entry)
  } catch {
    // 容量超過など。保存できなくても読める状態は変わらないので黙って諦める。
    return
  }
  await evictOldest(db)
}

// 上限を超えた分を、古い順（at昇順）に捨てる。
async function evictOldest(db: IDBDatabase): Promise<void> {
  const store = tx(db, 'readwrite')
  if (!store) return
  await new Promise<void>((resolve) => {
    const countReq = store.count()
    countReq.onerror = () => resolve()
    countReq.onsuccess = () => {
      let over = countReq.result - MAX_STORED_DOCS
      if (over <= 0) return resolve()
      let index: IDBIndex
      try {
        index = store.index('at')
      } catch {
        return resolve()
      }
      const cursorReq = index.openCursor()
      cursorReq.onerror = () => resolve()
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result
        if (!cursor || over <= 0) return resolve()
        cursor.delete()
        over--
        cursor.continue()
      }
    }
  })
}

export async function clearStoredDocs(): Promise<void> {
  const db = await openDb()
  if (!db) return
  const store = tx(db, 'readwrite')
  if (!store) return
  try {
    store.clear()
  } catch {
    // 消せなくても致命的ではない（次の書き込みで上書きされる）。
  }
}
