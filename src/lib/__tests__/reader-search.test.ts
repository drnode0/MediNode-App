import { describe, it, expect } from 'vitest'
import { normalizeForSearch, findMatchRanges, inlineSegments } from '../reader-search'
import type { ReaderInline } from '../reader-doc'

const inl = (text: string): ReaderInline => ({ text })

describe('normalizeForSearch', () => {
  it('カタカナをひらがなに揃える', () => {
    expect(normalizeForSearch('ナトリウム')).toBe('なとりうむ')
  })
  it('全角英数を半角小文字に揃える', () => {
    expect(normalizeForSearch('ＮａＣｌ　１２３')).toBe('nacl　123')
  })
  it('長さを変えない（indexマッピングの前提）', () => {
    const s = 'Ｎa トｶﾞ✅⚠️'
    expect(normalizeForSearch(s).length).toBe(s.length)
  })
})

describe('findMatchRanges', () => {
  it('かな/カナ・全半角・大小を無視して一致する', () => {
    expect(findMatchRanges('低ナトリウム血症', 'なとりうむ')).toEqual([{ start: 1, end: 6 }])
    expect(findMatchRanges('NaCl 投与', 'ｎａｃｌ')).toEqual([{ start: 0, end: 4 }])
  })
  it('複数ヒットを重複なしで返す', () => {
    expect(findMatchRanges('補正、補正、補正', '補正')).toEqual([
      { start: 0, end: 2 }, { start: 3, end: 5 }, { start: 6, end: 8 },
    ])
  })
  it('空クエリ・空白のみは空配列', () => {
    expect(findMatchRanges('本文', '')).toEqual([])
    expect(findMatchRanges('本文', '  ')).toEqual([])
  })
})

describe('inlineSegments', () => {
  it('単一inline内のレンジをセグメントに割る', () => {
    const segs = inlineSegments([inl('低Na血症とは')], [{ start: 1, end: 3 }])
    expect(segs).toEqual([[
      { text: '低', mark: false },
      { text: 'Na', mark: true },
      { text: '血症とは', mark: false },
    ]])
  })
  it('inline境界をまたぐレンジを両側に割り付ける', () => {
    // 連結テキスト "低Na血症"。レンジ {1,4} は inline0の"Na"とinline1の"血"にまたがる
    const segs = inlineSegments([inl('低Na'), inl('血症')], [{ start: 1, end: 4 }])
    expect(segs).toEqual([
      [{ text: '低', mark: false }, { text: 'Na', mark: true }],
      [{ text: '血', mark: true }, { text: '症', mark: false }],
    ])
  })
  it('レンジなしなら各inlineが1セグメント', () => {
    expect(inlineSegments([inl('あ'), inl('い')], [])).toEqual([
      [{ text: 'あ', mark: false }],
      [{ text: 'い', mark: false }],
    ])
  })
})
