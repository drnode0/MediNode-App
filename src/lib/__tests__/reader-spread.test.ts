import { describe, it, expect } from 'vitest'
import { splitSections, classifyPart, buildSpreadDraft, applyOverlay, sanitizeOverlay, sectionDisplay, sectionSources, verifyVerbatim, visibleQuizzes } from '../reader-spread'
import type { ReaderBlock, ReaderDoc } from '../reader-doc'
import type { SpreadQuiz, SpreadPart } from '../reader-spread'

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

  // verifyVerbatim（正確には内部の verbatimTargets）が辿る6分岐のうち、
  // bignumber と quiz.evidence は既存のテストで固定済み。ここは残り5分岐
  // （comparison / matrix / flow / timeline / gonogo）を1つずつ固定する。
  // これは修正3（sanitizeOverlay）が守っている安全装置の本体なので、逐語検査が
  // 素通りしないことをここで確定させておく。
  it('comparison に原本に無い文が混ざったら検査で落ちる', () => {
    const draft = buildSpreadDraft(doc, 'page-1')
    const bad = applyOverlay(draft, {
      parts: { '1': { kind: 'comparison', rows: [[[{ text: '原本に無い比較文。' }]]] } },
    })
    const r = verifyVerbatim(bad, doc)
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('原本に無い比較文。')
  })

  it('matrix に原本に無い文が混ざったら検査で落ちる', () => {
    const draft = buildSpreadDraft(doc, 'page-1')
    const bad = applyOverlay(draft, {
      parts: { '1': { kind: 'matrix', rows: [[[{ text: '原本に無いマトリクス文。' }]]] } },
    })
    const r = verifyVerbatim(bad, doc)
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('原本に無いマトリクス文。')
  })

  it('flow に原本に無い文が混ざったら検査で落ちる', () => {
    const draft = buildSpreadDraft(doc, 'page-1')
    const bad = applyOverlay(draft, {
      parts: { '1': { kind: 'flow', steps: [{ label: '1', inlines: [{ text: '原本に無い手順。' }] }] } },
    })
    const r = verifyVerbatim(bad, doc)
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('原本に無い手順。')
  })

  it('timeline に原本に無い文が混ざったら検査で落ちる', () => {
    const draft = buildSpreadDraft(doc, 'page-1')
    const bad = applyOverlay(draft, {
      parts: { '1': { kind: 'timeline', steps: [{ label: '1', inlines: [{ text: '原本に無い時系列の文。' }] }] } },
    })
    const r = verifyVerbatim(bad, doc)
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('原本に無い時系列の文。')
  })

  it('gonogo に原本に無い文が混ざったら検査で落ちる', () => {
    const draft = buildSpreadDraft(doc, 'page-1')
    const bad = applyOverlay(draft, {
      parts: { '1': { kind: 'gonogo', go: [[{ text: '原本に無いgoの文。' }]], noGo: [] } },
    })
    const r = verifyVerbatim(bad, doc)
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('原本に無いgoの文。')
  })
})

