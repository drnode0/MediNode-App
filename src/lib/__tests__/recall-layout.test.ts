import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { fibPt, seatCenter, layoutClaims, centroid } from '@/lib/recall/layout'
import { GENRE_CAPACITY } from '@/lib/recall/genres'

const dot = (a: number[], b: number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const norm = (v: number[]) => Math.hypot(v[0], v[1], v[2])

describe('layout', () => {
  it('fibPt は単位ベクトルで、席の中心は収容数64で決まる（席の総数に依存しない）', () => {
    expect(norm(fibPt(5, 700))).toBeCloseTo(1, 6)
    expect(seatCenter(3)).toEqual(fibPt(3, GENRE_CAPACITY))
  })
  it('同じ入力なら同じ出力。全主張が置かれ、単位球面上にある', () => {
    const items = Array.from({ length: 120 }, (_, i) => ({ claimId: `c${i}`, genreSlot: i % 5 === 0 ? 3 : 12, pageId: `p${i % 7}` }))
    const a = layoutClaims(items), b = layoutClaims(items)
    expect(a.size).toBe(120)
    for (const [id, v] of a) { expect(norm(v)).toBeCloseTo(1, 6); expect(b.get(id)).toEqual(v) }
  })
  // このテストは当初 avg(自席の主張と自席中心の内積) > avg(他席の主張と自席中心の内積) + 0.3 を課していたが、
  // それは寄り具合ではなく席の大きさを測っていた。容量つき最近傍では、全体の2/3を占める席は球面の2/3を
  // 割り当てられる。球面の2/3を覆う区画は定義上、自席中心との内積の平均が0付近になる（実測 0.0537）。
  // 同じ実装・同じ2席のまま件数比だけ逆にする（席3を100/300にする）と 0.6058 になり、閾値を軽く超える。
  // つまり合否を決めていたのは配置の質ではなく件数比だった。席の大きさに左右されない2点で見る。
  //   1) どの席の主張も、他のどの席の中心より自席の中心に近い（席ごと・両方向）
  //   2) 席の中の主張どうしが、その席の大きさに見合った密度でまとまっている（下の idealPairDot 参照）
  // なお 1) は全状況で成り立つ保証ではない。収容数64の格子では席の中心どうしが最短22度まで近づくので、
  // 隣り合う席が「その間隔より広い区画」を必要とするほど主張を抱えると、区画は自席中心から押しのけられる。
  // ここでは中心が十分に離れた席で見る（下の2例はいずれも席の中心どうしの内積が 0.3 未満）。
  it('席ごとの区画は自席の中心に寄る（自席の中心が他席の中心より近く、席の中どうしが密に寄る）', () => {
    const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length
    // 主張どうしの内積の平均。重心と違って区画が帯状でも潰れない
    const meanPairDot = (vs: [number, number, number][]) => {
      let s = 0, n = 0
      for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) { s += dot(vs[i], vs[j]); n++ }
      return n ? s / n : 1
    }
    // 席が球面の割合 f を占めるとき、その区画が理想的な円形なら主張どうしの内積の平均は (1-f)^2 になる。
    // 席を無視してばらまいた配置なら 0 付近。この比を見れば「まとまり具合」を席の大きさから切り離せる。
    const idealPairDot = (f: number) => (1 - f) ** 2
    const expectSeated = (items: { claimId: string; genreSlot: number; pageId: string }[]) => {
      const pos = layoutClaims(items)
      const slots = [...new Set(items.map((x) => x.genreSlot))].sort((a, b) => a - b)
      for (const slot of slots) {
        const seat = items.filter((x) => x.genreSlot === slot)
        const mine = seat.map((x) => pos.get(x.claimId)!)
        // 1) 自席の中心がいちばん近い
        const own = avg(mine.map((v) => dot(v, seatCenter(slot))))
        for (const other of slots) {
          if (other === slot) continue
          expect(own).toBeGreaterThan(avg(mine.map((v) => dot(v, seatCenter(other)))))
        }
        // 2) 席の中はまとまっている（理想的な円形の区画の半分以上の密度。ばらまきなら 0 付近になる）
        expect(meanPairDot(mine)).toBeGreaterThan(idealPairDot(seat.length / items.length) * 0.5)
      }
    }
    // 件数が偏った場合（席3が2/3を占める）。多数側でも自席の中心がいちばん近い
    expectSeated(Array.from({ length: 300 }, (_, i) => ({ claimId: `c${i}`, genreSlot: i < 200 ? 3 : 12, pageId: 'p' })))
    // 件数が均等な場合（3席×100）
    expectSeated(Array.from({ length: 300 }, (_, i) => ({ claimId: `c${i}`, genreSlot: [3, 12, 40][i % 3], pageId: 'p' })))
  })
  it('同じページの主張は隣り合う（ページ重心との内積が席全体の平均より高い）', () => {
    const items = Array.from({ length: 200 }, (_, i) => ({ claimId: `c${i}`, genreSlot: 3, pageId: `p${Math.floor(i / 40)}` }))
    const pos = layoutClaims(items)
    const c0 = centroid(items.filter((x) => x.pageId === 'p0').map((x) => pos.get(x.claimId)!))
    const inside = items.filter((x) => x.pageId === 'p0').map((x) => dot(pos.get(x.claimId)!, c0))
    const all = items.map((x) => dot(pos.get(x.claimId)!, c0))
    const avg = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length
    expect(avg(inside)).toBeGreaterThan(avg(all))
  })
})

const CORPUS = '.preview/recall-corpus.json'
describe.skipIf(!existsSync(CORPUS))('layout 実コーパス', () => {
  // コーパスの件数は中身が増減すれば変わるので、件数そのものではなく「全件が単位球面上に置かれる」ことを見る
  it('実コーパスでも全件が単位球面上に置かれ、席の数が増えても中心が動かない', async () => {
    const { extractClaims } = await import('@/lib/recall/extract-claims')
    const docs = JSON.parse(readFileSync(CORPUS, 'utf-8')) as Array<{ id: string; props: Record<string, string>; blocks: never[] }>
    const all = docs.flatMap((d) => extractClaims({
      pageId: d.id, pageTitle: d.props['名前'] || '', pageKind: '',
      genres: (d.props['ジャンル'] || '').split(',').map((s) => s.trim()).filter(Boolean), blocks: d.blocks,
    }))
    expect(all.length).toBeGreaterThan(0)
    const t0 = performance.now()
    const pos = layoutClaims(all)
    const ms = performance.now() - t0
    expect(pos.size).toBe(all.length)
    for (const c of all) expect(norm(pos.get(c.claimId)!)).toBeCloseTo(1, 6)
    expect(seatCenter(12)).toEqual(fibPt(12, 64)) // 席を34→35に増やしても分母は64のまま
    // 入力の並び順を変えても同じ位置になる（純関数）
    const shuffled = [...all].reverse()
    const posB = layoutClaims(shuffled)
    for (const c of all) expect(posB.get(c.claimId)).toEqual(pos.get(c.claimId))
    console.log(`[layout] 実コーパス ${all.length}件 / 席${new Set(all.map((c) => c.genreSlot)).size} を ${ms.toFixed(1)}ms で配置`)
  })
})
