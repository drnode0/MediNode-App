import { describe, it, expect } from 'vitest'
import {
  aggregateDaily,
  computeSummary,
  buildWeekGrid,
  jstWeekdayMon0,
  paceStatus,
  isReaderOrigin,
  type ActivitySummary,
} from '@/lib/knowledge-activity'

function summaryOf(daysSince: number | null, thisWeek: number): ActivitySummary {
  return {
    last7: { medical: 0, reference: 0 },
    last30: { medical: 0, reference: 0 },
    daysSinceLastMedical: daysSince,
    thisWeekMedical: thisWeek,
  }
}

// JST 2026-07-23 12:00 = UTC 2026-07-23T03:00:00Z
const NOW = Date.parse('2026-07-23T03:00:00.000Z')

describe('aggregateDaily', () => {
  it('作成日に new、別日の最終更新に edit を系列ごとに加算する', () => {
    const daily = aggregateDaily(
      [
        // 作成と更新が同日 → new のみ
        { createdAt: '2026-07-20T01:00:00.000Z', lastEdited: '2026-07-20T05:00:00.000Z' },
        // 作成後、別日に更新 → 作成日に new、更新日に edit
        { createdAt: '2026-07-20T01:00:00.000Z', lastEdited: '2026-07-22T05:00:00.000Z' },
      ],
      [
        { createdAt: '2026-07-21T01:00:00.000Z', lastEdited: '2026-07-21T01:00:00.000Z' },
      ],
    )
    expect(daily.get('2026-07-20')).toEqual({
      date: '2026-07-20', medicalNew: 2, medicalEdit: 0, referenceNew: 0, referenceEdit: 0,
    })
    expect(daily.get('2026-07-22')).toEqual({
      date: '2026-07-22', medicalNew: 0, medicalEdit: 1, referenceNew: 0, referenceEdit: 0,
    })
    expect(daily.get('2026-07-21')).toEqual({
      date: '2026-07-21', medicalNew: 0, medicalEdit: 0, referenceNew: 1, referenceEdit: 0,
    })
  })

  it('UTC→JST の日跨ぎを JST 日付で割り当てる', () => {
    // UTC 2026-07-20T16:00Z = JST 2026-07-21 01:00 → 21日に new
    const daily = aggregateDaily(
      [{ createdAt: '2026-07-20T16:00:00.000Z', lastEdited: '2026-07-20T16:00:00.000Z' }],
      [],
    )
    expect(daily.get('2026-07-21')?.medicalNew).toBe(1)
    expect(daily.has('2026-07-20')).toBe(false)
  })

  it('空文字の時刻は無視する', () => {
    const daily = aggregateDaily([{ createdAt: '', lastEdited: '' }], [])
    expect(daily.size).toBe(0)
  })
})

describe('jstWeekdayMon0', () => {
  it('月曜=0, 日曜=6 を返す', () => {
    expect(jstWeekdayMon0('2026-07-20')).toBe(0) // 月
    expect(jstWeekdayMon0('2026-07-23')).toBe(3) // 木
    expect(jstWeekdayMon0('2026-07-26')).toBe(6) // 日
  })
})

describe('computeSummary', () => {
  it('直近7/30日・今週medical・最終投稿からの日数を出す', () => {
    const daily = aggregateDaily(
      [
        { createdAt: '2026-07-21T01:00:00.000Z', lastEdited: '2026-07-21T01:00:00.000Z' }, // 今週 new
        { createdAt: '2026-06-30T01:00:00.000Z', lastEdited: '2026-06-30T01:00:00.000Z' }, // 30日内(new)・7日外
      ],
      [{ createdAt: '2026-07-22T01:00:00.000Z', lastEdited: '2026-07-22T01:00:00.000Z' }],
    )
    const s = computeSummary(daily, NOW)
    expect(s.last7.medical).toBe(1)
    expect(s.last7.reference).toBe(1)
    expect(s.last30.medical).toBe(2)
    expect(s.thisWeekMedical).toBe(1)
    expect(s.daysSinceLastMedical).toBe(2) // 7/21 → 7/23
  })

  it('medical新規が皆無なら daysSinceLastMedical は null', () => {
    const daily = aggregateDaily([], [{ createdAt: '2026-07-22T01:00:00.000Z', lastEdited: '2026-07-22T01:00:00.000Z' }])
    expect(computeSummary(daily, NOW).daysSinceLastMedical).toBe(null)
  })
})

describe('isReaderOrigin', () => {
  it('由来=現場の疑問 のみ true', () => {
    expect(isReaderOrigin('現場の疑問')).toBe(true)
    expect(isReaderOrigin(' 現場の疑問 ')).toBe(true)
    expect(isReaderOrigin('')).toBe(false)
    expect(isReaderOrigin(null)).toBe(false)
    expect(isReaderOrigin('その他')).toBe(false)
  })
})

describe('paceStatus', () => {
  it('投稿ゼロ歴は idle', () => {
    expect(paceStatus(summaryOf(null, 0), 3)).toEqual({ level: 'idle', message: expect.any(String) })
  })
  it('7日以上ゼロは alert', () => {
    const s = paceStatus(summaryOf(8, 0), 3)
    expect(s.level).toBe('alert')
  })
  it('週目標達成は good', () => {
    expect(paceStatus(summaryOf(1, 3), 3).level).toBe('good')
    expect(paceStatus(summaryOf(0, 5), 3).level).toBe('good')
  })
  it('未達かつ3日以上空くと warn（残り件数を出す）', () => {
    const s = paceStatus(summaryOf(4, 1), 3)
    expect(s.level).toBe('warn')
    expect(s.message).toContain('あと2件')
  })
  it('未達でも直近に投稿ありなら good（順調）', () => {
    expect(paceStatus(summaryOf(1, 2), 3).level).toBe('good')
  })
})

describe('buildWeekGrid', () => {
  it('weeks 列ぶんを月曜起点で0埋めし、今週月曜を最右列にする', () => {
    const daily = aggregateDaily(
      [{ createdAt: '2026-07-21T01:00:00.000Z', lastEdited: '2026-07-21T01:00:00.000Z' }],
      [],
    )
    const grid = buildWeekGrid(daily, NOW, 4)
    expect(grid.columns).toHaveLength(4)
    expect(grid.columns.every((col) => col.length === 7)).toBe(true)
    expect(grid.todayKey).toBe('2026-07-23')
    // 最右列は今週（月曜=2026-07-20〜）。火曜(index1)=2026-07-21 に medicalNew=1
    const lastCol = grid.columns[3]
    expect(lastCol[0].date).toBe('2026-07-20')
    expect(lastCol[1].date).toBe('2026-07-21')
    expect(lastCol[1].medicalNew).toBe(1)
  })
})
