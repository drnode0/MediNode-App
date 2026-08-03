// かんたん接続のUI表示判定（クライアント側）。
//
// 端末に同期済みの機能一覧（/api/premium/status → PremiumSync → settings）だけを見る。
// 判定の正はサーバー（sessionHasFeature('easy_connect')）であり、これは表示制御のみ。
// レガシーの earlyAccess（真偽値）では開かない。あれはマルチ部署検索と知の塔を
// 意味していた値で、かんたん接続は含まないため（feature-access.ts の
// LEGACY_BOOLEAN_FEATURES と同じ扱い）。
import { getSettings } from './settings'

export function isEasyConnectVisible(): boolean {
  try {
    const features = getSettings()?.earlyAccessFeatures
    return Array.isArray(features) && features.includes('easy_connect')
  } catch {
    return false
  }
}
