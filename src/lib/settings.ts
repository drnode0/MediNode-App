// ユーザーのAPIキー設定をlocalStorageで管理するユーティリティ

import type { TeamConfig } from './teams'

export type SearchMode = 'notion' | 'algolia'

export type AppSettings = {
  // 検索モード
  searchMode: SearchMode

  // 個人用（必須）
  notionToken: string
  notionMedicalDbId: string
  notionReferenceDbId: string
  // マニュアル・お知らせ・業務改善DB（任意）。未設定なら📋マニュアルタブは非表示。
  notionManualDbId: string
  // Notion接続の出自（任意）。'oauth'=かんたん接続で取得したトークン。
  // 未設定/'manual'=手入力。下流の同期・検索はこのフラグを区別しない（表示と再接続導線のみ）。
  notionAuthKind?: 'oauth' | 'manual'
  // かんたん接続時のワークスペース名（表示用）
  notionWorkspaceName?: string
  // 認可フローでテンプレート複製が行われた場合の複製先ページID（将来のGA用に保持のみ）
  notionDuplicatedTemplateId?: string
  // かんたん接続で置き換えられる前の手動Tokenの退避（任意）。手動接続へ戻せるようにするため
  // claim 時にだけ書かれる。すでにOAuthのトークンを持っている人の分は上書きされない。
  notionTokenPrev?: string
  // 退避した notionTokenPrev がどの出自だったか（通常 'manual'）。
  notionAuthKindPrev?: string

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
  // 部署のマニュアルDB（任意）
  teamNotionManualDbId: string
  // 追加部署（先行体験・マルチ部署串刺し検索）。earlyAccess なアカウントだけ設定できる。
  // 未設定/空 = 既存挙動と完全一致（サーバーは earlyAccess を再検証してからのみ使う）。
  additionalTeams?: TeamConfig[]
  // サーバー由来の先行体験フラグのミラー（表示制御のみ・判定の正はサーバー）。
  earlyAccess?: boolean
  // サーバー由来の先行体験・機能一覧のミラー（表示制御のみ・判定の正はサーバー）。
  // 値は 'easy_connect' / 'multi_department' / 'tower'。
  earlyAccessFeatures?: string[]

  // サブスク用（任意・Algoliaモードのみ）
  subscriptionSearchKey: string
  subscriptionAppId: string
  subscriptionIndex: string
  // 無料トライアル（クーポンコード経由・カード不要）の有効期限（ISO文字列）。
  // この日時を過ぎたらプレミアムを無効化する。Stripe正式登録の場合は空のまま。
  subscriptionTrialEndsAt?: string
  // Stripe契約の解約予約（cancel_at_period_end）の終了日時（ISO文字列）。
  // 空=解約予約なし。値がある間は「解約手続き済み・この日まで利用可能」を表示する
  // （有効性の判定には使わない。判定はサーバーの status/trial_ends_at が担う）。
  subscriptionCancelAt?: string

  // プロパティ名マッピング（任意）。
  // 既存のNotion DBを「列名を書き換えずに」つなぐための読み替え。空=既定名を使う。
  propSummary: string       // デフォルト: 要約
  propKeywords: string      // デフォルト: キーワード
  propKnowledgeLevel: string // デフォルト: 知識レベル
  propGenre: string         // デフォルト: ジャンル

  // 表示のカスタマイズ（任意・未設定=表示）。
  // 検索・まとめ用途で使う人向けに、学習系のUIを消せるようにする。
  hideQuizTab?: boolean   // クイズタブを非表示
  hideCqButton?: boolean  // CQ登録の浮きボタンを非表示（個人Notionを使わない人向け）
  // 未解決の問い（/cq）の第2の空「みんなが待っている問い」を非表示。
  // 自分の問いだけを静かに眺めたい人向け。自分の空は消せない（画面の本体なので）。
  hideCommunityCqs?: boolean

  // 本文フォールバック（任意・パワーモードの同期のみ）。
  // ONのとき、要約が空のページは本文冒頭を代わりに索引する（同期は遅くなる）。
  syncBodyFallback?: boolean
}

// 同期API・接続テストAPIへ送る列名の読み替え表を組み立てる。
// 入力のない項目は「キーごと落とす」。'' を送るとAPIが空文字の列名を探しに行き、
// 既定名（要約/キーワード/知識レベル/ジャンル）での解決が働かなくなる。
export type PropMap = {
  summary?: string
  keywords?: string
  knowledgeLevel?: string
  genre?: string
}

export function buildPropMap(
  settings: Partial<Pick<AppSettings, 'propSummary' | 'propKeywords' | 'propKnowledgeLevel' | 'propGenre'>> | null | undefined,
): PropMap {
  const pick = (v: string | undefined) => {
    const trimmed = (v || '').trim()
    return trimmed || undefined
  }
  const map: PropMap = {
    summary: pick(settings?.propSummary),
    keywords: pick(settings?.propKeywords),
    knowledgeLevel: pick(settings?.propKnowledgeLevel),
    genre: pick(settings?.propGenre),
  }
  // undefined のキーは JSON.stringify で消えるが、比較・テストのために実体からも落とす。
  ;(Object.keys(map) as Array<keyof PropMap>).forEach((k) => {
    if (map[k] === undefined) delete map[k]
  })
  return map
}

