import { Client } from '@notionhq/client'

export const notion = new Client({
  auth: process.env.NOTION_TOKEN,
})

export async function updateAlgoliaRecord(pageId: string) {
  const page = await notion.pages.retrieve({ page_id: pageId }) as any
  return page
}
