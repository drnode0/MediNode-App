import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { fibPt, seatCenter, seatPlacement, layoutClaims, strandsOf, centroid, SPACING, PAGE_BLOCK, type Placement, type Vec3 } from '@/lib/recall/layout'
import { GENRE_CAPACITY } from '@/lib/recall/genres'

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (v: number[]) => Math.hypot(v[0], v[1], v[2])
const angleDeg = (a: number[], b: number[]) => (Math.acos(Math.min(1, Math.max(-1, dot(a, b)))) * 180) / Math.PI
const same = (a: Placement, b: Placement) => a.v[0] === b.v[0] && a.v[1] === b.v[1] && a.v[2] === b.v[2]
const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length

describe('layout', () => {
  it('fibPt は単位ベクトル。席の中心は収容数64で決まり、席の数に依存しない', () => {
    expect(norm(fibPt(5, 700))).toBeCloseTo(1, 6)
    const centers = Array.from({ length: GENRE_CAPACITY }, (_, i) => seatCenter(i))
    for (const c of centers) expect(norm(c)).toBeCloseTo(1, 6)
    // 64席ぶんの中心はすべて格子の点のどれかで、重複しない（席番号→格子の一対一写像）
    const lattice = Array.from({ length: GENRE_CAPACITY }, (_, i) => fibPt(i, GENRE_CAPACITY).join(','))
    expect(new Set(centers.map((c) => c.join(','))).size).toBe(GENRE_CAPACITY)
    for (const c of centers) expect(lattice).toContain(c.join(','))
  })

  // 席番号をそのまま格子に載せると、使用中の席（01〜15＝0〜14番）が北の冠に固まり、
  // 南半球が丸ごと空になる。ここが崩れると球の半分が無人になるので、席の散り方を固定する。
  it('若い席番号（いま使っている15席）が球の片側に固まらない', () => {
    const ys = Array.from({ length: 15 }, (_, i) => seatCenter(i)[1])
    expect(Math.min(...ys)).toBeLessThan(-0.5)
    expect(Math.max(...ys)).toBeGreaterThan(0.5)
    // 素の並び（ビット反転なし）だと最小の y は 0.53。散らしていることを数値で押さえる
    expect(Math.min(...ys)).toBeLessThan(0.53)
  })

  it('らせんの点は席番号と番号だけで決まる。向きは位置に直交する単位ベクトル', () => {
    for (const [slot, m] of [[3, 0], [3, 41], [12, 7], [63, 200]] as const) {
      const p = seatPlacement(slot, m)
      expect(seatPlacement(slot, m)).toEqual(p)          // 同じ入力なら同じ点
      expect(norm(p.v)).toBeCloseTo(1, 6)
      expect(norm(p.dir)).toBeCloseTo(1, 6)
      expect(dot(p.v, p.dir)).toBeCloseTo(0, 6)          // 接ベクトル
      expect(p.scale).toBeGreaterThan(0.7)
      expect(p.scale).toBeLessThan(1.35)
      expect(p.variant).toBeGreaterThanOrEqual(0)
      expect(p.variant).toBeLessThan(4)
    }
    // 番号が進むほど席の中心から離れる（同じ席の中で外へ向かって埋まる）
    expect(angleDeg(seatPlacement(5, 3).v, seatCenter(5))).toBeLessThan(angleDeg(seatPlacement(5, 120).v, seatCenter(5)))
  })

  it('同じ入力なら同じ出力。全主張が置かれ、単位球面上にある。入力の並び順に依らない', () => {
    const items = Array.from({ length: 120 }, (_, i) => ({ claimId: `c${i}`, genreSlot: i % 5 === 0 ? 3 : 12, pageId: `p${i % 7}` }))
    const a = layoutClaims(items), b = layoutClaims([...items].reverse())
    expect(a.size).toBe(120)
    for (const [id, p] of a) { expect(norm(p.v)).toBeCloseTo(1, 6); expect(b.get(id)).toEqual(p) }
  })

  // 旧実装（容量つき最近傍）では、主張数の多い席の区画が自席の中心から最大109度離れていた。
  // 席の中心のまわりに置く方式では、件数比によらずこれが成り立つ。
  it('どの席の主張も、他のどの席の中心より自席の中心に近い（件数が偏っていても）', () => {
    const check = (items: { claimId: string; genreSlot: number; pageId: string }[]) => {
      const pos = layoutClaims(items)
      const slots = [...new Set(items.map((x) => x.genreSlot))].sort((a, b) => a - b)
      for (const slot of slots) {
        const mine = items.filter((x) => x.genreSlot === slot).map((x) => pos.get(x.claimId)!.v)
        const own = avg(mine.map((v) => dot(v, seatCenter(slot))))
        for (const other of slots) {
          if (other !== slot) expect(own).toBeGreaterThan(avg(mine.map((v) => dot(v, seatCenter(other)))))
        }
      }
    }
    check(Array.from({ length: 300 }, (_, i) => ({ claimId: `c${i}`, genreSlot: i < 200 ? 3 : 12, pageId: `p${i % 9}` })))
    check(Array.from({ length: 300 }, (_, i) => ({ claimId: `c${i}`, genreSlot: [3, 12, 40][i % 3], pageId: `p${i % 9}` })))
  })

  it('同じページの主張は隣り合う（ページ重心との内積が席全体の平均より高い）', () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ claimId: `c${i}`, genreSlot: 3, pageId: `p${Math.floor(i / 40)}` }))
    const pos = layoutClaims(items)
    const c0 = centroid(items.filter((x) => x.pageId === 'p0').map((x) => pos.get(x.claimId)!.v))
    const inside = items.filter((x) => x.pageId === 'p0').map((x) => dot(pos.get(x.claimId)!.v, c0))
    expect(avg(inside)).toBeGreaterThan(avg(items.map((x) => dot(pos.get(x.claimId)!.v, c0))))
  })

  // 旧実装はここが成り立たなかった（格子を主張の総数から作るため、1件増えると全点が引き直される）。
  it('新しいページの主張を足しても、既存の主張は1つも動かない', () => {
    const base = Array.from({ length: 200 }, (_, i) => ({ claimId: `c${i}`, genreSlot: i % 4, pageId: `p${i % 13}`, createdAt: '2026-09-01T00:00:00Z' }))
    const before = layoutClaims(base)
    const after = layoutClaims([...base,
      ...Array.from({ length: 30 }, (_, i) => ({ claimId: `n${i}`, genreSlot: i % 6, pageId: `new${i % 3}`, createdAt: '2026-10-01T00:00:00Z' }))])
    expect(after.size).toBe(230)
    for (const it of base) expect(same(after.get(it.claimId)!, before.get(it.claimId)!)).toBe(true)
  })

  // 既存ページへの追加は、そのページの枠（PAGE_BLOCK の倍数）に空きがあるあいだ何も動かさない。
  // 枠を超えたときだけ、同じ席の後ろのページがずれる（他の席は動かない）。
  it('既存ページへの追加は、枠に空きがあるあいだ既存の主張を動かさない', () => {
    const base = [
      ...Array.from({ length: PAGE_BLOCK - 1 }, (_, i) => ({ claimId: `a${i}`, genreSlot: 3, pageId: 'pa', createdAt: '2026-09-01T00:00:00Z' })),
      ...Array.from({ length: 5 }, (_, i) => ({ claimId: `b${i}`, genreSlot: 3, pageId: 'pb', createdAt: '2026-09-02T00:00:00Z' })),
      ...Array.from({ length: 5 }, (_, i) => ({ claimId: `z${i}`, genreSlot: 9, pageId: 'pz', createdAt: '2026-09-02T00:00:00Z' })),
    ]
    const before = layoutClaims(base)
    // 枠の中（pa は PAGE_BLOCK-1 件なのであと1件入る）
    const fits = layoutClaims([...base, { claimId: 'a-new', genreSlot: 3, pageId: 'pa', createdAt: '2026-10-01T00:00:00Z' }])
    for (const it of base) expect(same(fits.get(it.claimId)!, before.get(it.claimId)!)).toBe(true)
    // 枠を超える（2件足すと pa の枠が1つ増え、同じ席の後ろのページ pb がずれる）
    const over = layoutClaims([...base,
      { claimId: 'a-new', genreSlot: 3, pageId: 'pa', createdAt: '2026-10-01T00:00:00Z' },
      { claimId: 'a-new2', genreSlot: 3, pageId: 'pa', createdAt: '2026-10-02T00:00:00Z' }])
    for (const it of base.filter((x) => x.pageId === 'pa' || x.genreSlot === 9)) {
      expect(same(over.get(it.claimId)!, before.get(it.claimId)!)).toBe(true)
    }
    expect(base.filter((x) => x.pageId === 'pb').every((x) => !same(over.get(x.claimId)!, before.get(x.claimId)!))).toBe(true)
  })
})

