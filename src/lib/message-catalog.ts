// アプリがユーザーに出している通知・表示の「全カタログ」。
//
// 目的: Push / 画面バナー / モーダル / 静かなNew・バッジ / 設定内 に散らばった
//       ユーザー向けメッセージを1つのレジストリに集約し、/admin で見える化する。
//       これが唯一の一覧の真実。将来「即ON/OFF・優先度制御」を足す土台にもなる。
//
// 注意: trigger/frequency はコードの挙動を人が要約したもの（コードと同期させて保つ）。
//       ランタイム状態を持つのは flag 付き項目（app_flags の3キー）だけ。
//
// 棚卸し出典: docs/superpowers/specs/2026-07-24-message-catalog-design.md

export type MessageChannel = 'push' | 'banner' | 'modal' | 'quiet' | 'settings'

export type HealthLevel = 'ok' | 'hardcoded' | 'dead' | 'env-override' | 'preview-locked'

export type CatalogFlag = 'maintenance' | 'daily_question' | 'push'

export type CatalogItem = {
  id: string
  name: string
  channel: MessageChannel
  where: string // どこで出る
  trigger: string // 出る条件
  frequency: string // 頻度
  control: string // 制御の説明（人間可読）
  controllable: boolean // オーナーがランタイムで操作できるか
  flag?: CatalogFlag // ライブ状態（ON/preview/OFF）を出す対象
  storageKeys?: string[]
  file?: string // 主な参照
  health?: { level: HealthLevel; note: string }
}

export const CHANNEL_LABELS: Record<MessageChannel, string> = {
  push: 'Web Push（端末通知）',
  banner: '画面バナー（上部スタック）',
  modal: 'モーダル・全画面（初回/フロー）',
  quiet: '静かな通知（New・バッジ・由来）',
  settings: '設定内の文脈バナー',
}

export const HEALTH_LABELS: Record<HealthLevel, string> = {
  ok: '正常',
  hardcoded: 'ハードコード（要デプロイ）',
  dead: '死にチャネル（無効）',
  'env-override': 'env上書きの罠',
  'preview-locked': 'preview運用中',
}

