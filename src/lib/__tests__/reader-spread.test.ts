import { describe, it, expect } from 'vitest'
import { splitSections, classifyPart, buildSpreadDraft, applyOverlay, compressReferenceItems, digestTone, dropPubmedExamples, displayPreface, displayTail, reviewedDateOf, sanitizeOverlay, sectionDisplay, sectionSources, sectionTitleText, splitDigest, splitStampScope, splitTailBlocks, textOf, verifyVerbatim, visibleQuizzes } from '../reader-spread'
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

describe('splitSections: 節より後ろの level 1 見出し（# Evidence 以降）', () => {
  // 実物のサブスク本文の並び。`# Evidence` は level 1 で、📚callout の下に参考文献の
  // 箇条書きと PubMed検索例が続く。level 2 の節ではないので、対処しないと最後の節に飲み込まれる。
  const d: ReaderDoc = {
    title: 'T', icon: null, cover: null, lastEdited: null,
    blocks: [
      /* 0 */ { kind: 'heading', level: 1, inlines: t('Question') },
      /* 1 */ { kind: 'paragraph', inlines: t('酸素はどう使い分ける？') },
      /* 2 */ { kind: 'heading', level: 2, inlines: t('1. 目標SpO2から決める') },
      /* 3 */ { kind: 'list_item', ordered: false, inlines: t('94〜98%を目標にする。') },
      /* 4 */ { kind: 'heading', level: 1, inlines: t('Evidence') },
      /* 5 */ { kind: 'callout', icon: '📚', color: null, blocks: [{ kind: 'paragraph', inlines: t('まず当たるべき文献・ガイドライン') }] },
      /* 6 */ { kind: 'list_item', ordered: false, inlines: t('BTS guideline 2017 — 中核ガイドライン') },
      /* 7 */ { kind: 'paragraph', inlines: t('PubMed検索キーワード例') },
      /* 8 */ { kind: 'callout', icon: '⚠️', color: null, blocks: [{ kind: 'paragraph', inlines: t('本ページは学習用の情報です。') }] },
    ],
  }

  it('参考文献の箇条書きと PubMed検索例が節の深掘りに飲み込まれない', () => {
    const r = splitSections(d)
    expect(r.sections).toHaveLength(1)
    expect(r.sections[0].blocks).toEqual([d.blocks[3]])
    expect(r.tail).toContain(d.blocks[6])
    expect(r.tail).toContain(d.blocks[7])
  })

  it('`# Evidence` 見出し自体も記事末に出す（文献一覧の見出しが消えない）', () => {
    const r = splitSections(d)
    expect(r.tail).toContain(d.blocks[4])
  })

  it('節より前の level 1 見出し（# Question）は従来どおり preface に残る', () => {
    const r = splitSections(d)
    expect(r.preface).toEqual([d.blocks[0], d.blocks[1]])
  })
})

