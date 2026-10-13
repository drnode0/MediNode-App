// 調べた記録（trail）の表示可否と、記録のスイッチ。表示制御のみ・判定の正はサーバー（requireTrail）。
// recall-flag.ts と同型。レガシー earlyAccess(boolean) へのフォールバックはしない。
import { getSettings, saveSettings } from './settings'

export function isTrailEnabled(): boolean {
  try {
    const s = getSettings()
    if (!s) return false
    return Array.isArray(s.earlyAccessFeatures) && s.earlyAccessFeatures.includes('trail')
  } catch {
    return false
  }
}

// 調べた言葉を記録に残すか（既定は残す）。設定ごと端末間で同期される。
export function isTrailRecording(): boolean {
  try {
    return getSettings()?.trailOff !== true
  } catch {
    return true
  }
}

// 記録のスイッチを切り替える。設定がまだ無い端末（セットアップ前）では保存できないので false。
export function setTrailRecording(on: boolean): boolean {
  const s = getSettings()
  if (!s) return false
  return saveSettings({ ...s, trailOff: !on })
}
