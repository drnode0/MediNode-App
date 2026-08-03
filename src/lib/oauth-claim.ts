// かんたん接続の引き取り（claim）応答を、端末の設定へどう書くかの判断。
//
// 応答には hadServerSettings が付く。false は「サーバーに設定の実体（settings_enc）が
// 無かった」という意味で、珍しい状態ではない——/admin から easy_connect を付与すると
// user_settings に機能フラグだけの行ができるため、テスターはこの状態で claim に来る。
// ここで応答を丸ごと書くと、端末が持っているAlgoliaキー・部署接続・列マッピングを
// 空で潰す。だから false のときはローカルを主にマージする（設計書§10d）。
import { mergeSettings, type AppSettings } from './settings'

export type ClaimResponse =
  | { status: 'ok'; settings: AppSettings; hadServerSettings?: boolean }
  | { status: 'conflict'; unreadable: Array<{ role: string; id: string }> }
  | { status: 'none' }

// 接続そのものを表す項目。サーバーに実体が無い場合でも、ここだけは必ず新しい値を採る
// （引き取りの目的そのものであり、ローカルの古いトークンを残すと接続が成立しない）。
const CONNECTION_KEYS = [
  'notionToken',
  'notionAuthKind',
  'notionWorkspaceName',
  'notionDuplicatedTemplateId',
  'notionTokenPrev',
  'notionAuthKindPrev',
] as const

export function resolveClaimedSettings(
  claimed: AppSettings,
  hadServerSettings: boolean,
  local: AppSettings | null,
): AppSettings {
  if (hadServerSettings || !local) return claimed

  // ローカルを主にマージ（非空を空で潰さない）。
  const merged = (mergeSettings(local, claimed) ?? claimed) as unknown as Record<string, unknown>
  const from = claimed as unknown as Record<string, unknown>
  for (const k of CONNECTION_KEYS) {
    if (from[k] !== undefined) merged[k] = from[k]
  }
  return merged as unknown as AppSettings
}
