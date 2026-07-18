import { describe, it, expect } from 'vitest'
import { AUTO_TRIAL_DAYS, isAutoTrialEligible } from '@/lib/auto-trial'

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
