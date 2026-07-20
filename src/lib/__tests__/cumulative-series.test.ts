import { describe, it, expect } from 'vitest'
import { buildCumulativeSeries } from '@/app/admin/AdminCharts'

describe('buildCumulativeSeries', () => {
  it('実時刻でステップを刻み、末尾に now を足す', () => {
    const now = '2026-07-20T12:00:00Z'
    const series = buildCumulativeSeries(
      ['2026-07-18T11:30:00Z', '2026-07-20T00:10:00Z', null],
      now
    )
    expect(series).toEqual([
      { date: '2026-07-18T11:30:00Z', count: 1 },
      { date: '2026-07-20T00:10:00Z', count: 2 },
      { date: now, count: 2 },
    ])
  })

  it('同時刻の登録は1点にまとめる', () => {
    const now = '2026-07-20T12:00:00Z'
    const series = buildCumulativeSeries(
      ['2026-07-20T00:10:00Z', '2026-07-20T00:10:00Z'],
      now
    )
    expect(series[0]).toEqual({ date: '2026-07-20T00:10:00Z', count: 2 })
    expect(series[series.length - 1]).toEqual({ date: now, count: 2 })
  })

  it('空配列は空', () => expect(buildCumulativeSeries([], '2026-07-20T12:00:00Z')).toEqual([]))
})
