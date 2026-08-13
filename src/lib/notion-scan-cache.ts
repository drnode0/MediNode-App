// シンプルモード検索（/api/notion/search）のDB走査キャッシュ。
//
// なぜ要るか（2026-08-13）:
// Notionのtitleフィルタは前方一致しかできず要約・キーワードを検索できないため、
// このアプリは「DBを100件ずつページネーションで取得して JS側の matchesKeyword で絞る」
// 方式を採っている。素直に書くと打鍵ごとに最大1500件をNotionから取り直すことになり、
// これがシンプルモードの体感ラグ（実測2秒超）の主因になっている。
//
// 方針: 取得済みのページを「どこまで読んだか（cursor）」つきで持っておき、次の検索は
// まず手元の records を絞る。足りなければ続きから読み足す。これで
//   - 初回検索は従来どおり（早期打ち切りも効いたまま＝遅くならない）
//   - 2回目以降の打鍵はNotion往復ゼロで返る
//   - 読み進めるほど手元のインデックスが育つ
// という挙動になる。
//
// 保存先はサーバーインスタンスのメモリだけ（Vercel Data Cache等には置かない）。
// 利用者本人のNotion本文を永続ストアに置かないための判断。インスタンスが再利用される
// 数分のあいだだけ効き、それ以外は従来どおりNotionから取り直す。
//
// 鮮度: シンプルモードには同期ボタンが無く「Notionを直したら次の検索で反映される」ことが
// 前提なので、TTLは短く取る。打鍵1回ぶん（数秒〜十数秒）を確実に覆えればよい。

export const SCAN_TTL_MS = 60_000
// 同時に抱えるDBの数。1エントリ最大1500件（実測でおよそ数百KB）なので、
// 1インスタンスのメモリを圧迫しない範囲に抑える。超えたら古い順に捨てる。
export const SCAN_MAX_ENTRIES = 24

export type ScanState<T> = {
  records: T[]
  // 次に読むページの位置。undefined かつ done=false は「まだ1ページも読んでいない」。
  cursor?: string
  // 最終ページまで読み切ったか。true なら records がそのDBの全件（上限内）。
  done: boolean
  at: number
}

export type ScanCache<T> = {
  get(key: string, now: number): ScanState<T> | null
  set(key: string, state: ScanState<T>): void
  size(): number
  clear(): void
}

export function createScanCache<T>(
  ttlMs: number = SCAN_TTL_MS,
  maxEntries: number = SCAN_MAX_ENTRIES,
): ScanCache<T> {
  const store = new Map<string, ScanState<T>>()
  return {
    get(key, now) {
      const hit = store.get(key)
      if (!hit) return null
      if (now - hit.at >= ttlMs) {
        store.delete(key)
        return null
      }
      return hit
    },
    set(key, state) {
      // 再挿入で反復順（＝古い順）を更新する。
      store.delete(key)
      store.set(key, state)
      while (store.size > maxEntries) {
        const oldest = store.keys().next().value
        if (oldest === undefined) break
        store.delete(oldest)
      }
    },
    size: () => store.size,
    clear: () => store.clear(),
  }
}
