import { describe, it, expect } from 'vitest'
import {
  maskEmail,
  detectLocalContractIssues,
  detectAnomalySignals,
  reconcileStripe,
} from '../ledger-safety'

describe('maskEmail', () => {
  it('先頭1文字＋***＋ドメイン', () => expect(maskEmail('tatsuki@gmail.com')).toBe('t***@gmail.com'))
  it('null/@なしは安全に扱う', () => {
    expect(maskEmail(null)).toBe('—')
    expect(maskEmail('broken')).toBe('broken')
  })
})

describe('detectLocalContractIssues', () => {
  it('課金中なのにStripe顧客IDが無い行を拾う', () => {
    const issues = detectLocalContractIssues([
      { userId: 'a', email: 'a@x.com', kind: 'premium', status: 'active', plan: 'premium', hasStripe: false },
      { userId: 'b', email: 'b@x.com', kind: 'premium', status: 'active', plan: 'premium', hasStripe: true },
    ])
    expect(issues).toHaveLength(1)
    expect(issues[0].userId).toBe('a')
  })
  it('Stripe顧客IDがあるのに区分がfreeの行を拾う', () => {
    const issues = detectLocalContractIssues([
      { userId: 'c', email: 'c@x.com', kind: 'free', status: 'canceled', plan: 'premium', hasStripe: true },
    ])
    expect(issues).toHaveLength(1)
    expect(issues[0].reason).toContain('無効')
  })
})

describe('detectAnomalySignals', () => {
  const now = Date.parse('2026-07-20T12:00:00+09:00')
  it('紹介集中・使い捨てメール・失効間近を検出', () => {
    const rows = [
      { email: 'a@mailinator.com', kind: 'auto_trial' as const, referralCount: 0, premiumUsedAt: null, trialEndsAt: '2026-07-20T20:00:00+09:00', createdAt: '2026-07-01' },
      { email: 'b@x.com', kind: 'free' as const, referralCount: 12, premiumUsedAt: null, trialEndsAt: null, createdAt: '2026-07-02' },
    ]
    const s = detectAnomalySignals(rows, now)
    const keys = s.map((x) => x.key)
    expect(keys).toContain('referral_concentration')
    expect(keys).toContain('disposable_email')
    expect(keys).toContain('trial_expiring_unused')
  })
  it('該当なしなら空', () => {
    const s = detectAnomalySignals(
      [{ email: 'a@x.com', kind: 'free' as const, referralCount: 0, premiumUsedAt: null, trialEndsAt: null, createdAt: '2026-07-02' }],
      now
    )
    expect(s).toEqual([])
  })
})

describe('reconcileStripe', () => {
  it('宙に浮いた契約（Stripeにactiveだがローカルに無い）を拾う', () => {
    const r = reconcileStripe(
      [{ userId: 'u1', email: 'u1@x.com', stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1', status: 'active' }],
      [
        { id: 'sub_1', customer: 'cus_1', status: 'active' },
        { id: 'sub_2', customer: 'cus_2', status: 'active' }, // ローカルに無い → orphan
      ]
    )
    expect(r.orphanStripe.map((o) => o.subscriptionId)).toEqual(['sub_2'])
    expect(r.staleLocal).toEqual([])
  })
  it('ローカルpremiumだがStripeにactive無し（取り残し）を拾う', () => {
    const r = reconcileStripe(
      [{ userId: 'u3', email: 'u3@x.com', stripeCustomerId: 'cus_3', stripeSubscriptionId: 'sub_3', status: 'active' }],
      [{ id: 'sub_3', customer: 'cus_3', status: 'canceled' }]
    )
    expect(r.staleLocal.map((s) => s.userId)).toEqual(['u3'])
    expect(r.orphanStripe).toEqual([])
  })
})
