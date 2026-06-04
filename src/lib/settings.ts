// ユーザーのAPIキー設定をlocalStorageで管理するユーティリティ

export type AppSettings = {
  notionToken: string
  notionMedicalDbId: string
  notionReferenceDbId: string
  algoliaAppId: string
  algoliaSearchKey: string
  algoliaAdminKey: string
  algoliaIndex: string
}

const STORAGE_KEY = 'medical_search_settings'

export function getSettings(): AppSettings | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as AppSettings
  } catch {
    return null
  }
}

export function saveSettings(settings: AppSettings): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function clearSettings(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
}

export function isSetupComplete(): boolean {
  const s = getSettings()
  if (!s) return false
  return !!(
    s.notionToken &&
    s.notionMedicalDbId &&
    s.algoliaAppId &&
    s.algoliaSearchKey &&
    s.algoliaAdminKey
  )
}
