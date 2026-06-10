import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import algoliasearch from 'algoliasearch'

/**
 * サブスクリプション用 sync API
 *
 * 環境変数から認証情報を取得して、サブスク用Notion DBの内容を
 * subscription_medical Algoliaインデックスへ同期する。
 *
 * 認証:
 *   - x-sync-secret ヘッダー or ?secret=xxx クエリで SUBSCRIPTION_SYNC_SECRET と一致確認
 *   - 設定されていない or 不一致の場合は 401
 *
 * 必要な環境変数:
 *   - SUBSCRIPTION_NOTION_TOKEN
 *   - SUBSCRIPTION_MEDICAL_DB_ID
 *   - SUBSCRIPTION_REFERENCE_DB_ID (任意)
 *   - SUBSCRIPTION_ALGOLIA_APP_ID
 *   - SUBSCRIPTION_ALGOLIA_ADMIN_KEY
 *   - SUBSCRIPTION_ALGOLIA_INDEX (デフォルト: subscription_medical)
 *   - SUBSCRIPTION_SYNC_SECRET (これがないと401が返る)
 */

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
    return start ? start.slice(0, 4) : ''
  }
  return extractText(prop)
}

async function syncMedicalDb(
  notion: Client,
  dbId: string,
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
      const title = extractText(
        props['名前'] || props['title'] || props['タイトル'] || props['Name'] || {},
      )
      if (!title) continue
      records.push({
        objectID: `subscription_${page.id}`,
        source: 'medical',
        owner: 'subscription',
        title,
        genre: extractList(props['ジャンル'] || {}),
        detailGenre: extractText(props['詳細ジャンル'] || {}),
        tags: extractText(props['タグ'] || {}),
        knowledgeLevel: extractText(props['知識レベル'] || {}),
        aiSummary: extractText(props['要約'] || {}),
        aiKeywords: extractText(props['キーワード'] || {}),
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
      const title = extractText(
        props['名前'] || props['title'] || props['タイトル'] || props['Name'] || {},
      )
      if (!title) continue
      records.push({
        objectID: `subscription_${page.id}`,
        source: 'reference',
        owner: 'subscription',
        title,
        author: extractText(props['著者'] || {}),
        journal: extractText(props['ジャーナル名'] || {}),
        year: extractYearText(props['発行年'] || {}),
        evidenceLevel: extractText(props['エビデンスレベル'] || {}),
        aiSummary: extractText(props['要約'] || {}),
        aiKeywords: extractText(props['キーワード'] || {}),
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

function isAuthorized(req: NextRequest): boolean {
  const expected = process.env.SUBSCRIPTION_SYNC_SECRET
  if (!expected) return false // secret未設定 = 一切叩けない
  const headerSecret = req.headers.get('x-sync-secret')
  const url = new URL(req.url)
  const querySecret = url.searchParams.get('secret')
  return headerSecret === expected || querySecret === expected
}

export async function POST(req: NextRequest) {
  try {
    // 認証チェック
    if (!isAuthorized(req)) {
      return NextResponse.json(
        { error: 'Unauthorized: 有効な x-sync-secret が必要です' },
        { status: 401 },
      )
    }

    const notionToken = process.env.SUBSCRIPTION_NOTION_TOKEN
    const medicalDbId = process.env.SUBSCRIPTION_MEDICAL_DB_ID
    const referenceDbId = process.env.SUBSCRIPTION_REFERENCE_DB_ID
    const algoliaAppId = process.env.SUBSCRIPTION_ALGOLIA_APP_ID
    const algoliaAdminKey = process.env.SUBSCRIPTION_ALGOLIA_ADMIN_KEY
    const algoliaIndex = process.env.SUBSCRIPTION_ALGOLIA_INDEX || 'subscription_medical'

    // 必須環境変数チェック
    const missing: string[] = []
    if (!notionToken) missing.push('SUBSCRIPTION_NOTION_TOKEN')
    if (!medicalDbId) missing.push('SUBSCRIPTION_MEDICAL_DB_ID')
    if (!algoliaAppId) missing.push('SUBSCRIPTION_ALGOLIA_APP_ID')
    if (!algoliaAdminKey) missing.push('SUBSCRIPTION_ALGOLIA_ADMIN_KEY')
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `環境変数が不足しています: ${missing.join(', ')}` },
        { status: 500 },
      )
    }

    const notion = new Client({ auth: notionToken! })
    const algolia = algoliasearch(algoliaAppId!, algoliaAdminKey!)
    const index = algolia.initIndex(algoliaIndex)

    const records: Record<string, unknown>[] = []
    let syncedMedical = 0
    let syncedReference = 0

    // Medical DB の同期
    syncedMedical = await syncMedicalDb(notion, medicalDbId!, records)

    // Reference DB の同期（任意）
    if (referenceDbId) {
      syncedReference = await syncReferenceDb(notion, referenceDbId, records)
    }

    if (records.length > 0) {
      // 古い形式のレコードが残らないよう、同期前にインデックスをクリア
      await index.clearObjects()
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
      attributesForFaceting: [
        'filterOnly(owner)',
        'filterOnly(source)',
        'filterOnly(knowledgeLevel)',
        'genre',
      ],
      customRanking: ['desc(lastEdited)'],
    })

    return NextResponse.json({
      success: true,
      synced: {
        medical: syncedMedical,
        reference: syncedReference,
        total: records.length,
      },
      index: algoliaIndex,
    })
  } catch (err) {
    console.error('Subscription sync error:', err)
    const message = err instanceof Error ? err.message : '不明なエラーが発生しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// GETでも実行可能にしておく（ブラウザURLから叩けるように）
export async function GET(req: NextRequest) {
  return POST(req)
}
