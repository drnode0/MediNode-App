import { describe, it, expect } from 'vitest'
import { candidateLines, emptyPart, refForItem, withRefs } from '../spread-edit'
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

  it('スプレッドノートを渡すとノートの文も通る', () => {
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

describe('参考文献の圧縮行（編集画面）', () => {
  it('refForItem は選んだ原本の行への紐づけと、その行の文言を初期値に持つ1行を返す', () => {
    // 圧縮行は「原本のどの文献行か」を選んでから作る。紐づけ（sourceId）はここで必ず決まる。
    expect(refForItem('blk-1', 'BTS Guideline for oxygen use in adults（BMJ 2017） — 中核。')).toEqual({
      sourceId: 'blk-1',
      title: 'BTS Guideline for oxygen use in adults（BMJ 2017） — 中核。',
      source: '',
      note: '',
    })
  })

  it('withRefs は行があれば refs を立て、空になったらキーごと落とす', () => {
    const ref = { sourceId: 'blk-1', title: 'BTS Guideline for oxygen use in adults', source: 'BMJ Open Respir Res 2017', note: '中核ガイドライン' }
    expect(withRefs({}, [ref])).toEqual({ refs: [ref] })
    expect(withRefs({ shortLabels: { '1': '目標SpO2' } }, [ref]).shortLabels).toEqual({ '1': '目標SpO2' })
    expect(withRefs({ refs: [ref] }, []).refs).toBeUndefined()
  })
})
