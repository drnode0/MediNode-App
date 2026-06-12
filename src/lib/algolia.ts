import algoliasearch from 'algoliasearch'
import { getSettings } from './settings'

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

export function hasSubscriptionConfig(): boolean {
  const { appId, searchKey } = getSubscriptionConfig()
  return !!(appId && searchKey)
}

let _cachedSubClient: { appId: string; searchKey: string; client: ReturnType<typeof algoliasearch> } | null = null
export function createSubscriptionSearchClient() {
  const { appId, searchKey } = getSubscriptionConfig()
  if (_cachedSubClient && _cachedSubClient.appId === appId && _cachedSubClient.searchKey === searchKey) {
    return _cachedSubClient.client
  }
  const client = algoliasearch(appId, searchKey)
  _cachedSubClient = { appId, searchKey, client }
  return client
}

export function getSubscriptionIndexName() {
  return getSubscriptionConfig().index
}
