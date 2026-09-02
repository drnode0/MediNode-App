import { describe, it, expect } from 'vitest'
import { project, pickAt, type Sprite } from '@/lib/recall/render'

const sp = (id: string, home: [number, number, number]): Sprite => ({ claimId: id, home, state: { kind: 'kept', remaining: 1 }, phase: 0 })

describe('render 純関数', () => {
  it('回転ゼロなら手前（z=-1）の点は画面中央に、奥（z=+1）は隠れる側に投影される', () => {
    const cam = { rotY: 0, rotX: 0, zoom: 1 }
    const front = project([0, 0, -1], cam, 100, 200, 300)
    expect(front.X).toBeCloseTo(200); expect(front.Y).toBeCloseTo(300); expect(front.Z).toBeLessThan(0)
    expect(project([0, 0, 1], cam, 100, 200, 300).Z).toBeGreaterThan(0)
  })
  it('pickAt は半径内で最も近い手前の主張を返し、奥の主張は選ばない', () => {
    const cam = { rotY: 0, rotX: 0, zoom: 1 }
    const near = sp('near', [0, 0, -1]), back = sp('back', [0, 0, 1])
    expect(pickAt([near, back], cam, 100, 200, 300, 203, 302, 20)?.claimId).toBe('near')
    expect(pickAt([back], cam, 100, 200, 300, 200, 300, 20)).toBeNull()
    expect(pickAt([near], cam, 100, 200, 300, 260, 300, 20)).toBeNull()
  })
})
