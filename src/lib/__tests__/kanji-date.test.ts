import { describe, expect, it } from 'vitest'
import { kanjiNumber, kanjiDate } from '../kanji-date'

describe('kanjiNumber', () => {
  it('1〜99', () => {
    expect(kanjiNumber(1)).toBe('一')
    expect(kanjiNumber(10)).toBe('十')
    expect(kanjiNumber(15)).toBe('十五')
    expect(kanjiNumber(20)).toBe('二十')
    expect(kanjiNumber(31)).toBe('三十一')
    expect(kanjiNumber(99)).toBe('九十九')
  })
})

describe('kanjiDate（刻みの日付。朔日だけ特別表記）', () => {
  it('1日は朔日', () => {
    expect(kanjiDate('2026-08-01T09:00:00+09:00')).toBe('八月朔日')
  })
  it('通常日は漢数字', () => {
    expect(kanjiDate('2026-08-15T09:00:00+09:00')).toBe('八月十五日')
    expect(kanjiDate('2026-12-03T09:00:00+09:00')).toBe('十二月三日')
  })
})
