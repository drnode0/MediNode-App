// 端末間同期のマージ（mergeSettings）のテスト。
// 「空欄で非空を上書きしない」ユニオンであることを担保する
// （再インストール直後の部分的ローカルがサーバーの完全設定を消す事故の再発防止）。
import { describe, it, expect } from 'vitest'
import { mergeSettings, type AppSettings } from '../settings'

function base(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    searchMode: 'algolia',
    notionToken: '', notionMedicalDbId: '', notionReferenceDbId: '', notionManualDbId: '',
    algoliaAppId: '', algoliaSearchKey: '', algoliaAdminKey: '', algoliaIndex: 'medical_knowledge',
    teamLabel: '', teamNotionToken: '', teamNotionMedicalDbId: '', teamNotionReferenceDbId: '', teamNotionManualDbId: '',
    subscriptionSearchKey: '', subscriptionAppId: '', subscriptionIndex: '',
    propSummary: '', propKeywords: '', propKnowledgeLevel: '', propGenre: '',
    ...overrides,
  }
}

describe('mergeSettings', () => {
  it('primaryが空の項目はsecondaryの値で埋める（Notion Token喪失の再発防止）', () => {
    // primary（新しい側・再インストール直後）: Algoliaだけ入っている
    const primary = base({ algoliaAppId: 'NEWAPP', algoliaSearchKey: 'sk_new' })
    // secondary（古い側・サーバーの完全設定）: Notion Tokenがある
    const secondary = base({ notionToken: 'ntn_abc', notionMedicalDbId: 'db123', algoliaAppId: 'OLDAPP' })

    const merged = mergeSettings(primary, secondary)!
    // 空だったNotion系はサーバーから復元
    expect(merged.notionToken).toBe('ntn_abc')
    expect(merged.notionMedicalDbId).toBe('db123')
    // 両方に値がある項目は primary（新しい側）を優先
    expect(merged.algoliaAppId).toBe('NEWAPP')
    expect(merged.algoliaSearchKey).toBe('sk_new')
  })

  it('片方がnullならもう片方をそのまま返す', () => {
    const s = base({ notionToken: 'ntn_x' })
    expect(mergeSettings(null, s)).toEqual(s)
    expect(mergeSettings(s, null)).toEqual(s)
    expect(mergeSettings(null, null)).toBeNull()
  })

  it('primaryの非空値をsecondaryの空値で上書きしない', () => {
    const primary = base({ notionToken: 'ntn_keep' })
    const secondary = base({ notionToken: '' })
    expect(mergeSettings(primary, secondary)!.notionToken).toBe('ntn_keep')
  })

  it('searchMode等の必須値はprimaryを優先する', () => {
    const primary = base({ searchMode: 'notion' })
    const secondary = base({ searchMode: 'algolia' })
    expect(mergeSettings(primary, secondary)!.searchMode).toBe('notion')
  })
})
