import { describe, it, expect } from 'vitest'
import { splitIntoSections, buildSectionRecords, extractRelationIds, SECTION_MAX_BYTES } from '../subscription-sections'
import type { NotionBlockLite } from '../content-stats'

const para = (text: string): NotionBlockLite => ({ type: 'paragraph', paragraph: { rich_text: [{ plain_text: text }] } })
const h2 = (text: string): NotionBlockLite => ({ type: 'heading_2', heading_2: { rich_text: [{ plain_text: text }] } })
const h1 = (text: string): NotionBlockLite => ({ type: 'heading_1', heading_1: { rich_text: [{ plain_text: text }] } })

describe('splitIntoSections', () => {
  it('番号付きH2で節を切り、前文はsec0になる', () => {
    const secs = splitIntoSections([
      h1('Question'), para('結論と署名'),
      h2('1. 病態'), para('本文A'),
      h2('2. 治療'), para('本文B'),
    ])
    expect(secs.map((s) => [s.sectionNo, s.sectionTitle])).toEqual([
      [0, ''], [1, '病態'], [2, '治療'],
    ])
    expect(secs[0].text).toContain('結論と署名')
    expect(secs[1].text).toContain('本文A')
    // 節見出し自体も本文に含める（見出し語でもヒットさせるため）
    expect(secs[1].text).toContain('病態')
  })
  it('番号なしH2は節境界にしない（現行節に含める）', () => {
    const secs = splitIntoSections([h2('1. 病態'), para('A'), h2('確信度の見方'), para('凡例')])
    expect(secs).toHaveLength(1)
    expect(secs[0].text).toContain('凡例')
  })
  it('バイト上限を超える節は文単位でpart分割する', () => {
    const long = 'あ'.repeat(2000) + '。' + 'い'.repeat(2000) + '。'
    const secs = splitIntoSections([h2('1. 長い'), para(long)])
    expect(secs.length).toBeGreaterThan(1)
    for (const s of secs) {
      expect(Buffer.byteLength(s.text, 'utf8')).toBeLessThanOrEqual(SECTION_MAX_BYTES)
      expect(s.sectionNo).toBe(1)
    }
    expect(secs.map((s) => s.part)).toEqual(secs.map((_, i) => i))
  })
  it('空テキストの節は返さない', () => {
    expect(splitIntoSections([h2('1. 空')])).toHaveLength(1) // 見出しテキストのみでも節にはなる
    expect(splitIntoSections([])).toHaveLength(0)
  })
})

describe('buildSectionRecords', () => {
  const parent = {
    objectID: 'subscription_abc', title: '低Na血症', genre: ['腎臓'], source: 'medical',
    owner: 'subscription', aiSummary: '要約', lastEdited: '2026-07-01',
  }
  it('親の属性を引き継ぎ、節フィールドを上書きする', () => {
    const recs = buildSectionRecords(parent, [
      { sectionNo: 0, sectionTitle: '', part: 0, text: '結論' },
      { sectionNo: 1, sectionTitle: '病態', part: 0, text: '本文' },
    ])
    expect(recs[0]).toMatchObject({
      objectID: 'subscription_abc#sec0', parentId: 'subscription_abc',
      isParent: 0, recordType: 'section', sectionNo: 0, sectionText: '結論',
      title: '低Na血症', genre: ['腎臓'], source: 'medical', owner: 'subscription',
    })
    expect(recs[1].objectID).toBe('subscription_abc#sec1')
  })
  it('part>0はobjectIDに枝番が付く', () => {
    const recs = buildSectionRecords(parent, [{ sectionNo: 2, sectionTitle: 'x', part: 1, text: 't' }])
    expect(recs[0].objectID).toBe('subscription_abc#sec2-1')
  })
  it('空テキストの節はレコードにしない', () => {
    expect(buildSectionRecords(parent, [{ sectionNo: 1, sectionTitle: '', part: 0, text: '  ' }])).toHaveLength(0)
  })
})

describe('extractRelationIds', () => {
  it('relationプロパティからID配列を返す', () => {
    expect(extractRelationIds({ type: 'relation', relation: [{ id: 'a-1' }, { id: 'b-2' }] })).toEqual(['a-1', 'b-2'])
  })
  it('relation以外・空は空配列', () => {
    expect(extractRelationIds({ type: 'rich_text' })).toEqual([])
    expect(extractRelationIds({})).toEqual([])
  })
})
