import { describe, expect, it } from 'vitest'
import { buildPhases, totalDurMs, replayAt } from '../vine-replay'

describe('buildPhases', () => {
  it('通常の日: 溜め500→伸び1600→着地450→余韻1300', () => {
    const p = buildPhases(10, 14, null, false)
    expect(p.map((x) => [x.name, x.durMs])).toEqual([
      ['tame', 500], ['nobi', 1600], ['chakuchi', 450], ['yoin', 1300],
    ])
    expect(totalDurMs(p)).toBe(3850)
  })
  it('追い越しの日: 伸びが目盛りで二分され、間と刻みが挟まる', () => {
    const p = buildPhases(30, 40, 35, false) // 葉35=湯のみを越える日
    expect(p.map((x) => x.name)).toEqual(['tame', 'nobi', 'ma', 'kizami', 'nobi', 'chakuchi', 'yoin'])
    const nobis = p.filter((x) => x.name === 'nobi')
    expect(nobis[0]).toMatchObject({ fromLeaves: 30, toLeaves: 35 })
    expect(nobis[1]).toMatchObject({ fromLeaves: 35, toLeaves: 40 })
  })
  it('reduced: 400msの余韻のみ（leavesは即to）', () => {
    const p = buildPhases(10, 14, null, true)
    expect(p).toEqual([{ name: 'yoin', durMs: 400, fromLeaves: 14, toLeaves: 14 }])
  })
})

describe('replayAt', () => {
  const p = buildPhases(10, 14, null, false)
  it('溜め中はleaves=from・完了後はdone&leaves=to', () => {
    expect(replayAt(p, 0)).toMatchObject({ name: 'tame', leavesNow: 10, done: false })
    expect(replayAt(p, 99_999)).toMatchObject({ leavesNow: 14, done: true })
  })
  it('伸びの中間で単調に増える（イージングつき）', () => {
    const a = replayAt(p, 500 + 400).leavesNow
    const b = replayAt(p, 500 + 800).leavesNow
    const c = replayAt(p, 500 + 1200).leavesNow
    expect(a).toBeGreaterThan(10)
    expect(b).toBeGreaterThan(a)
    expect(c).toBeGreaterThan(b)
    expect(c).toBeLessThanOrEqual(14)
  })
  it('伸び終端でtoLeavesに到達', () => {
    expect(replayAt(p, 500 + 1600).leavesNow).toBeCloseTo(14, 5)
  })
})
