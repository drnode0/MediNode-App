import { NextRequest, NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { resolveRequestPremium } from '@/lib/premium-access'
import { fetchPageBlocks } from '@/lib/notion-page'
import { mapBlocksToReaderDoc } from '@/lib/reader-doc'

export async function GET(req: NextRequest) {
  const pageId = new URL(req.url).searchParams.get('id')?.replace(/^subscription_/, '').trim()
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
    const firstImage = doc.blocks.find((b) => b.kind === 'image') as { url: string } | undefined
    const url = doc.cover || firstImage?.url
    if (!url) return NextResponse.json({ error: 'no image' }, { status: 404 })
    return NextResponse.redirect(url, { status: 302, headers: { 'Cache-Control': 'private, max-age=600' } })
  } catch {
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 })
  }
}
