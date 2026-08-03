import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  digestItems,
  digestSections,
  getReaderViewMode,
  setReaderViewMode,
  READER_VIEW_MODE_KEY,
} from '../reader-digest'
import type { ReaderBlock } from '../reader-doc'

// window.localStorage モック（Node環境・personal-data.test.ts と同じ流儀）。
const store = new Map<string, string>()
const localStorageMock = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
}
vi.stubGlobal('window', { localStorage: localStorageMock })
vi.stubGlobal('localStorage', localStorageMock)

const t = (text: string) => [{ text }]

// 実物のナレッジと同じ並び: ⚡結論 → 番号つきH2の節（本文・recap・図解）→ 末尾の署名・スタンプ。
const blocks: ReaderBlock[] = [
  /* 0 */ { kind: 'callout', icon: '⚡', color: 'yellow_background', blocks: [{ kind: 'paragraph', inlines: t('結論：穿刺が第一選択。') }] },
  /* 1 */ { kind: 'heading', level: 2, inlines: t('1. なぜ迷うのか') },
  /* 2 */ { kind: 'paragraph', inlines: t('本文の段落。要点には出ない。') },
  /* 3 */ { kind: 'list_item', ordered: false, inlines: t('箇条書きも出ない。') },
  /* 4 */ { kind: 'paragraph', inlines: t('→だから、まず病因をエコーで確認する。') },
  /* 5 */ { kind: 'heading', level: 2, inlines: t('2. 病因別の使い分け') },
  /* 6 */ { kind: 'table', rows: [[t('表'), t('も'), t('出ない')]] },
  /* 7 */ { kind: 'image', url: 'https://example.test/figure.png', caption: '病因別の使い分け' },
  /* 8 */ { kind: 'callout', icon: '🧑‍⚕️', color: 'green_background', blocks: [{ kind: 'paragraph', inlines: t('集中治療医の実践。') }] },
  /* 9 */ { kind: 'callout', icon: '🤖', color: null, blocks: [{ kind: 'paragraph', inlines: t('2026年8月査読済み。') }] },
]

describe('digestItems', () => {
  it('⚡結論・H2見出し・recapを document 順に残す', () => {
    const kinds = digestItems(blocks.slice(0, 7)).map((p) => p.block.kind)
    expect(kinds).toEqual(['callout', 'heading', 'paragraph', 'heading'])
  })

  it('index は元の blocks 配列の位置を保持する（アンカー計算との一致）', () => {
    const headings = digestItems(blocks).filter((p) => p.block.kind === 'heading')
    expect(headings.map((p) => p.index)).toEqual([1, 5])
  })

  it('本文中の画像を拾う（図解は要点でも見せる）', () => {
    const images = digestItems(blocks).filter((p) => p.block.kind === 'image')
    expect(images.map((p) => p.index)).toEqual([7])
  })

  it('署名・査読スタンプ・免責の callout を拾う', () => {
    const withDisclaimer: ReaderBlock[] = [
      ...blocks,
      { kind: 'callout', icon: '⚠️', color: null, blocks: [{ kind: 'paragraph', inlines: t('免責。') }] },
    ]
    const icons = digestItems(withDisclaimer)
      .filter((p) => p.block.kind === 'callout')
      .map((p) => (p.block.kind === 'callout' ? p.block.icon : null))
    expect(icons).toEqual(['⚡', '🧑‍⚕️', '🤖', '⚠️'])
  })

  it('役割のない callout・表・通常段落・箇条書きは拾わない', () => {
    const plain: ReaderBlock[] = [
      { kind: 'callout', icon: '🍀', color: null, blocks: [{ kind: 'paragraph', inlines: t('ただの補足。') }] },
      { kind: 'paragraph', inlines: t('通常の段落。') },
      { kind: 'list_item', ordered: false, inlines: t('箇条書き。') },
      { kind: 'table', rows: [[t('表')]] },
    ]
    expect(digestItems(plain)).toEqual([])
  })
})

describe('digestSections', () => {
  it('最初のH2より前を preamble に置く', () => {
    const { preamble } = digestSections(blocks)
    expect(preamble.map((p) => p.index)).toEqual([0])
  })

  it('節の展開範囲は次のH2の手前で切れる', () => {
    const { sections } = digestSections(blocks)
    expect(sections.map((s) => [s.anchor, s.start, s.end])).toEqual([
      ['1', 1, 5],
      ['2', 5, 8],
    ])
  })

  it('末尾の署名・スタンプを epilogue に分離し、最終節の範囲へ含めない', () => {
    const { sections, epilogue } = digestSections(blocks)
    expect(sections[sections.length - 1].end).toBe(8)
    expect(epilogue.map((b) => (b.kind === 'callout' ? b.icon : b.kind))).toEqual(['🧑‍⚕️', '🤖'])
  })

  it('節の items には見出しと、その節の recap・画像が入る', () => {
    const { sections } = digestSections(blocks)
    expect(sections[0].items.map((p) => p.block.kind)).toEqual(['heading', 'paragraph'])
    expect(sections[1].items.map((p) => p.block.kind)).toEqual(['heading', 'image'])
  })

  it('H2が無い文書では sections が空で、要点は preamble に全部入る', () => {
    const noHeading: ReaderBlock[] = [blocks[0], { kind: 'paragraph', inlines: t('→だから、こうする。') }]
    const { preamble, sections, epilogue } = digestSections(noHeading)
    expect(sections).toEqual([])
    expect(epilogue).toEqual([])
    expect(preamble).toHaveLength(2)
  })

  it('末尾に📚Evidenceが挟まっても、署名を最終節に取り残さない', () => {
    const withEvidence: ReaderBlock[] = [
      ...blocks.slice(0, 9), // …図解・署名まで
      { kind: 'callout', icon: '📚', color: 'blue_background', blocks: [{ kind: 'paragraph', inlines: t('Evidence: SSC 2026') }] },
      blocks[9], // 🤖査読スタンプ
    ]
    const { sections, epilogue } = digestSections(withEvidence)
    expect(sections[sections.length - 1].end).toBe(8)
    expect(epilogue.map((b) => (b.kind === 'callout' ? b.icon : b.kind))).toEqual(['🧑‍⚕️', '📚', '🤖'])
  })

  it('署名などが無い文書では epilogue は空で、最終節が末尾まで伸びる', () => {
    const noTail = blocks.slice(0, 8)
    const { sections, epilogue } = digestSections(noTail)
    expect(epilogue).toEqual([])
    expect(sections[sections.length - 1].end).toBe(8)
  })
})

describe('view mode の保存', () => {
  beforeEach(() => store.clear())

  it('未保存・不正値は全文に倒す', () => {
    expect(getReaderViewMode()).toBe('full')
    store.set(READER_VIEW_MODE_KEY, 'summary')
    expect(getReaderViewMode()).toBe('full')
  })

  it('保存した値を読み戻せる', () => {
    setReaderViewMode('digest')
    expect(getReaderViewMode()).toBe('digest')
  })
})