describe('誌面の編集ルール（パイロット準拠の表示整形）', () => {
  it('displayPreface: 構造見出しとタイトル重複段落を除き、他は残す', () => {
    const preface: ReaderBlock[] = [
      { kind: 'heading', level: 1, inlines: t('Question') },
      { kind: 'paragraph', inlines: t('酸素療法はどのように使い分ける？') },
      { kind: 'heading', level: 1, inlines: t('Answer') },
      { kind: 'paragraph', inlines: t('導入の段落は残る。') },
    ]
    const r = displayPreface(preface, '💡 酸素療法はどのように使い分ける？')
    expect(r).toEqual([preface[3]])
  })

  it('splitStampScope: 🤖スタンプから但し書きだけ取り出し、【査読済み】行と区切り線は出さない', () => {
    const stamp: ReaderBlock = { kind: 'callout', icon: '🤖', color: 'yellow_background', blocks: [
      { kind: 'paragraph', inlines: t('【査読済み】 本ページの内容は検証済みです。') },
      { kind: 'divider' },
      { kind: 'paragraph', inlines: t('以下は成人・非挿管の急性期を想定した内容です。') },
    ] }
    const sig: ReaderBlock = { kind: 'callout', icon: '🧑‍⚕️', color: null, blocks: [] }
    const { scope, rest } = splitStampScope([sig, stamp])
    expect(scope).toEqual([stamp.kind === 'callout' ? stamp.blocks[2] : null])
    expect(rest).toEqual([sig])
  })

  it('dropPubmedExamples: 段落と直後の箇条書きだけ落とし、その先のブロックは残す', () => {
    const tail: ReaderBlock[] = [
      { kind: 'paragraph', inlines: t('PubMed検索キーワード例') },
      { kind: 'list_item', ordered: false, inlines: t('oxygen therapy target saturation') },
      { kind: 'list_item', ordered: false, inlines: t('hfnc guideline') },
      { kind: 'callout', icon: '⚠️', color: null, blocks: [] },
    ]
    expect(dropPubmedExamples(tail)).toEqual([tail[3]])
  })

  it('sectionTitleText: 番号つき節は「1. 」を落とし、番号なし節はそのまま', () => {
    expect(sectionTitleText({ n: 1, title: '1. 最初に決めるのは目標SpO2である' })).toBe('最初に決めるのは目標SpO2である')
    expect(sectionTitleText({ n: null, title: 'まとめ' })).toBe('まとめ')
  })

  it('displayTail: スタンプ・構造見出し・PubMed例をまとめて整形する', () => {
    const tail: ReaderBlock[] = [
      { kind: 'callout', icon: '🤖', color: null, blocks: [{ kind: 'paragraph', inlines: t('【査読済み】検証済み。') }, { kind: 'paragraph', inlines: t('対象範囲の但し書き。') }] },
      { kind: 'heading', level: 1, inlines: t('Evidence') },
      { kind: 'callout', icon: '📚', color: null, blocks: [] },
      { kind: 'paragraph', inlines: t('PubMed検索キーワード例') },
      { kind: 'list_item', ordered: false, inlines: t('query') },
      { kind: 'callout', icon: '⚠️', color: null, blocks: [] },
    ]
    const { scope, rest } = displayTail(tail)
    expect(scope.map((b) => b.kind)).toEqual(['paragraph'])
    expect(rest.map((b) => (b.kind === 'callout' ? b.icon : b.kind))).toEqual(['📚', '⚠️'])
  })
})

describe('flow の intro と note（パイロット誌面のフロー部品）', () => {
  const flowDoc: ReaderDoc = {
    title: 'x', icon: null, cover: null, lastEdited: null,
    blocks: [
      { kind: 'heading', level: 2, inlines: t('2. 鼻カニューレで開始する') },
      { kind: 'list_item', ordered: false, inlines: t('高CO₂血症リスクなしで SpO₂ 85%以上のとき。') },
      { kind: 'list_item', ordered: false, inlines: t('鼻カニューレ2〜6 L/分で開始する。') },
      { kind: 'list_item', ordered: false, inlines: t('6 L/分が上限。回復期は2 L/分まで下げてから中止する。') },
    ],
  }
  const flow: SpreadPart = {
    kind: 'flow',
    intro: t('高CO₂血症リスクなしで SpO₂ 85%以上'),
    steps: [{ label: '開始', inlines: t('鼻カニューレ2〜6 L/分'), note: t('6 L/分が上限。回復期は2 L/分まで下げてから中止する。') }],
  }

  it('intro と note も逐語一致検査の対象（原本の逐語なら通る）', () => {
    const draft = buildSpreadDraft(flowDoc, 'p')
    const good = applyOverlay(draft, { parts: { '2': flow } })
    expect(verifyVerbatim(good, flowDoc)).toEqual({ ok: true, missing: [] })
  })

  it('intro が原本に無い文なら検査で落ちる', () => {
    const draft = buildSpreadDraft(flowDoc, 'p')
    const bad = applyOverlay(draft, { parts: { '2': { ...flow, intro: t('原本に無い導入文') } } })
    const r = verifyVerbatim(bad, flowDoc)
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('原本に無い導入文')
  })

  it('note が原本に無い文なら検査で落ちる', () => {
    const draft = buildSpreadDraft(flowDoc, 'p')
    const bad = applyOverlay(draft, {
      parts: { '2': { kind: 'flow', steps: [{ label: '開始', inlines: t('鼻カニューレ2〜6 L/分'), note: t('原本に無い補足') }] } },
    })
    const r = verifyVerbatim(bad, flowDoc)
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('原本に無い補足')
  })

  it('sanitizeOverlay は intro / note の href も落とす', () => {
    const withHref: SpreadPart = {
      kind: 'flow',
      intro: [{ text: '導入', href: 'https://x.test' }],
      steps: [{ label: 'a', inlines: [{ text: '本文', href: 'https://x.test' }], note: [{ text: '補足', href: 'https://x.test' }] }],
    }
    const out = sanitizeOverlay({ parts: { '1': withHref } })
    const p = out.parts?.['1']
    if (p?.kind !== 'flow') throw new Error('unreachable')
    expect(p.intro).toEqual([{ text: '導入' }])
    expect(p.steps[0].inlines).toEqual([{ text: '本文' }])
    expect(p.steps[0].note).toEqual([{ text: '補足' }])
  })
})

