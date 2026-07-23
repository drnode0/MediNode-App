import { describe, it, expect } from 'vitest'
import { recentGroupIndex } from '../recent-grouping'

// now = 2026-07-23 09:00 JST（= 2026-07-23T00:00:00Z）
const NOW = Date.parse('2026-07-23T00:00:00Z')

describe('recentGroupIndex', () => {
  it('前日夕方(JST)の投稿は「今日(0)」ではなく「今週(1)」に入る（旧24hローリング窓のバグ修正）', () => {
    // 2026-07-22 10:00 JST = 2026-07-22T01:00:00Z（約23時間前だが暦日は前日）
    expect(recentGroupIndex('2026-07-22T01:00:00Z', NOW)).toBe(1)
  })

  it('本日(JST)の投稿は「今日(0)」', () => {
    // 2026-07-23 08:00 JST
    expect(recentGroupIndex('2026-07-22T23:00:00Z', NOW)).toBe(0)
  })

  it('7日以内は今週(1)、30日以内は今月(2)、それ以上はそれ以前(3)', () => {
    expect(recentGroupIndex('2026-07-18T00:00:00Z', NOW)).toBe(1)
    expect(recentGroupIndex('2026-07-01T00:00:00Z', NOW)).toBe(2)
    expect(recentGroupIndex('2026-05-01T00:00:00Z', NOW)).toBe(3)
  })

  it('日付が空/不正なら それ以前(3)', () => {
    expect(recentGroupIndex(undefined, NOW)).toBe(3)
    expect(recentGroupIndex('', NOW)).toBe(3)
    expect(recentGroupIndex('not-a-date', NOW)).toBe(3)
  })
})
