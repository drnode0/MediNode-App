// 居場所5段（決定1）と、惑星の要約・空の惑星のモヤ（決定10・11）。
// 描画はテストできない（DOM を持たない）ので、判断はすべてここの純関数に出してある。
import { describe, it, expect } from 'vitest'
import {
  ringRadius, placeOf, lookOf, isEscaping, planetRadius, planetSummary,
  R_SETTLED, R_RING_INNER, R_RING_OUTER, R_ESCAPE_MAX, R_TOUCHED, R_COLD,
  EDGE_LABELS, edgeLabelsVisible, EDGE_LABEL_MS, HALO_MAX,
  INK_HALO, INK_COOL, INK_WHITE,
} from '@/lib/recall/field-layout'
import { ESCAPE_THRESHOLD } from '@/lib/recall/srs'

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6)

describe('居場所5段', () => {
  it('5つの状態が設計書の表どおりの高度に来る', () => {
    near(placeOf('settled', 1).r, R_SETTLED)          // 1.16
    near(placeOf('kept', 1).r, R_RING_INNER)          // 1.3
    near(placeOf('touched', 0).r, R_TOUCHED)          // 3.05
    near(placeOf('cold', 0).r, R_COLD)                // 3.38
    // 離れかけは輪の外縁を割って、上限 2.85 まで
    near(placeOf('kept', 0).r, R_ESCAPE_MAX)
  })

  it('保持力 0.28 ちょうどが輪の外縁。境目で高度が飛ばない', () => {
    near(ringRadius(ESCAPE_THRESHOLD), R_RING_OUTER)
    const justInside = placeOf('kept', ESCAPE_THRESHOLD + 1e-9).r
    const justOutside = placeOf('kept', ESCAPE_THRESHOLD - 1e-9).r
    expect(Math.abs(justInside - justOutside)).toBeLessThan(1e-6)
  })

  it('保持力が高いほど内側にいる（単調）', () => {
    const rs = [1, 0.8, 0.6, 0.4, 0.28, 0.15, 0].map((r) => placeOf('kept', r).r)
    for (let i = 1; i < rs.length; i++) expect(rs[i]).toBeGreaterThanOrEqual(rs[i - 1])
  })

  it('離れかけの高度は 2.85 を超えない（読んだの帯 3.05 と当たらない）', () => {
    for (const rem of [0.27, 0.2, 0.1, 0.01, 0, -1]) {
      expect(placeOf('kept', rem).r).toBeLessThanOrEqual(R_ESCAPE_MAX)
      expect(placeOf('kept', rem).r).toBeLessThan(R_TOUCHED)
    }
  })

  it('未着手だけ、いちばん外でゆらぐ', () => {
    expect(placeOf('cold', 0, 0.07).y).toBe(0.07)
    expect(placeOf('kept', 1, 0.07).y).toBe(0)
    expect(placeOf('touched', 0, 0.07).y).toBe(0)
  })

  it('離れかけの判定は「残した」系だけ。読んだ・未着手は含まない', () => {
    expect(isEscaping('kept', 0.27)).toBe(true)
    expect(isEscaping('settled', 0.27)).toBe(true)
    expect(isEscaping('kept', ESCAPE_THRESHOLD)).toBe(false) // ちょうどは含めない
    expect(isEscaping('touched', 0)).toBe(false)
    expect(isEscaping('cold', 0)).toBe(false)
  })
})

