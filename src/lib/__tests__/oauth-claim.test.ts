// claim応答を端末へ書くときの判断。サーバーに設定の実体が無いときは
// ローカルを主にマージする（丸ごと置き換えると端末の設定を空で潰すため）。
import { describe, it, expect } from 'vitest'
import { resolveClaimedSettings } from '../oauth-claim'
import type { AppSettings } from '../settings'

const base = {
  searchMode: 'notion', notionToken: '', notionMedicalDbId: '', notionReferenceDbId: '', notionManualDbId: '',
  algoliaAppId: '', algoliaSearchKey: '', algoliaAdminKey: '', algoliaIndex: 'medical_knowledge',
  teamLabel: '', teamNotionToken: '', teamNotionMedicalDbId: '', teamNotionReferenceDbId: '', teamNotionManualDbId: '',
  subscriptionSearchKey: '', subscriptionAppId: '', subscriptionIndex: '',
  propSummary: '', propKeywords: '', propKnowledgeLevel: '', propGenre: '',
} as unknown as AppSettings

const withOverrides = (o: Record<string, unknown>) => ({ ...base, ...o }) as AppSettings

describe('resolveClaimedSettings', () => {
  it('サーバーに設定の実体があれば応答をそのまま採る', () => {
    const claimed = withOverrides({ notionToken: 'ntn_new', algoliaAppId: 'FROM_SERVER' })
    const local = withOverrides({ algoliaAppId: 'FROM_LOCAL', propSummary: 'サマリー' })
    const out = resolveClaimedSettings(claimed, true, local)
    expect(out.algoliaAppId).toBe('FROM_SERVER')
    expect(out.notionToken).toBe('ntn_new')
  })

  it('サーバーに設定の実体が無ければ、ローカルの値を空で潰さない', () => {
    const claimed = withOverrides({ notionToken: 'ntn_new' })
    const local = withOverrides({
      algoliaAppId: 'FROM_LOCAL', algoliaAdminKey: 'ADMIN', propSummary: 'サマリー',
      teamNotionToken: 'team_tok', subscriptionAppId: 'SUB',
    })
    const out = resolveClaimedSettings(claimed, false, local)
    expect(out.algoliaAppId).toBe('FROM_LOCAL')
    expect(out.algoliaAdminKey).toBe('ADMIN')
    expect(out.propSummary).toBe('サマリー')
    expect(out.teamNotionToken).toBe('team_tok')
    expect(out.subscriptionAppId).toBe('SUB')
  })

  it('サーバーに実体が無くても、新しいトークンは必ず反映する', () => {
    const claimed = withOverrides({ notionToken: 'ntn_new', notionAuthKind: 'oauth', notionWorkspaceName: 'WS' })
    const local = withOverrides({ notionToken: 'secret_old', notionAuthKind: 'manual' })
    const out = resolveClaimedSettings(claimed, false, local)
    expect(out.notionToken).toBe('ntn_new')
    expect(out.notionAuthKind).toBe('oauth')
    expect(out.notionWorkspaceName).toBe('WS')
  })

  it('ローカルが無ければ応答をそのまま採る', () => {
    const claimed = withOverrides({ notionToken: 'ntn_new' })
    expect(resolveClaimedSettings(claimed, false, null).notionToken).toBe('ntn_new')
  })

  it('退避された旧トークンも落とさない', () => {
    const claimed = withOverrides({ notionToken: 'ntn_new', notionTokenPrev: 'secret_old', notionAuthKindPrev: 'manual' })
    const out = resolveClaimedSettings(claimed, false, withOverrides({ algoliaAppId: 'A' }))
    expect(out.notionTokenPrev).toBe('secret_old')
    expect(out.notionAuthKindPrev).toBe('manual')
    expect(out.algoliaAppId).toBe('A')
  })
})
