import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { requireSessionIfLoginRequired } from '@/lib/api-guard'
import { resolveRequestPremium } from '@/lib/premium-access'
import { fetchPageBlocks } from '@/lib/notion-page'
import { mapBlocksToReaderDoc } from '@/lib/reader-doc'

export async function GET(req: NextRequest) {
  const denied = await requireSessionIfLoginRequired()
  if (denied) return denied

  const raw = new URL(req.url).searchParams.get('id')
  const pageId = raw?.replace(/^subscription_/, '').trim()
  if (!pageId) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  const { premium } = await resolveRequestPremium()
  if (!premium) return NextResponse.json({ error: 'premium required' }, { status: 403 })

  const token = process.env.SUBSCRIPTION_NOTION_TOKEN
  if (!token) return NextResponse.json({ error: 'not configured' }, { status: 500 })

  const notion = new Client({ auth: token })
  try {
    const page = await notion.pages.retrieve({ page_id: pageId })
    const blocks = await fetchPageBlocks(notion as any, pageId)
    const doc = mapBlocksToReaderDoc(page as any, blocks)
    return NextResponse.json({ doc }, { headers: { 'Cache-Control': 'private, max-age=120' } })
  } catch {
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 })
  }
}
