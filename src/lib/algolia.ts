import algoliasearch from 'algoliasearch'
import { getSettings } from './settings'
import { recordPremiumUse } from './premium-usage'

function getAlgoliaConfig() {
  const settings = getSettings()
  return {
    appId: settings?.algoliaAppId || '',
    searchKey: settings?.algoliaSearchKey || '',
    index: settings?.algoliaIndex || 'medical_knowledge',
  }
}

let _cachedClient: { appId: string; searchKey: string; client: ReturnType<typeof algoliasearch> } | null = null
export function createSearchClient() {
  const { appId, searchKey } = getAlgoliaConfig()
  if (_cachedClient && _cachedClient.appId === appId && _cachedClient.searchKey === searchKey) {
    return _cachedClient.client
  }
  const client = algoliasearch(appId, searchKey)
  _cachedClient = { appId, searchKey, client }
  return client
}

export function getIndexName() {
  return getAlgoliaConfig().index
}

// ============================================================
// サブスク用（作者が用意した別Algoliaアカウント）
// ============================================================

// プレミアム用Algoliaインデックス名は作者が固定で管理しているのでハードコード。
// 変更したい場合はここを書き換えて再デプロイ。
const PREMIUM_INDEX_NAME = 'Medical Knowledge_DB（サブスク用）'

function getSubscriptionConfig() {
  const settings = getSettings()
  return {
    appId: settings?.subscriptionAppId || '',
    searchKey: settings?.subscriptionSearchKey || '',
    // プレミアムインデックスは作者が固定管理するため、常にハードコード名を使う。
    // 過去に localStorage（subscriptionIndex）へ古いインデックス名（例: subscription_medical）が
    // 保存されていると、同期先と検索先がズレて「データがありません」になる。これを防ぐため
    // localStorage の値には依存させず、検索先を PREMIUM_INDEX_NAME に固定する。
    index: PREMIUM_INDEX_NAME,
  }
}

// トライアル（クーポンコード経由）の期限が切れていないかを判定する。
// Stripe正式登録の場合は subscriptionTrialEndsAt が空なので常に有効。
export function isSubscriptionTrialExpired(): boolean {
  const settings = getSettings()
  const endsAt = settings?.subscriptionTrialEndsAt
  if (!endsAt) return false // 期限指定なし（Stripe正式登録 or 未設定）= 期限切れ扱いしない
  const end = new Date(endsAt).getTime()
  if (Number.isNaN(end)) return false
  return Date.now() > end
}

export function hasSubscriptionConfig(): boolean {
  const { appId, searchKey } = getSubscriptionConfig()
  // キーが揃っていても、トライアル期限を過ぎていたらプレミアム無効とみなす。
  if (isSubscriptionTrialExpired()) return false
  return !!(appId && searchKey)
}

let _cachedSubClient: { appId: string; searchKey: string; client: ReturnType<typeof algoliasearch> } | null = null
export function createSubscriptionSearchClient() {
  const { appId, searchKey } = getSubscriptionConfig()
  if (_cachedSubClient && _cachedSubClient.appId === appId && _cachedSubClient.searchKey === searchKey) {
    return _cachedSubClient.client
  }
  const client = algoliasearch(appId, searchKey)

  // プレミアム利用の計測: このクライアント経由の検索が成功したら記録する（1時間1回に抑制）。
  // 検索セクション・ジャンル・クイズ等どの入口でも必ずここを通るので、一括で拾える。
  // 計測は結果のPromiseに相乗りするだけで、検索の成否・結果には一切影響しない。
  const rawInitIndex = client.initIndex.bind(client)
  ;(client as { initIndex: typeof client.initIndex }).initIndex = (indexName: string) => {
    const index = rawInitIndex(indexName)
    const rawSearch = index.search.bind(index)
    ;(index as { search: typeof index.search }).search = ((...args: Parameters<typeof rawSearch>) => {
      const result = rawSearch(...args)
      result.then(() => recordPremiumUse()).catch(() => {})
      return result
    }) as typeof index.search
    return index
  }

  _cachedSubClient = { appId, searchKey, client }
  return client
}

export function getSubscriptionIndexName() {
  return getSubscriptionConfig().index
}
