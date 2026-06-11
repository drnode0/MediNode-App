import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import algoliasearch from 'algoliasearch'

// プロパティ名マッピング型
export interface PropMap {
  summary?: string      // デフォルト: 要約
  keywords?: string     // デフォルト: キーワード
  knowledgeLevel?: string // デフォルト: 知識レベル
  genre?: string        // デフォルト: ジャンル
}

function getProp(
  props: Record<string, Record<string, unknown>>,
  key: string,
  fallback: string,
): Record<string, unknown> {
  return props[key] || props[fallback] || {}
}

function extractList(prop: Record<string, unknown>): string[] {
  if (!prop) return []
  const type = prop.type as string
  if (type === 'multi_select') {
    return ((prop.multi_select as Array<{ name: string }>) || []).map((t) => t.name)
  }
  return []
}

function extractText(prop: Record<string, unknown>): string {
  if (!prop) return ''
  const type = prop.type as string
  if (type === 'title') {
    return ((prop.title as Array<{ plain_text: string }>) || []).map((t) => t.plain_text).join('')
  }
  if (type === 'rich_text') {
    return ((prop.rich_text as Array<{ plain_text: string }>) || []).map((t) => t.plain_text).join('')
  }
  if (type === 'select') {
    return (prop.select as { name: string } | null)?.name || ''
  }
  if (type === 'multi_select') {
    return ((prop.multi_select as Array<{ name: string }>) || []).map((t) => t.name).join(', ')
  }
  if (type === 'date') {
    return (prop.date as { start: string } | null)?.start || ''
  }
  if (type === 'number') {
    return String(prop.number ?? '')
  }
  if (type === 'checkbox') {
    return prop.checkbox ? 'true' : 'false'
  }
  if (type === 'url') {
    return (prop.url as string) || ''
  }
  return ''
}

function extractHasFiles(props: Record<string, Record<string, unknown>>): boolean {
  for (const prop of Object.values(props)) {
    if (!prop) continue
    if (prop.type === 'files') {
      const files = prop.files as Array<unknown> | null
      if (files && files.length > 0) return true
    }
  }
  return false
}

function extractYearText(prop: Record<string, unknown>): string {
  if (!prop) return ''
  const type = prop.type as string
  if (type === 'date') {
    const start = (prop.date as { start: string } | null)?.start || ''
    // "2024-01-01" → "2024"
    return start ? start.slice(0, 4) : ''
  }
  return extractText(prop)
}

async function syncMedicalDb(
  notion: Client,
  dbId: string,
  owner: 'personal' | 'team',
  teamLabel: string,
  records: Record<string, unknown>[],
  propMap: PropMap,
): Promise<number> {
  const summaryKey = propMap.summary || '要約'
  const keywordsKey = propMap.keywords || 'キーワード'
  const knowledgeLevelKey = propMap.knowledgeLevel || '知識レベル'
  const genreKey = propMap.genre || 'ジャンル'

  let count = 0
  let cursor: string | undefined = undefined
  do {
    const res = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
    })
    for (const page of res.results) {
      if (page.object !== 'page') continue
      const p = page as Record<string, unknown>
      const props = p.properties as Record<string, Record<string, unknown>>
      const title =
        extractText(props['名前'] || props['title'] || props['タイトル'] || props['Name'] || {})
      if (!title) continue
      records.push({
        objectID: `${owner}_${page.id}`,
        source: 'medical',
        owner,
        teamLabel: owner === 'team' ? teamLabel : '',
        title,
        genre: extractList(getProp(props, genreKey, 'ジャンル')),
        detailGenre: extractText(props['詳細ジャンル'] || {}),
        tags: extractText(props['タグ'] || {}),
        knowledgeLevel: extractText(getProp(props, knowledgeLevelKey, '知識レベル')),
        aiSummary: extractText(getProp(props, summaryKey, '要約')),
        aiKeywords: extractText(getProp(props, keywordsKey, 'キーワード')),
        hasAttachment: extractHasFiles(props),
        lastEdited: (p.last_edited_time as string) || '',
        createdAt: (p.created_time as string) || '',
        notionUrl: (p.url as string) || '',
      })
      count++
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)
  return count
}

