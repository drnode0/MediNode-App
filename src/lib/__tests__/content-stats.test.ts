import { describe, it, expect } from 'vitest'
import { blockText, computeContentStats, readingMinutes } from '@/lib/content-stats'

const rt = (text: string) => [{ plain_text: text }]

describe('computeContentStats', () => {
  it('段落・見出しの文字数を合算し、H2をセクションとして数える', () => {
    const blocks = [
      { type: 'heading_2', heading_2: { rich_text: rt('結論') } },
      { type: 'paragraph', paragraph: { rich_text: rt('あいうえお') } },
      { type: 'heading_2', heading_2: { rich_text: rt('背景') } },
      { type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt('かきくけこ') } },
    ]
    const s = computeContentStats(blocks)
    expect(s.contentChars).toBe(14) // 結論(2)+あいうえお(5)+背景(2)+かきくけこ(5)
    expect(s.sectionCount).toBe(2)
    expect(s.headings).toEqual(['結論', '背景'])
  })

  it('headingsは先頭5件まで', () => {
    const blocks = Array.from({ length: 7 }, (_, i) => ({
      type: 'heading_2',
      heading_2: { rich_text: rt(`H${i + 1}`) },
    }))
    const s = computeContentStats(blocks)
    expect(s.sectionCount).toBe(7)
    expect(s.headings).toEqual(['H1', 'H2', 'H3', 'H4', 'H5'])
  })

  it('rich_textを持たないブロック（divider等）は無視する', () => {
    const blocks = [
      { type: 'divider', divider: {} },
      { type: 'image', image: { file: { url: 'x' } } },
      { type: 'paragraph', paragraph: { rich_text: rt('abc') } },
    ]
    const s = computeContentStats(blocks)
    expect(s.contentChars).toBe(3)
    expect(s.sectionCount).toBe(0)
    expect(s.headings).toEqual([])
  })
})

describe('readingMinutes', () => {
  it('600字/分・最低1分', () => {
    expect(readingMinutes(0)).toBe(0)
    expect(readingMinutes(100)).toBe(1)
    expect(readingMinutes(600)).toBe(1)
    expect(readingMinutes(4200)).toBe(7)
  })
})

describe('blockText の表対応', () => {
  it('table_row のセルを空白区切りで読む', () => {
    const row = {
      type: 'table_row',
      table_row: { cells: [[{ plain_text: '鼻カニューレ' }], [{ plain_text: '2〜6 L/分' }]] },
    }
    expect(blockText(row)).toBe('鼻カニューレ 2〜6 L/分')
  })

  it('table 本体（セルを持たない）は空文字のまま', () => {
    expect(blockText({ type: 'table', table: { table_width: 2 } })).toBe('')
  })

  it('表の文字数が本文文字数に加算される', () => {
    const blocks = [
      { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'あいう' }] } },
      { type: 'table', table: { table_width: 2 } },
      { type: 'table_row', table_row: { cells: [[{ plain_text: 'かき' }], [{ plain_text: 'くけ' }]] } },
    ]
    expect(computeContentStats(blocks).contentChars).toBe(3 + 'かき くけ'.length)
  })
})
