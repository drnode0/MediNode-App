import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import algoliasearch from 'algoliasearch'

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

async function syncMedicalDb(
  notion: Client,
  dbId: string,
  owner: 'personal' | 'team',
  teamLabel: string,
  records: Record<string, unknown>[],
): Promise<number> {
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
        genre: extractText(props['ジャンル'] || {}),
        detailGenre: extractText(props['詳細ジャンル'] || {}),
        tags: extractText(props['タグ'] || {}),
        knowledgeLevel: extractText(props['知識レベル'] || {}),
        aiSummary: extractText(props['AI要約'] || {}),
        aiKeywords: extractText(props['キーワード'] || {}),
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
): Promise<number> {
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
        year: extractText(props['発行年'] || {}),
        evidenceLevel: extractText(props['エビデンスレベル'] || {}),
        aiSummary: extractText(props['AI要約'] || {}),
        aiKeywords: extractText(props['キーワード'] || {}),
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
      // 部署用（任意）
      teamLabel,
      teamNotionToken,
      teamNotionMedicalDbId,
    } = body

    if (!notionToken || !notionMedicalDbId || !algoliaAppId || !algoliaAdminKey) {
      return NextResponse.json({ error: '必要なキーが不足しています' }, { status: 400 })
    }

    const notion = new Client({ auth: notionToken })

    // 接続テストのみ（testOnly=true の場合）
    if (testOnly) {
      try {
        // Notion接続テスト：DBに1件だけクエリ
        await notion.databases.query({
          database_id: notionMedicalDbId,
          page_size: 1,
        })

        // Algolia接続テスト：インデックス一覧取得
        const algolia = algoliasearch(algoliaAppId, algoliaAdminKey)
        await algolia.listIndices()

        return NextResponse.json({ success: true, testOnly: true })
      } catch (err) {
        const message = err instanceof Error ? err.message : '接続エラーが発生しました'
        return NextResponse.json({ error: message }, { status: 500 })
      }
    }

    // 通常の同期処理
    const algolia = algoliasearch(algoliaAppId, algoliaAdminKey)
    const index = algolia.initIndex(algoliaIndex || 'medical_knowledge')

    const records: Record<string, unknown>[] = []
    let syncedMedical = 0
    let syncedReference = 0

    // 個人用 Medical DB の同期
    syncedMedical += await syncMedicalDb(notion, notionMedicalDbId, 'personal', '', records)

    // 個人用 Reference DB の同期（任意）
    if (notionReferenceDbId) {
      syncedReference += await syncReferenceDb(notion, notionReferenceDbId, 'personal', '', records)
    }

    // 部署用 Medical DB の同期（任意）
    if (teamNotionToken && teamNotionMedicalDbId) {
      const teamNotion = new Client({ auth: teamNotionToken })
      syncedMedical += await syncMedicalDb(teamNotion, teamNotionMedicalDbId, 'team', teamLabel || '部署', records)
    }

    if (records.length > 0) {
      await index.saveObjects(records)
    }

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
      attributesForFaceting: ['owner', 'teamLabel'],
      customRanking: ['desc(lastEdited)'],
    })

    return NextResponse.json({
      success: true,
      synced: {
        medical: syncedMedical,
        reference: syncedReference,
        total: records.length,
      },
    })
  } catch (err) {
    console.error('Sync error:', err)
    const message = err instanceof Error ? err.message : '不明なエラーが発生しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
