// 公開記念キャンペーン（2026-07-18 公開）の期間と日数を一元管理する。
//
// 日数の階段設計（カード登録トライアルを収益への出口として最長の「カードなし枠」は
// 有料note購入者に残す）:
//   ① 登録だけ（コードなし・自動トライアル）… キャンペーン中 7日 / 通常 3日
//   ② カード登録トライアル（Stripe）        … 14日（キャンペーン後も恒久）
//   ③ note特典コード（TRIAL_CODES）        … キャンペーン中 30日 / 通常 14日
//   ④ 友達紹介コード                        … 新規 30日・紹介者 +14日（常設）
//
// サーバー・クライアント両方から import される想定（純ロジック・環境依存なし）。
// 環境変数（TRIAL_DAYS 等）が設定されている場合はそちらが優先される（各routeで判断）。

// キャンペーン終了: 2026-08-18 の日本時間いっぱいまで（JST 23:59:59 = UTC 14:59:59）。
export const LAUNCH_CAMPAIGN_END = '2026-08-18T14:59:59.000Z'

export function isLaunchCampaignActive(now: Date = new Date()): boolean {
  return now.getTime() <= new Date(LAUNCH_CAMPAIGN_END).getTime()
}

// ① 登録時自動トライアルの付与日数。
// 旧データ分類（member-ledger の isLegacyAutoTrial）は導入時の3日固定
// （auto-trial.ts の AUTO_TRIAL_DAYS）を参照し続けるため、ここには依存させない。
export function autoTrialDays(now: Date = new Date()): number {
  return isLaunchCampaignActive(now) ? 7 : 3
}

// ③ note特典コード（TRIAL_CODES）の日数。環境変数 TRIAL_DAYS 未設定時の既定値。
export function trialCodeDays(now: Date = new Date()): number {
  return isLaunchCampaignActive(now) ? 30 : 14
}

// ② Stripe カード登録トライアルの日数。環境変数 STRIPE_TRIAL_DAYS 未設定時の既定値。
// キャンペーンを機に 7日→14日 へ恒久アップ（期間で切り替えない）。
export const STRIPE_TRIAL_DAYS_DEFAULT = 14

// ④ 友達紹介の日数（常設・キャンペーンに依存しない）。
export const REFERRAL_NEW_USER_DAYS = 30
export const REFERRAL_REWARD_DAYS = 14
