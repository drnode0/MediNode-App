// 表示制御のみ。判定の正はサーバー（requireAskShelf）。recall-flag.ts と同型。
import { getSettings } from './settings'

export function isAskShelfEnabled(): boolean {
  try {
    const s = getSettings()
    if (!s) return false
    return Array.isArray(s.earlyAccessFeatures) && s.earlyAccessFeatures.includes('ask_shelf')
  } catch {
    return false
  }
}