describe('cards（2枚組の比較カード）と note（表層の補足ノート）', () => {
  const cardDoc: ReaderDoc = {
    title: 'x', icon: null, cover: null, lastEdited: null,
    blocks: [
      { kind: 'heading', level: 2, inlines: t('5. HFNCを検討する') },
      { kind: 'table', rows: [
        [t(''), t('通常酸素療法（COT）'), t('HFNC')],
        [t('流量'), t('吸気需要に届かない'), t('50〜60 L/分まで送気できる')],
      ] },
      { kind: 'list_item', ordered: false, inlines: t('高流量か低流量かの線引きは1回換気量以上のガスを供給できるかである。') },
    ],
  }
  const cards: SpreadPart = {
    kind: 'cards',
    cards: [
      { title: '通常酸素療法（COT）', lines: [t('吸気需要に届かない')] },
      { title: 'HFNC', lines: [t('50〜60 L/分まで送気できる')] },
    ],
  }

  it('cards の行は逐語一致検査の対象、title は命名なので対象外', () => {
    const draft = buildSpreadDraft(cardDoc, 'p')
    const good = applyOverlay(draft, { parts: { '5': { ...cards, cards: [{ title: '原本に無い呼び名', lines: [t('吸気需要に届かない')] }] } } })
    expect(verifyVerbatim(good, cardDoc)).toEqual({ ok: true, missing: [] })
    const bad = applyOverlay(draft, { parts: { '5': { kind: 'cards', cards: [{ title: 'COT', lines: [t('原本に無い行')] }] } } })
    expect(verifyVerbatim(bad, cardDoc).missing).toContain('原本に無い行')
  })

  it('note の inlines は逐語一致検査の対象', () => {
    const draft = buildSpreadDraft(cardDoc, 'p')
    const good = applyOverlay(draft, { extraParts: { '5': [{ kind: 'note', inlines: t('高流量か低流量かの線引きは1回換気量以上のガスを供給できるかである。') }] } })
    expect(verifyVerbatim(good, cardDoc)).toEqual({ ok: true, missing: [] })
    const bad = applyOverlay(draft, { extraParts: { '5': [{ kind: 'note', inlines: t('原本に無いノート') }] } })
    expect(verifyVerbatim(bad, cardDoc).missing).toContain('原本に無いノート')
  })

  it('sanitizeOverlay は cards / note を既知kindとして受け入れ、href だけ落とす', () => {
    const out = sanitizeOverlay({
      parts: { '5': { kind: 'cards', cards: [{ title: 'COT', lines: [[{ text: 'a', href: 'https://x.test' }]] }] } },
      extraParts: { '5': [{ kind: 'note', inlines: [{ text: 'n', href: 'https://x.test' }] }] },
    })
    const p = out.parts?.['5']
    if (p?.kind !== 'cards') throw new Error('unreachable')
    expect(p.cards[0].lines[0]).toEqual([{ text: 'a' }])
    const ex = out.extraParts?.['5']?.[0]
    if (ex?.kind !== 'note') throw new Error('unreachable')
    expect(ex.inlines).toEqual([{ text: 'n' }])
  })

  it('sectionDisplay: cards の行が全て載っている表は深掘りから除く（表層への昇格）', () => {
    const draft = buildSpreadDraft(cardDoc, 'p')
    const merged = applyOverlay(draft, { parts: { '5': cards } })
    const { deep } = sectionDisplay(merged.sections[0])
    expect(deep.some((b) => b.kind === 'table')).toBe(false)
    expect(deep.some((b) => b.kind === 'list_item')).toBe(true)
  })

  it('sectionDisplay: cards の行が表に無いときは表を残す', () => {
    const draft = buildSpreadDraft(cardDoc, 'p')
    const merged = applyOverlay(draft, {
      parts: { '5': { kind: 'cards', cards: [{ title: 'COT', lines: [t('高流量か低流量かの線引きは1回換気量以上のガスを供給できるかである。')] }] } },
    })
    const { deep } = sectionDisplay(merged.sections[0])
    expect(deep.some((b) => b.kind === 'table')).toBe(true)
  })
})

