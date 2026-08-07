// かんたん接続のUI表示判定（クライアント側）。
//
// GA後（NEXT_PUBLIC_EASY_CONNECT_GA=true）は全員に見せる。サーバー側は対で
// EASY_CONNECT_GA=true を設定すること（feature-access.ts）。この2つは必ず同時に
// 入れる・同時に消す。片方だけだと「見えるのに使えない」「使えるのに見えない」になる。
//
// GA前は、端末に同期済みの機能一覧（/api/premium/status → PremiumSync → settings）
// だけを見る。判定の正はサーバー（sessionHasFeature('easy_connect')）であり、
// これは表示制御のみ。レガシーの earlyAccess（真偽値）では開かない。あれは
// マルチ部署検索と知の塔を意味していた値で、かんたん接続は含まないため
// （feature-access.ts の LEGACY_BOOLEAN_FEATURES と同じ扱い）。
import { getSettings } from './settings'

export function isEasyConnectGa(): boolean {
  return process.env.NEXT_PUBLIC_EASY_CONNECT_GA === 'true'
}

export function isEasyConnectVisible(): boolean {
  if (isEasyConnectGa()) return true
  try {
    const features = getSettings()?.earlyAccessFeatures
    return Array.isArray(features) && features.includes('easy_connect')
  } catch {
    return false
  }
}
