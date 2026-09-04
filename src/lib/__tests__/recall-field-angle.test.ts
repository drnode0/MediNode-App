// 記事の扇形（決定4）。近景で輪を記事ごとに分け、主張を節の順に並べる。
// 描画はテストできない（DOM を持たない）ので、角度の決め方はすべて純関数に出してある。
import { describe, it, expect } from 'vitest'
import { fanOf, FAN_GAP, FAN_START, type FanClaim } from '@/lib/recall/field-angle'

const TAU = Math.PI * 2
const near = (a: number, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits)

// 席1つぶんの主張。sec の数字が節の順（番号付きH2 から来る）。
const claim = (id: string, page: string, sec: number, createdAt: string): FanClaim => ({
  claimId: id, pageId: page, pageTitle: `記事 ${page}`, sectionKey: `sec${sec}`, createdAt,
})

// 記事A（4件・節0→2）と記事B（2件・節1）。A の方が先にできている。
const base = (): FanClaim[] => [
  claim('a3', 'A', 2, '2026-08-01T00:00:03Z'),
  claim('a1', 'A', 0, '2026-08-01T00:00:01Z'),
  claim('b2', 'B', 1, '2026-08-02T00:00:02Z'),
  claim('a2', 'A', 1, '2026-08-01T00:00:02Z'),
  claim('b1', 'B', 1, '2026-08-02T00:00:01Z'),
  claim('a4', 'A', 2, '2026-08-01T00:00:04Z'),
]

const widthOf = (p: { a0: number; a1: number }) => p.a1 - p.a0

describe('扇形の幅', () => {
  it('その記事の主張数の比になる', () => {
    const { pages } = fanOf(base())
    const A = pages.find((p) => p.pageId === 'A')!
    const B = pages.find((p) => p.pageId === 'B')!
    expect(A.n).toBe(4)
    expect(B.n).toBe(2)
    near(widthOf(A) / widthOf(B), 2)
  })

  it('扇形の幅と隙間を全部足すと一周になる', () => {
    const { pages } = fanOf(base())
    const total = pages.reduce((s, p) => s + widthOf(p), 0) + FAN_GAP * pages.length
    near(total, TAU)
  })

  it('扇形どうしは重ならず、間に隙間がある', () => {
    const { pages } = fanOf(base())
    for (let i = 1; i < pages.length; i++) {
      near(pages[i].a0 - pages[i - 1].a1, FAN_GAP)
    }
    near(pages[0].a0, FAN_START)
  })

  it('主張が1件も無ければ扇形を作らない', () => {
    const { pages, angles } = fanOf([])
    expect(pages).toEqual([])
    expect(angles.size).toBe(0)
  })

  it('記事が多すぎても幅が負にならない', () => {
    const many: FanClaim[] = []
    for (let i = 0; i < 120; i++) many.push(claim(`c${i}`, `P${i}`, 0, `2026-08-01T00:00:${String(i).padStart(2, '0')}Z`))
    const { pages } = fanOf(many)
    expect(pages).toHaveLength(120)
    for (const p of pages) expect(widthOf(p)).toBeGreaterThan(0)
    const total = pages.reduce((s, p) => s + widthOf(p), 0)
    expect(total).toBeLessThanOrEqual(TAU + 1e-9)
  })
})

describe('主張の並び', () => {
  it('記事の中で節の順に並ぶ（乱数ではない）', () => {
    const { angles } = fanOf(base())
    const inA = ['a1', 'a2', 'a3', 'a4'].map((id) => angles.get(id)!)
    for (let i = 1; i < inA.length; i++) expect(inA[i]).toBeGreaterThan(inA[i - 1])
  })

  it('同じ節の中では作られた順に並ぶ', () => {
    const { angles } = fanOf(base())
    expect(angles.get('a4')!).toBeGreaterThan(angles.get('a3')!)
    expect(angles.get('b2')!).toBeGreaterThan(angles.get('b1')!)
  })

  it('主張はすべて自分の記事の扇形の中にいる', () => {
    const { pages, angles } = fanOf(base())
    for (const p of pages) {
      for (const [id, a] of angles) {
        const owner = base().find((c) => c.claimId === id)!
        if (owner.pageId !== p.pageId) continue
        expect(a).toBeGreaterThan(p.a0)
        expect(a).toBeLessThan(p.a1)
      }
    }
  })

  it('節キーが読めない主張も落とさず、その記事の末尾に置く', () => {
    const items = [...base(), { claimId: 'x1', pageId: 'A', pageTitle: '記事 A', sectionKey: '', createdAt: '2026-08-01T00:00:00Z' }]
    const { angles } = fanOf(items)
    expect(angles.has('x1')).toBe(true)
    expect(angles.get('x1')!).toBeGreaterThan(angles.get('a4')!)
  })
})

describe('足しても動かないもの', () => {
  it('主張を足しても、既存の記事の中の相対順が変わらない', () => {
    const before = fanOf(base()).angles
    const after = fanOf([...base(), claim('a5', 'A', 1, '2026-08-03T00:00:01Z')]).angles
    const ids = ['a1', 'a2', 'a3', 'a4']
    for (let i = 1; i < ids.length; i++) {
      const wasBefore = before.get(ids[i])! > before.get(ids[i - 1])!
      const isBefore = after.get(ids[i])! > after.get(ids[i - 1])!
      expect(isBefore).toBe(wasBefore)
    }
    // 足した主張は節1なので、a2 と a3 のあいだに入る（既存を追い越さない）。
    expect(after.get('a5')!).toBeGreaterThan(after.get('a2')!)
    expect(after.get('a5')!).toBeLessThan(after.get('a3')!)
  })

  it('記事が増えても、既存の記事の扇形の順序が変わらない', () => {
    const before = fanOf(base()).pages.map((p) => p.pageId)
    const withNew = fanOf([...base(), claim('c1', 'C', 0, '2026-09-01T00:00:01Z')]).pages.map((p) => p.pageId)
    expect(withNew.slice(0, before.length)).toEqual(before)
    expect(withNew[withNew.length - 1]).toBe('C')
  })

  it('渡す順を入れ替えても同じ結果になる', () => {
    const a = fanOf(base())
    const b = fanOf([...base()].reverse())
    expect(b.pages).toEqual(a.pages)
    expect([...b.angles.entries()].sort()).toEqual([...a.angles.entries()].sort())
  })
})