describe('誌面の編集ルール（凡例段落・参考文献の圧縮・要点ボックス）', () => {
  it('sectionDisplay: 凡例段落（確信度の見方）と末尾の区切り線は深掘りに出さない', () => {
    const d: ReaderDoc = {
      title: 'x', icon: null, cover: null, lastEdited: null,
      blocks: [
        { kind: 'heading', level: 2, inlines: t('6. まとめ') },
        { kind: 'list_item', ordered: false, inlines: t('本文の行。') },
        { kind: 'divider' },
        { kind: 'paragraph', inlines: [{ text: '確信度の見方：', bold: true }, { text: ' ✅ 確立／⚠️ 諸説あり' }] },
        { kind: 'divider' },
      ],
    }
    const draft = buildSpreadDraft(d, 'p')
    const { deep } = sectionDisplay(draft.sections[0])
    expect(deep).toEqual([{ kind: 'list_item', ordered: false, inlines: t('本文の行。') }])
  })

  it('displayTail: 参考文献の箇条書きから「引用：」以降（引用文と本文リンク）を出さない', () => {
    const tail: ReaderBlock[] = [
      { kind: 'callout', icon: '📚', color: null, blocks: [] },
      { kind: 'list_item', ordered: false, inlines: [
        { text: 'BTS Guideline（2017） ', bold: true },
        { text: '中核ガイドライン。引用：“The recommended target …” ' },
        { text: '本文', href: 'https://x.test' },
      ] },
      { kind: 'list_item', ordered: false, inlines: t('引用を含まない行はそのまま。') },
    ]
    const { rest } = displayTail(tail)
    const items = rest.filter((b) => b.kind === 'list_item')
    expect(textOf(items[0].kind === 'list_item' ? items[0].inlines : [])).toBe('BTS Guideline（2017） 中核ガイドライン。')
    expect(items[1]).toEqual(tail[2])
  })

  it('splitDigest: 見出しラベル・本文・査読済み行（foot）に分ける（区切り線は出さない）', () => {
    const lead: ReaderBlock = { kind: 'callout', icon: '⚡', color: 'yellow_background', blocks: [
      { kind: 'paragraph', inlines: [{ text: 'この問いへの答え', bold: true }] },
      { kind: 'list_item', ordered: false, inlines: t('要点1。') },
      { kind: 'list_item', ordered: false, inlines: t('要点2。') },
      { kind: 'divider' },
      { kind: 'paragraph', inlines: [{ text: '査読済み：2026-08', bold: true }, { text: ' 主要根拠：BTS 2017' }] },
    ] }
    const r = splitDigest(lead)
    // 見出し帯は誌面の呼び名に置き換わる（パイロット準拠）
    expect(r.heading).toBe('この記事の要点')
    expect(r.body.map((b) => textOf(b.kind === 'list_item' ? b.inlines : []))).toEqual(['要点1。', '要点2。'])
    expect(r.foot.map((b) => b.kind)).toEqual(['paragraph'])
  })

  it('splitDigest: 箇条書きの間の段落は並べ替えず body に原本の順序のまま残す', () => {
    const lead: ReaderBlock = { kind: 'callout', icon: '⚡', color: null, blocks: [
      { kind: 'paragraph', inlines: t('この記事の要点') },
      { kind: 'list_item', ordered: false, inlines: t('要点1。') },
      { kind: 'paragraph', inlines: t('補足の段落。') },
      { kind: 'list_item', ordered: false, inlines: t('要点2。') },
    ] }
    const r = splitDigest(lead)
    expect(r.body.map((b) => (b.kind === 'list_item' ? 'li' : b.kind))).toEqual(['li', 'paragraph', 'li'])
    expect(r.foot).toEqual([])
  })

  it('splitDigest: 先頭段落が既知ラベルでなければ見出しに吸わず body に残す（結論文を平文化しない）', () => {
    const lead: ReaderBlock = { kind: 'callout', icon: '⚡', color: null, blocks: [
      { kind: 'paragraph', inlines: t('目標SpO₂から決める。') },
      { kind: 'list_item', ordered: false, inlines: t('要点1。') },
    ] }
    const r = splitDigest(lead)
    expect(r.heading).toBeNull()
    expect(r.body).toHaveLength(2)
    expect(r.body[0]).toBe(lead.kind === 'callout' ? lead.blocks[0] : null)
  })

  it('splitDigest: lead が無い・callout でないときは空を返す', () => {
    expect(splitDigest(null)).toEqual({ heading: null, body: [], foot: [] })
    expect(splitDigest({ kind: 'paragraph', inlines: t('x') })).toEqual({ heading: null, body: [], foot: [] })
  })

  it('digestTone: 蛍光マーカー（_background）だけ落とし、太字と文字色は残す', () => {
    const blocks: ReaderBlock[] = [
      { kind: 'list_item', ordered: false, inlines: [
        { text: '94〜98%', bold: true, color: 'red_background' },
        { text: 'を目標とする', color: 'red' },
      ] },
    ]
    const r = digestTone(blocks)
    expect(r[0].kind === 'list_item' && r[0].inlines).toEqual([
      { text: '94〜98%', bold: true },
      { text: 'を目標とする', color: 'red' },
    ])
    // 元の配列には触れない（表示専用の導出）
    expect(blocks[0].kind === 'list_item' && blocks[0].inlines[0].color).toBe('red_background')
  })

  it('reviewedDateOf: ⚡ボックスの査読済み行から年月を取り出し、書式ゆらぎは正規化する', () => {
    const withDate = (text: string): ReaderBlock => ({ kind: 'callout', icon: '⚡', color: null, blocks: [
      { kind: 'paragraph', inlines: t('この記事の要点') },
      { kind: 'paragraph', inlines: [{ text, bold: true }, { text: ' 主要根拠：BTS 2017' }] },
    ] })
    expect(reviewedDateOf(withDate('査読済み：2026-08'))).toBe('2026-08')
    expect(reviewedDateOf(withDate('査読済み：2026/8'))).toBe('2026-08')
    expect(reviewedDateOf(withDate('査読済み: 2026年8月'))).toBe('2026-08')
    expect(reviewedDateOf(null)).toBeNull()
    expect(reviewedDateOf({ kind: 'callout', icon: '⚡', color: null, blocks: [{ kind: 'paragraph', inlines: t('要点だけ') }] })).toBeNull()
  })

  it('sectionDisplay: cards に載っていない本文セルが残る表は除かない（内容の欠落を防ぐ）', () => {
    const d: ReaderDoc = {
      title: 'x', icon: null, cover: null, lastEdited: null,
      blocks: [
        { kind: 'heading', level: 2, inlines: t('5. HFNCを検討する') },
        { kind: 'table', rows: [
          [t(''), t('COT'), t('HFNC')],
          [t('流量'), t('吸気需要に届かない'), t('50〜60 L/分まで送気できる')],
          [t('禁忌'), t('特になし'), t('鼻閉では使えない')],
        ] },
      ],
    }
    const draft = buildSpreadDraft(d, 'p')
    const merged = applyOverlay(draft, {
      parts: { '5': { kind: 'cards', cards: [
        { title: 'COT', lines: [t('吸気需要に届かない')] },
        { title: 'HFNC', lines: [t('50〜60 L/分まで送気できる')] },
      ] } },
    })
    // 禁忌行（特になし・鼻閉では使えない）がカードに無いので、表は深掘りに残る
    const { deep } = sectionDisplay(merged.sections[0])
    expect(deep.some((b) => b.kind === 'table')).toBe(true)
  })

  it('compressReferenceItems: 📚calloutより前の箇条書きには触れない（免責等の誤爆防止）', () => {
    const blocks: ReaderBlock[] = [
      { kind: 'list_item', ordered: false, inlines: t('本文の注記。引用：の語を含んでも触らない。') },
      { kind: 'callout', icon: '📚', color: null, blocks: [] },
      { kind: 'list_item', ordered: false, inlines: t('文献。引用：“quote”') },
    ]
    const r = compressReferenceItems(blocks)
    expect(r[0]).toBe(blocks[0])
    expect(textOf(r[2].kind === 'list_item' ? r[2].inlines : [])).toBe('文献。')
  })

  it('compressReferenceItems: 「引用」と「：」がインラインの境目で割れていても切れる', () => {
    const blocks: ReaderBlock[] = [
      { kind: 'callout', icon: '📚', color: null, blocks: [] },
      { kind: 'list_item', ordered: false, inlines: [
        { text: 'タイトル — 解説。' },
        { text: '引用', bold: true },
        { text: '：“quote” ' },
        { text: '本文', href: 'https://x.test' },
      ] },
    ]
    const r = compressReferenceItems(blocks)
    expect(textOf(r[1].kind === 'list_item' ? r[1].inlines : [])).toBe('タイトル — 解説。')
  })

  it('compressReferenceItems: 引用だけの行は空ブロックを残さず出さない', () => {
    const blocks: ReaderBlock[] = [
      { kind: 'callout', icon: '📚', color: null, blocks: [] },
      { kind: 'list_item', ordered: false, inlines: t('引用：“quote only”') },
      { kind: 'list_item', ordered: false, inlines: t('残る行。') },
    ]
    const r = compressReferenceItems(blocks)
    expect(r.map((b) => (b.kind === 'list_item' ? textOf(b.inlines) : b.kind))).toEqual(['callout', '残る行。'])
  })
})

