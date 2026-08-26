import { describe, it, expect } from 'vitest'
import { splitSections, classifyPart, buildSpreadDraft, applyOverlay, verifyVerbatim } from '../reader-spread'
import type { ReaderBlock, ReaderDoc } from '../reader-doc'

const t = (text: string) => [{ text }]

const doc: ReaderDoc = {
  title: '酸素はどう使い分ける？',
  icon: null,
  cover: null,
  lastEdited: '2026-08-20T00:00:00.000Z',
  blocks: [
    /* 0 */ { kind: 'callout', icon: '⚡', color: 'yellow_background', blocks: [{ kind: 'paragraph', inlines: t('目標SpO2から決める。') }] },
    /* 1 */ { kind: 'heading', level: 2, inlines: t('1. 最初に決めるのは目標SpO2である') },
    /* 2 */ { kind: 'paragraph', inlines: t('デバイスより先に目標値を決める。') },
    /* 3 */ { kind: 'heading', level: 2, inlines: t('2. 鼻カニューレで開始する') },
    /* 4 */ { kind: 'list_item', ordered: false, inlines: t('2〜6 L/分で開始する。') },
    /* 5 */ { kind: 'callout', icon: '🧑‍⚕️', color: null, blocks: [{ kind: 'paragraph', inlines: t('実際には忍容性を見る。') }] },
  ],
}

describe('splitSections', () => {
  it('⚡結論を lead に、番号つきH2ごとに節を切り、署名は tail に置く', () => {
    const r = splitSections(doc)
    expect(r.lead).toBe(doc.blocks[0])
    expect(r.sections.map((s) => s.n)).toEqual([1, 2])
    expect(r.sections[0].title).toBe('1. 最初に決めるのは目標SpO2である')
    expect(r.sections[0].anchor).toBe('1')
    expect(r.sections[0].blocks).toEqual([doc.blocks[2]])
    expect(r.sections[1].blocks).toEqual([doc.blocks[4]])
    expect(r.tail).toEqual([doc.blocks[5]])
  })

  it('H2の前にある本文は lead にも節にも入らず preface に落ちる', () => {
    const d: ReaderDoc = { ...doc, blocks: [{ kind: 'paragraph', inlines: t('前書き。') }, doc.blocks[1], doc.blocks[2]] }
    const r = splitSections(d)
    expect(r.lead).toBeNull()
    expect(r.preface).toEqual([d.blocks[0]])
    expect(r.sections).toHaveLength(1)
  })
})

describe('classifyPart', () => {
  it('表ブロックがあれば比較表になる', () => {
    const rows = [[[{ text: 'デバイス' }], [{ text: '流量' }]], [[{ text: '鼻カニューレ' }], [{ text: '2〜6 L/分' }]]]
    const part = classifyPart([{ kind: 'table', rows }])
    expect(part).toEqual({ kind: 'comparison', rows })
  })

  it('番号つき箇条書きが3つ以上なら判断フローになる', () => {
    const blocks: ReaderBlock[] = [
      { kind: 'list_item', ordered: true, inlines: t('目標SpO2を決める') },
      { kind: 'list_item', ordered: true, inlines: t('デバイスを選ぶ') },
      { kind: 'list_item', ordered: true, inlines: t('反応を見て替える') },
    ]
    const part = classifyPart(blocks)
    expect(part.kind).toBe('flow')
    expect(part.kind === 'flow' && part.steps.map((s) => s.label)).toEqual(['1', '2', '3'])
  })

  it('該当しなければ表層なし', () => {
    expect(classifyPart([{ kind: 'paragraph', inlines: t('ただの段落。') }])).toEqual({ kind: 'none' })
  })
})

describe('buildSpreadDraft', () => {
  it('節ごとに部品と深掘りを持つ下書きを組む', () => {
    const d = buildSpreadDraft(doc, 'page-1')
    expect(d.version).toBe(1)
    expect(d.pageId).toBe('page-1')
    expect(d.title).toBe('酸素はどう使い分ける？')
    expect(d.lead).toBe(doc.blocks[0])
    expect(d.sections).toHaveLength(2)
    expect(d.sections[0].deep).toEqual([doc.blocks[2]])
    expect(d.sections[0].part).toEqual({ kind: 'none' })
    expect(d.sections[0].shortLabel).toBeNull()
    expect(d.quizzes).toEqual([])
    expect(d.tail).toEqual([doc.blocks[5]])
  })
})

describe('applyOverlay / verifyVerbatim', () => {
  it('短ラベル・部品・理解チェックを重ねる', () => {
    const draft = buildSpreadDraft(doc, 'page-1')
    const merged = applyOverlay(draft, {
      shortLabels: { '1': '目標SpO2' },
      parts: { '1': { kind: 'bignumber', value: '94%', caption: [{ text: 'デバイスより先に目標値を決める。' }] } },
      icons: { '1': 'target' },
      quizzes: [{ id: 'q1', sectionAnchor: '1', question: '先に決めるのは？', choices: ['目標SpO2', 'デバイス'], answerIndex: 0, evidence: 'デバイスより先に目標値を決める。', reviewed: false }],
    })
    expect(merged.sections[0].shortLabel).toBe('目標SpO2')
    expect(merged.sections[0].part.kind).toBe('bignumber')
    expect(merged.icons).toEqual({ '1': 'target' })
    expect(merged.quizzes).toHaveLength(1)
    // 深掘り本文はオーバレイでは触れない
    expect(merged.sections[0].deep).toEqual(draft.sections[0].deep)
    // 本文は applyOverlay では触れない。ここが緩むと、上書きから本文を書き換える経路ができる。
    expect(merged.lead).toBe(draft.lead)
    expect(merged.preface).toBe(draft.preface)
    expect(merged.tail).toBe(draft.tail)
  })

  it('原本に無い文が混ざったら検査で落ちる', () => {
    const draft = buildSpreadDraft(doc, 'page-1')
    const bad = applyOverlay(draft, {
      parts: { '1': { kind: 'bignumber', value: '94%', caption: [{ text: '目標は常に98%以上にする。' }] } },
    })
    const r = verifyVerbatim(bad, doc)
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('目標は常に98%以上にする。')
  })

  it('原本の逐語だけなら検査を通る', () => {
    const draft = buildSpreadDraft(doc, 'page-1')
    const good = applyOverlay(draft, {
      quizzes: [{ id: 'q1', sectionAnchor: '1', question: '先に決めるのは？', choices: ['目標SpO2', 'デバイス'], answerIndex: 0, evidence: 'デバイスより先に目標値を決める。', reviewed: true }],
    })
    expect(verifyVerbatim(good, doc)).toEqual({ ok: true, missing: [] })
  })

  it('短ラベルは検査の対象にしない（原本に無くてよい）', () => {
    const draft = buildSpreadDraft(doc, 'page-1')
    const merged = applyOverlay(draft, { shortLabels: { '1': '目標SpO2' } })
    expect(verifyVerbatim(merged, doc).ok).toBe(true)
  })
})
