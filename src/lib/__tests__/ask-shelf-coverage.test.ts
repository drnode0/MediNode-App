import { describe, it, expect } from 'vitest'
import { normalizeForMatch, bigrams, buildCoverageIndex, coverage, CLAIM_COVERAGE_MIN } from '@/lib/ask-shelf/coverage'

describe('normalizeForMatch', () => {
  it('全角と半角・大小文字・記号の違いを消す', () => {
    expect(normalizeForMatch('ＭＡＰ６５ mmHg（未満）')).toBe('map65mmhg未満')
  })
  it('null 相当でも落ちない', () => {
    expect(normalizeForMatch('')).toBe('')
  })
})

describe('bigrams', () => {
  it('2文字ずつ1文字ずらして切り出す', () => {
    expect(bigrams('ショック')).toEqual(['ショ', 'ョッ', 'ック'])
  })
  it('1文字以下では空になる', () => {
    expect(bigrams('あ')).toEqual([])
  })
})

describe('coverage', () => {
  const docs = ['低血圧はショックの定義の要件ではない', '乳酸値は組織低灌流の指標である', '尿量は0.5 mL/kg/時未満で乏尿とする']
  const index = buildCoverageIndex(docs)

  it('文がそのまま含まれていれば1に近い', () => {
    expect(coverage('低血圧はショックの定義の要件ではない', docs[0], index)).toBeCloseTo(1, 5)
  })
  it('まったく重ならなければ0になる', () => {
    expect(coverage('白内障手術後の眼圧', docs[0], index)).toBe(0)
  })
  it('問いが空なら0を返す（0除算にしない）', () => {
    expect(coverage('', docs[0], index)).toBe(0)
  })
  it('コーパスに無い語は最大の重みで数え、覆えないぶん割合を下げる', () => {
    const withUnknown = coverage('ショック 眼圧', docs[0], index)
    const withoutUnknown = coverage('ショック', docs[0], index)
    expect(withUnknown).toBeLessThan(withoutUnknown)
  })
  it('閾値は0.25で1か所に置かれている', () => {
    expect(CLAIM_COVERAGE_MIN).toBe(0.25)
  })
})
