// drawField の alphaGain（D6）。描画はテストできない（DOM を持たない）ので、
// Canvas の代わりに「偽 ctx」を渡し、globalAlpha に何が入ったかだけを記録する
// （recall-render.test.ts の recorder と同じ作法。field-render は save/restore/translate を
//  使わないぶん、変換の積み重ねは持たない）。
import { describe, it, expect } from 'vitest'
import { drawField, type Planet, type ClaimDot, type FieldFrameArgs } from '@/lib/recall/field-render'
import { fieldLayout, initialCamera } from '@/lib/recall/field'
import { DARK_PALETTE, LIGHT_PALETTE, type FieldPalette } from '@/lib/recall/field-palette'
import { GENRE_SEATS } from '@/lib/recall/genres'

// ---- Canvas の代わり（このファイル内だけの記録用の偽物） ----
function recorder() {
  const fills: Array<{ alpha: number }> = []
  const ctx = {
    globalAlpha: 1, fillStyle: '' as unknown, strokeStyle: '' as unknown,
    lineWidth: 1, lineCap: '', font: '', textAlign: '', textBaseline: '',
    clearRect() {}, fillText() {}, measureText: () => ({ width: 0 }),
    fillRect() {},
    beginPath() {}, moveTo() {}, lineTo() {}, arc() {},
    fill() { fills.push({ alpha: ctx.globalAlpha }) },
    stroke() {},
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, fills }
}

// 1枠だけ主張が2つ乗った惑星。輪郭・芯・モヤは summary で明示的に切って、
// dot の fill 呼び出しだけを拾えるようにする。
function planetWithDots(dots: ClaimDot[]): Planet {
  const counts = new Array(GENRE_SEATS.length).fill(0)
  counts[2] = dots.length
  const seats = fieldLayout(counts)
  const seat = seats.find((s) => s.slot === 2)!
  return {
    seat,
    summary: { face: 'active', haze: false, core: false, outline: false, outlineAlpha: 0, halos: 0 },
    dots,
  }
}

function frameOf(planet: Planet, palette: FieldPalette): FieldFrameArgs {
  const counts = new Array(GENRE_SEATS.length).fill(0)
  counts[2] = planet.dots.length
  const seats = fieldLayout(counts)
  return {
    W: 800, H: 800, cam: initialCamera(seats), center: 'outside',
    planets: [planet], nearSlot: null, handYaw: 0, lensPageId: null,
    flying: [], t: 0, reduced: true, edgeAlpha: 0, palette,
  }
}

describe('drawField の alphaGain（D6）', () => {
  it('ライトの palette を渡すと点の alpha が 1.6 倍になり、1 で頭打ちになる', () => {
    // touched: alpha 0.4 固定・glow 無し → 1.6倍しても 1 を割らない
    // kept remaining=1: alpha 0.95・glow 無し → 1.6倍すると 1.52 になり、頭打ちに掛かる
    const dots: ClaimDot[] = [
      { claimId: 'touched', pageId: 'p', state: { kind: 'touched', remaining: 0 }, angle: 0, jitter: 0, phase: 0 },
      { claimId: 'kept', pageId: 'p', state: { kind: 'kept', remaining: 1 }, angle: Math.PI, jitter: 0, phase: 0 },
    ]

    const dark = recorder()
    drawField(dark.ctx, frameOf(planetWithDots(dots), DARK_PALETTE))
    const light = recorder()
    drawField(light.ctx, frameOf(planetWithDots(dots), LIGHT_PALETTE))

    expect(dark.fills.length).toBe(2)
    expect(light.fills.length).toBe(2)

    // 頭打ちに掛からない方（touched）は、ちょうど 1.6 倍（深度の掛け算は両方に同じく掛かるので比だけ見る）
    expect(light.fills[0].alpha).toBeCloseTo(dark.fills[0].alpha * 1.6, 6)

    // 頭打ちに掛かる方（kept remaining=1）は、1.6 倍ぶんには届かず、
    // 「gainAlpha が 1 で丸めたあとに depth を掛けた値」= dark の alpha ÷ 0.95 に一致する
    expect(light.fills[1].alpha).toBeCloseTo(dark.fills[1].alpha / 0.95, 6)
    expect(light.fills[1].alpha).toBeLessThan(dark.fills[1].alpha * 1.6)
  })
})
