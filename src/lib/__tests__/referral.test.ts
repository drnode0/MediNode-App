import { describe, it, expect } from 'vitest'
import {
  generateReferralCode,
  looksLikeReferralCode,
  normalizeReferralCode,
  canRedeemReferral,
  shouldRewardReferrer,
  emailBase,
  isSameMailbox,
  REFERRAL_REWARD_CAP,
} from '@/lib/referral'

describe('referral code', () => {
  it('MN- + 8文字（紛らわしい文字なし）で生成される', () => {
    const code = generateReferralCode()
    expect(code).toMatch(/^MN-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{8}$/)
  })

  it('生成コードは looksLikeReferralCode を通る', () => {
    for (let i = 0; i < 20; i++) {
      expect(looksLikeReferralCode(generateReferralCode())).toBe(true)
    }
  })

  it('env系コードや適当な文字列は紹介コード形式とみなさない', () => {
    expect(looksLikeReferralCode('MEDINODE2026')).toBe(false)
    expect(looksLikeReferralCode('MN-SHORT')).toBe(false)
    expect(looksLikeReferralCode('MN-K3F7WXQ0')).toBe(false) // 0 は使わない
    expect(looksLikeReferralCode('')).toBe(false)
  })

  it('normalize は trim + 大文字化（小文字入力・前後空白を吸収）', () => {
    expect(normalizeReferralCode('  mn-k3f7wxqz ')).toBe('MN-K3F7WXQZ')
  })
})

describe('canRedeemReferral', () => {
  const base = { isOwnCode: false, alreadyRedeemed: false, hasStripeHistory: false, hasComp: false }

  it('条件を満たせば受け取れる', () => {
    expect(canRedeemReferral(base)).toEqual({ ok: true })
  })

  it('自分のコードは弾く', () => {
    expect(canRedeemReferral({ ...base, isOwnCode: true })).toEqual({ ok: false, reason: 'self_referral' })
  })

  it('受け取りは生涯1回', () => {
    expect(canRedeemReferral({ ...base, alreadyRedeemed: true })).toEqual({ ok: false, reason: 'already_redeemed' })
  })

  it('Stripe決済歴がある人は新規側になれない', () => {
    expect(canRedeemReferral({ ...base, hasStripeHistory: true })).toEqual({ ok: false, reason: 'not_new_user' })
  })

  it('無期限comp保持者は対象外（trial上書きで降格させない）', () => {
    expect(canRedeemReferral({ ...base, hasComp: true })).toEqual({ ok: false, reason: 'has_comp' })
  })
})

describe('emailBase / isSameMailbox', () => {
  it('+エイリアスとGmailのドット差を同一実体に正規化する', () => {
    expect(emailBase('Taro+1@Gmail.com')).toBe('taro@gmail.com')
    expect(emailBase('t.a.r.o@googlemail.com')).toBe('taro@gmail.com')
    expect(isSameMailbox('taro@gmail.com', 'taro+sub@gmail.com')).toBe(true)
    expect(isSameMailbox('t.aro@gmail.com', 'taro@gmail.com')).toBe(true)
  })

  it('Gmail以外はドットを区別し、別人は別扱い', () => {
    expect(isSameMailbox('t.aro@example.com', 'taro@example.com')).toBe(false)
    expect(isSameMailbox('taro@gmail.com', 'jiro@gmail.com')).toBe(false)
    expect(isSameMailbox('taro+a@example.com', 'taro@example.com')).toBe(true)
    expect(isSameMailbox(null, 'taro@gmail.com')).toBe(false)
  })
})

describe('shouldRewardReferrer', () => {
  it('上限（10人）までは還元し、超えたら止める', () => {
    expect(shouldRewardReferrer(0)).toBe(true)
    expect(shouldRewardReferrer(REFERRAL_REWARD_CAP - 1)).toBe(true)
    expect(shouldRewardReferrer(REFERRAL_REWARD_CAP)).toBe(false)
  })
})
