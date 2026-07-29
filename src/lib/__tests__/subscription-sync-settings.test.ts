import { describe, it, expect } from 'vitest'
import { SUBSCRIPTION_INDEX_SETTINGS } from '@/app/api/subscription/sync/_core'

// 2026-07-29の本番障害の再発防止: facetingAfterDistinct はAlgoliaの「クエリ専用」
// パラメータで、setSettings に含めると 400 Invalid object attributes になる。
// 当時は saveObjects 後に setSettings が失敗し、distinct なしの節レコードだけが
// 本番に残って検索一覧が重複だらけになった。
describe('SUBSCRIPTION_INDEX_SETTINGS', () => {
  it('クエリ専用パラメータを含まない（含めるとsetSettingsが400で全滅する）', () => {
    expect(SUBSCRIPTION_INDEX_SETTINGS).not.toHaveProperty('facetingAfterDistinct')
  })

  it('distinct集約の必須3点セットが揃っている', () => {
    expect(SUBSCRIPTION_INDEX_SETTINGS.attributeForDistinct).toBe('parentId')
    expect(SUBSCRIPTION_INDEX_SETTINGS.distinct).toBe(true)
    expect(SUBSCRIPTION_INDEX_SETTINGS.customRanking?.[0]).toBe('desc(isParent)')
  })

  it('本文スニペットの設定が揃っている', () => {
    expect(SUBSCRIPTION_INDEX_SETTINGS.attributesToSnippet).toEqual(['sectionText:30'])
    expect(SUBSCRIPTION_INDEX_SETTINGS.attributesToRetrieve).toEqual(['*', '-sectionText'])
  })
})
