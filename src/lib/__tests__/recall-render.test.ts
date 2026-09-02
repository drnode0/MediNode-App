import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { project, pickAt, drawnPos, drawFrame, viewport, hereMark, type Sprite, type Camera, type FrameArgs } from '@/lib/recall/render'
import type { RecallState } from '@/lib/recall/types'

const sp = (id: string, home: [number, number, number], state: RecallState = { kind: 'kept', remaining: 1 }, phase = 0): Sprite =>
  ({ claimId: id, home, state, phase })
const view = (R: number, cx: number, cy: number) => ({ R, cx, cy })
const CAM0: Camera = { rotY: 0, rotX: 0, zoom: 1 }

// ---- Canvas の代わり（このファイル内だけの記録用の偽物） ----
type Draw = { alpha: number; x: number; y: number; w: number; h: number }
function recorder() {
  const draws: Draw[] = []
  const ctx = {
    globalAlpha: 1, fillStyle: '' as unknown, font: '', textAlign: '',
    clearRect() {}, fillRect() {}, fillText() {},
    createRadialGradient: () => ({ addColorStop() {} }),
    drawImage(_img: unknown, x: number, y: number, w: number, h: number) {
      draws.push({ alpha: ctx.globalAlpha, x, y, w, h })
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, draws }
}
const offscreen = () => ({
  width: 0, height: 0,
  getContext: () => ({
    fillStyle: '' as unknown, globalAlpha: 1,
    createRadialGradient: () => ({ addColorStop() {} }),
    fillRect() {},
  }),
})
const hadDocument = 'document' in globalThis
beforeAll(() => { (globalThis as { document?: unknown }).document = { createElement: () => offscreen() } })
afterAll(() => { if (!hadDocument) delete (globalThis as { document?: unknown }).document })

const frame = (over: Partial<FrameArgs>): FrameArgs => ({
  W: 800, H: 800, cam: CAM0, sprites: [], flying: new Map(), marks: [],
  t: 0, reduced: false, dimmed: false, lens: 'all', ...over,
})

describe('render 純関数', () => {
  it('回転ゼロなら手前（z=-1）の点は画面中央に、奥（z=+1）は隠れる側に投影される', () => {
    const front = project([0, 0, -1], CAM0, 100, 200, 300)
    expect(front.X).toBeCloseTo(200); expect(front.Y).toBeCloseTo(300); expect(front.Z).toBeLessThan(0)
    expect(project([0, 0, 1], CAM0, 100, 200, 300).Z).toBeGreaterThan(0)
  })

  // 回転ゼロだと回転の項がすべて 0 倍になり、符号を反転しても気づけない。ここで向きを固定する。
  it('横回転90度で +x の点は手前の極へ、縦回転90度で +y の点は奥へ回る', () => {
    const yaw = project([1, 0, 0], { rotY: Math.PI / 2, rotX: 0, zoom: 1 }, 100, 200, 300)
    expect(yaw.X).toBeCloseTo(200); expect(yaw.Z).toBeCloseTo(-100)
    const pitch = project([0, 1, 0], { rotY: 0, rotX: Math.PI / 2, zoom: 1 }, 100, 200, 300)
    expect(pitch.Z).toBeCloseTo(100)
  })

  it('pickAt は半径内で最も近い手前の主張を返し、奥の主張は選ばない', () => {
    const near = sp('near', [0, 0, -1]), back = sp('back', [0, 0, 1])
    expect(pickAt([near, back], CAM0, view(100, 200, 300), 0, true, 203, 302, 20)?.claimId).toBe('near')
    expect(pickAt([back], CAM0, view(100, 200, 300), 0, true, 200, 300, 20)).toBeNull()
    expect(pickAt([near], CAM0, view(100, 200, 300), 0, true, 260, 300, 20)).toBeNull()
  })

  // I2: 画面距離だけで選ぶと、上に描かれている手前の点を飛び越して奥の点が当たる。
  it('半径内に2つあるとき、画面距離が遠くても手前（上に描かれる方）を選ぶ', () => {
    const v = view(100, 200, 300)
    const near = sp('near', [0.98, 0, -0.2])      // X=303.16 / Z=-20（あとから描かれる＝上）
    const far = sp('far', [0.995, 0, 0.0999])     // X=297.08 / Z=+9.99（先に描かれる＝下）
    const pn = project(near.home, CAM0, 100, 200, 300), pf = project(far.home, CAM0, 100, 200, 300)
    expect(Math.hypot(pf.X - 300, pf.Y - 300)).toBeLessThan(Math.hypot(pn.X - 300, pn.Y - 300)) // 奥の方が画面上は近い
    expect(pickAt([near, far], CAM0, v, 0, true, 300, 300, 20)?.claimId).toBe('near')
    expect(pickAt([far, near], CAM0, v, 0, true, 300, 300, 20)?.claimId).toBe('near') // 並び順に依らない
  })

  // I3: 当たり判定は定位置ではなく「描いた位置」を見る。
  it('ゆらぎでずれた主張は、描かれている位置で当たり、定位置では当たらない', () => {
    const v = view(400, 200, 300), t = 8.219
    const s = sp('wob', [1, 0, 0])
    const drawn = project(drawnPos(s, t, false), CAM0, v.R, v.cx, v.cy)
    const home = project(s.home, CAM0, v.R, v.cx, v.cy)
    const gap = Math.abs(drawn.X - home.X)
    expect(gap).toBeGreaterThan(8) // ずれは隣の点との間隔に匹敵する大きさ
    expect(pickAt([s], CAM0, v, t, false, drawn.X, drawn.Y, 6)?.claimId).toBe('wob')
    expect(pickAt([s], CAM0, v, t, false, home.X, home.Y, 6)).toBeNull()
  })

  it('動きを減らす設定では、描く位置は定位置のまま動かない', () => {
    const s = sp('fade', [1, 0, 0], { kind: 'kept', remaining: 0.05 })
    expect(drawnPos(s, 0, true)).toEqual([1, 0, 0])
    expect(drawnPos(s, 12.5, true)).toEqual([1, 0, 0])
  })

  it('viewport は山が出ているあいだ球を上へ寄せる', () => {
    expect(viewport(800, 600, CAM0, 0)).toEqual({ R: 600 * 0.34, cx: 400, cy: 286 })
    expect(viewport(800, 600, CAM0, 2).cy).toBe(240)
    expect(viewport(800, 600, { rotY: 0, rotX: 0, zoom: 2 }, 0).R).toBe(600 * 0.34 * 2)
  })

  it('hereMark は寄ったときだけ、画面中央に最も近い手前のページ目印を返す', () => {
    const marks = [
      { text: '手前', v: [0, 0, -1] as [number, number, number], level: 'page' as const, n: 3 },
      { text: '奥', v: [0, 0, 1] as [number, number, number], level: 'page' as const, n: 3 },
    ]
    const v = viewport(800, 800, { rotY: 0, rotX: 0, zoom: 2 }, 0)
    expect(hereMark(marks, { rotY: 0, rotX: 0, zoom: 2 }, v)?.text).toBe('手前')
    expect(hereMark(marks, CAM0, viewport(800, 800, CAM0, 0))).toBeNull() // 引きの位置では出さない
  })
})

describe('drawFrame', () => {
  // I1: 動きを減らす設定でも、薄れかけの主張だけは明滅し続けていた。
  it('動きを減らす設定なら、薄れかけの主張も時刻によらず同じ位置に描かれる', () => {
    const s = sp('fade', [1, 0.3, -0.4], { kind: 'kept', remaining: 0.05 }, 1.7)
    const a = recorder(), b = recorder()
    drawFrame(a.ctx, frame({ sprites: [s], reduced: true, t: 0 }))
    drawFrame(b.ctx, frame({ sprites: [s], reduced: true, t: 41.3 }))
    expect(a.draws.length).toBe(1)
    expect(b.draws).toEqual(a.draws)
  })

  it('動きを減らさなければ、薄れかけの主張は時刻で位置が変わる', () => {
    const s = sp('fade', [1, 0.3, -0.4], { kind: 'kept', remaining: 0.05 }, 1.7)
    const a = recorder(), b = recorder()
    drawFrame(a.ctx, frame({ sprites: [s], reduced: false, t: 0 }))
    drawFrame(b.ctx, frame({ sprites: [s], reduced: false, t: 41.3 }))
    expect(b.draws).not.toEqual(a.draws)
  })

  // I4: 寄って手前を見ているときに、記憶の残りの差が消えていた（上限に張り付いていた）。
  it('寄った手前の主張でも、記憶の残り 0 と 1 で見え方が変わる', () => {
    const cam = { rotY: 0, rotX: 0, zoom: 1.5 } // 1.4 超え＝減衰の指数 3.2
    const empty = recorder(), full = recorder()
    drawFrame(empty.ctx, frame({ cam, reduced: true, sprites: [sp('a', [0, 0, -1], { kind: 'kept', remaining: 0 })] }))
    drawFrame(full.ctx, frame({ cam, reduced: true, sprites: [sp('a', [0, 0, -1], { kind: 'kept', remaining: 1 })] }))
    expect(empty.draws[0].alpha).toBeLessThan(full.draws[0].alpha * 0.7)
    expect(empty.draws[0].w).toBeLessThan(full.draws[0].w)
  })

  it('引きの位置でも、記憶の残り 0 と 1 で明るさが変わる', () => {
    const empty = recorder(), full = recorder()
    drawFrame(empty.ctx, frame({ reduced: true, sprites: [sp('a', [0, 0, -1], { kind: 'kept', remaining: 0 })] }))
    drawFrame(full.ctx, frame({ reduced: true, sprites: [sp('a', [0, 0, -1], { kind: 'kept', remaining: 1 })] }))
    expect(empty.draws[0].alpha).toBeLessThan(full.draws[0].alpha * 0.7)
  })

  it('不透明度は 1 を超えない', () => {
    const r = recorder()
    drawFrame(r.ctx, frame({
      cam: { rotY: 0, rotX: 0, zoom: 2 }, reduced: true,
      sprites: [sp('a', [0, 0, -1], { kind: 'settled', remaining: 1 }), sp('b', [0, 0, -1], { kind: 'touched', remaining: 0 })],
    }))
    for (const d of r.draws) expect(d.alpha).toBeLessThanOrEqual(1)
  })
})
