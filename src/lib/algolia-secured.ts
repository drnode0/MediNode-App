// プレミアム用 Algolia キーの発行（S-4: 期限をキー自体に暗号で埋め込む）。
//
// 生の Search-Only キー（SUBSCRIPTION_ALGOLIA_SEARCH_KEY）をそのまま配布すると、
// DevTools で抜かれた場合に無期限で使われ、コード式トライアルの期限もクライアント側の
// 判定頼みになる。Secured API Key は親キーから HMAC で導出され、
//   - validUntil（有効期限）… 期限切れ＝Algolia 側で検索が物理的に不能。改ざん不可
//   - restrictIndices      … サブスク用インデックス以外を触れない
// をキー自体に焼き込める。生成はローカル計算のみで Algolia への往復は発生しない。
//
// 有効期限は「UTC日でグリッド化」する（now を直接使わない）。同じ日のうちは同じ
// validUntil → 同じキーが生成されるため、PremiumSync の「キーが変わったら保存して
// リロード」ロジックが日に1回しか発火しない（毎回変わるとリロードループになる）。

import algoliasearch from 'algoliasearch'

const DAY_SEC = 24 * 60 * 60
// グリッド先の日数。ユーザーが毎日開かなくても数日は持ち、漏えい時の寿命は短く。
const KEY_LIFETIME_DAYS = 8

// 「今日(UTC)の 0:00 + KEY_LIFETIME_DAYS 日」を unix 秒で返す。日内で不変。
function gridValidUntil(): number {
  const todayUtc = Math.floor(Date.now() / 1000 / DAY_SEC) * DAY_SEC
  return todayUtc + KEY_LIFETIME_DAYS * DAY_SEC
}

// プレミアム用の短命 Search キーを発行する。
// expiresAt（ISO文字列）を渡すと、グリッド期限とのうち早い方を採用する
// （コード式トライアルは trialEndsAt ちょうどでキーも失効させる）。
export function issuePremiumSearchKey(opts: {
  appId: string
  parentSearchKey: string
  index: string
  expiresAt?: string | null
}): string {
  const grid = gridValidUntil()
  let validUntil = grid
  if (opts.expiresAt) {
    const ts = Math.floor(new Date(opts.expiresAt).getTime() / 1000)
    if (Number.isFinite(ts) && ts > 0) validUntil = Math.min(grid, ts)
  }
  const client = algoliasearch(opts.appId, opts.parentSearchKey)
  return client.generateSecuredApiKey(opts.parentSearchKey, {
    validUntil,
    restrictIndices: [opts.index],
    // sectionText（節本文）はスニペット経由でのみ見せる設計（インデックス既定の
    // attributesToRetrieve: ['*', '-sectionText']）。それをキー自体にも焼き込み、
    // クエリ時に attributesToRetrieve: ['sectionText'] 等で上書きして全文ダンプ
    // されるのを防ぐ（Secured Key に埋めたパラメータはクエリ時に強制され上書き不可）。
    attributesToRetrieve: ['*', '-sectionText'],
  })
}