describe('sanitizeOverlay', () => {
  it('part の ReaderInline から href を落とす（text/bold等は残す）', () => {
    const overlay = {
      parts: {
        '1': {
          kind: 'comparison',
          rows: [[[{ text: 'デバイスより先に目標値を決める。', bold: true, href: 'https://example.com/fake' }]]],
        } satisfies SpreadPart,
      },
    }
    const sanitized = sanitizeOverlay(overlay)
    const part = sanitized.parts!['1']
    expect(part.kind).toBe('comparison')
    expect(part.kind === 'comparison' && part.rows[0][0][0]).toEqual({
      text: 'デバイスより先に目標値を決める。',
      bold: true,
    })
  })

  it('bignumber・flow・gonogo でも href を落とす', () => {
    const overlay = {
      parts: {
        a: { kind: 'bignumber', value: '94%', caption: [{ text: '説明。', href: 'https://x.example' }] } satisfies SpreadPart,
        b: { kind: 'flow', steps: [{ label: '1', inlines: [{ text: '手順。', href: 'https://x.example' }] }] } satisfies SpreadPart,
        c: { kind: 'gonogo', go: [[{ text: 'go。', href: 'https://x.example' }]], noGo: [[{ text: 'no-go。', href: 'https://x.example' }]] } satisfies SpreadPart,
      },
    }
    const sanitized = sanitizeOverlay(overlay)
    const a = sanitized.parts!.a
    const b = sanitized.parts!.b
    const c = sanitized.parts!.c
    expect(a.kind === 'bignumber' && a.caption[0].href).toBeUndefined()
    expect(b.kind === 'flow' && b.steps[0].inlines[0].href).toBeUndefined()
    expect(c.kind === 'gonogo' && c.go[0][0].href).toBeUndefined()
    expect(c.kind === 'gonogo' && c.noGo[0][0].href).toBeUndefined()
  })

  it('未知の kind は採用しない（そのアンカーの上書きごと落とす）', () => {
    const overlay = {
      parts: {
        '1': { kind: 'chart', data: [] } as unknown as SpreadPart,
        '2': { kind: 'none' } satisfies SpreadPart,
      },
    }
    const sanitized = sanitizeOverlay(overlay)
    expect(sanitized.parts).toEqual({ '2': { kind: 'none' } })
  })

  it('parts を持たないオーバレイはそのまま返す', () => {
    const overlay = { shortLabels: { '1': 'ラベル' } }
    expect(sanitizeOverlay(overlay)).toEqual(overlay)
  })

  it('classifyPart が原本から自動で作る part には触れない（overlay.parts に無ければ無傷）', () => {
    // 節2は原本の番号なし箇条書き1件なので classifyPart は 'none' を返す。
    // ここに overlay.parts でアンカー '2' を指定しなければ、sanitizeOverlay は
    // draft.sections[1].part に一切触れず、applyOverlay もそれをそのまま素通しする。
    const draft = buildSpreadDraft(doc, 'page-1')
    const overlay = sanitizeOverlay({ parts: { '1': { kind: 'none' } } })
    const merged = applyOverlay(draft, overlay)
    expect(merged.sections[1].part).toEqual(draft.sections[1].part)
  })
})

describe('visibleQuizzes', () => {
  const base = buildSpreadDraft(doc, 'page-1')
  const q = (over: Partial<SpreadQuiz>): SpreadQuiz => ({
    id: 'q1', sectionAnchor: '1', question: '？', choices: ['a', 'b'], answerIndex: 0,
    evidence: 'デバイスより先に目標値を決める。', reviewed: true, ...over,
  })

  it('目視済みで根拠が本文にあるものだけ出す', () => {
    const s = { ...base, quizzes: [q({})] }
    expect(visibleQuizzes(s, '1')).toHaveLength(1)
  })

  it('目視前は出さない', () => {
    const s = { ...base, quizzes: [q({ reviewed: false })] }
    expect(visibleQuizzes(s, '1')).toHaveLength(0)
  })

  it('根拠が本文に無くなったら出さない', () => {
    const s = { ...base, quizzes: [q({ evidence: '原本から消えた文。' })] }
    expect(visibleQuizzes(s, '1')).toHaveLength(0)
  })

  it('別の節の設問は出さない', () => {
    const s = { ...base, quizzes: [q({ sectionAnchor: '2' })] }
    expect(visibleQuizzes(s, '1')).toHaveLength(0)
  })

  it('根拠が空文字で目視済みでも出さない（"".includes("")はtrueになるため）', () => {
    const s = { ...base, quizzes: [q({ evidence: '' })] }
    expect(visibleQuizzes(s, '1')).toHaveLength(0)
  })

  it('根拠が空白とタブだけで目視済みでも出さない', () => {
    const s = { ...base, quizzes: [q({ evidence: '  \t\t  ' })] }
    expect(visibleQuizzes(s, '1')).toHaveLength(0)
  })
})

