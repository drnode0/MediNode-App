// ユーザーのAPIキー設定をlocalStorageで管理するユーティリティ

export type SearchMode = 'notion' | 'algolia'

export type AppSettings = {
  // 検索モード
  searchMode: SearchMode

  // 個人用（必須）
  notionToken: string
  notionMedicalDbId: string
  notionReferenceDbId: string

  // Algoliaモードのみ必須
  algoliaAppId: string
  algoliaSearchKey: string
  algoliaAdminKey: string
  algoliaIndex: string

  // 部署用（任意）
  teamLabel: string
  teamNotionToken: string
  teamNotionMedicalDbId: string
  teamNotionReferenceDbId: string

  // サブスク用（任意・Algoliaモードのみ）
  subscriptionSearchKey: string
  subscriptionAppId: string
  subscriptionIndex: string
  // 無料トライアル（クーポンコード経由・カード不要）の有効期限（ISO文字列）。
  // この日時を過ぎたらプレミアムを無効化する。Stripe正式登録の場合は空のまま。
  subscriptionTrialEndsAt?: string

  // プロパティ名マッピング（任意）
  propSummary: string       // デフォルト: 要約
  propKeywords: string      // デフォルト: キーワード
  propKnowledgeLevel: string // デフォルト: 知識レベル
  propGenre: string         // デフォルト: ジャンル
}

const STORAGE_KEY = 'medical_search_settings'
const DRAFT_KEY = 'medical_search_setup_draft'
const LAST_SYNCED_KEY = 'medical_search_last_synced'
// この端末でトライアルコードを使用済みかを記録するキー。
// 期限切れ後に同じ端末で再度コードを使う“実質無限トライアル”をカジュアルに防ぐための軽量対策。
// 注意: 別ブラウザ・シークレット・別端末・localStorage削除では回避可能（厳密対策はサーバー側のメール登録制が必要）。
const TRIAL_USED_KEY = 'medical_search_trial_used'

// トライアルコードを使ったことを記録する。
export function markTrialUsed(): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(TRIAL_USED_KEY, new Date().toISOString())
}

// この端末で過去にトライアルコードを使ったことがあるか。
export function hasUsedTrial(): boolean {
  if (typeof window === 'undefined') return false
  return !!localStorage.getItem(TRIAL_USED_KEY)
}

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

  // 個人DB / 部署DB / プレミアム のいずれか1つでも設定されていれば開始できる。
  // （ゲスト参加で個人DBを持たない人や、プレミアムだけ使いたい人に対応）
  const hasPersonal = !!(s.notionToken && s.notionMedicalDbId)
  const hasTeam = !!(s.teamNotionToken && s.teamNotionMedicalDbId)
  // プレミアムは作者配信のAlgoliaを使うため本人DB不要で単独成立する。
  // 期限切れの無効化は表示側（hasSubscriptionConfig）が担保するため、
  // 完了判定には期限を持ち込まない（settings→algolia の循環import回避も兼ねる）。
  const hasPremium = !!(s.subscriptionAppId && s.subscriptionSearchKey)

  if (!hasPersonal && !hasTeam && !hasPremium) return false

  // 個人DB／部署DBを Algolia（パワーモード）で使う場合は Algolia キーも必要。
  const usesOwnAlgolia = (hasPersonal || hasTeam) && s.searchMode === 'algolia'
  if (usesOwnAlgolia) {
    return !!(s.algoliaAppId && s.algoliaSearchKey && s.algoliaAdminKey)
  }

  // 上記以外（Notionモードで個人/部署DBあり、またはプレミアムのみ）は完了。
  return true
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
