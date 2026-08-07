import { describe, it, expect } from 'vitest'
import { AUTO_TRIAL_DAYS, isAutoTrialEligible, shouldRequestAutoTrial } from '@/lib/auto-trial'

describe('auto-trial', () => {
  it('日数は3日固定', () => {
    expect(AUTO_TRIAL_DAYS).toBe(3)
  })

  it('付与済みフラグがあれば対象外', () => {
    expect(isAutoTrialEligible({ grantedAt: '2026-07-18T00:00:00Z', hasSubscriptionRow: false })).toBe(false)
  })

  it('サブスク記録（コード式トライアル/契約/comp）があれば対象外', () => {
    expect(isAutoTrialEligible({ grantedAt: null, hasSubscriptionRow: true })).toBe(false)
  })

  it('どちらもなければ対象', () => {
    expect(isAutoTrialEligible({ grantedAt: null, hasSubscriptionRow: false })).toBe(true)
    expect(isAutoTrialEligible({ grantedAt: undefined, hasSubscriptionRow: false })).toBe(true)
  })
})

describe('shouldRequestAutoTrial', () => {
  it('登録先行OFFなら常に叩く（現行の挙動を変えない）', () => {
    expect(shouldRequestAutoTrial({ registerFirst: false, setupComplete: false })).toBe(true)
    expect(shouldRequestAutoTrial({ registerFirst: false, setupComplete: true })).toBe(true)
  })
  it('登録先行ONでセットアップ未完了なら叩かない（体験日数を無駄にしない）', () => {
    expect(shouldRequestAutoTrial({ registerFirst: true, setupComplete: false })).toBe(false)
  })
  it('登録先行ONでもセットアップ完了後は叩く', () => {
    expect(shouldRequestAutoTrial({ registerFirst: true, setupComplete: true })).toBe(true)
  })
})
