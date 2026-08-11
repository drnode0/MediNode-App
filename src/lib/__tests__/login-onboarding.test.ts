import { describe, it, expect } from 'vitest'
import { nextPhaseAfterAuth, nextPhaseAfterProfile } from '../login-onboarding'

describe('nextPhaseAfterAuth', () => {
  it('職種未登録なら profile（購読状態に関わらず）', () => {
    expect(nextPhaseAfterAuth({ occupation: null, subscribed: false, canOfferPush: true })).toBe('profile')
    expect(nextPhaseAfterAuth({ occupation: null, subscribed: true, canOfferPush: false })).toBe('profile')
  })
  it('職種登録済み・未購読・通知を出せる端末なら notify', () => {
    expect(nextPhaseAfterAuth({ occupation: '医師', subscribed: false, canOfferPush: true })).toBe('notify')
  })
  it('購読済み or 通知を出せない端末なら done', () => {
    expect(nextPhaseAfterAuth({ occupation: '医師', subscribed: true, canOfferPush: true })).toBe('done')
    expect(nextPhaseAfterAuth({ occupation: '医師', subscribed: false, canOfferPush: false })).toBe('done')
  })
})

describe('nextPhaseAfterProfile', () => {
  it('未購読・通知を出せる端末なら notify、それ以外は done', () => {
    expect(nextPhaseAfterProfile({ subscribed: false, canOfferPush: true })).toBe('notify')
    expect(nextPhaseAfterProfile({ subscribed: true, canOfferPush: true })).toBe('done')
    expect(nextPhaseAfterProfile({ subscribed: false, canOfferPush: false })).toBe('done')
  })
})
