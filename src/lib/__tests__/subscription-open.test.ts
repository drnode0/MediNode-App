import { describe, it, expect, vi, beforeEach } from 'vitest'
import { hasSubscriptionConfig } from '@/lib/algolia'
import { isInAppReaderTarget } from '../subscription-open'

vi.mock('@/lib/algolia', () => ({ hasSubscriptionConfig: vi.fn() }))

describe('isInAppReaderTarget', () => {
  beforeEach(() => vi.mocked(hasSubscriptionConfig).mockReset())
  it('subscription かつ config 有 → true', () => {
    vi.mocked(hasSubscriptionConfig).mockReturnValue(true)
    expect(isInAppReaderTarget('subscription')).toBe(true)
  })
  it('config 無 → false', () => {
    vi.mocked(hasSubscriptionConfig).mockReturnValue(false)
    expect(isInAppReaderTarget('subscription')).toBe(false)
  })
  it('個人/部署/未定義 → false（config 有でも）', () => {
    vi.mocked(hasSubscriptionConfig).mockReturnValue(true)
    expect(isInAppReaderTarget('personal')).toBe(false)
    expect(isInAppReaderTarget('team')).toBe(false)
    expect(isInAppReaderTarget(undefined)).toBe(false)
  })
})