describe('枝（同じページを繋ぐ筋）', () => {
  const items = Array.from({ length: 24 }, (_, i) => ({ claimId: `c${i}`, genreSlot: 3, pageId: `p${Math.floor(i / 8)}` }))

  it('ページごとに1本以上できる。1件だけのページは枝を作らない', () => {
    const pos = layoutClaims(items)
    expect(strandsOf(items, pos).length).toBeGreaterThanOrEqual(3)
    const solo = [{ claimId: 'x', genreSlot: 5, pageId: 'solo' }]
    expect(strandsOf(solo, layoutClaims(solo))).toEqual([])
  })

  // らせんは黄金角で回るので、番号順に繋ぐと球を横切る長い線になる。近い順に辿り直している。
  it('枝のひと続きは近い点どうしだけを結ぶ（球を横切る線を引かない）', () => {
    const pos = layoutClaims(items)
    for (const line of strandsOf(items, pos)) {
      for (let i = 1; i < line.length; i++) {
        const d = Math.acos(Math.min(1, dot(line[i - 1], line[i])))
        expect(d).toBeLessThanOrEqual(SPACING * 3.2 + 1e-9)
      }
    }
  })

  it('枝の点はすべて、その配置に実在する点', () => {
    const pos = layoutClaims(items)
    const known = new Set([...pos.values()].map((p) => p.v.join(',')))
    for (const line of strandsOf(items, pos)) for (const v of line) expect(known.has(v.join(','))).toBe(true)
  })
})