describe('sectionDisplay', () => {
  const rows = [[t('患者群'), t('目標')], [t('急性疾患の多く'), t('94〜98%')]]
  const table: ReaderBlock = { kind: 'table', rows }
  const bullet: ReaderBlock = { kind: 'list_item', ordered: false, inlines: t('目標に調整する。') }
  const recap: ReaderBlock = { kind: 'paragraph', inlines: t('→ 目標範囲を先に決める。') }
  const section = (deep: ReaderBlock[], part: SpreadPart) =>
    ({ n: 1, anchor: '1', title: '1. 節', shortLabel: null, part, deep })

  it('比較表の元テーブルと節末の→段落を深掘りから取り分ける', () => {
    const r = sectionDisplay(section([table, bullet, recap], { kind: 'comparison', rows }))
    expect(r.recap).toBe(recap)
    expect(r.deep).toEqual([bullet])
  })

  it('オーバレイ由来で中身の違う表なら深掘りの表は残す', () => {
    const other = [[t('別のヘッダ')], [t('別の中身')]]
    const r = sectionDisplay(section([table, bullet], { kind: 'comparison', rows: other }))
    expect(r.deep).toEqual([table, bullet])
  })

  it('→段落が無い節は recap 無しで深掘りが無傷', () => {
    const r = sectionDisplay(section([bullet], { kind: 'none' }))
    expect(r.recap).toBeNull()
    expect(r.deep).toEqual([bullet])
  })

  it('→段落が複数あれば末尾側の1つだけを recap にする', () => {
    const first: ReaderBlock = { kind: 'paragraph', inlines: t('→ 途中のまとめ。') }
    const r = sectionDisplay(section([first, bullet, recap], { kind: 'none' }))
    expect(r.recap).toBe(recap)
    expect(r.deep).toEqual([first, bullet])
  })

  it('保存形（section.deep）には触れない', () => {
    const deep = [table, bullet, recap]
    const s = section(deep, { kind: 'comparison', rows })
    sectionDisplay(s)
    expect(s.deep).toEqual([table, bullet, recap])
  })
})

describe('sectionSources', () => {
  it('深掘りのリンクラベルを登場順・重複なしで返す（calloutの中も見る）', () => {
    const deep: ReaderBlock[] = [
      { kind: 'list_item', ordered: false, inlines: [{ text: '94〜98%。' }, { text: 'BTS guideline 2017', href: 'https://example.com/bts' }] },
      { kind: 'list_item', ordered: false, inlines: [{ text: '88〜92%。' }, { text: 'BTS guideline 2017', href: 'https://example.com/bts' }] },
      { kind: 'callout', icon: '📚', color: null, blocks: [
        { kind: 'paragraph', inlines: [{ text: '野口 2024', href: 'https://example.com/noguchi' }] },
      ] },
    ]
    expect(sectionSources(deep)).toEqual(['BTS guideline 2017', '野口 2024'])
  })

  it('表の中のリンクは拾わない', () => {
    const deep: ReaderBlock[] = [
      { kind: 'table', rows: [[[{ text: 'EMJ 2021', href: 'https://example.com/emj' }]]] },
    ]
    expect(sectionSources(deep)).toEqual([])
  })
})

describe('gonogo のラベル（goLabel / noGoLabel）', () => {
  it('sanitizeOverlay を通してもラベルは残り、go/noGo の href だけ落ちる', () => {
    const part: SpreadPart = {
      kind: 'gonogo',
      goLabel: 'NIVを選ぶ',
      noGoLabel: '侵襲的人工呼吸への移行を判断する',
      go: [[{ text: 'pH 7.35以下はNIV。', href: 'https://example.com' }]],
      noGo: [[{ text: 'pH 7.15未満の持続。' }]],
    }
    const r = sanitizeOverlay({ parts: { '1': part } })
    const got = r.parts?.['1']
    expect(got?.kind).toBe('gonogo')
    if (got?.kind !== 'gonogo') throw new Error('unreachable')
    expect(got.goLabel).toBe('NIVを選ぶ')
    expect(got.noGoLabel).toBe('侵襲的人工呼吸への移行を判断する')
    expect(got.go[0][0]).toEqual({ text: 'pH 7.35以下はNIV。' })
  })

  it('ラベルは逐語一致検査の対象にしない（原本に無くてよい）', () => {
    const d: ReaderDoc = { ...doc, blocks: [doc.blocks[1], { kind: 'paragraph', inlines: t('挿管へ移行する。') }] }
    const draft = buildSpreadDraft(d, 'p1')
    const spread = applyOverlay(draft, { parts: { '1': {
      kind: 'gonogo', goLabel: '原本に無い呼び名', noGoLabel: 'これも呼び名',
      go: [t('挿管へ移行する。')], noGo: [],
    } } })
    expect(verifyVerbatim(spread, d).ok).toBe(true)
  })
})

