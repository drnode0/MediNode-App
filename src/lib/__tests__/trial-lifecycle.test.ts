import { describe, it, expect } from 'vitest'
import {
  classifyTrialLifecycle,
  shouldNotify,
  isAdminEmail,
  isTrialPlan,
  ENDING_SOON_WINDOW_MS,
  ENDED_GRACE_MS,
  type TrialLifecycleStage,
} from '../trial-lifecycle'

// 2026-01-15T00:00:00Z を「今」とする固定時刻。
const NOW = Date.parse('2026-01-15T00:00:00.000Z')
const H = 60 * 60 * 1000
const D = 24 * H

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

describe('classifyTrialLifecycle', () => {
  it('カードなしトライアルで期限が約1日先なら ending_soon', () => {
    const sub = { trial_ends_at: iso(NOW + 20 * H), stripe_customer_id: null, plan: 'auto_trial' }
    expect(classifyTrialLifecycle(sub, { now: NOW })).toBe<'ending_soon'>('ending_soon')
  })

  it('期限を過ぎて猶予内なら ended', () => {
    const sub = { trial_ends_at: iso(NOW - 2 * H), stripe_customer_id: null, plan: 'auto_trial' }
    expect(classifyTrialLifecycle(sub, { now: NOW })).toBe('ended')
  })

  it('期限がまだ遠い（窓の外）なら none', () => {
    const sub = { trial_ends_at: iso(NOW + 5 * D), stripe_customer_id: null, plan: 'trial' }
    expect(classifyTrialLifecycle(sub, { now: NOW })).toBe('none')
  })

  it('期限切れから猶予を大きく過ぎていれば none（古い失効を蒸し返さない）', () => {
    const sub = { trial_ends_at: iso(NOW - 30 * D), stripe_customer_id: null, plan: 'auto_trial' }
    expect(classifyTrialLifecycle(sub, { now: NOW })).toBe('none')
  })

  it('trial_ends_at が null なら none（Stripeカードトライアル・comp等）', () => {
    const sub = { trial_ends_at: null, stripe_customer_id: null, plan: 'comp' }
    expect(classifyTrialLifecycle(sub, { now: NOW })).toBe('none')
  })

  it('stripe_customer_id があるカードトライアルは対象外（none）', () => {
    // 期限が1日先でも、Stripe側で扱う契約なので触らない。
    const sub = { trial_ends_at: iso(NOW + 20 * H), stripe_customer_id: 'cus_123', plan: 'premium' }
    expect(classifyTrialLifecycle(sub, { now: NOW })).toBe('none')
  })

  it('不正な日付文字列は none（クラッシュしない）', () => {
    const sub = { trial_ends_at: 'not-a-date', stripe_customer_id: null, plan: 'trial' }
    expect(classifyTrialLifecycle(sub, { now: NOW })).toBe('none')
  })

  // ── 誤送信バグの回帰テスト ──
  // comp/premium 等に古い trial_ends_at が残っていても、通知対象にしない。
  it('【回帰】plan=comp で期限が窓内でも none（アクセスを失わない人に誤送信しない）', () => {
    const sub = { trial_ends_at: iso(NOW + 20 * H), stripe_customer_id: null, plan: 'comp' }
    expect(classifyTrialLifecycle(sub, { now: NOW })).toBe('none')
  })

  it('【回帰】plan=premium（カードなし行の残骸）でも none', () => {
    const sub = { trial_ends_at: iso(NOW - 2 * H), stripe_customer_id: null, plan: 'premium' }
    expect(classifyTrialLifecycle(sub, { now: NOW })).toBe('none')
  })

  it('【回帰】plan=null は対象外（none）', () => {
    const sub = { trial_ends_at: iso(NOW + 20 * H), stripe_customer_id: null, plan: null }
    expect(classifyTrialLifecycle(sub, { now: NOW })).toBe('none')
  })

  it('trial/auto_trial のみ isTrialPlan=true', () => {
    expect(isTrialPlan('trial')).toBe(true)
    expect(isTrialPlan('auto_trial')).toBe(true)
    expect(isTrialPlan('comp')).toBe(false)
    expect(isTrialPlan('premium')).toBe(false)
    expect(isTrialPlan(null)).toBe(false)
  })
})

describe('isAdminEmail（管理者除外）', () => {
  const csv = 'owner@example.com, monitor@example.com'
  it('管理者メールは true（大文字小文字/前後空白を吸収）', () => {
    expect(isAdminEmail('OWNER@example.com', csv)).toBe(true)
    expect(isAdminEmail('monitor@example.com', csv)).toBe(true)
  })
  it('一般ユーザーは false', () => {
    expect(isAdminEmail('user@example.com', csv)).toBe(false)
  })
  it('email なし / CSV未設定は false', () => {
    expect(isAdminEmail(null, csv)).toBe(false)
    expect(isAdminEmail('owner@example.com', undefined)).toBe(false)
  })

  it('窓の境界: ちょうど ENDING_SOON_WINDOW_MS 先は ending_soon（含む）', () => {
    const sub = { trial_ends_at: iso(NOW + ENDING_SOON_WINDOW_MS), stripe_customer_id: null, plan: 'trial' }
    expect(classifyTrialLifecycle(sub, { now: NOW })).toBe('ending_soon')
  })

  it('窓の境界: 猶予ちょうど前の失効は ended（含む）', () => {
    const sub = { trial_ends_at: iso(NOW - ENDED_GRACE_MS), stripe_customer_id: null, plan: 'trial' }
    expect(classifyTrialLifecycle(sub, { now: NOW })).toBe('ended')
  })
})

describe('shouldNotify（重複防止：通知済みの期限値で判定）', () => {
  const end = iso(NOW + 20 * H)

  it('ending_soon: まだ通知していなければ送る', () => {
    expect(shouldNotify('ending_soon', end, { trial_ending_notified_for: undefined })).toBe(true)
  })

  it('ending_soon: 同じ期限で通知済みなら送らない', () => {
    expect(shouldNotify('ending_soon', end, { trial_ending_notified_for: end })).toBe(false)
  })

  it('ending_soon: 期限が延長され値が変わったら再度送る', () => {
    const extended = iso(NOW + 10 * D)
    expect(shouldNotify('ending_soon', extended, { trial_ending_notified_for: end })).toBe(true)
  })

  it('ended: まだ通知していなければ送る', () => {
    expect(shouldNotify('ended', end, { trial_ended_notified_for: undefined })).toBe(true)
  })

  it('ended: 同じ期限で通知済みなら送らない', () => {
    expect(shouldNotify('ended', end, { trial_ended_notified_for: end })).toBe(false)
  })

  it('none は常に送らない', () => {
    expect(shouldNotify('none' as TrialLifecycleStage, end, {})).toBe(false)
  })
})
