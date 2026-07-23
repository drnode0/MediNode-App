import { describe, it, expect } from 'vitest'
import {
  canonicalGenreKey,
  pickRepresentativeVariant,
  mergeGenreKeys,
  genreFacetFilter,
  genreMatchesCanonical,
  departmentColorToken,
  DEPARTMENT_COLOR_TOKENS,
  genreHueIndex,
} from '../genre'

describe('canonicalGenreKey', () => {
  it('番号プレフィックス（半角ピリオド）を落とす', () => {
    expect(canonicalGenreKey('02.呼吸')).toBe('呼吸')
  })
  it('番号なしはそのまま', () => {
    expect(canonicalGenreKey('呼吸')).toBe('呼吸')
  })
  it('全角ピリオドの番号も落とす', () => {
    expect(canonicalGenreKey('10．循環')).toBe('循環')
  })
  it('前後空白とピリオド後の空白を落とす', () => {
    expect(canonicalGenreKey(' 05. 感染症 ')).toBe('感染症')
  })
  it('INBOX等の非番号はそのまま', () => {
    expect(canonicalGenreKey('INBOX')).toBe('INBOX')
  })
  it('意味の違うジャンルは統合キーが変わらない（内科/外科を守る）', () => {
    expect(canonicalGenreKey('呼吸器内科')).toBe('呼吸器内科')
    expect(canonicalGenreKey('呼吸器外科')).toBe('呼吸器外科')
    expect(canonicalGenreKey('呼吸器内科')).not.toBe(canonicalGenreKey('呼吸'))
  })
})

describe('pickRepresentativeVariant', () => {
  it('番号付きvariantを優先する（色・並び順の安定化）', () => {
    expect(pickRepresentativeVariant(['呼吸', '02.呼吸'])).toBe('02.呼吸')
  })
  it('番号が複数あれば小さい番号を採る', () => {
    expect(pickRepresentativeVariant(['03.循環', '01.循環'])).toBe('01.循環')
  })
  it('番号なしだけなら辞書順の先頭', () => {
    expect(pickRepresentativeVariant(['い', 'あ'])).toBe('あ')
  })
  it('単一variantはそれ自身', () => {
    expect(pickRepresentativeVariant(['呼吸'])).toBe('呼吸')
  })
})

describe('mergeGenreKeys', () => {
  it('同一正規化キーのvariantを1つに束ねる', () => {
    const merged = mergeGenreKeys(['02.呼吸', '呼吸', '03.循環'])
    expect(merged).toEqual([
      { key: '呼吸', variants: ['02.呼吸', '呼吸'] },
      { key: '循環', variants: ['03.循環'] },
    ])
  })
  it('variantの重複は除く', () => {
    const merged = mergeGenreKeys(['呼吸', '呼吸'])
    expect(merged).toEqual([{ key: '呼吸', variants: ['呼吸'] }])
  })
  it('正規化して空になるキーは捨てる', () => {
    expect(mergeGenreKeys(['05.', '   '])).toEqual([])
  })
  it('意味の違うジャンルは別チップのまま', () => {
    const merged = mergeGenreKeys(['呼吸器内科', '呼吸器外科'])
    expect(merged.map((m) => m.key).sort()).toEqual(['呼吸器内科', '呼吸器外科'])
  })
})

describe('genreFacetFilter', () => {
  it('variantをOR結合したAlgoliaフィルタを作る', () => {
    expect(genreFacetFilter(['02.呼吸', '呼吸'])).toBe('genre:"02.呼吸" OR genre:"呼吸"')
  })
  it('ダブルクオートをエスケープする', () => {
    expect(genreFacetFilter(['a"b'])).toBe('genre:"a\\"b"')
  })
  it('空配列は空文字', () => {
    expect(genreFacetFilter([])).toBe('')
  })
})

describe('genreMatchesCanonical', () => {
  it('hitのジャンルを正規化して選択キーと照合する', () => {
    expect(genreMatchesCanonical(['02.呼吸'], '呼吸')).toBe(true)
    expect(genreMatchesCanonical(['呼吸'], '呼吸')).toBe(true)
  })
  it('意味の違うジャンルは一致しない', () => {
    expect(genreMatchesCanonical(['呼吸器内科'], '呼吸')).toBe(false)
  })
})

describe('genreHueIndex', () => {
  it('番号付きは (番号-1) % 5 で色相を巡回する', () => {
    expect(genreHueIndex('01.総論', 5)).toBe(0)
    expect(genreHueIndex('02.呼吸', 5)).toBe(1)
    expect(genreHueIndex('05.循環', 5)).toBe(4)
  })
  it('番号がパレット長を超えたら巡回する', () => {
    expect(genreHueIndex('06.X', 5)).toBe(0)
  })
  it('番号なしは名前ハッシュで安定的に決まる（同じ入力は同じ色）', () => {
    const a = genreHueIndex('感染症', 5)
    const b = genreHueIndex('感染症', 5)
    expect(a).toBe(b)
    expect(a).toBeGreaterThanOrEqual(0)
    expect(a).toBeLessThan(5)
  })
})

describe('departmentColorToken', () => {
  it('1個目（index 0）は緑', () => {
    expect(departmentColorToken(0)).toBe('green')
  })
  it('2個目（index 1）は琥珀', () => {
    expect(departmentColorToken(1)).toBe('amber')
  })
  it('パレット長を超えたら巡回する', () => {
    expect(departmentColorToken(DEPARTMENT_COLOR_TOKENS.length)).toBe('green')
  })
  it('負のindexでも安全に巡回する', () => {
    expect(departmentColorToken(-1)).toBe(DEPARTMENT_COLOR_TOKENS[DEPARTMENT_COLOR_TOKENS.length - 1])
  })
  it('パレットに紫（プレミアム予約色）を含めない', () => {
    expect(DEPARTMENT_COLOR_TOKENS).not.toContain('violet')
    expect(DEPARTMENT_COLOR_TOKENS).not.toContain('purple')
  })
})
