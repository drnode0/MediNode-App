// 惑星の色の2組（ダーク／ライト）。描画はテストできないので、色の対応表だけを固定する。
import { describe, it, expect } from 'vitest'
import { DARK_PALETTE, LIGHT_PALETTE, paletteOf, inkOf } from '@/lib/recall/field-palette'
import { INK_WARM, INK_COOL, INK_WHITE, INK_HALO } from '@/lib/recall/core-shapes'
import { INK_TOUCHED, INK_DIM, lookOf } from '@/lib/recall/field-layout'
import { coreLayers } from '@/lib/recall/core-shapes'
import { CORE_SPIN } from '@/lib/recall/cores'
const CORE_KINDS = Object.keys(CORE_SPIN) as Array<keyof typeof CORE_SPIN>

const hex = (s: string) => {
  const m = /^#([0-9a-f]{6})$/i.exec(s)
  if (!m) throw new Error(`hex でない: ${s}`)
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const
}
// 相対輝度（WCAG）。明るさの向きを見るためだけに使う。
const lum = (s: string) => {
  const [r, g, b] = hex(s).map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

const ALL_INKS = [INK_WHITE, INK_COOL, INK_WARM, INK_HALO, INK_TOUCHED, INK_DIM]

describe('惑星の色の2組', () => {
  it('paletteOf は dark で紺の地、light で紙の地', () => {
    expect(paletteOf(true)).toBe(DARK_PALETTE)
    expect(paletteOf(false)).toBe(LIGHT_PALETTE)
    expect(lum(DARK_PALETTE.bg)).toBeLessThan(0.05)
    expect(lum(LIGHT_PALETTE.bg)).toBeGreaterThan(0.85)
  })

  // D6 は 2026-09-05 に取り下げ。ダークの地は他のタブと同じ紺（実画面で緑が浮いたため）。
  it('ダークの地は他のタブと同じ紺', () => {
    expect(DARK_PALETTE.bg).toBe('#0B1524')
  })

  it('alphaGain はダーク 1（素通し）・ライト 1.6（紙で薄く沈む線を底上げ）', () => {
    expect(DARK_PALETTE.alphaGain).toBe(1)
    expect(LIGHT_PALETTE.alphaGain).toBe(1.6)
  })

  it('ダークの線の色は全部、ライトで引き直せる（引き直し漏れがあると紙の上で白い線になる）', () => {
    for (const ink of ALL_INKS) {
      expect(LIGHT_PALETTE.inks[ink], `${ink} がライトの対応表に無い`).toBeDefined()
      expect(inkOf(LIGHT_PALETTE, ink)).not.toBe(ink)
      expect(inkOf(DARK_PALETTE, ink)).toBe(ink)
    }
  })

  it('芯の線と主張の点が使う色は、対応表の中に収まっている', () => {
    const used = new Set<string>()
    for (const kind of CORE_KINDS) for (const l of coreLayers(kind, 1.3, { glow: true })) used.add(l.ink)
    for (const kind of ['settled', 'kept', 'touched', 'cold'] as const) used.add(lookOf(kind, 0.5, 0, true).ink)
    used.add(lookOf('kept', 0.05, 0, true).ink) // 離れかけ
    for (const ink of used) expect(LIGHT_PALETTE.inks[ink], `${ink} がライトの対応表に無い`).toBeDefined()
  })

  it('ライトでは線が地より暗く、ダークでは線が地より明るい（同じ世界の裏返し）', () => {
    for (const ink of ALL_INKS) {
      expect(lum(inkOf(LIGHT_PALETTE, ink))).toBeLessThan(lum(LIGHT_PALETTE.bg))
      expect(lum(inkOf(DARK_PALETTE, ink))).toBeGreaterThan(lum(DARK_PALETTE.bg))
    }
    for (const p of [LIGHT_PALETTE, DARK_PALETTE]) {
      expect(contrast(p.label, p.bg)).toBeGreaterThan(4)
      expect(contrast(p.outline, p.bg)).toBeGreaterThan(7)
      // 離れかけの色は 10px の文字にも使う（惑星の名前の下の「離れかけ n」）
      expect(contrast(inkOf(p, INK_HALO), p.bg)).toBeGreaterThan(4)
      expect(p.glow).toBeGreaterThan(0)
      expect(p.glow).toBeLessThan(1)
    }
    // 紙では後光を薄くする（濃いと滲みに見える。2026-09-04 に実画面で確認）
    expect(LIGHT_PALETTE.glow).toBeLessThan(DARK_PALETTE.glow)
  })

  it('深く残したが最も濃く、離れかけだけが暖色（どちらの組でも）', () => {
    for (const p of [LIGHT_PALETTE, DARK_PALETTE]) {
      const strength = (ink: string) => Math.abs(lum(inkOf(p, ink)) - lum(p.bg))
      expect(strength(INK_WHITE)).toBeGreaterThanOrEqual(strength(INK_COOL))
      expect(strength(INK_COOL)).toBeGreaterThan(strength(INK_TOUCHED))
      const [r, , b] = hex(inkOf(p, INK_HALO))
      expect(r - b).toBeGreaterThan(60)
      for (const ink of [INK_WHITE, INK_COOL, INK_TOUCHED, INK_DIM]) {
        const [cr, , cb] = hex(inkOf(p, ink))
        expect(cr - cb, `${ink} が暖色に寄っている`).toBeLessThan(0)
      }
    }
  })
})
