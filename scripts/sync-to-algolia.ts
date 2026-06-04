import { resolve } from 'path'
// Load .env.local
import { readFileSync } from 'fs'
const envPath = resolve(process.cwd(), '.env.local')
try {
  const envContent = readFileSync(envPath, 'utf-8')
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/)
    if (match) {
      process.env[match[1].trim()] = match[2].trim()
    }
  }
} catch {}

import { Client } from '@notionhq/client'
import algoliasearch from 'algoliasearch'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const algolia = algoliasearch(
  process.env.ALGOLIA_APP_ID!,
  process.env.ALGOLIA_ADMIN_KEY!
)
const index = algolia.initIndex(process.env.ALGOLIA_INDEX || 'medical_knowledge')

type NotionPage = {
  id: string
  properties: Record<string, any>
  url: string
  last_edited_time: string
}

function extractTitle(properties: Record<string, any>): string {
  for (const key of Object.keys(properties)) {
    const prop = properties[key]
    if (prop.type === 'title' && prop.title?.length > 0) {
      return prop.title.map((t: any) => t.plain_text).join('')
    }
  }
  return '(無題)'
}

function extractText(properties: Record<string, any>, key: string): string {
  const prop = properties[key]
  if (!prop) return ''
  if (prop.type === 'rich_text') {
    return prop.rich_text?.map((t: any) => t.plain_text).join('') || ''
  }
  if (prop.type === 'select') return prop.select?.name || ''
  if (prop.type === 'multi_select') {
    return prop.multi_select?.map((s: any) => s.name).join(', ') || ''
  }
  if (prop.type === 'number') return String(prop.number || '')
  if (prop.type === 'url') return prop.url || ''
  if (prop.type === 'checkbox') return prop.checkbox ? 'はい' : 'いいえ'
  if (prop.type === 'date') return prop.date?.start?.slice(0, 4) || ''
  return ''
}

async function getPageTitles(pageIds: string[]): Promise<string[]> {
  const titles: string[] = []
  for (const id of pageIds) {
    try {
      const page = await notion.pages.retrieve({ page_id: id }) as any
      const title = extractTitle(page.properties)
      if (title && title !== '(無題)') titles.push(title)
    } catch {
      // skip
    }
  }
  return titles
}

async function getPageContent(pageId: string): Promise<string> {
  try {
    const blocks = await notion.blocks.children.list({ block_id: pageId, page_size: 50 })
    const texts: string[] = []
    for (const block of blocks.results as any[]) {
      const type = block.type
      const content = block[type]
      if (content?.rich_text) {
        const text = content.rich_text.map((t: any) => t.plain_text).join('')
        if (text) texts.push(text)
      }
    }
    return texts.join(' ').slice(0, 2000)
  } catch {
    return ''
  }
}

async function syncDatabase(dbId: string, source: 'medical' | 'reference') {
  console.log(`\n同期開始: ${source} (${dbId})`)
  let cursor: string | undefined
  const records: any[] = []

  do {
    const response = await notion.databases.query({
      database_id: dbId,
      start_cursor: cursor,
      page_size: 100,
    })

    for (const page of response.results as NotionPage[]) {
      const properties = page.properties
      const title = extractTitle(properties)

      // Medical DB用
      const genre = extractText(properties, 'ジャンル') || extractText(properties, 'Genre')
      const detailGenre = extractText(properties, '詳細ジャンル')
      const type = extractText(properties, 'タイプ') || extractText(properties, 'Type')
      const tags = extractText(properties, 'タグ') || extractText(properties, 'Tags')
      const status = extractText(properties, 'ステータス') || extractText(properties, 'Status')
      const summary = extractText(properties, 'サマリー') || extractText(properties, 'Summary')
      const aiSummary = extractText(properties, 'AI要約')
      const knowledgeLevel = extractText(properties, '知識レベル')
      const createdAt = (properties['作成日時'] as any)?.created_time || ''

      // Reference DB用
      const author = extractText(properties, '著者') || extractText(properties, 'Author')
      const journal = extractText(properties, 'ジャーナル名') || extractText(properties, '雑誌') || extractText(properties, 'Journal')
      const year = extractText(properties, '発行年') || extractText(properties, '年') || extractText(properties, 'Year')
      const readStatus = extractText(properties, '読了') || extractText(properties, 'Read')
      const evidenceLevel = extractText(properties, 'エビデンスレベル')
      const aiKeywords = extractText(properties, 'AIキーワード') || extractText(properties, 'キーワード')

      // リレーション先のタイトルを取得
      let relatedCQTitles: string[] = []
      let relatedRefTitles: string[] = []
      if (source === 'reference') {
        // 参考文献 → Medical DBリレーション（CQタイトル）
        const relProp = properties['MEDICAL DB'] as any
        if (relProp?.type === 'relation' && relProp.relation?.length > 0) {
          const ids = relProp.relation.slice(0, 5).map((r: any) => r.id)
          relatedCQTitles = await getPageTitles(ids)
        }
      } else {
        // 医療知識 → 参考文献DBリレーション（文献タイトル）
        const relProp = properties['参考文献DB'] as any
        if (relProp?.type === 'relation' && relProp.relation?.length > 0) {
          const ids = relProp.relation.slice(0, 5).map((r: any) => r.id)
          relatedRefTitles = await getPageTitles(ids)
        }
      }

      const content = await getPageContent(page.id)

      records.push({
        objectID: page.id,
        title,
        source,
        genre,
        detailGenre,
        type,
        tags,
        status,
        summary,
        aiSummary,
        knowledgeLevel,
        author,
        journal,
        year,
        readStatus,
        evidenceLevel,
        aiKeywords,
        relatedCQTitles,
        relatedRefTitles,
        content,
        notionUrl: page.url,
        lastEdited: page.last_edited_time,
        createdAt,
      })
    }

    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined
    console.log(`  取得済み: ${records.length}件`)
  } while (cursor)

  return records
}

async function main() {
  console.log('Notion → Algolia 同期開始')

  const medicalRecords = await syncDatabase(
    process.env.NOTION_MEDICAL_DB_ID!,
    'medical'
  )
  const referenceRecords = await syncDatabase(
    process.env.NOTION_REFERENCE_DB_ID!,
    'reference'
  )

  const allRecords = [...medicalRecords, ...referenceRecords]
  console.log(`\n合計 ${allRecords.length} 件をAlgoliaに投入中...`)

  // インデックス設定
  await index.setSettings({
    searchableAttributes: ['title', 'aiSummary', 'summary', 'content', 'genre', 'detailGenre', 'tags', 'aiKeywords', 'author', 'journal', 'relatedCQTitles'],
    attributesForFaceting: ['source', 'genre', 'detailGenre', 'knowledgeLevel', 'readStatus', 'evidenceLevel'],
    customRanking: ['desc(lastEdited)'],
    highlightPreTag: '<mark>',
    highlightPostTag: '</mark>',
  })

  // バッチ投入
  const batchSize = 100
  for (let i = 0; i < allRecords.length; i += batchSize) {
    const batch = allRecords.slice(i, i + batchSize)
    await index.saveObjects(batch)
    console.log(`  投入済み: ${Math.min(i + batchSize, allRecords.length)}/${allRecords.length}`)
  }

  console.log('\n同期完了!')
}

main().catch(console.error)
