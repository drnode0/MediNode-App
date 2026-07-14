import { describe, it, expect } from 'vitest'
import { FAQ_ENTRIES, FAQ_CATEGORIES, searchFaq } from '../help-faq'

describe('searchFaq', () => {
  it('空クエリ・カテゴリなしなら全件を返す', () => {
    expect(searchFaq(FAQ_ENTRIES, '', null)).toHaveLength(FAQ_ENTRIES.length)
  })

  it('カテゴリで絞り込める', () => {
    const results = searchFaq(FAQ_ENTRIES, '', 'エラー対処')
    expect(results.length).toBeGreaterThan(0)
    expect(results.every((e) => e.category === 'エラー対処')).toBe(true)
  })

  it('キーワードにヒットする（keywordsの表記ゆれ含む）', () => {
    // 「403」は q/keywords に含まれる
    const results = searchFaq(FAQ_ENTRIES, '403', null)
    expect(results.some((e) => e.id === 'err-403')).toBe(true)
    // 大文字小文字を無視する
    expect(searchFaq(FAQ_ENTRIES, 'ALGOLIA', null).length).toBeGreaterThan(0)
  })

  it('空白区切りはAND条件になる', () => {
    const results = searchFaq(FAQ_ENTRIES, 'パスワード 忘れた', null)
    expect(results.some((e) => e.id === 'password-forgot')).toBe(true)
    expect(results.length).toBeLessThan(searchFaq(FAQ_ENTRIES, 'パスワード', null).length)
  })

  it('ヒットなしは空配列', () => {
    expect(searchFaq(FAQ_ENTRIES, '存在しない語zzz', null)).toHaveLength(0)
  })

  it('全エントリのカテゴリが定義済みカテゴリに含まれる', () => {
    for (const e of FAQ_ENTRIES) {
      expect(FAQ_CATEGORIES).toContain(e.category)
    }
  })

  it('idが重複していない', () => {
    const ids = FAQ_ENTRIES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