describe('gauge（実測値の帯グラフ）', () => {
  const gauge: SpreadPart = {
    kind: 'gauge',
    title: '院内死亡率（呼び名）',
    items: [
      { value: '8.7%', label: [{ text: '88〜92%群' }] },
      { value: '17.1%', label: [{ text: '97〜100%群', href: 'https://example.com' }], warn: true },
    ],
  }

  it('sanitizeOverlay で label の href だけ落ち、value・warn・title は残る', () => {
    const r = sanitizeOverlay({ parts: { '1': gauge } })
    const got = r.parts?.['1']
    if (got?.kind !== 'gauge') throw new Error('unreachable')
    expect(got.title).toBe('院内死亡率（呼び名）')
    expect(got.items[1]).toEqual({ value: '17.1%', label: [{ text: '97〜100%群' }], warn: true })
  })

  it('value と label は逐語一致検査の対象、title は対象外', () => {
    const d: ReaderDoc = { ...doc, blocks: [doc.blocks[1], { kind: 'paragraph', inlines: t('院内死亡率が88〜92%群8.7%であった。') }] }
    const draft = buildSpreadDraft(d, 'p1')
    const ok = applyOverlay(draft, { parts: { '1': { kind: 'gauge', title: '原本に無い呼び名', items: [{ value: '8.7%', label: [{ text: '88〜92%群' }] }] } } })
    expect(verifyVerbatim(ok, d).ok).toBe(true)
    const bad = applyOverlay(draft, { parts: { '1': { kind: 'gauge', items: [{ value: '99.9%', label: [{ text: '88〜92%群' }] }] } } })
    const r = verifyVerbatim(bad, d)
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('99.9%')
  })
})

describe('extraParts（追加の表層部品）', () => {
  it('applyOverlay で節に付き、逐語一致検査は主役部品と同じ扱い', () => {
    const d: ReaderDoc = { ...doc, blocks: [doc.blocks[1], { kind: 'paragraph', inlines: t('死亡率は8.7%であった。') }] }
    const draft = buildSpreadDraft(d, 'p1')
    const good = applyOverlay(draft, { extraParts: { '1': [{ kind: 'gauge', items: [{ value: '8.7%', label: [{ text: '死亡率' }] }] }] } })
    expect(good.sections[0].extraParts).toHaveLength(1)
    expect(verifyVerbatim(good, d).ok).toBe(true)
    const bad = applyOverlay(draft, { extraParts: { '1': [{ kind: 'gauge', items: [{ value: '1.2%', label: [{ text: '原本に無い条件' }] }] }] } })
    expect(verifyVerbatim(bad, d).ok).toBe(false)
  })

  it('sanitizeOverlay は extraParts でも未知kindを捨て、hrefを落とす', () => {
    const r = sanitizeOverlay({ extraParts: { '1': [
      { kind: 'unknown' } as unknown as SpreadPart,
      { kind: 'bignumber', value: '15 L/分', caption: [{ text: 'リザーバーマスク', href: 'https://example.com' }] },
    ] } })
    expect(r.extraParts?.['1']).toEqual([{ kind: 'bignumber', value: '15 L/分', caption: [{ text: 'リザーバーマスク' }] }])
  })
})

describe('entries（いまの状況から探す）', () => {
  it('存在しない節を指す入口は applyOverlay で捨てる', () => {
    const draft = buildSpreadDraft(doc, 'p1')
    const r = applyOverlay(draft, { entries: [
      { label: 'SpO₂ 85%未満', anchor: '2' },
      { label: '存在しない節へ', anchor: '9' },
    ] })
    expect(r.entries).toEqual([{ label: 'SpO₂ 85%未満', anchor: '2' }])
  })

  it('sanitizeOverlay は label / anchor が空の入口を捨てる', () => {
    const r = sanitizeOverlay({ entries: [
      { label: '  ', anchor: '1' },
      { label: '入口', anchor: '' },
      { label: '入口', anchor: '1' },
    ] })
    expect(r.entries).toEqual([{ label: '入口', anchor: '1' }])
  })
})
