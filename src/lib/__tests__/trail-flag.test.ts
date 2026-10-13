import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { hasFeature, EARLY_ACCESS_FEATURES } from '@/lib/feature-access'

const ENV = { ...process.env }
afterEach(() => { process.env = { ...ENV } })

describe('feature trail', () => {
  it('EARLY_ACCESS_FEATURES に trail が入る', () => {
    expect(EARLY_ACCESS_FEATURES).toContain('trail')
  })
  it('TRAIL_EMAILS に載ったメールだけ真。ほかの機能のリストには落ちない', () => {
    process.env.TRAIL_EMAILS = 'owner@example.com'
    process.env.EARLY_ACCESS_EMAILS = 'monitor@example.com'
    process.env.RECALL_EMAILS = 'monitor@example.com'
    expect(hasFeature('trail', { email: 'owner@example.com' })).toBe(true)
    expect(hasFeature('trail', { email: 'monitor@example.com' })).toBe(false)
  })
  it('レガシー boolean では開かない', () => {
    delete process.env.TRAIL_EMAILS
    expect(hasFeature('trail', { email: 'x@example.com', ledgerEarlyAccess: true })).toBe(false)
  })
})

describe('isTrailEnabled / isTrailRecording', () => {
  beforeEach(() => { vi.resetModules() })
  it('features ミラーに trail があれば真', async () => {
    vi.doMock('@/lib/settings', () => ({ getSettings: () => ({ earlyAccessFeatures: ['trail'] }), saveSettings: () => true }))
    expect((await import('@/lib/trail-flag')).isTrailEnabled()).toBe(true)
    vi.resetModules()
    vi.doMock('@/lib/settings', () => ({ getSettings: () => ({ earlyAccessFeatures: ['recall'] }), saveSettings: () => true }))
    expect((await import('@/lib/trail-flag')).isTrailEnabled()).toBe(false)
    vi.resetModules()
    vi.doMock('@/lib/settings', () => ({ getSettings: () => null, saveSettings: () => true }))
    expect((await import('@/lib/trail-flag')).isTrailEnabled()).toBe(false)
  })
  it('記録は既定で残す。trailOff が真のときだけ残さない', async () => {
    vi.doMock('@/lib/settings', () => ({ getSettings: () => ({}), saveSettings: () => true }))
    expect((await import('@/lib/trail-flag')).isTrailRecording()).toBe(true)
    vi.resetModules()
    vi.doMock('@/lib/settings', () => ({ getSettings: () => ({ trailOff: true }), saveSettings: () => true }))
    expect((await import('@/lib/trail-flag')).isTrailRecording()).toBe(false)
  })
  it('切り替えは trailOff を反転して保存する。設定が無ければ保存しない', async () => {
    const save = vi.fn(() => true)
    vi.doMock('@/lib/settings', () => ({ getSettings: () => ({ searchMode: 'notion' }), saveSettings: save }))
    expect((await import('@/lib/trail-flag')).setTrailRecording(false)).toBe(true)
    expect(save).toHaveBeenCalledWith({ searchMode: 'notion', trailOff: true })
    vi.resetModules()
    vi.doMock('@/lib/settings', () => ({ getSettings: () => null, saveSettings: save }))
    expect((await import('@/lib/trail-flag')).setTrailRecording(true)).toBe(false)
  })
})