async function syncReferenceDb(
  notion: Client,
  dbId: string,
  owner: 'personal' | 'team',
  teamLabel: string,
  records: Record<string, unknown>[],
  propMap: PropMap,
): Promise<number> {
  const summaryKey = propMap.summary || '要約'
  const keywordsKey = propMap.keywords || 'キーワード'

  let count = 0
  let cursor: string | undefined = undefined
  do {
    const res = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
    })
    for (const page of res.results) {
      if (page.object !== 'page') continue
      const p = page as Record<string, unknown>
      const props = p.properties as Record<string, Record<string, unknown>>
      const title =
        extractText(props['名前'] || props['title'] || props['タイトル'] || props['Name'] || {})
      if (!title) continue
      records.push({
        objectID: `${owner}_${page.id}`,
        source: 'reference',
        owner,
        teamLabel: owner === 'team' ? teamLabel : '',
        title,
        author: extractText(props['著者'] || {}),
        journal: extractText(props['ジャーナル名'] || {}),
        year: extractYearText(props['発行年'] || {}),
        evidenceLevel: extractText(props['エビデンスレベル'] || {}),
        aiSummary: extractText(getProp(props, summaryKey, '要約')),
        aiKeywords: extractText(getProp(props, keywordsKey, 'キーワード')),
        hasAttachment: extractHasFiles(props),
        lastEdited: (p.last_edited_time as string) || '',
        createdAt: (p.created_time as string) || '',
        notionUrl: (p.url as string) || '',
      })
      count++
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)
  return count
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      notionToken,
      notionMedicalDbId,
      notionReferenceDbId,
      algoliaAppId,
      algoliaAdminKey,
      algoliaIndex,
      testOnly,
      // プロパティ名マッピング（任意）
      propMap,
      // 部署用（任意）
      teamLabel,
      teamNotionToken,
      teamNotionMedicalDbId,
      teamNotionReferenceDbId,
    } = body

    if (!notionToken || !notionMedicalDbId || !algoliaAppId || !algoliaAdminKey) {
      return NextResponse.json({ error: '必要なキーが不足しています' }, { status: 400 })
    }

    const resolvedPropMap: PropMap = propMap || {}
    const notion = new Client({ auth: notionToken })

    // 接続テストのみ（testOnly=true の場合）
    if (testOnly) {
      // Notion接続テスト
      try {
        await notion.databases.query({
          database_id: notionMedicalDbId,
          page_size: 1,
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : '接続エラーが発生しました'
        return NextResponse.json({ error: `[Notion] ${message}` }, { status: 500 })
      }

      // Algolia接続テスト
      try {
        const algolia = algoliasearch(algoliaAppId, algoliaAdminKey)
        await algolia.listIndices()
      } catch (err) {
        const message = err instanceof Error ? err.message : '接続エラーが発生しました'
        return NextResponse.json({ error: `[Algolia] ${message}` }, { status: 500 })
      }

      return NextResponse.json({ success: true, testOnly: true })
    }

    // 通常の同期処理
    const algolia = algoliasearch(algoliaAppId, algoliaAdminKey)
    const index = algolia.initIndex(algoliaIndex || 'medical_knowledge')

    const records: Record<string, unknown>[] = []
    let syncedPersonalMedical = 0
    let syncedPersonalReference = 0
    let syncedTeamMedical = 0
    let syncedTeamReference = 0
    const warnings: string[] = []

    // 個人用 Medical DB の同期
    syncedPersonalMedical += await syncMedicalDb(notion, notionMedicalDbId, 'personal', '', records, resolvedPropMap)

    // 個人用 Reference DB の同期（任意）
    if (notionReferenceDbId) {
      syncedPersonalReference += await syncReferenceDb(notion, notionReferenceDbId, 'personal', '', records, resolvedPropMap)
    }

    // 部署用 Medical DB の同期（任意）
    if (teamNotionToken && teamNotionMedicalDbId) {
      const teamNotion = new Client({ auth: teamNotionToken })
      try {
        syncedTeamMedical += await syncMedicalDb(teamNotion, teamNotionMedicalDbId, 'team', teamLabel || '部署', records, resolvedPropMap)
      } catch (err) {
        warnings.push(`部署用 Medical DB の同期に失敗: ${err instanceof Error ? err.message : String(err)}`)
      }
      // 部署用 Reference DB の同期（任意）
      if (teamNotionReferenceDbId) {
        try {
          syncedTeamReference += await syncReferenceDb(teamNotion, teamNotionReferenceDbId, 'team', teamLabel || '部署', records, resolvedPropMap)
        } catch (err) {
          warnings.push(`部署用 Reference DB の同期に失敗: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
    }

    const syncedMedical = syncedPersonalMedical + syncedTeamMedical
    const syncedReference = syncedPersonalReference + syncedTeamReference

    // フィルタ（owner:team 等）が確実に効くよう、レコード保存より先に
    // attributesForFaceting を設定する。先に保存すると、ファセット未登録の状態で
    // インデックスされ、owner フィルタが一致しない（=同期件数は出るのに表示されない）
    // ことがあるため、設定 → 保存の順に統一する。
    await index.setSettings({
      searchableAttributes: [
        'title',
        'aiSummary',
        'aiKeywords',
        'tags',
        'genre',
        'detailGenre',
        'author',
        'journal',
      ],
      attributesForFaceting: ['filterOnly(owner)', 'filterOnly(teamLabel)', 'filterOnly(source)', 'filterOnly(knowledgeLevel)', 'genre'],
      customRanking: ['desc(lastEdited)'],
    })

    if (records.length > 0) {
      // 古い形式のレコードが残らないよう、同期前にインデックスをクリアしてから保存
      await index.clearObjects()
      await index.saveObjects(records)
    }

    return NextResponse.json({
      success: true,
      synced: {
        medical: syncedMedical,
        reference: syncedReference,
        total: records.length,
        detail: {
          personalMedical: syncedPersonalMedical,
          personalReference: syncedPersonalReference,
          teamMedical: syncedTeamMedical,
          teamReference: syncedTeamReference,
        },
      },
      warnings,
    })
  } catch (err) {
    console.error('Sync error:', err)
    const message = err instanceof Error ? err.message : '不明なエラーが発生しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
