import { describe, it, expect } from 'vitest'
import {
  pct,
  computeFunnel,
  countTrialStarted,
  computeRetention,
  computeSourceQuality,
  computeRevenue,
  PREMIUM_MONTHLY_JPY,
} from '../ledger-metrics'

describe('pct', () => {
  it('小数第1位まで返す', () => expect(pct(1, 3)).toBe(33.3))
  it('母数0は0', () => expect(pct(5, 0)).toBe(0))
})

describe('computeFunnel', () => {
  it('各段の人数と前段比%を返す（先頭はnull）', () => {
    const f = computeFunnel({ lpVisits: 200, registered: 50, trialStarted: 40, paying: 10 })
    expect(f.map((s) => s.count)).toEqual([200, 50, 40, 10])
    expect(f[0].pct).toBeNull()
    expect(f[1].pct).toBe(25) // 50/200
    expect(f[2].pct).toBe(80) // 40/50
    expect(f[3].pct).toBe(25) // 10/40
  })
  it('LP訪問0なら登録段の%はnull（ゼロ除算回避）', () => {
    const f = computeFunnel({ lpVisits: 0, registered: 3, trialStarted: 2, paying: 1 })
    expect(f[1].pct).toBeNull()
  })
})

describe('countTrialStarted', () => {
  it('premium/stripe_trial/trial/auto_trial を試用済みとして数える', () => {
    const rows = [
      { kind: 'premium' as const },
      { kind: 'stripe_trial' as const },
      { kind: 'trial' as const },
      { kind: 'auto_trial' as const },
      { kind: 'free' as const },
      { kind: 'expired' as const },
    ]
    expect(countTrialStarted(rows)).toBe(4)
  })
})

describe('computeRetention', () => {
  it('解約率＝課金解約/(課金中+課金解約)、転換率＝課金中/試用母集団', () => {
    const rows = [
      { kind: 'premium' as const, hasStripe: true }, // 課金中
      { kind: 'premium' as const, hasStripe: true }, // 課金中
      { kind: 'expired' as const, hasStripe: true }, // 課金からの解約
      { kind: 'expired' as const, hasStripe: false }, // 無料トライアル失効（churn対象外）
      { kind: 'trial' as const, hasStripe: false }, // 試用中
    ]
    const r = computeRetention(rows)
    expect(r.payingActive).toBe(2)
    expect(r.churnedPaying).toBe(1)
    expect(r.churn).toBeCloseTo(1 / 3) // 1/(2+1)
    // 試用母集団 = premium2 + trial1 + churnedPaying1 = 4、課金中2
    expect(r.trialToPaying).toBeCloseTo(2 / 4)
  })
  it('母数0でゼロ除算しない', () => {
    const r = computeRetention([{ kind: 'free' as const, hasStripe: false }])
    expect(r.churn).toBe(0)
    expect(r.trialToPaying).toBe(0)
  })
})

describe('computeSourceQuality', () => {
  it('流入元別に登録/試用/課金/CVRを集計し登録数降順', () => {
    const rows = [
      { source: 'x', kind: 'premium' as const },
      { source: 'x', kind: 'trial' as const },
      { source: 'x', kind: 'free' as const },
      { source: 'note', kind: 'free' as const },
    ]
    const q = computeSourceQuality(rows)
    expect(q[0].source).toBe('x') // 登録3で先頭
    expect(q[0]).toMatchObject({ registered: 3, trial: 1, paying: 1 })
    expect(q[0].cvr).toBeCloseTo(33.3) // 1/3
    expect(q[1]).toMatchObject({ source: 'note', registered: 1, paying: 0, cvr: 0 })
  })
})

describe('computeRevenue', () => {
  it('MRR=課金者×単価、ARR=×12、月次は累積', () => {
    const rows = [
      { kind: 'premium' as const, subCreatedAt: '2026-06-10T00:00:00Z' },
      { kind: 'premium' as const, subCreatedAt: '2026-07-02T00:00:00Z' },
      { kind: 'premium' as const, subCreatedAt: '2026-07-20T00:00:00Z' },
      { kind: 'stripe_trial' as const, subCreatedAt: '2026-07-01T00:00:00Z' }, // 課金でない
      { kind: 'expired' as const, subCreatedAt: null },
    ]
    const r = computeRevenue(rows, PREMIUM_MONTHLY_JPY)
    expect(r.payingCount).toBe(3)
    expect(r.mrr).toBe(3 * 980)
    expect(r.arr).toBe(3 * 980 * 12)
    expect(r.monthly).toEqual([
      { month: '2026-06', count: 1 },
      { month: '2026-07', count: 3 },
    ])
  })
})
