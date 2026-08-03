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
    const claimed = withOverrides({
      notionToken: 'ntn_new', notionAuthKind: 'oauth', notionWorkspaceName: 'WS',
      notionDuplicatedTemplateId: 'template_new',
    })
    const local = withOverrides({ notionToken: 'secret_old', notionAuthKind: 'manual' })
    const out = resolveClaimedSettings(claimed, false, local)
    expect(out.notionToken).toBe('ntn_new')
    expect(out.notionAuthKind).toBe('oauth')
    expect(out.notionWorkspaceName).toBe('WS')
    expect(out.notionDuplicatedTemplateId).toBe('template_new')
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

  // mergeSettings の空判定は undefined/null/'' のみを「空」とみなす（[] や false は空扱いしない）。
  // だから配列・真偽値のフィールドは、値が入っていれば常に端末側が勝つ。
  // この3件は「壊れたら露呈すべき前提」を resolveClaimedSettings 越しに固定するための回帰テスト。
  it('端末が持つ追加部署（配列）は、応答に無くても空で潰さない', () => {
    const claimed = withOverrides({ notionToken: 'ntn_new' })
    const local = withOverrides({
      additionalTeams: [{ label: '放射線科', notionToken: 'team_tok', medicalDbId: 'db_radiology' }],
    })
    const out = resolveClaimedSettings(claimed, false, local)
    expect(out.additionalTeams).toEqual([{ label: '放射線科', notionToken: 'team_tok', medicalDbId: 'db_radiology' }])
  })

  it('端末が false にしている表示設定（真偽値）は、応答が別の値でも上書きしない', () => {
    const claimed = withOverrides({ notionToken: 'ntn_new', hideQuizTab: true })
    const local = withOverrides({ hideQuizTab: false })
    const out = resolveClaimedSettings(claimed, false, local)
    expect(out.hideQuizTab).toBe(false)
  })

  it('端末が空文字のままの項目は、この場合に限って応答の値で埋まってよい', () => {
    const claimed = withOverrides({ notionToken: 'ntn_new', propKeywords: 'FROM_SERVER_KW' })
    const local = withOverrides({ propKeywords: '' })
    const out = resolveClaimedSettings(claimed, false, local)
    expect(out.propKeywords).toBe('FROM_SERVER_KW')
  })
})
