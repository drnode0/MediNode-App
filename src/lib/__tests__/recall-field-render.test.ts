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
  const texts: string[] = []
  const state = { gradients: 0, strokes: 0 }
  const ctx = {
    globalAlpha: 1, fillStyle: '' as unknown, strokeStyle: '' as unknown,
    lineWidth: 1, lineCap: '', font: '', textAlign: '', textBaseline: '',
    letterSpacing: '0px',
    clearRect() {}, fillText(t: string) { texts.push(t) }, measureText: () => ({ width: 0 }),
    fillRect() {},
    createRadialGradient() { state.gradients++; return { addColorStop() {} } },
    beginPath() {}, moveTo() {}, lineTo() {}, arc() {},
    fill() { fills.push({ alpha: ctx.globalAlpha }) },
    stroke() { state.strokes++ },
  }
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    fills, texts,
    get gradients() { return state.gradients },
    get strokes() { return state.strokes },
  }
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

// ── 宇宙の描画（再計画 §4.2・§4.3） ────────────
const dot = (claimId: string, kind: 'touched' | 'kept', remaining: number): ClaimDot =>
  ({ claimId, pageId: 'p1', state: { kind, remaining }, angle: 0, jitter: 0, phase: 0 })

describe('描く物の出し分け（再計画 §4.2・§4.3）', () => {
  it('show.planetLabels=false なら惑星名を描かない（既定は描く）', () => {
    const planet = planetWithDots([dot('a', 'kept', 1)])
    const a = frameOf(planet, DARK_PALETTE)
    a.cam = { ...a.cam, zoom: 8 } // 中景（S > LABEL_MIN_R）
    const r1 = recorder(); drawField(r1.ctx, a)
    expect(r1.texts.some((t) => t.includes(planet.seat.label))).toBe(true)
    const r2 = recorder(); drawField(r2.ctx, { ...a, show: { planetLabels: false } })
    expect(r2.texts.some((t) => t.includes(planet.seat.label))).toBe(false)
  })

  it('familyFocus の族の惑星だけ、名前が一時的に出る', () => {
    const planet = planetWithDots([dot('a', 'kept', 1)])
    const a: FieldFrameArgs = {
      ...frameOf(planet, DARK_PALETTE),
      show: { planetLabels: false }, t: 1,
      familyFocus: { kind: planet.seat.kind, until: 3000 },
    }
    const r = recorder(); drawField(r.ctx, a)
    expect(r.texts).toContain(planet.seat.label)
    // 期限切れ
    const r2 = recorder(); drawField(r2.ctx, { ...a, familyFocus: { kind: planet.seat.kind, until: 500 } })
    expect(r2.texts).not.toContain(planet.seat.label)
  })

  it('空の席は show.nebula でガス（放射状グラデーション）、既定は粒（グラデーション無し）', () => {
    const empty: Planet = {
      ...planetWithDots([]),
      summary: { face: 'empty', haze: true, core: false, outline: false, outlineAlpha: 0, halos: 0 },
    }
    const base = frameOf(empty, DARK_PALETTE)
    // 空の席を画面の中央に置く（既定のカメラだと画面の外に出て、何も描かれない）
    const a: FieldFrameArgs = { ...base, cam: { ...base.cam, focus: [...empty.seat.at] } }
    const r1 = recorder(); drawField(r1.ctx, a); expect(r1.gradients).toBe(0)
    const r2 = recorder(); drawField(r2.ctx, { ...a, show: { nebula: true } }); expect(r2.gradients).toBe(2)
  })

  it('族名は familyLabels を渡したときだけ。押した族の sub は familyFocus の間だけ', () => {
    const a: FieldFrameArgs = {
      ...frameOf(planetWithDots([]), DARK_PALETTE), t: 1,
      familyLabels: [{ text: 'Flow', sub: '名詞', kind: 'flow', at: [0, 0.2, 0] }],
    }
    const r1 = recorder(); drawField(r1.ctx, a)
    expect(r1.texts).toContain('FLOW'); expect(r1.texts).not.toContain('名詞')
    const r2 = recorder(); drawField(r2.ctx, { ...a, familyFocus: { kind: 'flow', until: 3000 } })
    expect(r2.texts).toContain('名詞')
  })

  it('fanAlpha=0 なら扇形を描かない', () => {
    const planet: Planet = {
      ...planetWithDots([dot('a', 'kept', 1)]),
      pages: [{ pageId: 'p1', title: '記事', n: 1, a0: 0, a1: 1 }],
    }
    const base: FieldFrameArgs = { ...frameOf(planet, DARK_PALETTE), nearSlot: planet.seat.slot }
    const on = recorder(); drawField(on.ctx, { ...base, show: { fanAlpha: 1 } })
    const off = recorder(); drawField(off.ctx, { ...base, show: { fanAlpha: 0 } })
    expect(off.strokes).toBeLessThan(on.strokes)
  })
})
