import { describe, expect, it } from 'vitest'
import type { Step } from '../tower-steps'
import { PX_PER_LEAF, leafY } from '../vine-scroll'
import { SCENERY_ALMANAC, eventsBetween, sceneryMarks } from '../vine-scenery'

const leaf = (at: string): Step => ({ id: `k-${at}`, kind: 'recall', at, genre: '', title: '' })

describe('暦', () => {
  it('12項目・すべて名詞ラベル', () => {
    expect(SCENERY_ALMANAC).toHaveLength(12)
  })
  it('期間内の出来事を年をまたいで列挙する（JST解釈）', () => {
    const evs = eventsBetween('2025-12-01T00:00:00.000Z', '2026-02-28T00:00:00.000Z')
    expect(evs.map((e) => e.kind)).toEqual(['hatsuyuki', 'hatsuhinode', 'ume'])
  })
  it('期間外は含めない', () => {
    expect(eventsBetween('2026-06-16T00:00:00.000Z', '2026-07-01T00:00:00.000Z')).toEqual([])
  })
})

describe('sceneryMarks（点景の位置＝葉と葉の間に時間割合で置く）', () => {
  const NOW = '2026-08-01T00:00:00.000Z'
  it('最初の葉より前の点景は置かない', () => {
    const leaves = [leaf('2026-07-01T00:00:00.000Z'), leaf('2026-07-30T00:00:00.000Z')]
    const marks = sceneryMarks(leaves, NOW)
    expect(marks.map((m) => m.kind)).toEqual(['semi']) // 7/20だけ。6/15の蛍は蔓が始まる前
  })
  it('葉が伸びなかった期間の点景は同じ葉間に重なる（leafIndexが同じ）', () => {
    const leaves = [leaf('2026-03-01T00:00:00.000Z'), leaf('2026-07-30T00:00:00.000Z')]
    const marks = sceneryMarks(leaves, NOW)
    // 3/28 桜・4/20 つばめ・5/20 若葉・6/15 蛍・7/20 蝉——全部 葉1と葉2の間
    expect(marks).toHaveLength(5)
    expect(new Set(marks.map((m) => m.leafIndex))).toEqual(new Set([1]))
    // yは葉1と葉2の間（14pxの帯の中）で単調（新しいほど上=小さい）
    const ys = marks.map((m) => m.y)
    expect(Math.max(...ys)).toBeLessThanOrEqual(leafY(1, 2))
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(leafY(2, 2) - PX_PER_LEAF)
    expect([...ys].sort((a, b) => b - a)).toEqual(ys)
  })
  it('最後の葉より新しい点景は穂先の上1葉ぶんに圧縮して置く', () => {
    const leaves = [leaf('2026-06-01T00:00:00.000Z')]
    const marks = sceneryMarks(leaves, NOW) // 6/15 蛍・7/20 蝉が葉より新しい
    expect(marks.map((m) => m.kind)).toEqual(['hotaru', 'semi'])
    for (const m of marks) {
      expect(m.y).toBeLessThan(leafY(1, 1))
      expect(m.y).toBeGreaterThanOrEqual(leafY(1, 1) - PX_PER_LEAF)
    }
  })
  it('葉0なら空', () => {
    expect(sceneryMarks([], NOW)).toEqual([])
  })
})
