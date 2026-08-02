// 知の塔の開放判定（単一チョークポイント）。
// 機能別の先行体験に移行済み: サーバーが配る features に 'tower' が含まれるかを見る。
// features がまだ届いていない端末（旧バージョンのキャッシュ・列未適用）では、
// 分離前の earlyAccess にフォールバックする——切替の瞬間に塔が消えないようにするため。
// 全体公開時は TOWER_GA=true を立てる（サーバー側で全員 true になる）。
import { getSettings } from './settings'

export function isTowerEnabled(): boolean {
  try {
    const s = getSettings()
    if (!s) return false
    const features = s.earlyAccessFeatures
    if (Array.isArray(features)) return features.includes('tower')
    return s.earlyAccess === true
  } catch {
    return false
  }
}
