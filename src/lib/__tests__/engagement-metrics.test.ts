import { describe, it, expect } from 'vitest'
import {
  countUsageOn,
  avgDailyUnique,
  memberActiveRate,
  stickiness,
  continuityDistribution,
  weeklyRetention,
  optOutRate,
  ACTIVE_MEMBER_KINDS,
} from '../engagement-metrics'

const DAY = 24 * 60 * 60 * 1000

describe('countUsageOn', () => {
  const rows = [{ used_on: '2026-07-24' }, { used_on: '2026-07-24' }, { used_on: '2026-07-23' }]
  it('その日付の行数（=ユニーク使用者数）を返す', () => {
    expect(countUsageOn(rows, '2026-07-24')).toBe(2)
    expect(countUsageOn(rows, '2026-07-23')).toBe(1)
  })
  it('該当なしは0', () => {
    expect(countUsageOn(rows, '2026-07-01')).toBe(0)
    expect(countUsageOn([], '2026-07-24')).toBe(0)
  })
})

describe('avgDailyUnique', () => {
  it('直近7日の日次件数の平均を四捨五入で返す', () => {
    const rows = [
      { used_on: '2026-07-24' },
      { used_on: '2026-07-24' },
      { used_on: '2026-07-23' },
    ]
    const keys = ['2026-07-24', '2026-07-23', '2026-07-22', '2026-07-21', '2026-07-20', '2026-07-19', '2026-07-18']
    // 合計3人日 / 7 = 0.43 → 0
    expect(avgDailyUnique(rows, keys)).toBe(0)
  })
  it('空は0（ゼロ除算しない）', () => {
    expect(avgDailyUnique([], [])).toBe(0)
  })
})

describe('memberActiveRate', () => {
  const now = Date.parse('2026-07-24T00:00:00.000Z')
  const members = [
    { kind: 'premium', lastUsedAt: new Date(now - 1 * DAY).toISOString() }, // 有効・稼働
    { kind: 'trial', lastUsedAt: new Date(now - 6 * DAY).toISOString() }, // 有効・稼働
    { kind: 'premium', lastUsedAt: new Date(now - 20 * DAY).toISOString() }, // 有効・非稼働
    { kind: 'premium', lastUsedAt: null }, // 有効・未使用
    { kind: 'free', lastUsedAt: new Date(now - 1 * DAY).toISOString() }, // 会員でない→分母外
  ]
  it('有効会員のうち7日以内利用の割合。分母は有効会員のみ', () => {
    const r = memberActiveRate(members, now, 7)
    expect(r.total).toBe(4) // free を除く
    expect(r.active).toBe(2)
    expect(r.pct).toBe(50)
  })
  it('有効会員0人なら0%（ゼロ除算しない）', () => {
    const r = memberActiveRate([{ kind: 'free', lastUsedAt: null }], now, 7)
    expect(r).toEqual({ active: 0, total: 0, pct: 0 })
  })
  it('ACTIVE_MEMBER_KINDS は課金＋試用系', () => {
    expect(ACTIVE_MEMBER_KINDS).toContain('premium')
    expect(ACTIVE_MEMBER_KINDS).toContain('auto_trial')
    expect(ACTIVE_MEMBER_KINDS).not.toContain('free')
  })
})

describe('stickiness', () => {
  it('DAU/MAU を%で返す', () => {
    expect(stickiness(5, 20)).toBe(25)
  })
  it('MAU0は0', () => {
    expect(stickiness(0, 0)).toBe(0)
  })
})

describe('continuityDistribution', () => {
  const last7 = ['2026-07-24', '2026-07-23', '2026-07-22', '2026-07-21', '2026-07-20', '2026-07-19', '2026-07-18']
  it('ユーザーごとの利用日数をバケットに振り分け、リピーター率を出す', () => {
    const rows = [
      // u1: 1日だけ
      { user_id: 'u1', used_on: '2026-07-24' },
      // u2: 3日
      { user_id: 'u2', used_on: '2026-07-24' },
      { user_id: 'u2', used_on: '2026-07-23' },
      { user_id: 'u2', used_on: '2026-07-22' },
      // u3: 毎日(7)
      ...last7.map((d) => ({ user_id: 'u3', used_on: d })),
    ]
    const r = continuityDistribution(rows, last7)
    expect(r.buckets).toEqual({ d1: 1, d2_3: 1, d4_6: 0, daily: 1 })
    // ≥2日=2人(u2,u3) / ≥1日=3人 = 66.7%（pct は小数第1位）
    expect(r.repeaterRate).toBe(66.7)
  })
  it('窓外の日付は数えない・重複日は1回', () => {
    const rows = [
      { user_id: 'u1', used_on: '2026-07-24' },
      { user_id: 'u1', used_on: '2026-07-24' }, // 重複
      { user_id: 'u1', used_on: '2026-07-01' }, // 窓外
    ]
    const r = continuityDistribution(rows, last7)
    expect(r.buckets).toEqual({ d1: 1, d2_3: 0, d4_6: 0, daily: 0 })
    expect(r.repeaterRate).toBe(0)
  })
})

describe('weeklyRetention', () => {
  const thisWeek = ['2026-07-24', '2026-07-23', '2026-07-22', '2026-07-21', '2026-07-20', '2026-07-19', '2026-07-18']
  const lastWeek = ['2026-07-17', '2026-07-16', '2026-07-15', '2026-07-14', '2026-07-13', '2026-07-12', '2026-07-11']
  it('継続・新規復帰・離脱注意を数える', () => {
    const rows = [
      { user_id: 'cont', used_on: '2026-07-23' }, // 今週
      { user_id: 'cont', used_on: '2026-07-16' }, // 先週 → 継続
      { user_id: 'new', used_on: '2026-07-22' }, // 今週のみ → 新規/復帰
      { user_id: 'churn', used_on: '2026-07-14' }, // 先週のみ → 離脱注意
    ]
    const r = weeklyRetention(rows, thisWeek, lastWeek)
    expect(r.thisWeekActive).toBe(2) // cont,new
    expect(r.continuing).toBe(1) // cont
    expect(r.newOrReturning).toBe(1) // new
    expect(r.churnRisk).toBe(1) // churn
  })
})

describe('optOutRate', () => {
  it('失効 / 一度でも購読 を%で返す', () => {
    expect(optOutRate(10, 3)).toBe(30)
  })
  it('母数0は0', () => {
    expect(optOutRate(0, 0)).toBe(0)
  })
})