const STORAGE_KEY = 'medical_search_settings'
const DRAFT_KEY = 'medical_search_setup_draft'
const LAST_SYNCED_KEY = 'medical_search_last_synced'
// この端末でローカル設定を最後に更新した時刻（ISO）。端末間同期の last-write-wins 比較に使う。
const SETTINGS_UPDATED_KEY = 'medical_search_settings_updated'
// この端末でトライアルコードを使用済みかを記録するキー。
// 期限切れ後に同じ端末で再度コードを使う“実質無限トライアル”をカジュアルに防ぐための軽量対策。
// 注意: 別ブラウザ・シークレット・別端末・localStorage削除では回避可能（厳密対策はサーバー側のメール登録制が必要）。
const TRIAL_USED_KEY = 'medical_search_trial_used'
// サーバー保存が401（セッション不達）で拒否されたときに発火するイベント名。
// 発火: saveSettings / 購読: AuthNotice（再ログインを促すバナー表示）。
export const SESSION_LOST_EVENT = 'medinode-session-lost'

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

// ローカル保存が成功したかを返す（false=プライベートモード/容量超過等で書けなかった）。
// 呼び出し側は戻り値を無視してもよいが、セットアップ完了処理などは false を見て
// 「この端末には保存できませんでした（ログインすればサーバーに保存されます）」を案内できる。
export function saveSettings(settings: AppSettings, opts?: { skipServer?: boolean }): boolean {
  if (typeof window === 'undefined') return false
  // localStorage への書き込みは iOS プライベートブラウズや容量超過で throw することがある。
  // ここで throw すると呼び出し元（セットアップ完了・プレミアム確定）の処理が中断するため、
  // 例外を飲み込んでサーバー保存の継続に委ねる。
  let localOk = true
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
    localStorage.setItem(SETTINGS_UPDATED_KEY, new Date().toISOString())
  } catch {
    localOk = false
  }

  // ログイン中ならサーバーにも保存して端末間同期する（fire-and-forget・失敗は次回保存に委ねる）。
  // skipServer は、SettingsSync がサーバー値をローカルへ復元した直後の echo POST を防ぐためのフラグ。
  if (opts?.skipServer) return localOk
  try {
    void fetch('/api/user-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
      cache: 'no-store',
      keepalive: true,
    })
      .then((res) => {
        // 401 = クライアントはログイン済みのつもりでも、サーバーにセッションが届いていない
        // （Cookie不達・期限切れ）。黙って握り潰すと「保存できているつもりで同期されない」
        // 端末が生まれ、機種変更や再インストール時に古い設定しか復元できなくなる。
        // AuthNotice がこのイベントを拾ってバナーで再ログインを促す。
        if (res.status === 401 && typeof window !== 'undefined') {
          window.dispatchEvent(new Event(SESSION_LOST_EVENT))
        }
      })
      .catch(() => {})
  } catch {
    // 未ログイン・ネットワーク失敗等は無視（API側で401を返すだけ）。次回 saveSettings で再送される。
  }
  return localOk
}

// ローカル設定の最終更新時刻（端末間同期の last-write-wins 比較用）。
export function getSettingsUpdatedAt(): string | null {
  if (typeof window === 'undefined') return null
  return localStorage.getItem(SETTINGS_UPDATED_KEY)
}

// サーバー由来の更新時刻をローカルの基準として記録する（SettingsSync が復元時に使う）。
export function setSettingsUpdatedAt(iso: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(SETTINGS_UPDATED_KEY, iso)
  } catch {
    // プライベートモード/容量超過。同期の基準時刻が書けないだけで致命的ではない。
  }
}

export function clearSettings(): void {
  if (typeof window === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(LAST_SYNCED_KEY)
  localStorage.removeItem(SETTINGS_UPDATED_KEY)
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

// セットアップ途中の一時保存（best-effort。書けなくても入力は続けられる）。
export function saveDraft(draft: Partial<AppSettings>): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // プライベートモード/容量超過。下書きが残らないだけで完了処理には影響しない。
  }
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

// DB ID比較用の正規化（OAuthFinishのrepickプリフィル比較で使用）。
// extractNotionDbId は手入力を「ハイフン無し32桁・小文字」に揃えるが、list-databases API が
// 返すIDはNotionのsearch応答そのまま（ハイフン付きUUID）。表記が違う2つのIDが同じDBを
// 指しているかどうかを判定するには、双方をこの正規化（ハイフン除去＋小文字化）にかけてから
// 比較する必要がある。生の文字列比較のままだと、手入力でDBを登録したユーザー全員が
// repick のプリフィルから漏れる（Finding 1）。
export function normalizeNotionId(id: string): string {
  return id.trim().toLowerCase().replace(/-/g, '')
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

// 端末間同期のマージ。primary（新しい側）を基本にしつつ、primaryが空の項目は
// secondary（古い側）の値で埋める＝「空欄で非空を上書きしない」ユニオン。
//
// これが無いと、PWA再インストール直後の“部分的なローカル設定”（例: Algoliaだけ
// 入力・Notion Tokenは空）が新しいタイムスタンプでサーバーの完全な設定を消して
// しまい、ログインしてもNotion Tokenが戻らない、という事故が起きる。
// 値が入っている項目どうしが衝突したときだけ primary（新しい側）を優先する。
export function mergeSettings(
  primary: AppSettings | null,
  secondary: AppSettings | null,
): AppSettings | null {
  if (!primary) return secondary
  if (!secondary) return primary
  const isEmpty = (v: unknown) => v === undefined || v === null || v === ''
  const out: Record<string, unknown> = { ...secondary, ...primary }
  const keys = new Set([...Object.keys(secondary), ...Object.keys(primary)])
  for (const k of keys) {
    const pv = (primary as Record<string, unknown>)[k]
    const sv = (secondary as Record<string, unknown>)[k]
    out[k] = isEmpty(pv) ? sv : pv
  }
  return out as AppSettings
}
