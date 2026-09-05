// 7族の表（Recall の説明の折りたたみに出す）。名詞は未定（空文字）でも表が組めること。
import { describe, it, expect } from 'vitest'
import { familyMembers, FAMILY_ORDER, FAMILY_NOUN } from '@/lib/recall/families'
import { GENRE_SEATS, isRetiredSeat, genreLabel, OTHER_SLOT } from '@/lib/recall/genres'
import { coreKindOf } from '@/lib/recall/cores'

describe('7族の表', () => {
  it('族は定義順に7つ', () => {
    expect(familyMembers().map((f) => f.kind)).toEqual(FAMILY_ORDER)
    expect(FAMILY_ORDER).toEqual(['flow', 'exchange', 'signal', 'invasion', 'structure', 'regulation', 'system'])
  })

  it('廃番と63番を除く全席が、ちょうど1つの族に入る', () => {
    const all = familyMembers().flatMap((f) => f.members)
    const expected = GENRE_SEATS.map((_, slot) => slot).filter((s) => s !== OTHER_SLOT && !isRetiredSeat(s) && GENRE_SEATS[s])
    expect(all.length).toBe(expected.length)
    expect(new Set(all).size).toBe(all.length)
  })

  it('廃番の席（学会）は表に出さない', () => {
    expect(familyMembers().flatMap((f) => f.members)).not.toContain('学会')
  })

  it('属する分野は cores.ts の割り当てと一致する（手で二重に持たない）', () => {
    for (const f of familyMembers()) {
      for (const label of f.members) {
        const slot = GENRE_SEATS.findIndex((_, s) => genreLabel(s) === label)
        expect(slot).toBeGreaterThanOrEqual(0)
        expect(coreKindOf(slot)).toBe(f.kind)
      }
    }
  })

  it('属する分野は席番号順に並ぶ', () => {
    for (const f of familyMembers()) {
      const slots = f.members.map((label) => GENRE_SEATS.findIndex((_, s) => genreLabel(s) === label))
      expect(slots).toEqual([...slots].sort((a, b) => a - b))
    }
  })

  it('英名と名詞を持つ（名詞は空文字でもよい）', () => {
    for (const f of familyMembers()) {
      expect(f.en.length).toBeGreaterThan(0)
      expect(typeof f.noun).toBe('string')
      expect(f.noun).toBe(FAMILY_NOUN[f.kind])
    }
  })
})
