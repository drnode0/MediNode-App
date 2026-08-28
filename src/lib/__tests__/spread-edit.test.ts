import { describe, it, expect } from 'vitest'
import { candidateLines, emptyPart } from '../spread-edit'
import { makeVerbatimChecker } from '../reader-spread'
import type { ReaderBlock, ReaderDoc } from '../reader-doc'

const t = (text: string) => [{ text }]

describe('candidateLines（編集画面の候補文）', () => {
  it('段落・箇条書き・表セル・calloutの中を登場順・重複なしで返す', () => {
    const blocks: ReaderBlock[] = [
      { kind: 'list_item', ordered: false, inlines: t('一つ目の主張。') },
      { kind: 'table', rows: [[t('セルA'), t('セルB')], [t('一つ目の主張。'), t('セルC')]] },
      { kind: 'callout', icon: '📚', color: null, blocks: [{ kind: 'paragraph', inlines: t('文献の説明。') }] },
      { kind: 'paragraph', inlines: t('  空白を  含む   段落。 ') },
    ]
    expect(candidateLines(blocks)).toEqual([
      '一つ目の主張。',
      'セルA',
      'セルB',
      'セルC',
      '文献の説明。',
      '空白を 含む 段落。',
    ])
  })

  it('🎨制作メモの中は候補にしない（読者に出ない文のため）', () => {
    const blocks: ReaderBlock[] = [
      { kind: 'callout', icon: '🎨', color: null, blocks: [{ kind: 'paragraph', inlines: t('制作メモ。') }] },
      { kind: 'paragraph', inlines: t('本文。') },
    ]
    expect(candidateLines(blocks)).toEqual(['本文。'])
  })
})

describe('makeVerbatimChecker（1文の逐語照合）', () => {
  const doc: ReaderDoc = {
    title: 'x', icon: null, cover: null, lastEdited: null,
    blocks: [{ kind: 'paragraph', inlines: t('鼻カニューレ2〜6 L/分で開始する。') }],
  }

  it('原本の部分文字列は通り、無い文は落ちる。空白の揺れは吸収する', () => {
    const ok = makeVerbatimChecker(doc)
    expect(ok('鼻カニューレ2〜6 L/分')).toBe(true)
    expect(ok('鼻カニューレ2〜6  L/分')).toBe(true)
    expect(ok('どこにも無い文')).toBe(false)
  })

  it('誌面ノートを渡すとノートの文も通る', () => {
    const notes: ReaderBlock[] = [{ kind: 'list_item', ordered: false, inlines: t('ノートの一文') }]
    const ok = makeVerbatimChecker(doc, notes)
    expect(ok('ノートの一文')).toBe(true)
    expect(makeVerbatimChecker(doc)('ノートの一文')).toBe(false)
  })
})

describe('emptyPart（部品の雛形）', () => {
  it('全kindで、その形の空雛形が返る', () => {
    expect(emptyPart('flow')).toEqual({ kind: 'flow', steps: [{ label: '', inlines: [] }] })
    expect(emptyPart('cards').kind).toBe('cards')
    expect(emptyPart('gonogo')).toMatchObject({ go: [[]], noGo: [[]] })
    expect(emptyPart('none')).toEqual({ kind: 'none' })
  })
})
