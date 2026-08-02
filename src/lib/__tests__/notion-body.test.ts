// 本文フォールバック用の抜粋関数。blocks APIの結果から本文テキストを
// つないで maxLen で切る。テキストを持たないブロックは読み飛ばす。
import { describe, it, expect } from 'vitest'
import { extractBodyExcerpt } from '../notion-body'

const para = (text: string) => ({
  type: 'paragraph',
  paragraph: { rich_text: [{ plain_text: text }] },
})

describe('extractBodyExcerpt', () => {
  it('段落テキストを空白でつなぐ', () => {
    expect(extractBodyExcerpt([para('一文目。'), para('二文目。')])).toBe('一文目。 二文目。')
  })

  it('maxLen で切り詰める', () => {
    expect(extractBodyExcerpt([para('あ'.repeat(400))], 300)).toHaveLength(300)
  })

  it('見出し・箇条書き・引用も拾う', () => {
    const blocks = [
      { type: 'heading_2', heading_2: { rich_text: [{ plain_text: '見出し' }] } },
      { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ plain_text: '項目' }] } },
      { type: 'quote', quote: { rich_text: [{ plain_text: '引用' }] } },
    ]
    expect(extractBodyExcerpt(blocks)).toBe('見出し 項目 引用')
  })

  it('テキストを持たないブロック（画像等）は読み飛ばす', () => {
    const blocks = [{ type: 'image', image: {} }, para('本文')]
    expect(extractBodyExcerpt(blocks)).toBe('本文')
  })

  it('空配列なら空文字', () => {
    expect(extractBodyExcerpt([])).toBe('')
  })
})
