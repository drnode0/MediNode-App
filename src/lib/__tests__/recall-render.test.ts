import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { project, pickAt, drawnPos, drawFrame, viewport, hereMark, type Sprite, type Camera, type FrameArgs } from '@/lib/recall/render'
import type { RecallState } from '@/lib/recall/types'
import type { Vec3 } from '@/lib/recall/layout'

const sp = (id: string, home: Vec3, state: RecallState = { kind: 'kept', remaining: 1 }, phase = 0, dir: Vec3 = [1, 0, 0]): Sprite =>
  ({ claimId: id, home, state, phase, dir, scale: 1, variant: 0 })
const view = (R: number, cx: number, cy: number) => ({ R, cx, cy })
const CAM0: Camera = { rotY: 0, rotX: 0, zoom: 1 }

// ---- Canvas の代わり（このファイル内だけの記録用の偽物） ----
// かけらは translate → rotate → drawImage で描くので、変換の積み重ねも持つ。
// 記録する x, y は「変換を掛けたあとの画面上の位置」にして、投影のテストと突き合わせられるようにする。
type Draw = { alpha: number; x: number; y: number; w: number; h: number; rot: number }
type Fill = { x: number; y: number; w: number; h: number }
function recorder() {
  const draws: Draw[] = []
  const fills: Fill[] = []
  const ops: string[] = []
  let tf = { tx: 0, ty: 0, rot: 0 }
  const stack: typeof tf[] = []
  const ctx = {
    globalAlpha: 1, fillStyle: '' as unknown, font: '', textAlign: '',
    clearRect() {}, fillText() {},
    fillRect(x: number, y: number, w: number, h: number) { fills.push({ x, y, w, h }); ops.push('fill') },
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    save() { stack.push({ ...tf }) },
    restore() { tf = stack.pop() ?? { tx: 0, ty: 0, rot: 0 } },
    translate(x: number, y: number) { tf.tx += x; tf.ty += y },
    rotate(a: number) { tf.rot += a },
    drawImage(_img: unknown, x: number, y: number, w: number, h: number) {
      // 描画の中心（局所座標の x+w/2, y+h/2）を回して足す
      const lx = x + w / 2, ly = y + h / 2
      const c = Math.cos(tf.rot), s = Math.sin(tf.rot)
      draws.push({ alpha: ctx.globalAlpha, x: tf.tx + lx * c - ly * s, y: tf.ty + lx * s + ly * c, w, h, rot: tf.rot })
      ops.push('draw')
    },
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, draws, fills, ops }
}
// かけらの下絵を焼くための偽キャンバス（経路の命令はすべて受け流す）
const offscreen = () => ({
  width: 0, height: 0,
  getContext: () => ({
    fillStyle: '' as unknown, globalAlpha: 1,
    createRadialGradient: () => ({ addColorStop() {} }),
    createLinearGradient: () => ({ addColorStop() {} }),
    fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, quadraticCurveTo() {}, closePath() {}, fill() {},
  }),
})
const hadDocument = 'document' in globalThis
beforeAll(() => { (globalThis as { document?: unknown }).document = { createElement: () => offscreen() } })
afterAll(() => { if (!hadDocument) delete (globalThis as { document?: unknown }).document })

