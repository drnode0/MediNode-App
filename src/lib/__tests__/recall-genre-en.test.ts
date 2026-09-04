// 席の英名・族の英名。設計書 §4 の表がそのまま画面に出るので、
// テストは「表の網羅性・重複の無さ」だけを見る（英語の妥当性はオーナー確認済み）。
import { describe, it, expect } from 'vitest'
import { genreEnglishOf, coreEnglishOf, GENRE_EN } from '@/lib/recall/genre-en'
import { GENRE_SEATS, OTHER_SLOT, RETIRED_SEATS } from '@/lib/recall/genres'
import { canonicalGenreKey } from '@/lib/genre'
import { CoreKind } from '@/lib/recall/cores'

describe('席の英名', () => {
  it('廃番以外の全席に英名がある', () => {
    const retired = new Set(RETIRED_SEATS.map((name) => canonicalGenreKey(name)))
    GENRE_SEATS.forEach((seat, slot) => {
      const key = canonicalGenreKey(seat)
      if (retired.has(key)) return
      expect(genreEnglishOf(slot), seat).not.toBe('')
    })
  })

  it('英名は重複しない', () => {
    const names = Object.values(GENRE_EN)
    expect(new Set(names).size).toBe(names.length)
  })

  it('63番（その他）は Others', () => {
    expect(genreEnglishOf(OTHER_SLOT)).toBe('Others')
  })

  it('席の外は空文字', () => {
    expect(genreEnglishOf(999)).toBe('')
    expect(genreEnglishOf(-1)).toBe('')
  })

  it('表に無い名前（架空の席）は空文字', () => {
    expect(GENRE_EN['架空の席']).toBeUndefined()
  })
})

describe('族の英名', () => {
  it('族7つの英名が、内部名の先頭を大文字にした形になっている', () => {
    const kinds: CoreKind[] = ['flow', 'exchange', 'signal', 'invasion', 'structure', 'regulation', 'system']
    const expected = ['Flow', 'Exchange', 'Signal', 'Invasion', 'Structure', 'Regulation', 'System']
    kinds.forEach((kind, i) => {
      expect(coreEnglishOf(kind)).toBe(expected[i])
    })
  })
})
