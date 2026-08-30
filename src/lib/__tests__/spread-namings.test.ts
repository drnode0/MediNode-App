import { describe, it, expect } from 'vitest'
import { collectNamings } from '../spread-namings'
import type { SpreadDoc, SpreadPart } from '../reader-spread'

const inl = (s: string) => [{ text: s }]

// SpreadDoc の最小形。テストごとに必要なキーだけ差し替える。
const doc = (over: Partial<SpreadDoc>): SpreadDoc => ({
  version: 1,
  pageId: 'p1',
  title: '記事',
  lead: null,
  preface: [],
  sections: [],
  tail: [],
  quizzes: [],
  icons: {},
  ...over,
})

const section = (part: SpreadPart, shortLabel: string | null = null) => ({
  n: 1,
  anchor: '1',
  title: '1. 節',
  shortLabel,
  part,
  deep: [],
})

describe('collectNamings', () => {
  it('比較表は title だけ拾い、セルは拾わない（セルは逐語一致検査が見ている）', () => {
    const part: SpreadPart = { kind: 'comparison', title: '呼吸不全の分類', rows: [[inl('Ⅰ型'), inl('Ⅱ型')]] }
    const out = collectNamings(doc({ sections: [section(part)] }))
    expect(out.map((n) => n.text)).toEqual(['呼吸不全の分類'])
    expect(out[0].net).toBe('none')
  })

  it('カードは title だけ拾い、lines は拾わない', () => {
    const part: SpreadPart = { kind: 'cards', cards: [{ title: '酸素の入れ方で外す', lines: [inl('本文の逐語。')] }] }
    const out = collectNamings(doc({ sections: [section(part)] }))
    expect(out.map((n) => n.text)).toEqual(['酸素の入れ方で外す'])
  })

  it('ゲージの title、判断図の question と when、Go/No-Go のラベル、フローの step.label を拾う', () => {
    const gauge: SpreadPart = { kind: 'gauge', title: '同じ傾向', items: [{ value: '11.7%', label: inl('黒人患者') }] }
    const decision: SpreadPart = { kind: 'decision', question: 'Ⅱ型のリスクがあるか？', branches: [{ when: 'ある', then: inl('88〜92%を目標とする。') }] }
    const gonogo: SpreadPart = { kind: 'gonogo', go: [inl('行う。')], noGo: [inl('行わない。')], goLabel: 'NIVを選ぶ', noGoLabel: '侵襲的人工呼吸への移行を判断する' }
    const flow: SpreadPart = { kind: 'flow', steps: [{ label: '酸素投与', inlines: inl('開始する。') }] }
    const out = collectNamings(doc({ sections: [section(gauge)], topParts: [decision, gonogo, flow] }))
    expect(out.map((n) => n.text).sort()).toEqual(
      ['NIVを選ぶ', 'Ⅱ型のリスクがあるか？', 'ある', '侵襲的人工呼吸への移行を判断する', '同じ傾向', '酸素投与'].sort(),
    )
  })

  it('節の短縮ラベルを拾う', () => {
    const out = collectNamings(doc({ sections: [section({ kind: 'none' }, '落とし穴')] }))
    expect(out.map((n) => n.text)).toEqual(['落とし穴'])
  })

  it('extraParts も走査する', () => {
    const main: SpreadPart = { kind: 'comparison', title: '主役の表', rows: [] }
    const extra: SpreadPart = { kind: 'gauge', title: '添えるゲージ', items: [] }
    const out = collectNamings(doc({ sections: [{ ...section(main), extraParts: [extra] }] }))
    expect(out.map((n) => n.text)).toEqual(['主役の表', '添えるゲージ'])
  })

  it('理解チェックは設問と選択肢が命名、解説は循環として拾う', () => {
    const out = collectNamings(
      doc({
        quizzes: [
          {
            id: 'q1',
            sectionAnchor: '1',
            question: '血液ガスが返り、次にどうしますか？',
            choices: ['NIVを考慮する', '経過を見る'],
            answerIndex: 0,
            evidence: '本文の逐語。',
            answerLead: '言い直し。',
            explanation: '解説の地の文。',
            reviewed: false,
          },
        ],
      }),
    )
    const byNet = (net: string) => out.filter((n) => n.net === net).map((n) => n.text)
    expect(byNet('none')).toEqual(['血液ガスが返り、次にどうしますか？', 'NIVを考慮する', '経過を見る'])
    expect(byNet('circular')).toEqual(['言い直し。', '解説の地の文。'])
    // 根拠（evidence）は原本の逐語なので対象外
    expect(out.map((n) => n.text)).not.toContain('本文の逐語。')
  })

  it('参考文献の圧縮行は3つとも循環として拾う（照合先のノートもClaudeが書いている）', () => {
    const out = collectNamings(doc({ refs: [{ title: 'BTS 2017', source: '英国胸部学会', note: '目標を定める。' }] }))
    expect(out.every((n) => n.net === 'circular')).toBe(true)
    expect(out.map((n) => n.text)).toEqual(['BTS 2017', '英国胸部学会', '目標を定める。'])
  })

  it('空文字と未指定は落とす（読む一覧に空行を出さない）', () => {
    const part: SpreadPart = { kind: 'cards', cards: [{ title: '', lines: [] }] }
    expect(collectNamings(doc({ sections: [section(part)] }))).toEqual([])
  })

  it('where にどの部品のどのキーかが入る', () => {
    const part: SpreadPart = { kind: 'gauge', title: '同じ傾向', items: [] }
    expect(collectNamings(doc({ sections: [section(part)] }))[0].where).toBe('節1 gauge.title')
  })
})