const frame = (over: Partial<FrameArgs>): FrameArgs => ({
  W: 800, H: 800, cam: CAM0, sprites: [], flying: new Map(), marks: [],
  t: 0, reduced: false, dimmed: false, lens: 'all', ...over,
})
// かけら本体だけ（芯の重ね描きを除く）。芯は本体の直後に同じ大きさで描かれる。
const shards = (draws: Draw[]) => draws.filter((_, i) => i === 0 || draws[i - 1].w !== draws[i].w || draws[i - 1].x !== draws[i].x)

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

  it('project は回転後の単位ベクトル（面の向き）も返す', () => {
    const p = project([0, 0, -1], CAM0, 100, 200, 300)
    expect(p.n).toEqual([0, 0, -1])
    const yaw = project([1, 0, 0], { rotY: Math.PI / 2, rotX: 0, zoom: 1 }, 100, 200, 300)
    expect(Math.hypot(...yaw.n)).toBeCloseTo(1, 6)
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
      { text: '手前', v: [0, 0, -1] as Vec3, level: 'page' as const, n: 3 },
      { text: '奥', v: [0, 0, 1] as Vec3, level: 'page' as const, n: 3 },
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
    expect(shards(a.draws).length).toBe(1)
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
  it('寄った手前の主張でも、記憶の残り 0 と 1 で明るさが変わる', () => {
    const cam = { rotY: 0, rotX: 0, zoom: 1.5 } // 1.4 超え＝減衰の指数 2.2
    const empty = recorder(), full = recorder()
    drawFrame(empty.ctx, frame({ cam, reduced: true, sprites: [sp('a', [0, 0, -1], { kind: 'kept', remaining: 0 })] }))
    drawFrame(full.ctx, frame({ cam, reduced: true, sprites: [sp('a', [0, 0, -1], { kind: 'kept', remaining: 1 })] }))
    expect(empty.draws[0].alpha).toBeLessThan(full.draws[0].alpha * 0.7)
  })

  it('引きの位置でも、記憶の残り 0 と 1 で明るさが変わる', () => {
    const empty = recorder(), full = recorder()
    drawFrame(empty.ctx, frame({ reduced: true, sprites: [sp('a', [0, 0, -1], { kind: 'kept', remaining: 0 })] }))
    drawFrame(full.ctx, frame({ reduced: true, sprites: [sp('a', [0, 0, -1], { kind: 'kept', remaining: 1 })] }))
    expect(empty.draws[0].alpha).toBeLessThan(full.draws[0].alpha * 0.7)
  })

  // 記憶の残りを大きさに掛けると、シルエットが時間で痩せて「覚えているものほど大きい」と読める。
  // 大きさは主張ごとに固定し、残りは明るさと芯の濃さで見せる。
  it('記憶の残りは大きさを変えず、芯の濃さを変える', () => {
    const empty = recorder(), full = recorder()
    drawFrame(empty.ctx, frame({ reduced: true, sprites: [sp('a', [0, 0, -1], { kind: 'kept', remaining: 0 })] }))
    drawFrame(full.ctx, frame({ reduced: true, sprites: [sp('a', [0, 0, -1], { kind: 'kept', remaining: 1 })] }))
    expect(empty.draws[0].w).toBeCloseTo(full.draws[0].w, 6)   // かけらの大きさは同じ
    expect(empty.draws.length).toBe(2)                          // かけら＋芯
    // 芯（2枚目）は、残りが 0 のときほとんど出ない
    expect(empty.draws[1].alpha / empty.draws[0].alpha).toBeLessThan(0.2)
    expect(full.draws[1].alpha / full.draws[0].alpha).toBeCloseTo(1, 2)
  })

  // 未着手（発光しない状態）でも陰影が付くこと。これが無いと、全件未着手のときに
  // 一様な粒の霧になる。
  it('同じ状態でも、光の当たる側（左上）の方が反対側より明るい', () => {
    const cold: RecallState = { kind: 'cold', remaining: 0 }
    const litSide = recorder(), darkSide = recorder()
    drawFrame(litSide.ctx, frame({ reduced: true, sprites: [sp('a', [-0.55, -0.55, -0.63], cold)] }))
    drawFrame(darkSide.ctx, frame({ reduced: true, sprites: [sp('a', [0.55, 0.55, -0.63], cold)] }))
    expect(litSide.draws[0].alpha).toBeGreaterThan(darkSide.draws[0].alpha * 1.8)
  })

  it('かけらは流れの向きに寝る（向きが違えば傾きが違う）', () => {
    const a = recorder(), b = recorder()
    drawFrame(a.ctx, frame({ reduced: true, sprites: [sp('a', [0, 0, -1], { kind: 'cold', remaining: 0 }, 0, [1, 0, 0])] }))
    drawFrame(b.ctx, frame({ reduced: true, sprites: [sp('a', [0, 0, -1], { kind: 'cold', remaining: 0 }, 0, [0, 1, 0])] }))
    expect(a.draws[0].rot).toBeCloseTo(0, 6)
    expect(b.draws[0].rot).toBeCloseTo(Math.PI / 2, 6)
  })

  // 球の実体は、裏側の主張のあと・手前の主張の前に描く（裏側が透けて、手前は上に乗る）。
  it('球の実体は裏側の主張と手前の主張のあいだに描かれる', () => {
    const r = recorder()
    drawFrame(r.ctx, frame({ reduced: true, sprites: [sp('back', [0, 0, 1]), sp('front', [0, 0, -1])] }))
    const first = r.ops.indexOf('draw')
    const last = r.ops.lastIndexOf('draw')
    const globeFill = r.ops.findIndex((o, i) => o === 'fill' && i > first)
    expect(first).toBeGreaterThanOrEqual(0)
    expect(globeFill).toBeGreaterThan(first)
    expect(globeFill).toBeLessThan(last)
    // 球の実体は半径 R の広さで塗る（背景の全面塗りとは別）
    const R = viewport(800, 800, CAM0, 0).R
    expect(r.fills.some((f) => Math.abs(f.w - R * 2.4) < 1)).toBe(true)
  })

  it('主張が1つも無くても球は描かれる', () => {
    const r = recorder()
    drawFrame(r.ctx, frame({ sprites: [] }))
    const R = viewport(800, 800, CAM0, 0).R
    expect(r.fills.some((f) => Math.abs(f.w - R * 2.4) < 1)).toBe(true)
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
