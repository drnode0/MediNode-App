// 標本帳（図鑑）タスク2: 点の見た目とトレイの配置。
// 描画はテストできない（DOM を持たない）ので、判断はすべてここの純関数に出してある。
import { describe, it, expect } from 'vitest'
import { dotLookOf, trayLayout, TRAY_MAX_ROWS } from '@/lib/recall/dex'
import { ESCAPE_THRESHOLD } from '@/lib/recall/srs'

describe('点の見た目 dotLookOf', () => {
  it('5段の不透明度が設計書の表どおり', () => {
    expect(dotLookOf({ kind: 'cold', remaining: 0 })).toEqual({ kind: 'cold', alpha: 0.35 })
    expect(dotLookOf({ kind: 'touched', remaining: 0 })).toEqual({ kind: 'touched', alpha: 0.55 })
    expect(dotLookOf({ kind: 'kept', remaining: 1 })).toEqual({ kind: 'kept', alpha: 0.95 })
    expect(dotLookOf({ kind: 'settled', remaining: 1 })).toEqual({ kind: 'settled', alpha: 1 })
  })

  it('残した＝保持力 1 と 0.3 で、1 の方が濃い（field-layout の lookOf と同じ向き）', () => {
    const full = dotLookOf({ kind: 'kept', remaining: 1 })
    const low = dotLookOf({ kind: 'kept', remaining: 0.3 })
    expect(full.alpha).toBeGreaterThan(low.alpha)
    // 0.5 + 0.45 × remaining
    expect(low.alpha).toBeCloseTo(0.5 + 0.45 * 0.3, 6)
  })

  it('離れかけは kept/settled より優先される（保持力が閾値未満）', () => {
    const escapingKept = dotLookOf({ kind: 'kept', remaining: ESCAPE_THRESHOLD - 0.01 })
    expect(escapingKept.kind).toBe('escaping')
    expect(escapingKept.alpha).toBe(1)

    const escapingSettled = dotLookOf({ kind: 'settled', remaining: ESCAPE_THRESHOLD - 0.01 })
    expect(escapingSettled.kind).toBe('escaping')

    // ちょうど閾値は含めない（isEscaping と同じ境目）
    const atThreshold = dotLookOf({ kind: 'kept', remaining: ESCAPE_THRESHOLD })
    expect(atThreshold.kind).toBe('kept')
  })

  it('読んだ・未着手は保持力を見ない（remaining を渡しても値は動かない）', () => {
    expect(dotLookOf({ kind: 'cold', remaining: 0.9 }).alpha).toBe(0.35)
    expect(dotLookOf({ kind: 'touched', remaining: 0.9 }).alpha).toBe(0.55)
  })
})

describe('トレイの並び trayLayout', () => {
  it('34 件・幅 240px は 6px のまま 2 行に収まる', () => {
    const t = trayLayout(34, 240)
    expect(t.size).toBe(6)
    expect(t.gap).toBe(3)
    expect(t.rows).toBe(2)
    expect(t.shown).toBe(34)
    expect(t.rest).toBe(0)
    expect(t.perRow).toBeGreaterThanOrEqual(1)
  })

  it('178 件・幅 240px は 6px だと 7 行になるので 4px へ落ちて全件入る', () => {
    const six = trayLayout(6, 240) // 6px 側の perRow を別途確認するための対照
    const t = trayLayout(178, 240)
    expect(Math.ceil(178 / six.perRow)).toBeGreaterThan(TRAY_MAX_ROWS) // 6px だと 6 行を超える前提の確認
    expect(t.size).toBe(4)
    expect(t.gap).toBe(2)
    expect(t.rows).toBeLessThanOrEqual(TRAY_MAX_ROWS)
    expect(t.shown).toBe(178)
    expect(t.rest).toBe(0)
  })

  it('300 件・幅 240px は 4px でも 6 行に収まらず「ほか rest」が出る', () => {
    const t = trayLayout(300, 240)
    expect(t.size).toBe(4)
    expect(t.gap).toBe(2)
    expect(t.rows).toBe(TRAY_MAX_ROWS)
    expect(t.rest).toBeGreaterThan(0)
    expect(t.shown + t.rest).toBe(300)
    expect(t.shown).toBe(t.perRow * TRAY_MAX_ROWS)
  })

  it('幅 0 でも perRow は 1 以上（0 除算・0 個表示にしない）', () => {
    const t = trayLayout(10, 0)
    expect(t.perRow).toBeGreaterThanOrEqual(1)
  })

  it('0 件は 0 行・0 個', () => {
    const t = trayLayout(0, 240)
    expect(t.rows).toBe(0)
    expect(t.shown).toBe(0)
    expect(t.rest).toBe(0)
  })
})
