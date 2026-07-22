import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { Client } from '@notionhq/client'
import { requireSessionIfLoginRequired } from '@/lib/api-guard'
import { resolveRequestPremium } from '@/lib/premium-access'
import { fetchPageBlocks } from '@/lib/notion-page'
import { mapBlocksToReaderDoc } from '@/lib/reader-doc'

// 本文はプレミアム全員で同一なので、Notionからの取得結果をサーバー側（Vercel Data Cache）で
// 共有キャッシュする。誰かが一度読めば、以後1時間は全員 Notion API 往復なしの即応答になる。
// プレミアム判定は毎リクエスト GET 側で行う（キャッシュするのはコンテンツだけ）。
const getReaderDocCached = (pageId: string, token: string) =>
  unstable_cache(
    async () => {
      const notion = new Client({ auth: token })
      const page = await notion.pages.retrieve({ page_id: pageId })
      const blocks = await fetchPageBlocks(notion, pageId)
      return mapBlocksToReaderDoc(page as Parameters<typeof mapBlocksToReaderDoc>[0], blocks)
    },
    ['subscription-reader-doc', pageId],
    { revalidate: 3600 },
  )()

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

  try {
    const doc = await getReaderDocCached(pageId, token)
    // 本文は日次syncでしか変わらないので、ブラウザ側で長めに持たせて再訪のラグをなくす
    // （private: 会員ゲート済みコンテンツを共有キャッシュに載せない）。
    return NextResponse.json({ doc }, { headers: { 'Cache-Control': 'private, max-age=600, stale-while-revalidate=86400' } })
  } catch {
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 })
  }
}
