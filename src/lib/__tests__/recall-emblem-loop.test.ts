// 紋章の共有 rAF（emblem-loop.ts）のうち、DOM を持たずに判断できる部分だけをテストする。
// 30fps の間引き判定（now - last < 33 なら描かない）が対象。
import { describe, it, expect } from 'vitest'
import { shouldDraw } from '@/components/recall/emblem-loop'

describe('shouldDraw（30fpsの間引き）', () => {
  it('33ms未満は描かない', () => {
    expect(shouldDraw(1032, 1000)).toBe(false)
    expect(shouldDraw(1000, 1000)).toBe(false)
  })

  it('33ms以上で描く', () => {
    expect(shouldDraw(1033, 1000)).toBe(true)
    expect(shouldDraw(1100, 1000)).toBe(true)
  })

  it('最初のフレーム（lastDrawnAtが0）はほぼ必ず描く', () => {
    expect(shouldDraw(performance.now(), 0)).toBe(true)
  })
})
