import { hasSubscriptionConfig } from './algolia'
import { isPersonalReaderEnabled } from './personal-reader-flag'
import { getSettings } from './settings'

// このアイテムをアプリ内リーダーで開くべきか。「アプリ内で開くか」の唯一のゲート。
// - subscription: 設定済みなら常にアプリ内（既存挙動そのまま）
// - personal/team: 先行体験 'personal_reader' が開いていて、かつ本文を取りに行ける
//   トークンが端末にあるときだけアプリ内（降格式リーダー）。トークンが無い状態で
//   true を返すと「開いたのに読めない」になるため、ここで一緒に確認する。
export function isInAppReaderTarget(owner?: string): boolean {
  if (owner === 'subscription') return hasSubscriptionConfig()
  if (owner !== 'personal' && owner !== 'team') return false
  if (!isPersonalReaderEnabled()) return false
  try {
    const s = getSettings()
    if (!s) return false
    if (owner === 'personal') return !!s.notionToken
    return !!s.teamNotionToken || (s.additionalTeams || []).some((t) => !!t?.notionToken)
  } catch {
    return false
  }
}
