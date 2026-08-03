import { describe, it, expect } from 'vitest'
import { stripLeadingEmoji } from '../labels'
import { titleParts } from '../title-display'

// タイトル先頭の種別絵文字は「lucideアイコンに置換して本文からは剥がす」のが約束。
// アイコンの判定（iconForTitleEmoji）は trimStart してから照合するので、剥がす側が
// 行頭固定だと、先頭に空白が1つ入っただけで「アイコンが出る＋絵文字も残る」の
// 二重表示になる。両者の前処理を揃えることがこのテストの主眼。
describe('stripLeadingEmoji', () => {
  it('先頭の絵文字を剥がす', () => {
    expect(stripLeadingEmoji('💡 PCTを測定する意義はあるのか？')).toBe('PCTを測定する意義はあるのか？')
  })

  it('絵文字の前に空白があっても剥がす（半角・全角・タブ）', () => {
    expect(stripLeadingEmoji(' 💡 日本紅斑熱を疑った時の動き方は？')).toBe('日本紅斑熱を疑った時の動き方は？')
    expect(stripLeadingEmoji('　💡 日本紅斑熱を疑った時の動き方は？')).toBe('日本紅斑熱を疑った時の動き方は？')
    expect(stripLeadingEmoji('\t❓ CQ：これは？')).toBe('CQ：これは？')
  })

  it('絵文字のないタイトルは前後の空白だけ落とす', () => {
    expect(stripLeadingEmoji(' 日本紅斑熱を疑った時の動き方は？ ')).toBe('日本紅斑熱を疑った時の動き方は？')
  })

  it('空・未設定は空文字', () => {
    expect(stripLeadingEmoji(null)).toBe('')
    expect(stripLeadingEmoji(undefined)).toBe('')
    expect(stripLeadingEmoji('')).toBe('')
  })
})

describe('titleParts', () => {
  it('先頭に空白があってもアイコンと本文が食い違わない（絵文字が残らない）', () => {
    const p = titleParts(' 💡 日本紅斑熱を疑った時の動き方は？')
    expect(p.Icon).not.toBeNull()
    expect(p.text).toBe('日本紅斑熱を疑った時の動き方は？')
  })

  it('種別（level）が取れるときはタイトルの絵文字有無によらず同じアイコンになる', () => {
    const withEmoji = titleParts('💡 これは？', { level: '💡 ナレッジ' })
    const without = titleParts('これは？', { level: '💡 ナレッジ' })
    expect(withEmoji.Icon).toBe(without.Icon)
    expect(withEmoji.text).toBe('これは？')
    expect(without.text).toBe('これは？')
  })
})