const CORPUS = '.preview/recall-corpus.json'
type LItem = { claimId: string; genreSlot: number; pageId: string; createdAt?: string }
async function loadCorpusItems(): Promise<LItem[]> {
  const { extractClaims } = await import('@/lib/recall/extract-claims')
  const docs = JSON.parse(readFileSync(CORPUS, 'utf-8')) as Array<{ id: string; props: Record<string, string>; blocks: never[] }>
  return docs.flatMap((d) => extractClaims({
    pageId: d.id, pageTitle: d.props['名前'] || '', pageKind: '',
    genres: (d.props['ジャンル'] || '').split(',').map((s) => s.trim()).filter(Boolean), blocks: d.blocks,
  }))
}

describe.skipIf(!existsSync(CORPUS))('layout 実コーパス', () => {
  it('全件が単位球面上に置かれ、席ごとにひとかたまりになる', async () => {
    const all = await loadCorpusItems()
    expect(all.length).toBeGreaterThan(0)
    const t0 = performance.now()
    const pos = layoutClaims(all)
    const ms = performance.now() - t0
    expect(pos.size).toBe(all.length)
    for (const c of all) expect(norm(pos.get(c.claimId)!.v)).toBeCloseTo(1, 6)
    const bySlot = new Map<number, LItem[]>()
    for (const c of all) { if (!bySlot.has(c.genreSlot)) bySlot.set(c.genreSlot, []); bySlot.get(c.genreSlot)!.push(c) }
    const spreads: number[] = []
    for (const [slot, seat] of bySlot) {
      // 席の中の主張は、その席の中心のまわりに収まる（旧実装では最大109度離れていた）
      const worst = Math.max(...seat.map((c) => angleDeg(pos.get(c.claimId)!.v, seatCenter(slot))))
      spreads.push(worst)
      expect(worst).toBeLessThan(75)
    }
    console.log(`[layout] 実コーパス ${all.length}件 / 席${bySlot.size} を ${ms.toFixed(1)}ms で配置。席の広がり 最大 ${Math.max(...spreads).toFixed(1)}度`)
  })

  it('実コーパスに主張を足しても、既存の主張は1つも動かない', async () => {
    const all = await loadCorpusItems()
    const base = layoutClaims(all)
    const added: LItem[] = [...all,
      ...Array.from({ length: 30 }, (_, i) => ({ claimId: `new-${i}`, genreSlot: i % 9, pageId: `new-page-${i % 4}`, createdAt: '2026-12-01T00:00:00Z' })),
      // 新しい席が1つ増える場合
      ...Array.from({ length: 12 }, (_, i) => ({ claimId: `seat-${i}`, genreSlot: 31, pageId: 'new-seat-page', createdAt: '2026-12-01T00:00:00Z' }))]
    const next = layoutClaims(added)
    const moved = all.filter((c) => !same(next.get(c.claimId)!, base.get(c.claimId)!))
    expect(moved.length).toBe(0)
    console.log(`[layout] 42件追加（新しい席1つを含む）で動いた既存の主張 ${moved.length}件`)
  })
})
