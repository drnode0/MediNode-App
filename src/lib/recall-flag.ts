// Recall（知の球）の表示可否（表示制御のみ・判定の正はサーバー）。
// サーバーが配る features ミラー（settings.earlyAccessFeatures）に 'recall' があるかを見る。
// personal-reader-flag と同型。レガシー earlyAccess(boolean) へのフォールバックはしない。
import { getSettings } from './settings'

export function isRecallEnabled(): boolean {
  try {
    const s = getSettings()
    if (!s) return false
    return Array.isArray(s.earlyAccessFeatures) && s.earlyAccessFeatures.includes('recall')
  } catch {
    return false
  }
}
