// 登録時自動トライアル（モニターFB「コードなしでも最初の数日は見れる方がいい」対応）。
// note特典のコード式トライアル（14日・/api/premium/trial）とは独立した固定3日。
// 判定はサーバー（/api/premium/auto-trial）が行い、ここは純ロジックのみ。

// 導入時の付与日数。member-ledger の旧データ分類（isLegacyAutoTrial）が
// 「付与+3日」で照合するために残している。実際の付与日数は campaign.ts の
// autoTrialDays()（キャンペーン中7日・通常3日）を使うこと。
export const AUTO_TRIAL_DAYS = 3

// 付与条件: 過去に自動付与されておらず（user_metadata.auto_trial_granted_at なし）、
// かつ subscriptions に記録が一切ない（コード式トライアル・契約・comp のどれでもない）。
// 記録がある人に付与すると、note特典14日→3日への降格が起きるため必ず除外する。
export function isAutoTrialEligible(opts: {
  grantedAt: string | null | undefined
  hasSubscriptionRow: boolean
}): boolean {
  if (opts.grantedAt) return false
  if (opts.hasSubscriptionRow) return false
  return true
}
