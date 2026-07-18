// /api/user-settings の復元応答（GET）の分類。
// SetupWizard の「保存済みの設定で始める」は、この分類に応じて案内を変える。
//
// 背景（2026-07-18 実インシデント）:
//   端末のセッションCookieがサーバーに届かない状態（iOSのサイトデータ削除等）でも、
//   旧実装は一律「保存済みの設定はまだありません」と表示していた。設定済みユーザーが
//   再セットアップへ誘導され、「設定が消えた」ように見える上、再入力した設定の保存も
//   401で握り潰されるため、サーバーの正しい設定に到達できないループに陥る。
//   さらに復号失敗（鍵ずれ）まで「設定なし」と案内すると、再セットアップの保存が
//   サーバーの既存設定を上書きしてデータ喪失につながるため、区別を必須とする。

export type RestoreOutcome =
  | 'network_error'      // HTTP失敗・JSONでない応答（通信・一時障害）
  | 'not_authenticated'  // サーバーがセッションを認識していない（Cookie不達・期限切れ）
  | 'server_error'       // ログイン済みだがサーバー側で復元不能（復号失敗・鍵未設定）
  | 'no_settings'        // 本当に保存済み設定がない（新規アカウント）
  | 'has_settings'       // 設定が返った

export function classifyRestoreResponse(httpOk: boolean, data: unknown): RestoreOutcome {
  if (!httpOk || typeof data !== 'object' || data === null) return 'network_error'
  const d = data as { loggedIn?: unknown; settings?: unknown; reason?: unknown }
  // loggedIn:true 以外（false・欠落）は「設定なし」と断定せず、認証未達として扱う。
  if (d.loggedIn !== true) return 'not_authenticated'
  if (d.settings) return 'has_settings'
  // API は復号失敗・鍵未設定のとき reason を付けて settings:null を返す。
  if (typeof d.reason === 'string' && d.reason) return 'server_error'
  return 'no_settings'
}
