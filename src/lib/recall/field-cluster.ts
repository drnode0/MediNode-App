// 族ごとの星団（純関数）。設計 2026-09-05 再計画 §4.3。
// 族の中心7点＝黄金角の螺旋で半径 FAMILY_R の球面に置く。惑星＝中心＋席番号のハッシュで決まる固定のずれ。
// 開くたびに変わらない（席番号だけから決まる）。
// 族の順（FAMILY_ORDER）は families.ts が正。ここで二重に持たない。
import type { Vec3 } from './layout'
import { coreKindOf } from './cores'
import { FAMILY_ORDER } from './families'

export { FAMILY_ORDER }

export const FAMILY_R = 0.5
export const CLUSTER_SPREAD = 0.3
export const CLUSTER_ZOOM = 2.4
export const CLUSTER_PITCH = -0.55
export const CLUSTER_MID_ZOOM = 5
export const FAMILY_FOCUS_ZOOM = 3.4

export function familyCenter(i: number): Vec3 {
  const n = FAMILY_ORDER.length
  const y = 1 - (2 * (i + 0.5)) / n
  const r = Math.sqrt(1 - y * y)
  const a = i * Math.PI * (3 - Math.sqrt(5))
  return [Math.cos(a) * r * FAMILY_R, y * FAMILY_R, Math.sin(a) * r * FAMILY_R]
}

const hash = (a: number, b: number) => {
  let x = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) >>> 0
  x = (x ^ (x >>> 13)) >>> 0
  x = Math.imul(x, 1274126177) >>> 0
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

export function clusterPointOf(slot: number): Vec3 {
  const c = familyCenter(FAMILY_ORDER.indexOf(coreKindOf(slot)))
  const th = hash(slot, 1) * Math.PI * 2
  const ph = Math.acos(2 * hash(slot, 2) - 1)
  const rr = CLUSTER_SPREAD * Math.cbrt(hash(slot, 3))
  return [c[0] + Math.sin(ph) * Math.cos(th) * rr, c[1] + Math.cos(ph) * rr * 0.6, c[2] + Math.sin(ph) * Math.sin(th) * rr]
}
