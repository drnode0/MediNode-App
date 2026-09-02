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
type LItem = { claimId: string; genreSlot: number; pageId: string }
async function loadCorpusItems(): Promise<LItem[]> {
  const { extractClaims } = await import('@/lib/recall/extract-claims')
  const docs = JSON.parse(readFileSync(CORPUS, 'utf-8')) as Array<{ id: string; props: Record<string, string>; blocks: never[] }>
  return docs.flatMap((d) => extractClaims({
    pageId: d.id, pageTitle: d.props['名前'] || '', pageKind: '',
    genres: (d.props['ジャンル'] || '').split(',').map((s) => s.trim()).filter(Boolean), blocks: d.blocks,
  }))
}
const angleDeg = (a: number[], b: number[]) => (Math.acos(Math.min(1, Math.max(-1, dot(a, b)))) * 180) / Math.PI
const samePoint = (a: number[], b: number[]) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2]

describe.skipIf(!existsSync(CORPUS))('layout 実コーパス', () => {
  // コーパスの件数は中身が増減すれば変わるので、件数そのものではなく「全件が単位球面上に置かれる」ことを見る
  it('実コーパスでも全件が単位球面上に置かれ、席の数が増えても中心が動かない', async () => {
    const all = await loadCorpusItems()
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

  // 実データで成り立つのは「席ごとにひとかたまりになる」ことだけで、「その塊が席の中心の上にある」ことではない。
  // 実測（687件・15席）では、占有率の高い上位4席の区画は自席の中心から大きく離れる:
  //   席3 174件 中心との内積の平均 -0.107 / 自席が最も近い 23件 / 区画の重心は席の中心から101度
  //   席4  98件 -0.155 / 21件 / 109度   席12 98件 0.542 / 26件 / 46度   席2 53件 0.700 / 24件 / 30度
  // 一方で29件以下の11席はすべて内積 0.85〜0.98・自席が最も近い 100%・ずれ1〜13度。
  // よってここでは「自席の中心が最も近い」を課さない（上位4席で偽になる）。まとまり具合だけを、
  // 席の大きさで正規化した密度（席内の主張どうしの内積の平均 ÷ 理想値 (1-f)^2）で見る。
  it('実コーパスの各席はひとかたまりになる（席の中心の上にあるとは限らない）', async () => {
    const all = await loadCorpusItems()
    const pos = layoutClaims(all)
    const meanPairDot = (vs: number[][]) => {
      let s = 0, n = 0
      for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) { s += dot(vs[i], vs[j]); n++ }
      return n ? s / n : 1
    }
    const ratios = (place: Map<string, [number, number, number]>) => {
      const bySlot = new Map<number, LItem[]>()
      for (const c of all) { if (!bySlot.has(c.genreSlot)) bySlot.set(c.genreSlot, []); bySlot.get(c.genreSlot)!.push(c) }
      return [...bySlot.entries()].map(([slot, seat]) => {
        const f = seat.length / all.length
        return { slot, n: seat.length, ratio: meanPairDot(seat.map((c) => place.get(c.claimId)!)) / (1 - f) ** 2 }
      })
    }
    const got = ratios(pos)
    const worst = got.reduce((a, b) => (a.ratio < b.ratio ? a : b))
    // 対照: 位置だけを席と無関係に総入れ替えする（席の情報が消えた配置）
    let seed = 20260902
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
    const perm = all.map((c) => ({ id: c.claimId, k: rnd() })).sort((a, b) => a.k - b.k)
    const scattered = new Map(all.map((c, i) => [c.claimId, pos.get(perm[i].id)!]))
    const control = ratios(scattered)
    const controlMax = Math.max(...control.map((r) => r.ratio))
    // 閾値 0.25 は実測の最小 0.310 の下、対照の最大 0.112（件数の少ない席のばらつき）の上に置く
    for (const r of got) expect(r.ratio).toBeGreaterThan(0.25)
    expect(controlMax).toBeLessThan(0.25)
    console.log(`[layout] 席内の密度比 最小 ${worst.ratio.toFixed(3)}（席${worst.slot}・${worst.n}件） / 対照の最大 ${controlMax.toFixed(3)}`)
  })

  // 同期のたびに主張がどれだけ動くか。格子は fibPt(i, N) で全件数 N に依存するので、N が1でも変われば
  // 全主張の座標が計算し直される。実測（687件）:
  //   総数が変わらない編集（10件を別ページへ移す）… 85.7% が完全に同じ点・区画の重心は最大 5.5度
  //   1件追加 … 中央値 0.1度・p90 0.4度（区画の重心は最大 0.5度）
  //   30件追加 / 新しい席が1つ増える / 1割削除 … 主張ごとの移動は中央値 16度・平均 22〜24度・p90 52〜58度。
  //     ただし席の区画（重心）の移動は平均 2.2〜2.7度・最大 10.7度に収まる
  // つまり固定されているのは「席の区画がどこにあるか」であって、「個々の主張がどの点に載るか」ではない。
  // 動かない側だけをテストに固定する。動く側（1割削除で個々の主張が平均23度動く）は
  // レポートに数値で残し、ここでは成立しない不変条件として課さない。
  it('総数が変わらない編集では大半の主張が同じ点に残り、席の区画は同期をまたいでほぼ動かない', async () => {
    const all = await loadCorpusItems()
    const base = layoutClaims(all)
    const seatShift = (next: LItem[]) => {
      const posN = layoutClaims(next)
      const alive = new Set(next.map((x) => x.claimId))
      const bySlot = new Map<number, LItem[]>()
      for (const c of all) { if (alive.has(c.claimId)) { if (!bySlot.has(c.genreSlot)) bySlot.set(c.genreSlot, []); bySlot.get(c.genreSlot)!.push(c) } }
      const shifts = [...bySlot.values()].map((seat) => angleDeg(
        centroid(seat.map((c) => base.get(c.claimId)!)), centroid(seat.map((c) => posN.get(c.claimId)!))))
      return { posN, alive, maxShift: Math.max(...shifts) }
    }
    // (c) 総数据え置きの編集: 主張数が最も多いページから10件抜き、次のページへ10件足す
    const byPage = new Map<string, LItem[]>()
    for (const c of all) { if (!byPage.has(c.pageId)) byPage.set(c.pageId, []); byPage.get(c.pageId)!.push(c) }
    const pages = [...byPage.entries()].filter(([, v]) => v.length >= 10)
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    expect(pages.length).toBeGreaterThan(1)
    const dropped = new Set(pages[0][1].slice(0, 10).map((c) => c.claimId))
    const edited: LItem[] = [...all.filter((c) => !dropped.has(c.claimId)),
      ...Array.from({ length: 10 }, (_, i) => ({ claimId: `synthetic-c-${i}`, genreSlot: pages[1][1][0].genreSlot, pageId: pages[1][0] }))]
    const c = seatShift(edited)
    const survivors = all.filter((x) => c.alive.has(x.claimId))
    const frozen = survivors.filter((x) => samePoint(base.get(x.claimId)!, c.posN.get(x.claimId)!)).length
    expect(frozen / survivors.length).toBeGreaterThan(0.7) // 実測 0.857
    expect(c.maxShift).toBeLessThan(20) // 実測 5.5度

    // (d) 1割をランダムに削る。個々の主張は動く（平均23度）が、席の区画は動かない
    let seed = 20260902
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff }
    const keep = new Set(all.map((x) => ({ x, k: rnd() })).sort((a, b) => a.k - b.k)
      .slice(Math.floor(all.length * 0.1)).map((o) => o.x.claimId))
    const d = seatShift(all.filter((x) => keep.has(x.claimId)))
    expect(d.maxShift).toBeLessThan(20) // 実測 7.8度
    const moved = all.filter((x) => d.alive.has(x.claimId)).map((x) => angleDeg(base.get(x.claimId)!, d.posN.get(x.claimId)!))
    console.log(`[layout] 1割削除: 席の区画の移動 最大 ${d.maxShift.toFixed(1)}度 / 主張ごとの移動 平均 ${(moved.reduce((s, a) => s + a, 0) / moved.length).toFixed(1)}度`)
  })
})