describe('splitTailBlocks（記事末尾を実践・文献・免責の口に分ける）', () => {
  const practice: ReaderBlock = { kind: 'callout', icon: '🧑‍⚕️', color: null, blocks: [
    { kind: 'paragraph', inlines: t('集中治療医の実践') },
    { kind: 'paragraph', inlines: t('吸気努力を見極めて処方する。') },
    { kind: 'paragraph', inlines: t('※筆者の実践です。') },
  ] }
  const refsHead: ReaderBlock = { kind: 'callout', icon: '📚', color: null, blocks: [
    { kind: 'paragraph', inlines: t('まず当たるべき文献・ガイドライン') },
  ] }
  const ref1: ReaderBlock = { kind: 'list_item', ordered: false, inlines: t('BTS Guideline（2017）') }
  const ref2: ReaderBlock = { kind: 'list_item', ordered: false, inlines: t('ERS/ATS guidelines（2017）') }
  const disclaimer: ReaderBlock = { kind: 'callout', icon: '⚠️', color: null, blocks: [
    { kind: 'paragraph', inlines: t('本ページは学習用の情報です。') },
  ] }

  it('署名・文献・免責をそれぞれの口に入れ、文献の箇条書きは refsItems に集める', () => {
    const r = splitTailBlocks([practice, refsHead, ref1, ref2, disclaimer])
    expect(r.practice).toBe(practice)
    expect(r.refsHead).toBe(refsHead)
    expect(r.refsItems).toEqual([ref1, ref2])
    // 免責は callout そのものではなく中身（枠は誌面が自前で組む）
    expect(r.disclaimer).toEqual(disclaimer.kind === 'callout' ? disclaimer.blocks : [])
    expect(r.rest).toEqual([])
  })

  it('分類できないブロックは黙って捨てず rest に残す', () => {
    const para: ReaderBlock = { kind: 'paragraph', inlines: t('末尾の普通の段落。') }
    const note: ReaderBlock = { kind: 'callout', icon: '📝', color: null, blocks: [] }
    const r = splitTailBlocks([para, practice, note])
    expect(r.rest).toEqual([para, note])
    expect(r.practice).toBe(practice)
  })

  it('文献の callout が無いときは refsItems が空で、箇条書きは rest に残る', () => {
    const r = splitTailBlocks([ref1, ref2])
    expect(r.refsHead).toBeNull()
    expect(r.refsItems).toEqual([])
    expect(r.rest).toEqual([ref1, ref2])
  })

  it('同じ役割の callout が2つあるときは最初だけ採り、2つ目は rest に残す', () => {
    const practice2: ReaderBlock = { kind: 'callout', icon: '🧑‍⚕️', color: null, blocks: [
      { kind: 'paragraph', inlines: t('2つ目の署名。') },
    ] }
    const disclaimer2: ReaderBlock = { kind: 'callout', icon: '⚠️', color: null, blocks: [
      { kind: 'paragraph', inlines: t('2つ目の免責。') },
    ] }
    const refsHead2: ReaderBlock = { kind: 'callout', icon: '📚', color: null, blocks: [] }
    const r = splitTailBlocks([practice, practice2, refsHead, refsHead2, disclaimer, disclaimer2])
    expect(r.practice).toBe(practice)
    expect(r.refsHead).toBe(refsHead)
    expect(r.disclaimer).toEqual(disclaimer.kind === 'callout' ? disclaimer.blocks : [])
    expect(r.rest).toEqual([practice2, refsHead2, disclaimer2])
  })

  it('免責の callout をまたいだ後ろの箇条書きも refsItems に入る', () => {
    // 範囲の取り方は compressReferenceItems と同じで、文献の callout より後ろの箇条書きは
    // 間に別の callout が挟まっても文献の一覧として扱う。いまの挙動を固定する。
    const ref3: ReaderBlock = { kind: 'list_item', ordered: false, inlines: t('BTS/ICS guideline（2016）') }
    const r = splitTailBlocks([refsHead, ref1, disclaimer, ref3])
    expect(r.refsItems).toEqual([ref1, ref3])
    expect(r.rest).toEqual([])
  })
})