export const MESSAGE_CATALOG: CatalogItem[] = [
  // ── Web Push ───────────────────────────────────────────────
  {
    id: 'push-daily',
    name: '今日の1問（Push）',
    channel: 'push',
    where: '端末通知',
    trigger: 'cron30分毎・各ユーザーの設定時間帯に1日1回（daily_push_logで重複防止）',
    frequency: '1日1回/人',
    control: '段階フラグ（off/preview/on）のみ。文面・時間帯はロジック＋cronで固定',
    controllable: true,
    flag: 'push',
    file: 'src/app/api/cron/daily-push/route.ts',
    health: { level: 'preview-locked', note: '現在は preview 運用（意図的・本人と指定アドレスのみ）' },
  },
  {
    id: 'push-announce',
    name: 'お知らせ一斉送信（Push）',
    channel: 'push',
    where: '端末通知',
    trigger: 'オーナーが /admin のフォームから手動送信',
    frequency: '任意（週1目安・UI注記のみ）',
    control: '✅ フル操作（文面作成＆送信）。段階フラグに従う',
    controllable: true,
    flag: 'push',
    file: 'src/app/api/admin/push-broadcast/route.ts',
    health: { level: 'ok', note: '' },
  },
  {
    id: 'push-resolved-cq',
    name: '解決CQ通知（Push）',
    channel: 'push',
    where: '（現状は出ない）',
    trigger: 'ユーザー設定にトグルはあるが、送信するコードが存在しない',
    frequency: '—',
    control: '実質無効',
    controllable: false,
    file: 'src/lib/push.ts（kind定義のみ・sender無し）',
    health: { level: 'dead', note: 'トグルはあるが送信元が無い＝押しても何も起きない。要判断（実装 or 撤去）' },
  },

  // ── 画面バナー ─────────────────────────────────────────────
  {
    id: 'banner-pwa',
    name: 'PWA導入案内（ホーム画面に追加）',
    channel: 'banner',
    where: 'アプリ上部',
    trigger: 'Webで開いていて(非standalone)かつ未閉じ',
    frequency: '×で恒久非表示',
    control: 'ハードコード（/adminトグル無し）',
    controllable: false,
    storageKeys: ['medinode_pwa_banner_dismissed_v1'],
    file: 'src/components/AppBanners.tsx',
    health: { level: 'hardcoded', note: 'コードのみ。表示条件・文面はソース固定' },
  },
  {
    id: 'banner-announcement',
    name: 'お知らせ / 更新バナー',
    channel: 'banner',
    where: 'アプリ上部＋設定「お知らせ・更新履歴」',
    trigger: '未読のお知らせ（ANNOUNCEMENTS配列）がある時',
    frequency: 'お知らせidごとに1回',
    control: 'ハードコード配列。新規告知は配列に追記＋再デプロイ',
    controllable: false,
    storageKeys: ['medinode_announcement_seen_v1'],
    file: 'src/components/AppBanners.tsx（ANNOUNCEMENTS[]）',
    health: { level: 'hardcoded', note: '最大のギャップ：お知らせを出すたびコード編集＋デプロイが必要' },
  },
  {
    id: 'banner-resolved-cq',
    name: '解決CQバナー（投稿がナレッジに）',
    channel: 'banner',
    where: 'アプリ上部',
    trigger: 'プレミアム・未読の解決CQ（由来=現場の疑問）がある時',
    frequency: '新しい解決CQが出るたび',
    control: 'データ駆動（Notion 由来プロパティ）。筆者追加ダイジェストを抑制',
    controllable: false,
    storageKeys: ['medinode_resolved_cq_seen_v1'],
    file: 'src/components/ResolvedCqs.tsx',
    health: { level: 'ok', note: '' },
  },
  {
    id: 'banner-author-digest',
    name: '筆者追加ダイジェスト',
    channel: 'banner',
    where: 'アプリ上部',
    trigger: 'プレミアム・追加2件以上・7日に1回。解決CQバナー表示中は出さない',
    frequency: '7日に1回まで',
    control: 'データ駆動＋頻度キャップ（ハードコード7日）',
    controllable: false,
    storageKeys: ['medinode_author_seen_v1', 'medinode_author_digest_at_v1'],
    file: 'src/lib/author-additions.ts',
    health: { level: 'ok', note: '' },
  },
  {
    id: 'banner-feedback',
    name: 'フィードバック依頼',
    channel: 'banner',
    where: 'アプリ上部',
    trigger: '検索5回以上 または 初回利用から3日以上',
    frequency: '1回だけ（送る/閉じるで恒久非表示）',
    control: 'ハードコード閾値（5回/3日）',
    controllable: false,
    storageKeys: ['medinode_fb_nudge_done', 'medinode_first_use_at', 'medinode_search_count'],
    file: 'src/components/AppBanners.tsx',
    health: { level: 'hardcoded', note: '閾値・文面はソース固定。/adminで頻度調整できない' },
  },
  {
    id: 'banner-power',
    name: 'パワーモード勧誘',
    channel: 'banner',
    where: 'アプリ上部（シンプルモード時のみ）',
    trigger: 'Notion直結（シンプル）モードで未閉じ',
    frequency: '「あとで」で恒久非表示',
    control: 'ハードコード',
    controllable: false,
    storageKeys: ['medinode_power_banner_dismissed_v1'],
    file: 'src/components/AppBanners.tsx',
    health: { level: 'hardcoded', note: 'コードのみ' },
  },

  // ── モーダル・全画面 ───────────────────────────────────────
  {
    id: 'modal-push-primer',
    name: 'Push プライマー（明日の1問を通知で？）',
    channel: 'modal',
    where: '今日の1問に回答した直後',
    trigger: 'push設定でenabledのコホートかつ未提示・許可未取得',
    frequency: '1回（コホート外なら未消化のまま再提示可）',
    control: 'サーバ設定（push有効コホート）でゲート',
    controllable: false,
    storageKeys: ['medinode_push_primer_seen_v1'],
    file: 'src/components/PushPrimer.tsx',
    health: { level: 'ok', note: 'push段階に連動' },
  },
  {
    id: 'modal-feature-tour',
    name: 'はじめてガイド（機能ツアー）',
    channel: 'modal',
    where: 'セットアップ完了後',
    trigger: '初回のみ（設定→ヘルプから再表示可）',
    frequency: '1回',
    control: 'ハードコード',
    controllable: false,
    storageKeys: ['medical_search_feature_tour_done_v1'],
    file: 'src/components/FeatureTour.tsx',
    health: { level: 'hardcoded', note: 'コードのみ' },
  },
  {
    id: 'modal-onboarding',
    name: 'オンボーディング（アプリ紹介）',
    channel: 'modal',
    where: '初回起動時（全画面）',
    trigger: '未オンボーディングかつ未セットアップ',
    frequency: '1回',
    control: 'ハードコード',
    controllable: false,
    storageKeys: ['medical_search_onboarding_done_v4'],
    file: 'src/components/OnboardingScreen.tsx',
    health: { level: 'hardcoded', note: 'コードのみ' },
  },
  {
    id: 'modal-setup',
    name: 'セットアップウィザード',
    channel: 'modal',
    where: '未接続時（全画面）',
    trigger: '設定（トークン等）が未保存の間',
    frequency: 'セットアップ完了まで',
    control: 'ハードコードのフロー',
    controllable: false,
    file: 'src/components/SetupWizard.tsx',
    health: { level: 'hardcoded', note: 'コードのみ' },
  },
  {
    id: 'card-daily-question',
    name: '今日の1問カード（画面内）',
    channel: 'modal',
    where: '検索タブ上部の常設カード',
    trigger: 'サーバ（/api/daily-question）が available と判定した時',
    frequency: '毎日',
    control: '段階フラグ（off/preview/on）＋出題内容はサーバ設定',
    controllable: true,
    flag: 'daily_question',
    file: 'src/components/DailyQuestionCard.tsx',
    health: { level: 'ok', note: '' },
  },
  {
    id: 'toast-auth',
    name: '認証トースト（おかえりなさい/復元/エラー）',
    channel: 'modal',
    where: 'ログイン着地時に上部トースト',
    trigger: 'URLパラメータ（welcome/auth_error）またはsession-lostイベント',
    frequency: '1回（成功は6秒で自動消滅）',
    control: '認証フロー駆動（ハードコード）',
    controllable: false,
    file: 'src/components/auth/AuthNotice.tsx',
    health: { level: 'ok', note: '' },
  },
  {
    id: 'gate-maintenance',
    name: 'メンテナンス画面（調整中）',
    channel: 'modal',
    where: '全画面オーバーレイ',
    trigger: 'app_flags maintenance が ON（オーナーは除外）',
    frequency: 'ON中は常時',
    control: '✅ /admin からON/OFF（唯一のフル操作な表示）',
    controllable: true,
    flag: 'maintenance',
    file: 'src/components/MaintenanceGate.tsx',
    health: { level: 'ok', note: '' },
  },
  {
    id: 'bar-offline',
    name: 'オフラインバー',
    channel: 'modal',
    where: '上部の細い帯',
    trigger: '端末がオフライン',
    frequency: 'オフライン中',
    control: 'ランタイム状態（操作不要）',
    controllable: false,
    file: 'src/components/PwaRuntime.tsx',
    health: { level: 'ok', note: '' },
  },
  {
    id: 'notice-search-error',
    name: '検索エラー通知',
    channel: 'modal',
    where: '検索結果域',
    trigger: 'Algolia検索が失敗した時',
    frequency: 'エラー時',
    control: 'エラー駆動（操作不要）',
    controllable: false,
    file: 'src/components/SearchErrors.tsx',
    health: { level: 'ok', note: '' },
  },

  // ── 静かな通知 ─────────────────────────────────────────────
  {
    id: 'quiet-author-3layer',
    name: '筆者追加サイン（タブ未読ドット/Newチップ）',
    channel: 'quiet',
    where: '新着タブアイコン＋カード',
    trigger: '前回確認より後に追加された💡ナレッジ/📄精読ノート',
    frequency: '新着タブを開くと消える',
    control: 'データ＋localStorage透かし（自動）',
    controllable: false,
    storageKeys: ['medinode_author_seen_v1'],
    file: 'src/lib/author-additions.ts',
    health: { level: 'ok', note: '' },
  },
  {
    id: 'quiet-cq-viewcount',
    name: '解決CQ 参照回数バッジ',
    channel: 'quiet',
    where: '解決CQ一覧の各行',
    trigger: '参照回数が10回以上（寂しい数字は隠す）',
    frequency: '常時（増加のみ）',
    control: 'データ駆動。しきい値10はコード定数',
    controllable: false,
    file: 'src/lib/cq-views.ts（VIEW_BADGE_MIN=10）',
    health: { level: 'hardcoded', note: 'しきい値10はソース定数。/admin調整不可' },
  },
  {
    id: 'quiet-recording-level',
    name: '収録レベル（精読ノート）バッジ＋新着絞り込み',
    channel: 'quiet',
    where: 'カード＋新着タブ',
    trigger: 'Notion「収録レベル」＝精読（🔖文献カードは新着に出さない）',
    frequency: '常時',
    control: 'Notionプロパティ（オーナーが値で制御）',
    controllable: false,
    file: 'src/components/ResultCard.tsx',
    health: { level: 'ok', note: '' },
  },
  {
    id: 'quiet-origin-badge',
    name: '由来バッジ（現場の疑問から）',
    channel: 'quiet',
    where: 'カード',
    trigger: 'Notion「由来」＝現場の疑問',
    frequency: '常時（実名なし）',
    control: 'Notionプロパティ（オーナーが値で制御）',
    controllable: false,
    file: 'src/components/ResultCard.tsx',
    health: { level: 'ok', note: '' },
  },
  {
    id: 'quiet-recency',
    name: '新着タブ 日付グルーピング',
    channel: 'quiet',
    where: '新着タブの見出し',
    trigger: '今日/今週/今月/それ以前（作成・更新日）',
    frequency: '常時（日付駆動）',
    control: '自動（操作不要）',
    controllable: false,
    file: 'src/lib/recent-grouping.ts',
    health: { level: 'ok', note: '' },
  },

  // ── 設定内の文脈バナー ─────────────────────────────────────
  {
    id: 'settings-trial-states',
    name: 'トライアル/解約/会員状態バナー（設定内）',
    channel: 'settings',
    where: '設定パネル',
    trigger: 'トライアル中/終了/解約予定/会員/非会員 の各状態',
    frequency: '状態に応じて常時',
    control: '課金状態データ駆動',
    controllable: false,
    file: 'src/components/SettingsPanel.tsx',
    health: { level: 'ok', note: '' },
  },
]

export type CatalogSummary = {
  total: number
  byChannel: Record<MessageChannel, number>
  controllable: number
  issues: CatalogItem[] // health が ok 以外（dead/hardcoded/env-override/preview-locked）
}

/** カタログの集計（カテゴリ別件数・操作可能数・要注意項目）。 */
export function summarizeCatalog(items: CatalogItem[]): CatalogSummary {
  const byChannel: Record<MessageChannel, number> = {
    push: 0,
    banner: 0,
    modal: 0,
    quiet: 0,
    settings: 0,
  }
  let controllable = 0
  const issues: CatalogItem[] = []
  for (const it of items) {
    byChannel[it.channel] += 1
    if (it.controllable) controllable += 1
    if (it.health && it.health.level !== 'ok') issues.push(it)
  }
  return { total: items.length, byChannel, controllable, issues }
}
