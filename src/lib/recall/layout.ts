// 配置(純関数・決定的)。描画を知らない。
// 1) 主張数 N のフィボナッチ球面格子(密度一様)
// 2) 使用中の席の中心へ、席ごとの主張数を容量として距離の近い順に割り当てる(容量制約つき最近傍)
// 3) 席の中ではページごとに連続した格子点を与える
// 席の中心は fibPt(slot, GENRE_CAPACITY)。分母を席の数にすると席を足すたび全中心がずれるので固定する。
import { GENRE_CAPACITY } from './genres'

export type Vec3 = [number, number, number]
const GA = Math.PI * (3 - Math.sqrt(5))

export function fibPt(i: number, n: number): Vec3 {
  const y = 1 - ((i + 0.5) / n) * 2
  const r = Math.sqrt(Math.max(0, 1 - y * y))
  const th = GA * i
  return [Math.cos(th) * r, y, Math.sin(th) * r]
}

export function seatCenter(slot: number): Vec3 {
  return fibPt(slot, GENRE_CAPACITY)
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export function centroid(vs: Vec3[]): Vec3 {
  const v: Vec3 = [0, 0, 0]
  for (const p of vs) { v[0] += p[0]; v[1] += p[1]; v[2] += p[2] }
  const L = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / L, v[1] / L, v[2] / L]
}

// 容量制約つき最近傍。近いペアから順に、容量が残っている席へ格子点を割り当てる。
function assign(points: Vec3[], centers: Vec3[], caps: number[]): number[] {
  const pairs: [number, number, number][] = []
  points.forEach((p, pi) => centers.forEach((c, ci) => pairs.push([1 - dot(p, c), pi, ci])))
  pairs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
  const out = new Array<number>(points.length).fill(-1)
  const left = caps.slice()
  let done = 0
  for (const [, pi, ci] of pairs) {
    if (out[pi] >= 0 || left[ci] <= 0) continue
    out[pi] = ci; left[ci]--; done++
    if (done === points.length) break
  }
  return out
}

export type LayoutItem = { claimId: string; genreSlot: number; pageId: string }

export function layoutClaims(items: LayoutItem[]): Map<string, Vec3> {
  const N = items.length
  const result = new Map<string, Vec3>()
  if (!N) return result
  // 入力順に依存しないよう、席→ページ→ID で安定に並べる
  const sorted = [...items].sort((a, b) => a.genreSlot - b.genreSlot || a.pageId.localeCompare(b.pageId) || a.claimId.localeCompare(b.claimId))
  const bySlot = new Map<number, LayoutItem[]>()
  for (const it of sorted) { if (!bySlot.has(it.genreSlot)) bySlot.set(it.genreSlot, []); bySlot.get(it.genreSlot)!.push(it) }
  const slots = [...bySlot.keys()].sort((a, b) => a - b)
  const lattice: Vec3[] = Array.from({ length: N }, (_, i) => fibPt(i, N))
  const centers = slots.map(seatCenter)
  const assigned = assign(lattice, centers, slots.map((s) => bySlot.get(s)!.length))
  slots.forEach((slot, si) => {
    const c = centers[si]
    const cells = lattice.map((p, i) => ({ p, i })).filter((o) => assigned[o.i] === si).sort((a, b) => dot(b.p, c) - dot(a.p, c))
    const list = bySlot.get(slot)!
    list.forEach((it, k) => result.set(it.claimId, cells[k % cells.length].p))
  })
  return result
}