describe('見え方', () => {
  it('明るさは保持力に比例する（忘れるほど明るい旧式に戻さない）', () => {
    const full = lookOf('kept', 1, 0, true).alpha
    const half = lookOf('kept', 0.5, 0, true).alpha
    const low = lookOf('kept', 0.3, 0, true).alpha
    expect(full).toBeGreaterThan(half)
    expect(half).toBeGreaterThan(low)
    near(full, 0.95)
    near(low, 0.5 + 0.45 * 0.3)
  })

  it('離れかけは光の色で、動きを減らす設定では明滅しない', () => {
    const a = lookOf('kept', 0.1, 0, true)
    const b = lookOf('kept', 0.1, 1.7, true)
    expect(a.ink).toBe(INK_HALO)
    expect(a.glow).toBe(true)
    expect(a.alpha).toBe(b.alpha) // 時刻が変わっても同じ
  })

  it('動きを減らさなければ、離れかけは時刻で明滅する', () => {
    const a = lookOf('kept', 0.1, 0, false).alpha
    const b = lookOf('kept', 0.1, 0.5, false).alpha
    expect(a).not.toBe(b)
  })

  // 深く残したと、保持力が満タンの残したは、**明るさでは分かれない**（どちらも 0.95）。
  // 分かれるのは色・大きさ・後光と、なにより居場所（1.16 と 1.3）。
  // 明るさだけで見分けようとしないよう、この事実をテストで固定しておく。
  it('深く残したは、明るさではなく色・大きさ・後光・居場所で分かれる', () => {
    const deep = lookOf('settled', 1, 0, false)
    const full = lookOf('kept', 1, 0, false)
    expect(deep.alpha).toBe(full.alpha)          // 明るさは同じ
    expect(deep.ink).toBe(INK_WHITE)
    expect(full.ink).toBe(INK_COOL)              // 色が違う
    expect(deep.size).toBeGreaterThan(full.size) // 大きさが違う
    expect(deep.glow).toBe(true)
    expect(full.glow).toBe(false)                // 後光の有無が違う
    expect(placeOf('settled', 1).r).toBeLessThan(placeOf('kept', 1).r) // 居場所が違う
  })

  it('残したは冷たい白、読んだと未着手はそれより暗い', () => {
    expect(lookOf('kept', 1, 0, true).ink).toBe(INK_COOL)
    expect(lookOf('touched', 0, 0, true).alpha).toBeLessThan(lookOf('kept', 0.3, 0, true).alpha)
    expect(lookOf('cold', 0, 0, true).alpha).toBeLessThan(lookOf('touched', 0, 0, true).alpha)
  })
})

describe('惑星の要約', () => {
  it('主張が1件も無い席はモヤ。輪郭も芯も描かない', () => {
    const s = planetSummary({ total: 0, keptRemainings: [], escaping: 0 })
    expect(s.face).toBe('empty')
    expect(s.haze).toBe(true)
    expect(s.core).toBe(false)
    expect(s.outline).toBe(false)
  })

  it('主張はあるが1つも触れていない席はモヤにしない。芯は出し、輪郭は最も薄い', () => {
    const s = planetSummary({ total: 40, keptRemainings: [], escaping: 0 })
    expect(s.face).toBe('untouched')
    expect(s.haze).toBe(false)   // 空の惑星と取り違えない
    expect(s.core).toBe(true)
    expect(s.outline).toBe(true)
    near(s.outlineAlpha, 0.16)
  })

  it('輪郭の明るさは残した主張の平均保持力で上がる', () => {
    const low = planetSummary({ total: 10, keptRemainings: [0.1, 0.1], escaping: 2 })
    const high = planetSummary({ total: 10, keptRemainings: [1, 1], escaping: 0 })
    expect(high.outlineAlpha).toBeGreaterThan(low.outlineAlpha)
    near(high.outlineAlpha, 0.16 + 0.42)
  })

  it('離れかけの光の点は上限5', () => {
    expect(planetSummary({ total: 30, keptRemainings: [0.1], escaping: 3 }).halos).toBe(3)
    expect(planetSummary({ total: 30, keptRemainings: [0.1], escaping: 9 }).halos).toBe(HALO_MAX)
    // 空の惑星には出さない
    expect(planetSummary({ total: 0, keptRemainings: [], escaping: 4 }).halos).toBe(0)
  })

  it('惑星の大きさは件数で増えるが、平方根で頭を押さえる', () => {
    const small = planetRadius(1, 178)
    const big = planetRadius(178, 178)
    expect(big).toBeGreaterThan(small)
    expect(big / small).toBeLessThan(4)  // 178倍にはしない
    expect(planetRadius(0, 178)).toBe(small > 0 ? planetRadius(0, 178) : 0)
    expect(planetRadius(0, 178)).toBeLessThanOrEqual(small)
  })
})

describe('境目の名前', () => {
  it('画面に出るのは5語。「定着」は出さない', () => {
    expect(EDGE_LABELS.map(([, name]) => name)).toEqual(['深く残した', '残した', '離れかけ', '読んだ', '未着手'])
    for (const [, name] of EDGE_LABELS) expect(name).not.toBe('定着')
  })

  it('入って一定時間だけ出て、最初のドラッグで消える', () => {
    const t0 = 1000
    expect(edgeLabelsVisible(t0, t0 + 100, false)).toBe(true)
    expect(edgeLabelsVisible(t0, t0 + EDGE_LABEL_MS + 1, false)).toBe(false)
    // 時間内でもドラッグしたら消える
    expect(edgeLabelsVisible(t0, t0 + 100, true)).toBe(false)
  })
})
