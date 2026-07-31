import { describe, it, expect } from 'vitest'
import {
  LADDER, MM_PER_STEP, heightMm, formatHeight, nextMilestone, passedMilestones, stepsThisWeek,
} from '../tower-ladder'

describe('梯子', () => {
  it('15段が歩数の昇順に並ぶ（序盤密）', () => {
    expect(LADDER.length).toBe(15)
    for (let i = 1; i < LADDER.length; i++) {
      expect(LADDER[i].steps).toBeGreaterThan(LADDER[i - 1].steps)
    }
    expect(LADDER[0]).toMatchObject({ steps: 3, label: 'アリ' })
    expect(LADDER.find((m) => m.label === 'ネコ')?.steps).toBe(300)
  })
  it('高さ換算とフォーマット', () => {
    expect(heightMm(214)).toBe(214 * MM_PER_STEP)
    expect(formatHeight(214)).toBe('21.4cm')
    expect(formatHeight(8)).toBe('8mm')
    expect(formatHeight(1720)).toBe('1.72m')
  })
  it('次の目盛りと越えた目盛り', () => {
    const next = nextMilestone(214)
    expect(next?.label).toBe('ネコ')
    expect(passedMilestones(214).map((m) => m.label)).toContain('スズメ')
    expect(passedMilestones(214).map((m) => m.label)).not.toContain('ネコ')
    expect(nextMilestone(99999)).toBeNull()
  })
  it('ちょうど目盛り上は「越えた」', () => {
    expect(passedMilestones(300).map((m) => m.label)).toContain('ネコ')
    expect(nextMilestone(300)?.label).toBe('柴犬')
  })
  it('今週の歩数は直近7日のみ数える', () => {
    const now = '2026-08-01T12:00:00.000Z'
    const steps = [
      { at: '2026-07-31T00:00:00.000Z' },
      { at: '2026-07-26T00:00:00.000Z' },
      { at: '2026-07-24T00:00:00.000Z' }, // 8日前
    ]
    expect(stepsThisWeek(steps, now)).toBe(2)
  })
})
