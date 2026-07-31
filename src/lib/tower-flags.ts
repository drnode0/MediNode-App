// 知の塔の開放判定（単一チョークポイント）。v1はオーナーの暗転リリース:
// 既存の先行体験フラグ（/api/premium/status → PremiumSync → settings.earlyAccess）を再利用する。
// 全体公開時はここを変えるだけ。マルチ部署検索の先行体験を他ユーザーへ開く時は塔専用フラグへ分離。
import { getSettings } from './settings'

export function isTowerEnabled(): boolean {
  try {
    return getSettings()?.earlyAccess === true
  } catch {
    return false
  }
}
