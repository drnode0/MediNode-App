import { describe, expect, it } from 'vitest'
import {
  MM_PER_LEAF, COMPOUND_START_LEAVES, COMPOUND_RATE,
  heightMmFromLeaves, leavesForHeightMm, formatHeight,
} from '../vine-ladder'

describe('ゴールデン定数（GA後は変更不可。落ちたら定数を疑え、テストを直すな）', () => {
  it('葉1枚=2mm・複利開始125枚・r=0.8%', () => {
    expect(MM_PER_LEAF).toBe(2)
    expect(COMPOUND_START_LEAVES).toBe(125)
    expect(COMPOUND_RATE).toBe(0.008)
  })
  it('実寸帯: 葉0=0mm・葉3=6mm・葉125=250mm', () => {
    expect(heightMmFromLeaves(0)).toBe(0)
    expect(heightMmFromLeaves(3)).toBe(6)
    expect(heightMmFromLeaves(125)).toBe(250)
  })
  it('複利帯: 葉126=252mm・富士山(3776m)は葉1333枚で越える', () => {
    expect(heightMmFromLeaves(126)).toBeCloseTo(252, 0)
    expect(leavesForHeightMm(3_776_000)).toBe(1333)
  })
})

describe('heightMmFromLeaves', () => {
  it('単調増加（0〜2000枚）', () => {
    let prev = -1
    for (let n = 0; n <= 2000; n++) {
      const h = heightMmFromLeaves(n)
      expect(h).toBeGreaterThan(prev)
      prev = h
    }
  })
  it('境界が連続（125枚と126枚の間に段差がない）', () => {
    const gap = heightMmFromLeaves(126) - heightMmFromLeaves(125)
    expect(gap).toBeGreaterThan(0)
    expect(gap).toBeLessThan(4) // 2mm×複利ぶん程度
  })
})

describe('leavesForHeightMm（逆関数）', () => {
  it('高さmm以上になる最小の整数葉数を返す', () => {
    expect(leavesForHeightMm(5)).toBe(3)    // アリ5mm→葉3枚目
    expect(leavesForHeightMm(70)).toBe(35)  // 湯のみ7cm→葉35枚
    expect(leavesForHeightMm(250)).toBe(125) // ネコ25cm→葉125枚
  })
  it('往復整合: 任意の目盛りmmで heightMm(leaves(mm)) >= mm かつ heightMm(leaves(mm)-1) < mm', () => {
    for (const mm of [5, 8, 20, 35, 70, 100, 250, 398, 750, 15000, 54800, 3_776_000]) {
      const n = leavesForHeightMm(mm)
      expect(heightMmFromLeaves(n)).toBeGreaterThanOrEqual(mm)
      expect(heightMmFromLeaves(n - 1)).toBeLessThan(mm)
    }
  })
})

describe('formatHeight', () => {
  it('mm/cm/mを桁で切り替える', () => {
    expect(formatHeight(6)).toBe('6mm')
    expect(formatHeight(70)).toBe('7cm')
    expect(formatHeight(252)).toBe('25.2cm')
    expect(formatHeight(3_776_000)).toBe('3776m')
  })
})
