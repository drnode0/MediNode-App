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

export function createSearchClient() {
  const { appId, searchKey } = getAlgoliaConfig()
  return algoliasearch(appId, searchKey)
}

export function getIndexName() {
  return getAlgoliaConfig().index
}
