import { Client } from '@notionhq/client'
import algoliasearch from 'algoliasearch'
import { timingSafeEqual } from 'crypto'
import { computeContentStats, type NotionBlockLite } from '@/lib/content-stats'

/**
 * サブスクリプション同期の共通ロジック。
 *
 * 手動API（route.ts）と Vercel Cron（/api/cron/subscription-sync）の
 * 両方から呼ばれる。処理を二重実装しないため、ここに集約する。
 *
 * 必要な環境変数:
 *   - SUBSCRIPTION_NOTION_TOKEN
 *   - SUBSCRIPTION_MEDICAL_DB_ID
 *   - SUBSCRIPTION_REFERENCE_DB_ID (任意)
 *   - SUBSCRIPTION_ALGOLIA_APP_ID
 *   - SUBSCRIPTION_ALGOLIA_ADMIN_KEY
 *   - SUBSCRIPTION_ALGOLIA_INDEX (デフォルト: Medical Knowledge_DB（サブスク用）／検索側と一致必須)
 */

export type SyncResult = {
  success: true
  synced: { medical: number; reference: number; total: number }
  index: string
}

export type SyncError = {
  ok: false
  status: number
  error: string
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

// ページ本文（トップレベルブロック）を全ページネーションで取得し、充実度統計を返す。
// 失敗してもページ全体の同期は止めない（統計なしで続行）。対象は現状40ページ弱なので
// ページごとの逐次取得でもcron実行時間・レート制限とも問題にならない。
async function fetchContentStats(
  notion: Client,
  pageId: string,
): Promise<{ contentChars: number; sectionCount: number; headings: string[] } | null> {
  try {
    const blocks: NotionBlockLite[] = []
    let cursor: string | undefined = undefined
    do {
      const res = await notion.blocks.children.list({
        block_id: pageId,
        page_size: 100,
        start_cursor: cursor,
      })
      blocks.push(...(res.results as unknown as NotionBlockLite[]))
      cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
    } while (cursor)
    return computeContentStats(blocks)
  } catch {
    return null
  }
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
      const stats = await fetchContentStats(notion, page.id)
      records.push({
        objectID: `subscription_${page.id}`,
        source: 'medical',
        owner: 'subscription',
        title,
        genre: extractList(props['ジャンル'] || {}),
        detailGenre: extractText(props['詳細ジャンル'] || {}),
        tags: extractText(props['タグ'] || {}),
        knowledgeLevel: extractText(props['知識レベル'] || {}),
        // 由来（現場の疑問＝読者の臨床疑問投稿から生まれたナレッジ）。空なら通常のナレッジ。
        origin: extractText(props['由来'] || {}),
        // 投稿者情報（由来=現場の疑問のページのみ作者が入力）。実名は扱わず、
        // 職種と本人希望のペンネームだけを載せる（ペンネーム空欄=匿名表示）。
        posterRole: extractText(props['投稿者職種'] || {}),
        posterName: extractText(props['ペンネーム'] || props['投稿者名'] || {}),
        aiSummary: extractText(props['要約'] || {}),
        aiKeywords: extractText(props['キーワード'] || {}),
        hasAttachment: extractHasFiles(props),
        lastEdited: (p.last_edited_time as string) || '',
        createdAt: (p.created_time as string) || '',
        notionUrl: (p.url as string) || '',
        contentChars: stats?.contentChars ?? 0,
        sectionCount: stats?.sectionCount ?? 0,
        headings: stats?.headings ?? [],
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
      const stats = await fetchContentStats(notion, page.id)
      records.push({
        objectID: `subscription_${page.id}`,
        source: 'reference',
        owner: 'subscription',
        title,
        author: extractText(props['著者'] || {}),
        journal: extractText(props['ジャーナル名'] || {}),
        year: extractYearText(props['発行年'] || {}),
        evidenceLevel: extractText(props['エビデンスレベル'] || {}),
        recordingLevel: extractText(props['収録レベル'] || {}),
        aiSummary: extractText(props['要約'] || {}),
        aiKeywords: extractText(props['キーワード'] || {}),
        hasAttachment: extractHasFiles(props),
        lastEdited: (p.last_edited_time as string) || '',
        createdAt: (p.created_time as string) || '',
        notionUrl: (p.url as string) || '',
        contentChars: stats?.contentChars ?? 0,
        sectionCount: stats?.sectionCount ?? 0,
        headings: stats?.headings ?? [],
      })
      count++
    }
    cursor = res.has_more ? (res.next_cursor ?? undefined) : undefined
  } while (cursor)
  return count
}

/**
 * 指定したsecretが SUBSCRIPTION_SYNC_SECRET と一致するか判定する。
 * secret未設定の場合は false（＝一切叩けない）。
 */
export function isSyncSecretValid(secret: string | null): boolean {
  const expected = process.env.SUBSCRIPTION_SYNC_SECRET
  if (!expected) return false
  if (!secret) return false
  // タイミング攻撃対策の定数時間比較。長さが違うと timingSafeEqual は throw するため
  // 先に長さを揃える（長さ差自体は秘匿性に大きく影響しない）。
  const a = Buffer.from(secret)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/**
 * サブスク用Notion DB → サブスク用Algoliaインデックスへ同期する本体。
 * 認証は呼び出し側で済ませてから呼ぶこと。
 */
export async function runSubscriptionSync(): Promise<SyncResult | SyncError> {
  const notionToken = process.env.SUBSCRIPTION_NOTION_TOKEN
  const medicalDbId = process.env.SUBSCRIPTION_MEDICAL_DB_ID
  const referenceDbId = process.env.SUBSCRIPTION_REFERENCE_DB_ID
  const algoliaAppId = process.env.SUBSCRIPTION_ALGOLIA_APP_ID
  const algoliaAdminKey = process.env.SUBSCRIPTION_ALGOLIA_ADMIN_KEY
  // 既定のインデックス名は検索側（lib/algolia.ts の PREMIUM_INDEX_NAME）および
  // premium/verify と一致させる。ここがズレると「同期はされるのに検索で0件
  // （データがありません）」になるため、必ず同じ値にすること。
  const algoliaIndex = process.env.SUBSCRIPTION_ALGOLIA_INDEX || 'Medical Knowledge_DB（サブスク用）'

  // 必須環境変数チェック
  const missing: string[] = []
  if (!notionToken) missing.push('SUBSCRIPTION_NOTION_TOKEN')
  if (!medicalDbId) missing.push('SUBSCRIPTION_MEDICAL_DB_ID')
  if (!algoliaAppId) missing.push('SUBSCRIPTION_ALGOLIA_APP_ID')
  if (!algoliaAdminKey) missing.push('SUBSCRIPTION_ALGOLIA_ADMIN_KEY')
  if (missing.length > 0) {
    return {
      ok: false,
      status: 500,
      error: `環境変数が不足しています: ${missing.join(', ')}`,
    }
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
      'filterOnly(recordingLevel)',
      // 解決済み臨床疑問の通知・一覧（lib/resolved-cqs.ts）が origin:"現場の疑問" で絞り込む
      'filterOnly(origin)',
      'genre',
    ],
    customRanking: ['desc(lastEdited)'],
  })

  return {
    success: true,
    synced: {
      medical: syncedMedical,
      reference: syncedReference,
      total: records.length,
    },
    index: algoliaIndex,
  }
}
