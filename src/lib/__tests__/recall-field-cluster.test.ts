import { describe, it, expect } from 'vitest'
import { familyCenter, clusterPointOf, FAMILY_ORDER, FAMILY_R, CLUSTER_SPREAD } from '@/lib/recall/field-cluster'
import { GENRE_SEATS, isRetiredSeat, OTHER_SLOT } from '@/lib/recall/genres'
import { coreKindOf } from '@/lib/recall/cores'

const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

describe('族ごとの星団', () => {
  it('同じ席は何度呼んでも同じ位置（決定性）', () => {
    expect(clusterPointOf(3)).toEqual(clusterPointOf(3))
  })
  it('7族の中心は互いに 0.5 以上離れている', () => {
    for (let i = 0; i < 7; i++) for (let j = i + 1; j < 7; j++) expect(dist(familyCenter(i), familyCenter(j))).toBeGreaterThan(0.5)
  })
  it('族の中心は半径 FAMILY_R の球面の近く（縦は潰していない）', () => {
    for (let i = 0; i < 7; i++) expect(Math.hypot(...familyCenter(i))).toBeCloseTo(FAMILY_R, 1)
  })
  it('各席は自分の族の中心から CLUSTER_SPREAD 以内', () => {
    for (let slot = 0; slot < GENRE_SEATS.length; slot++) {
      if (!GENRE_SEATS[slot] || slot === OTHER_SLOT || isRetiredSeat(slot)) continue
      const c = familyCenter(FAMILY_ORDER.indexOf(coreKindOf(slot)))
      expect(dist(clusterPointOf(slot), c)).toBeLessThanOrEqual(CLUSTER_SPREAD + 1e-9)
    }
  })
})
