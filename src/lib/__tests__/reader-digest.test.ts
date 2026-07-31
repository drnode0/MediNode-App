import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  digestItems,
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

const blocks: ReaderBlock[] = [
  { kind: 'callout', icon: '⚡', color: 'yellow_background', blocks: [{ kind: 'paragraph', inlines: t('結論：穿刺が第一選択。') }] },
  { kind: 'heading', level: 2, inlines: t('1. なぜ迷うのか') },
  { kind: 'paragraph', inlines: t('本文の段落。要点には出ない。') },
  { kind: 'list_item', ordered: false, inlines: t('箇条書きも出ない。') },
  { kind: 'paragraph', inlines: t('→だから、まず病因をエコーで確認する。') },
  { kind: 'heading', level: 2, inlines: t('2. 病因別の使い分け') },
  { kind: 'table', rows: [[t('表'), t('も'), t('出ない')]] },
  { kind: 'callout', icon: '🧑‍⚕️', color: 'green_background', blocks: [{ kind: 'paragraph', inlines: t('署名も出ない。') }] },
]

describe('digestItems', () => {
  it('結論・H2見出し・recapだけを残し、節ごとに section-link を挟む', () => {
    const items = digestItems(blocks)
    const kinds = items.map((x) => (x.kind === 'block' ? x.block.kind : 'section-link'))
    expect(kinds).toEqual(['callout', 'heading', 'paragraph', 'section-link', 'heading', 'section-link'])
  })

  it('section-link のアンカーは節番号（番号なしはインデックス）', () => {
    const items = digestItems(blocks)
    const anchors = items.filter((x) => x.kind === 'section-link').map((x) => (x.kind === 'section-link' ? x.anchor : ''))
    expect(anchors).toEqual(['1', '2'])
  })

  it('index は元の blocks 配列の位置を保持する（アンカー計算との一致）', () => {
    const items = digestItems(blocks)
    const headingIdx = items.filter((x) => x.kind === 'block' && x.block.kind === 'heading')
    expect(headingIdx.map((x) => (x.kind === 'block' ? x.index : -1))).toEqual([1, 5])
  })

  it('H2が無い文書では結論とrecapだけになり section-link は出ない', () => {
    const noHeading: ReaderBlock[] = [blocks[0], { kind: 'paragraph', inlines: t('→だから、こうする。') }]
    const items = digestItems(noHeading)
    expect(items.every((x) => x.kind === 'block')).toBe(true)
    expect(items).toHaveLength(2)
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
