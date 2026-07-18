import { describe, it, expect } from 'vitest'
import { deriveMemberKind, type SubscriptionSummary } from '../member-ledger'

const NOW = new Date('2026-07-15T00:00:00Z')

function sub(partial: Partial<SubscriptionSummary>): SubscriptionSummary {
  return { plan: null, status: null, trial_ends_at: null, stripe_customer_id: null, ...partial }
}

describe('deriveMemberKind', () => {
  it('管理者はDB行に関係なく admin', () => {
    expect(deriveMemberKind(true, null, NOW)).toBe('admin')
    expect(deriveMemberKind(true, sub({ plan: 'trial', status: 'canceled' }), NOW)).toBe('admin')
  })

  it('行なし・status なしは free', () => {
    expect(deriveMemberKind(false, null, NOW)).toBe('free')
    expect(deriveMemberKind(false, undefined, NOW)).toBe('free')
    expect(deriveMemberKind(false, sub({}), NOW)).toBe('free')
  })

  it('招待コードの無期限 comp', () => {
    expect(deriveMemberKind(false, sub({ plan: 'comp', status: 'active' }), NOW)).toBe('comp')
  })

  it('期限内トライアルは trial・期限切れは expired', () => {
    expect(
      deriveMemberKind(false, sub({ plan: 'trial', status: 'trialing', trial_ends_at: '2026-07-27T00:00:00Z' }), NOW),
    ).toBe('trial')
    expect(
      deriveMemberKind(false, sub({ plan: 'trial', status: 'trialing', trial_ends_at: '2026-07-01T00:00:00Z' }), NOW),
    ).toBe('expired')
  })

  it('revoke 済み（canceled）は expired', () => {
    expect(deriveMemberKind(false, sub({ plan: 'comp', status: 'canceled' }), NOW)).toBe('expired')
    expect(deriveMemberKind(false, sub({ plan: 'trial', status: 'canceled' }), NOW)).toBe('expired')
  })

  it('Stripe 課金中は premium（plan か customer 紐づけのどちらでも）', () => {
    expect(deriveMemberKind(false, sub({ plan: 'premium', status: 'active' }), NOW)).toBe('premium')
    expect(
      deriveMemberKind(false, sub({ status: 'active', stripe_customer_id: 'cus_123' }), NOW),
    ).toBe('premium')
  })

  it('Stripe のカード登録トライアル期間中は stripe_trial（無料コードの trial と区別）', () => {
    expect(deriveMemberKind(false, sub({ plan: 'premium', status: 'trialing' }), NOW)).toBe('stripe_trial')
    expect(
      deriveMemberKind(false, sub({ status: 'trialing', stripe_customer_id: 'cus_123' }), NOW),
    ).toBe('stripe_trial')
    // Stripe トライアルでも trial_ends_at が過ぎていれば expired。
    expect(
      deriveMemberKind(
        false,
        sub({ plan: 'premium', status: 'trialing', trial_ends_at: '2026-07-01T00:00:00Z', stripe_customer_id: 'cus_123' }),
        NOW,
      ),
    ).toBe('expired')
  })

  it('plan 不明の active 行は安全側で premium 扱い', () => {
    expect(deriveMemberKind(false, sub({ status: 'active' }), NOW)).toBe('premium')
  })

  it('plan=auto_trial（登録時3日・新形式）は auto_trial・期限切れは expired', () => {
    expect(
      deriveMemberKind(
        false,
        sub({ plan: 'auto_trial', status: 'trialing', trial_ends_at: '2026-07-17T00:00:00Z' }),
        NOW,
      ),
    ).toBe('auto_trial')
    expect(
      deriveMemberKind(
        false,
        sub({ plan: 'auto_trial', status: 'trialing', trial_ends_at: '2026-07-14T00:00:00Z' }),
        NOW,
      ),
    ).toBe('expired')
  })

  // 旧形式の遡及分類: auto_trial 導入前は自動3日も plan='trial' で保存されていた。
  // user_metadata.auto_trial_granted_at と期限の一致（付与+3日）で自動トライアルと見なす。
  it('旧形式: plan=trial でも自動付与フラグ＋期限が付与+3日なら auto_trial', () => {
    expect(
      deriveMemberKind(
        false,
        sub({
          plan: 'trial',
          status: 'trialing',
          trial_ends_at: '2026-07-17T10:00:00Z',
          auto_trial_granted_at: '2026-07-14T10:00:00Z',
        }),
        NOW,
      ),
    ).toBe('auto_trial')
  })

  it('旧形式: 自動付与フラグがあってもコード式14日に乗り換えた人は trial のまま', () => {
    // 自動3日のあと note コード（14日）を入れると trial_ends_at が付与+3日から離れる。
    expect(
      deriveMemberKind(
        false,
        sub({
          plan: 'trial',
          status: 'trialing',
          trial_ends_at: '2026-07-28T10:00:00Z',
          auto_trial_granted_at: '2026-07-14T10:00:00Z',
        }),
        NOW,
      ),
    ).toBe('trial')
  })

  it('旧形式: 自動付与フラグがなければ従来どおり trial', () => {
    expect(
      deriveMemberKind(false, sub({ plan: 'trial', status: 'trialing', trial_ends_at: '2026-07-27T00:00:00Z' }), NOW),
    ).toBe('trial')
  })
})
