import { describe, expect, it } from 'vitest'
import {
  PX_PER_LEAF, SCENE_TOP_PAD, GROUND_GAP, SCENE_BOTTOM_PAD,
  sceneHeightPx, leafY, groundY, visibleRange, markPositions,
} from '../vine-scroll'

describe('葉の縦位置', () => {
  it('いちばん新しい葉が上端の余白の位置に来る', () => {
    expect(leafY(100, 100)).toBe(SCENE_TOP_PAD)
  })
  it('古い葉ほど下に来る（1葉あたり14px）', () => {
    expect(leafY(99, 100)).toBe(SCENE_TOP_PAD + PX_PER_LEAF)
    expect(leafY(1, 100)).toBe(SCENE_TOP_PAD + 99 * PX_PER_LEAF)
  })
  it('葉が何枚あっても間隔は縮まない（間引かない設計の担保）', () => {
    for (const total of [10, 300, 3000]) {
      expect(leafY(1, total) - leafY(2, total)).toBe(PX_PER_LEAF)
    }
  })
  it('葉0でも落ちない', () => {
    expect(() => sceneHeightPx(0)).not.toThrow()
    expect(groundY(0)).toBe(SCENE_TOP_PAD + GROUND_GAP)
  })
})

describe('シーンの丈', () => {
  it('地面は最古の葉より下、シーンはさらに下に余白を持つ', () => {
    expect(groundY(100)).toBe(leafY(1, 100) + GROUND_GAP)
    expect(sceneHeightPx(100)).toBe(groundY(100) + SCENE_BOTTOM_PAD)
  })
  it('葉300枚で6画面分ほどになる（画面700px想定）', () => {
    expect(Math.round(sceneHeightPx(300) / 700)).toBe(6)
  })
})

describe('仮想化の窓', () => {
  it('上端では新しい側だけを返す', () => {
    const r = visibleRange(0, 700, 300)
    expect(r.to).toBe(300)
    expect(r.from).toBeLessThan(300)
    expect(r.from).toBeGreaterThanOrEqual(1)
  })
  it('前後1画面分の余白を含む（窓はおよそ3画面分）', () => {
    // 上端でも下端でもない位置。3画面分 ÷ 14px = およそ150枚が窓に入る
    const mid = visibleRange(1400, 700, 300)
    expect(mid.to - mid.from + 1).toBeGreaterThanOrEqual(148)
    expect(mid.to - mid.from + 1).toBeLessThanOrEqual(156)
    // 画面の中に居る葉が窓から漏れていないこと
    expect(leafY(mid.to, 300)).toBeLessThanOrEqual(1400)
    expect(leafY(mid.from, 300)).toBeGreaterThanOrEqual(1400 + 700)
  })
  it('総数を超えない・1を下回らない', () => {
    const r = visibleRange(-9999, 700, 50)
    expect(r.from).toBe(1)
    expect(r.to).toBe(50)
  })
  it('葉0なら空の窓を返す', () => {
    expect(visibleRange(0, 700, 0)).toEqual({ from: 1, to: 0 })
  })
})

describe('越えた印', () => {
  it('越えた実物だけを、越えた時点の葉の位置に置く', () => {
    const marks = markPositions(60) // アリ3・テントウムシ4・ドングリ10・カタツムリ18・湯のみ35・スズメ50
    expect(marks.map((m) => m.milestone.label)).toEqual(
      ['アリ', 'テントウムシ', 'ドングリ', 'カタツムリ', '湯のみ', 'スズメ'],
    )
    const suzume = marks[marks.length - 1]
    expect(suzume.leafIndex).toBe(50)
    expect(suzume.y).toBe(leafY(50, 60))
  })
  it('まだ越えていない実物は含めない', () => {
    expect(markPositions(2)).toEqual([])
  })
})
