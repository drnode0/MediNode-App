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
const DRAFT_KEY = 'medical_search_setup_draft'
const LAST_SYNCED_KEY = 'medical_search_last_synced'

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
  localStorage.removeItem(LAST_SYNCED_KEY)
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

// セットアップ途中の一時保存
export function saveDraft(draft: Partial<AppSettings>): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
}

export function getDraft(): Partial<AppSettings> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    return JSON.parse(raw) as Partial<AppSettings>
  } catch {
    return null
  }
}

export function clearDraft(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(DRAFT_KEY)
}

// 最終同期日時
export function saveLastSynced(): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(LAST_SYNCED_KEY, new Date().toISOString())
}

export function getLastSynced(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(LAST_SYNCED_KEY)
}

// 最終同期日時を人間が読みやすい形式に変換
export function formatLastSynced(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000)
  if (diffMin < 1) return 'たった今'
  if (diffMin < 60) return `${diffMin}分前`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour}時間前`
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}

// NotionのURLからDB IDを抽出
export function extractNotionDbId(input: string): string {
  const trimmed = input.trim()
  // すでにIDの形式（32文字の英数字またはハイフン区切り）
  if (/^[a-f0-9]{32}$/.test(trimmed)) return trimmed
  if (/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(trimmed)) {
    return trimmed.replace(/-/g, '')
  }
  // URLからIDを抽出
  // https://www.notion.so/workspace/Title-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx?v=...
  // https://www.notion.so/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx?v=...
  const urlMatch = trimmed.match(/([a-f0-9]{32})(?:[?&]|$)/)
  if (urlMatch) return urlMatch[1]
  // ハイフン付きUUID形式のURLも対応
  const uuidMatch = trimmed.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/)
  if (uuidMatch) return uuidMatch[1].replace(/-/g, '')
  // 抽出できなかった場合はそのまま返す
  return trimmed
}
