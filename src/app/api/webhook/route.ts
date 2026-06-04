import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import algoliasearch from 'algoliasearch'

const notion = new Client({ auth: process.env.NOTION_TOKEN })
const algolia = algoliasearch(process.env.ALGOLIA_APP_ID!, process.env.ALGOLIA_ADMIN_KEY!)
const index = algolia.initIndex(process.env.ALGOLIA_INDEX || 'medical_knowledge')

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
  if (prop.type === 'rich_text') return prop.rich_text?.map((t: any) => t.plain_text).join('') || ''
  if (prop.type === 'select') return prop.select?.name || ''
  if (prop.type === 'multi_select') return prop.multi_select?.map((s: any) => s.name).join(', ') || ''
  return ''
}

async function getPageContent(pageId: string): Promise<string> {
  try {
    const blocks = await notion.blocks.children.list({ block_id: pageId, page_size: 50 })
    const texts: string[] = []
    for (const block of blocks.results as any[]) {
      const type = block.type
      const content = (block as any)[type]
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Notion Webhook verification
    if (body.type === 'verification') {
      return NextResponse.json({ challenge: body.challenge })
    }

    const pageId = body.entity?.id || body.page_id
    if (!pageId) {
      return NextResponse.json({ ok: true })
    }

    const page = await notion.pages.retrieve({ page_id: pageId }) as any
    if (!page || page.object !== 'page') {
      return NextResponse.json({ ok: true })
    }

    const properties = page.properties
    const title = extractTitle(properties)
    const content = await getPageContent(pageId)

    const medicalDbId = process.env.NOTION_MEDICAL_DB_ID?.replace(/-/g, '')
    const refDbId = process.env.NOTION_REFERENCE_DB_ID?.replace(/-/g, '')
    const parentDbId = page.parent?.database_id?.replace(/-/g, '')
    const source = parentDbId === medicalDbId ? 'medical' : parentDbId === refDbId ? 'reference' : 'other'

    if (source === 'other') {
      return NextResponse.json({ ok: true })
    }

    await index.saveObject({
      objectID: pageId,
      title,
      source,
      genre: extractText(properties, 'ジャンル'),
      type: extractText(properties, 'タイプ'),
      tags: extractText(properties, 'タグ'),
      status: extractText(properties, 'ステータス'),
      summary: extractText(properties, 'サマリー'),
      author: extractText(properties, '著者'),
      content,
      notionUrl: page.url,
      lastEdited: page.last_edited_time,
    })

    console.log(`Updated: ${title} (${pageId})`)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('Webhook error:', error)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
