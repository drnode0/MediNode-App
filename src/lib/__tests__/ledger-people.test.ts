import { describe, it, expect } from 'vitest'
import {
  lastSeenMs,
  activityBand,
  fmtRelative,
  contributionScore,
  comparePeople,
} from '../ledger-people'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-07-31T12:00:00+09:00').getTime()
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString()

describe('lastSeenMs', () => {
  it('最終利用・最終ログイン・設定同期の最新値を採る', () => {
    const r = { lastUsedAt: iso(3 * DAY), lastSignInAt: iso(1 * DAY), settingsUpdatedAt: iso(10 * DAY) }
    expect(lastSeenMs(r)).toBe(NOW - 1 * DAY)
  })
  it('全て null なら 0（形跡なし）', () => {
    expect(lastSeenMs({ lastUsedAt: null, lastSignInAt: null, settingsUpdatedAt: null })).toBe(0)
  })
})

describe('activityBand', () => {
  it('ちょうど7日前は week（既存「最終利用の内訳」と同じ包含判定）', () => {
    expect(activityBand(NOW - 7 * DAY, NOW)).toBe('week')
  })
  it('7日と1msを超えたら month', () => {
    expect(activityBand(NOW - 7 * DAY - 1, NOW)).toBe('month')
  })
  it('ちょうど30日前は month・超えたら older', () => {
    expect(activityBand(NOW - 30 * DAY, NOW)).toBe('month')
    expect(activityBand(NOW - 30 * DAY - 1, NOW)).toBe('older')
  })
  it('0 は never', () => {
    expect(activityBand(0, NOW)).toBe('never')
  })
})

describe('fmtRelative', () => {
  it('0は—、当日・昨日・日数・週・月を段階表示', () => {
    expect(fmtRelative(0, NOW)).toBe('—')
    expect(fmtRelative(NOW - 2 * 60 * 60 * 1000, NOW)).toBe('今日')
    expect(fmtRelative(NOW - 1 * DAY, NOW)).toBe('昨日')
    expect(fmtRelative(NOW - 5 * DAY, NOW)).toBe('5日前')
    expect(fmtRelative(NOW - 20 * DAY, NOW)).toBe('2週間前')
    expect(fmtRelative(NOW - 100 * DAY, NOW)).toBe('3か月前')
  })
})

describe('comparePeople', () => {
  const base = { lastUsedAt: null, lastSignInAt: null, settingsUpdatedAt: null }
  it('contribution: 合計降順・同数は最終利用が新しい順', () => {
    const a = { ...base, createdAt: iso(1 * DAY), cqCount: 2, voteCount: 0, lastUsedAt: iso(10 * DAY) }
    const b = { ...base, createdAt: iso(2 * DAY), cqCount: 1, voteCount: 1, lastUsedAt: iso(1 * DAY) }
    // 同数(2)なので lastSeen の新しい b が先
    expect(comparePeople('contribution', a, b)).toBeGreaterThan(0)
    const c = { ...base, createdAt: iso(3 * DAY), cqCount: 3, voteCount: 0, lastUsedAt: null }
    expect(comparePeople('contribution', c, a)).toBeLessThan(0)
  })
  it('active: 形跡なしは最後尾', () => {
    const active = { ...base, createdAt: iso(1 * DAY), cqCount: 0, voteCount: 0, lastUsedAt: iso(1 * DAY) }
    const never = { ...base, createdAt: iso(0), cqCount: 0, voteCount: 0 }
    expect(comparePeople('active', never, active)).toBeGreaterThan(0)
  })
  it('newest: 登録日降順・nullは最後尾', () => {
    const newer = { ...base, createdAt: iso(1 * DAY), cqCount: 0, voteCount: 0 }
    const older = { ...base, createdAt: iso(9 * DAY), cqCount: 0, voteCount: 0 }
    const noDate = { ...base, createdAt: null, cqCount: 0, voteCount: 0 }
    expect(comparePeople('newest', newer, older)).toBeLessThan(0)
    expect(comparePeople('newest', noDate, older)).toBeGreaterThan(0)
  })
})

describe('contributionScore', () => {
  it('CQ数と投票数の単純合計', () => {
    expect(contributionScore({ cqCount: 2, voteCount: 3 })).toBe(5)
  })
})
