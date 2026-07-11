// Secured API Key 発行の決定性（日内で同一キー）と期限クランプのテスト。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { issuePremiumSearchKey } from '../algolia-secured'

const BASE = {
  appId: 'TESTAPP',
  parentSearchKey: 'parent-search-key-for-test',
  index: 'test_index',
}

afterEach(() => {
  vi.useRealTimers()
})

describe('issuePremiumSearchKey', () => {
  it('同じUTC日のうちは同じキーを返す（PremiumSyncのリロードループ防止）', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T01:00:00Z'))
    const k1 = issuePremiumSearchKey(BASE)
    vi.setSystemTime(new Date('2026-07-11T23:59:00Z'))
    const k2 = issuePremiumSearchKey(BASE)
    expect(k1).toBe(k2)
  })

  it('UTC日が変わるとキーが変わる', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'))
    const k1 = issuePremiumSearchKey(BASE)
    vi.setSystemTime(new Date('2026-07-12T12:00:00Z'))
    const k2 = issuePremiumSearchKey(BASE)
    expect(k1).not.toBe(k2)
  })

  it('expiresAt がグリッドより早ければそちらを採用（トライアル期限で失効）', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T00:00:00Z'))
    const soon = '2026-07-12T00:00:00Z' // グリッド（+8日）より早い
    const kSoon = issuePremiumSearchKey({ ...BASE, expiresAt: soon })
    const kGrid = issuePremiumSearchKey(BASE)
    expect(kSoon).not.toBe(kGrid)
    // デコードして validUntil を検証（secured keyはbase64のクエリ文字列+HMAC）。
    const decoded = Buffer.from(kSoon, 'base64').toString('utf8')
    expect(decoded).toContain(`validUntil=${Math.floor(new Date(soon).getTime() / 1000)}`)
    // restrictIndices はJSON配列がURLエンコードされて埋め込まれる（%5B%22test_index%22%5D）。
    expect(decodeURIComponent(decoded)).toContain('restrictIndices=["test_index"]')
  })

  it('expiresAt がグリッドより遅ければグリッドを採用（キー寿命の上限8日）', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-11T00:00:00Z'))
    const far = '2027-01-01T00:00:00Z'
    const kFar = issuePremiumSearchKey({ ...BASE, expiresAt: far })
    const kGrid = issuePremiumSearchKey(BASE)
    expect(kFar).toBe(kGrid)
  })
})
