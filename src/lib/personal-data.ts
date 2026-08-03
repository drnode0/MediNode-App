// 端末ローカル（localStorage）に残る「個人データ」を、ログインしているユーザーが
// 別人に変わった瞬間にまとめて消すための仕組み。
//
// 背景: 「最近見た」や検索履歴・クイズ学習記録などは、プライバシー方針で
// サーバー同期していない（端末ローカルのみ）。ところが同じ端末・同じブラウザで
// アカウントを切り替えると、前のアカウントのこれらが次のアカウントに見えてしまう。
// 共有端末（院内の共有iPad/PC等）では「何を調べていたか」が同僚に見える問題になる。
//
// 対処: 認証ユーザーの id が「別のユーザーに変わった時だけ」個人データを消す。
// 同一ユーザーの再ログイン（トークン更新含む）では消さない＝自分のクイズ記録等を失わない。

// 消す対象。サーバー同期される設定（medical_search_settings 等）や、
// ユーザーidで自己ガードされる計測系（medinode_acq / usage_ping 等）はここに含めない。
export const PERSONAL_DEVICE_KEYS = [
  'medinode_recent_views_v1', // 最近見た（今回の実害）
  'medical_search_history', // 検索キーワード履歴
  'medinode_search_count', // 検索回数
  'medinode_quiz_stats', // クイズ/SRS 学習記録
  'medinode_quiz_genre_filter_v1', // クイズのジャンル絞り込み
  'medinode_daily_question_v1', // 今日の1問の回答状態
  'notion_db_creator_recent_pages', // 最近のページ
  'medinode_resolved_cq_seen_v1', // 解決済みCQ既読水位
  'medinode_author_seen_v1', // 筆者追加分 既読水位
  'medinode_author_digest_at_v1', // 筆者追加分 ダイジェスト日時
  'medinode_push_primer_seen_v1', // 通知プライマーの既読水位
  'medinode_reader_read_v1', // リーダー既読（見た）水位
  'medinode_reader_bookmarks_v1', // リーダーのブックマーク
  'medinode_reader_rereads_v1', // リーダーの読み返し（蔓の輪郭の濃度）
  'medinode_tower_v1', // 知の塔（学びの歩の台帳）
] as const

// この端末で最後にログインしていたユーザーの id を覚えておくキー（機微でない）。
export const LAST_USER_KEY = 'medinode_last_user_id'

export function clearPersonalDeviceData(): void {
  for (const k of PERSONAL_DEVICE_KEYS) {
    try {
      localStorage.removeItem(k)
    } catch {
      // localStorage不可（プライベートブラウズ等）でも落とさない。
    }
  }
}

// 認証ユーザーが解決したタイミングで呼ぶ。返り値はテスト/ログ用。
// - null（ログアウト/読み込み中）: 何もしない。前の持ち主のデータは、次に別ユーザーが
//   ログインした瞬間に消す（ログアウト単体では消さない＝同一ユーザーの再ログインを守る）。
// - この端末で初めて観測（デプロイ直後を含む）: 持ち主として記録するだけ。既存データは消さない。
// - 別のユーザーに変わった: 前の持ち主の端末ローカル個人データを消す。
export function reconcilePersonalDataForUser(
  userId: string | null,
): 'noop' | 'adopted' | 'cleared' {
  if (!userId) return 'noop'
  let last: string | null = null
  try {
    last = localStorage.getItem(LAST_USER_KEY)
  } catch {
    return 'noop'
  }
  if (last === userId) return 'noop'
  if (last === null) {
    try {
      localStorage.setItem(LAST_USER_KEY, userId)
    } catch {}
    return 'adopted'
  }
  clearPersonalDeviceData()
  try {
    localStorage.setItem(LAST_USER_KEY, userId)
  } catch {}
  return 'cleared'
}
