import { describe, it, expect } from 'vitest'
import { candidateLines, emptyPart, refForItem, sourceCandidates, swapMainWithFirstExtra, withRefs } from '../spread-edit'
import { makeVerbatimChecker, type SpreadOverlay, type SpreadPart } from '../reader-spread'
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

describe('swapMainWithFirstExtra（主役と追加の先頭の入れ替え）', () => {
  const note: SpreadPart = { kind: 'note', inlines: [{ text: '主役' }] }
  const big: SpreadPart = { kind: 'bignumber', value: '9.1%', caption: [] }
  const gauge: SpreadPart = { kind: 'gauge', items: [{ value: '1', label: [] }] }

  it('主役と追加の先頭を入れ替え、残りの追加の並びは保つ', () => {
    const out = swapMainWithFirstExtra(
      { parts: { 'sec-1': note }, extraParts: { 'sec-1': [big, gauge] } },
      'sec-1',
    )
    expect(out.parts?.['sec-1']).toEqual(big)
    expect(out.extraParts?.['sec-1']).toEqual([note, gauge])
  })

  it('主役が自動判定（parts に無い）のときは何も変えない', () => {
    const before: SpreadOverlay = { extraParts: { 'sec-1': [big] } }
    expect(swapMainWithFirstExtra(before, 'sec-1')).toEqual(before)
  })

  it('追加が無いときは何も変えない', () => {
    const before: SpreadOverlay = { parts: { 'sec-1': note } }
    expect(swapMainWithFirstExtra(before, 'sec-1')).toEqual(before)
  })

  it('他の節のオーバレイに触らない', () => {
    const out = swapMainWithFirstExtra(
      { parts: { 'sec-1': note, 'sec-2': gauge }, extraParts: { 'sec-1': [big] } },
      'sec-1',
    )
    expect(out.parts?.['sec-2']).toEqual(gauge)
  })
})

describe('sourceCandidates（表層に上げられる原本のブロック）', () => {
  it('表と画像だけを、登場順に、見分けの付く名前で返す', () => {
    const blocks: ReaderBlock[] = [
      { kind: 'paragraph', inlines: t('本文。'), blockId: 'blk-p' },
      { kind: 'table', rows: [[t('NIV群'), t('酸素マスク群')], [t('9.1%'), t('18.5%')]], blockId: 'blk-t' },
      { kind: 'image', url: 'https://example.org/a.png', caption: '低酸素血症の発生率', blockId: 'blk-i' },
      { kind: 'image', url: 'https://example.org/b.png', caption: null, blockId: 'blk-i2' },
      { kind: 'table', rows: [[t('マスク種類')]], blockId: 'blk-t2' },
    ]
    expect(sourceCandidates(blocks)).toEqual([
      { blockId: 'blk-t', label: '表: NIV群／酸素マスク群' },
      { blockId: 'blk-i', label: '図: 低酸素血症の発生率' },
      { blockId: 'blk-i2', label: '図: 2つ目' },
      { blockId: 'blk-t2', label: '表: マスク種類' },
    ])
  })

  it('ブロックIDを持たないブロックは候補にしない（指す先にできないため）', () => {
    const blocks: ReaderBlock[] = [{ kind: 'table', rows: [[t('A')]] }]
    expect(sourceCandidates(blocks)).toEqual([])
  })
})
