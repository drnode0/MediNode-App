import { describe, expect, it } from 'vitest'
import { generateVinePath, pointAtHeight, lengthAtHeight } from '../vine-path'

describe('generateVinePath（決定的・y単調・DOM不使用）', () => {
  it('同じseedなら完全に同じ結果（リロードで蔓が変わらない）', () => {
    const a = generateVinePath(42, 800, 100, 60)
    const b = generateVinePath(42, 800, 100, 60)
    expect(a.d).toBe(b.d)
    expect(a.totalLen).toBe(b.totalLen)
  })
  it('seedが違えば形が変わる', () => {
    expect(generateVinePath(1, 800, 100, 60).d).not.toBe(generateVinePath(2, 800, 100, 60).d)
  })
  it('yは厳密単調増加（高さ→座標の対応が壊れない・20seed分）', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const p = generateVinePath(seed, 1200, 100, 70)
      for (let i = 1; i < p.samples.length; i++) {
        expect(p.samples[i].y).toBeGreaterThan(p.samples[i - 1].y)
      }
    }
  })
  it('最上部サンプルはheightPxに到達・弧長は高さ以上（うねるぶん長い）', () => {
    const p = generateVinePath(7, 1000, 100, 60)
    expect(p.samples[p.samples.length - 1].y).toBeCloseTo(1000, 0)
    expect(p.totalLen).toBeGreaterThanOrEqual(1000)
    expect(p.totalLen).toBeLessThan(1500) // 過剰にうねらない
  })
  it('xはbaseX±ampに収まる', () => {
    const p = generateVinePath(9, 1000, 100, 60)
    for (const s of p.samples) {
      expect(s.x).toBeGreaterThanOrEqual(100 - 60)
      expect(s.x).toBeLessThanOrEqual(100 + 60)
    }
  })
  it('heightPx=0や負でも単調性の契約を守る（1pxの芽にクランプ）', () => {
    for (const h of [0, -5]) {
      const p = generateVinePath(3, h, 100, 60)
      for (let i = 1; i < p.samples.length; i++) {
        expect(p.samples[i].y).toBeGreaterThan(p.samples[i - 1].y)
      }
      expect(p.samples[p.samples.length - 1].y).toBeCloseTo(1, 5)
    }
  })
})

describe('pointAtHeight / lengthAtHeight', () => {
  it('指定高さ±1px以内の点を返す・長さは単調', () => {
    const p = generateVinePath(5, 900, 100, 60)
    let prevLen = -1
    for (const h of [0, 100, 333, 500, 899]) {
      const pt = pointAtHeight(p, h)
      expect(Math.abs(pt.y - h)).toBeLessThanOrEqual(1)
      const len = lengthAtHeight(p, h)
      expect(len).toBeGreaterThan(prevLen)
      prevLen = len
    }
  })
  it('範囲外は端にクランプ', () => {
    const p = generateVinePath(5, 900, 100, 60)
    expect(pointAtHeight(p, -10).y).toBe(p.samples[0].y)
    expect(pointAtHeight(p, 99_999).y).toBeCloseTo(900, 0)
  })
})
