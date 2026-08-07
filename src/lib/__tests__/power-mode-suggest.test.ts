import { describe, it, expect } from 'vitest'
import { shouldSuggestPowerMode, SUGGEST_MIN_SEARCHES } from '../power-mode-suggest'

describe('shouldSuggestPowerMode', () => {
  it('検索5回未満では出さない（遅くても）', () => {
    expect(shouldSuggestPowerMode([])).toBe(false)
    expect(shouldSuggestPowerMode([3000, 3000, 3000, 3000])).toBe(false)
  })
  it('5回以上で、2秒超が3回あれば出す', () => {
    expect(shouldSuggestPowerMode([2500, 2100, 800, 3000, 900])).toBe(true)
  })
  it('5回以上でも、速ければ出さない', () => {
    expect(shouldSuggestPowerMode([800, 900, 1200, 700, 1500, 1900])).toBe(false)
  })
  it('2秒超が2回では出さない', () => {
    expect(shouldSuggestPowerMode([2500, 2100, 800, 900, 700])).toBe(false)
  })
  it('ちょうど2秒は「超」ではない', () => {
    expect(shouldSuggestPowerMode([2000, 2000, 2000, 2000, 2000])).toBe(false)
  })
  it('しきい値定数が想定どおり', () => {
    expect(SUGGEST_MIN_SEARCHES).toBe(5)
  })
})
