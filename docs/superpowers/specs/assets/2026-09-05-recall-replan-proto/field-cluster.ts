// 試作: 族ごとの星団。族の中心7点＝黄金角の螺旋で単位球に散らす。惑星＝中心＋席番号のハッシュ。
import type { Vec3 } from '@/lib/recall/layout'
import { coreKindOf, type CoreKind } from '@/lib/recall/cores'
export const KINDS: CoreKind[] = ['flow','exchange','signal','invasion','structure','regulation','system']
export const CLUSTER_SPREAD = 0.3
export const FAMILY_R = 0.5
export const CLUSTER_ZOOM = 2.4
export const CLUSTER_PITCH = -0.55
export const CLUSTER_MID_ZOOM = 5
export function familyCenter(i: number): Vec3 {
  const n = KINDS.length
  const y = 1 - (2 * (i + 0.5)) / n
  const r = Math.sqrt(1 - y * y)
  const a = i * Math.PI * (3 - Math.sqrt(5))
  return [Math.cos(a) * r * FAMILY_R, y * FAMILY_R, Math.sin(a) * r * FAMILY_R]
}
const h = (a: number, b: number) => { let x = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) >>> 0; x = (x ^ (x >>> 13)) >>> 0; x = Math.imul(x, 1274126177) >>> 0; return ((x ^ (x >>> 16)) >>> 0) / 4294967296 }
export function clusterPointOf(slot: number): Vec3 {
  const c = familyCenter(KINDS.indexOf(coreKindOf(slot)))
  const th = h(slot, 1) * Math.PI * 2, ph = Math.acos(2 * h(slot, 2) - 1), rr = CLUSTER_SPREAD * Math.cbrt(h(slot, 3))
  return [c[0] + Math.sin(ph) * Math.cos(th) * rr, c[1] + Math.cos(ph) * rr * 0.6, c[2] + Math.sin(ph) * Math.sin(th) * rr]
}
