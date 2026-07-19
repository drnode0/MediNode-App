import { describe, it, expect } from 'vitest'
import {
  LAUNCH_CAMPAIGN_END,
  isLaunchCampaignActive,
  autoTrialDays,
  trialCodeDays,
  STRIPE_TRIAL_DAYS_DEFAULT,
  REFERRAL_NEW_USER_DAYS,
  REFERRAL_REWARD_DAYS,
} from '@/lib/campaign'

describe('launch campaign', () => {
  it('終了時刻は 2026-08-18 JST いっぱい（UTC 14:59:59）', () => {
    expect(LAUNCH_CAMPAIGN_END).toBe('2026-08-18T14:59:59.000Z')
  })

  it('期間中は active（公開日・終了当日JST23時台を含む）', () => {
    expect(isLaunchCampaignActive(new Date('2026-07-18T00:00:00Z'))).toBe(true)
    expect(isLaunchCampaignActive(new Date('2026-08-18T14:59:59Z'))).toBe(true)
  })

  it('JST 8/19 0:00 以降は inactive', () => {
    expect(isLaunchCampaignActive(new Date('2026-08-18T15:00:00Z'))).toBe(false)
    expect(isLaunchCampaignActive(new Date('2026-09-01T00:00:00Z'))).toBe(false)
  })

  it('自動トライアル: キャンペーン中7日・終了後3日', () => {
    expect(autoTrialDays(new Date('2026-07-19T00:00:00Z'))).toBe(7)
    expect(autoTrialDays(new Date('2026-08-20T00:00:00Z'))).toBe(3)
  })

  it('noteコード: キャンペーン中30日・終了後21日（常にカード14日より上）', () => {
    expect(trialCodeDays(new Date('2026-07-19T00:00:00Z'))).toBe(30)
    expect(trialCodeDays(new Date('2026-08-20T00:00:00Z'))).toBe(21)
    expect(trialCodeDays(new Date('2026-08-20T00:00:00Z'))).toBeGreaterThan(STRIPE_TRIAL_DAYS_DEFAULT)
  })

  it('カード登録トライアルは恒久14日・紹介は新規30日/紹介者14日', () => {
    expect(STRIPE_TRIAL_DAYS_DEFAULT).toBe(14)
    expect(REFERRAL_NEW_USER_DAYS).toBe(30)
    expect(REFERRAL_REWARD_DAYS).toBe(14)
  })
})
