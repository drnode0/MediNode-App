import { hasSubscriptionConfig } from './algolia'

// このアイテムをアプリ内リーダーで開くべきか（サブスク配信のみ・設定済み）。
// 既存 ResultCard の inAppReader 判定と同一。個人/部署は外部リンクのまま。
export function isInAppReaderTarget(owner?: string): boolean {
  return owner === 'subscription' && hasSubscriptionConfig()
}
