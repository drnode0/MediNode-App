import { describe, it, expect } from 'vitest'
import { sectionKeysByBlock, sectionEnds } from '@/lib/recall/reader-claims'
import type { ReaderBlock } from '@/lib/reader-doc'

const h2 = (t: string): ReaderBlock => ({ kind: 'heading', level: 2, inlines: [{ text: t }] })
const li = (t: string): ReaderBlock => ({ kind: 'list_item', ordered: false, inlines: [{ text: t }] })
const p = (t: string): ReaderBlock => ({ kind: 'paragraph', inlines: [{ text: t }] })

describe('節キーの導出', () => {
  it('番号付きH2の前は sec0、以後はその番号', () => {
    const blocks = [p('前置き'), h2('1. 定義'), li('あ'), h2('2. 数値'), li('い')]
    expect(sectionKeysByBlock(blocks)).toEqual(['sec0', 'sec1', 'sec1', 'sec2', 'sec2'])
  })

  it('番号の無いH2では節を切り替えない（同期側の SECTION_HEAD_RE と同じ）', () => {
    const blocks = [h2('1. 定義'), li('あ'), h2('まとめ'), li('い')]
    expect(sectionKeysByBlock(blocks)).toEqual(['sec1', 'sec1', 'sec1', 'sec1'])
  })

  it('題名の無い「3.」だけの見出しは節境界にしない', () => {
    const blocks = [h2('1. 定義'), li('あ'), h2('3.'), li('い')]
    expect(sectionKeysByBlock(blocks)).toEqual(['sec1', 'sec1', 'sec1', 'sec1'])
  })
})

describe('節末の位置', () => {
  it('番号付き節ごとに、その節の最後のブロックの位置を返す', () => {
    const blocks = [p('前置き'), h2('1. 定義'), li('あ'), li('い'), h2('2. 数値'), li('う')]
    expect(sectionEnds(blocks)).toEqual([
      { sectionKey: 'sec1', afterIndex: 3 },
      { sectionKey: 'sec2', afterIndex: 5 },
    ])
  })

  it('sec0（見出しより前）には節末を作らない', () => {
    expect(sectionEnds([p('前置きだけ')])).toEqual([])
  })
})
