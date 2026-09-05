import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { hasFeature, EARLY_ACCESS_FEATURES } from '@/lib/feature-access'

const ENV = { ...process.env }
afterEach(() => { process.env = { ...ENV } })

describe('feature recall', () => {
  it('EARLY_ACCESS_FEATURES に recall が入る', () => {
    // 末尾固定ではなく「含まれる」が本来の不変条件。recall より後に追加された機能
    // （例: ask_shelf）が末尾に来るのは自然な運用であり、recall が末尾でなくなっても
    // 壊れてはいけない。
    expect(EARLY_ACCESS_FEATURES).toContain('recall')
  })
  it('RECALL_EMAILS に載ったメールだけ真。EARLY_ACCESS_EMAILS には落ちない', () => {
    process.env.RECALL_EMAILS = 'owner@example.com'
    process.env.EARLY_ACCESS_EMAILS = 'monitor@example.com'
    expect(hasFeature('recall', { email: 'owner@example.com' })).toBe(true)
    expect(hasFeature('recall', { email: 'monitor@example.com' })).toBe(false)
  })
  it('RECALL_EMAILS が空のとき、EARLY_ACCESS_EMAILS にいても偽', () => {
    delete process.env.RECALL_EMAILS
    process.env.EARLY_ACCESS_EMAILS = 'monitor@example.com'
    expect(hasFeature('recall', { email: 'monitor@example.com' })).toBe(false)
  })
  it('レガシー boolean では開かない', () => {
    delete process.env.RECALL_EMAILS
    expect(hasFeature('recall', { email: 'x@example.com', ledgerEarlyAccess: true })).toBe(false)
  })
})

describe('isRecallEnabled', () => {
  beforeEach(() => { vi.resetModules() })
  it('features ミラーに recall があれば真、無ければ偽、settings が無ければ偽', async () => {
    vi.doMock('@/lib/settings', () => ({ getSettings: () => ({ earlyAccessFeatures: ['recall'] }) }))
    expect((await import('@/lib/recall-flag')).isRecallEnabled()).toBe(true)
    vi.resetModules()
    vi.doMock('@/lib/settings', () => ({ getSettings: () => ({ earlyAccessFeatures: ['tower'] }) }))
    expect((await import('@/lib/recall-flag')).isRecallEnabled()).toBe(false)
    vi.resetModules()
    vi.doMock('@/lib/settings', () => ({ getSettings: () => null }))
    expect((await import('@/lib/recall-flag')).isRecallEnabled()).toBe(false)
  })
})