describe('refs（参考文献の圧縮行）', () => {
  // 圧縮行は原本に無く、非公開の誌面ノートにだけ置く（原本は公開リンクで読者に見えるため）。
  // ノート側は1行1文献の箇条書きで、その1行の中に title / source / note がそのまま含まれる。
  const notes: ReaderBlock[] = [
    { kind: 'list_item', ordered: false, inlines: t('BTS Guideline for oxygen use in adults｜BMJ Open Respir Res 2017｜成人急性期の目標SpO2とデバイス選択の中核ガイドライン') },
    { kind: 'list_item', ordered: false, inlines: t('出典の略記が無い文献') },
  ]
  const ref = {
    title: 'BTS Guideline for oxygen use in adults',
    source: 'BMJ Open Respir Res 2017',
    note: '成人急性期の目標SpO2とデバイス選択の中核ガイドライン',
  }

  it('applyOverlay が refs を載せ、本文（lead / preface / deep / tail）には触れない', () => {
    const draft = buildSpreadDraft(doc, 'page-1')
    const merged = applyOverlay(draft, { refs: [ref] })
    expect(merged.refs).toEqual([ref])
    expect(merged.lead).toBe(draft.lead)
    expect(merged.preface).toBe(draft.preface)
    expect(merged.tail).toBe(draft.tail)
    expect(merged.sections[0].deep).toEqual(draft.sections[0].deep)
  })

  it('refs を渡さなければ refs は立たない（原本の箇条書きで出す fail-safe）', () => {
    const draft = buildSpreadDraft(doc, 'page-1')
    expect(draft.refs).toBeUndefined()
    expect(applyOverlay(draft, {}).refs).toBeUndefined()
  })

  it('sanitizeOverlay は title が空白だけの行を捨て、source / note の空は通す', () => {
    const r = sanitizeOverlay({ refs: [
      { title: '  ', source: 'Thorax 2016', note: 'NIVの適応・禁忌' },
      { title: '出典の略記が無い文献', source: '', note: '' },
    ] })
    expect(r.refs).toEqual([{ title: '出典の略記が無い文献', source: '', note: '' }])
  })

  it('title / source / note は逐語一致検査の対象で、誌面ノートにあれば通る', () => {
    const draft = buildSpreadDraft(doc, 'page-1')
    const good = applyOverlay(draft, { refs: [ref] })
    expect(verifyVerbatim(good, doc, notes).ok).toBe(true)
    // ノートを渡さなければ原本だけで検査する（従来どおり fail-closed）
    expect(verifyVerbatim(good, doc).ok).toBe(false)
  })

  it('ノートにも原本にも無い note を持つ refs は検査で落ちる', () => {
    const draft = buildSpreadDraft(doc, 'page-1')
    const bad = applyOverlay(draft, { refs: [{ ...ref, note: '誰も書いていない一行説明' }] })
    const r = verifyVerbatim(bad, doc, notes)
    expect(r.ok).toBe(false)
    expect(r.missing).toContain('誰も書いていない一行説明')
  })

  it('source / note が空の行は検査に掛からない（既存の trim + filter で落ちる）', () => {
    const draft = buildSpreadDraft(doc, 'page-1')
    const merged = applyOverlay(draft, { refs: [{ title: '出典の略記が無い文献', source: '', note: '' }] })
    expect(verifyVerbatim(merged, doc, notes)).toEqual({ ok: true, missing: [] })
  })
})
