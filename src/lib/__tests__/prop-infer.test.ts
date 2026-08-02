// 列名推定（inferPropMap）のテスト。
// 既存DBの列名を書き換えずにつなぐため、スキーマ（名前と型）から
// 役割ごとの候補を推定する。1つの列は1つの役割にしか割り当てない。
import { describe, it, expect } from 'vitest'
import { inferPropMap, typeAllowedColumns } from '../prop-infer'

const p = (name: string, type: string) => ({ name, type })

describe('inferPropMap', () => {
  it('既定名が型ごと揃っていれば全役割 exact', () => {
    const r = inferPropMap([
      p('名前', 'title'),
      p('要約', 'rich_text'),
      p('キーワード', 'multi_select'),
      p('ジャンル', 'multi_select'),
      p('知識レベル', 'select'),
    ])
    expect(r.summary).toMatchObject({ best: '要約', confidence: 'exact' })
    expect(r.keywords).toMatchObject({ best: 'キーワード', confidence: 'exact' })
    expect(r.genre).toMatchObject({ best: 'ジャンル', confidence: 'exact' })
    expect(r.knowledgeLevel).toMatchObject({ best: '知識レベル', confidence: 'exact' })
  })

  it('類似名を likely として推定する（サマリー→要約、カテゴリ→ジャンル）', () => {
    const r = inferPropMap([
      p('名前', 'title'),
      p('サマリー', 'rich_text'),
      p('カテゴリ', 'multi_select'),
    ])
    expect(r.summary).toMatchObject({ best: 'サマリー', confidence: 'likely' })
    expect(r.genre).toMatchObject({ best: 'カテゴリ', confidence: 'likely' })
  })

  it('名前が一致しても型が合わなければ採用しない（要約が number）', () => {
    const r = inferPropMap([p('名前', 'title'), p('要約', 'number')])
    expect(r.summary.best).toBeNull()
    expect(r.summary.confidence).toBe('none')
  })

  it('1つの列を2役割に割り当てない（タグはキーワードが取り、ジャンルは none）', () => {
    const r = inferPropMap([p('名前', 'title'), p('タグ', 'multi_select')])
    expect(r.keywords).toMatchObject({ best: 'タグ', confidence: 'likely' })
    expect(r.genre.best).toBeNull()
    expect(r.genre.candidates).not.toContain('タグ')
  })

  it('名前が導けず型だけ合う列は guess（候補のみ・bestなし）', () => {
    const r = inferPropMap([p('名前', 'title'), p('ひとこと', 'rich_text')])
    expect(r.summary).toMatchObject({ best: null, confidence: 'guess' })
    expect(r.summary.candidates).toContain('ひとこと')
  })

  it('大文字小文字を無視して英語同義語も拾う（Summary→要約）', () => {
    const r = inferPropMap([p('名前', 'title'), p('Summary', 'rich_text')])
    expect(r.summary).toMatchObject({ best: 'Summary', confidence: 'likely' })
  })

  it('typeAllowedColumns はclaimせず、同じ列を複数役割の選択肢に出す', () => {
    const schema = [p('名前', 'title'), p('タグ', 'multi_select')]
    expect(typeAllowedColumns(schema, 'keywords')).toContain('タグ')
    expect(typeAllowedColumns(schema, 'genre')).toContain('タグ')
  })
})
