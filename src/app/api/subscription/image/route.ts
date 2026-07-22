import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { Client } from '@notionhq/client'
import { requireSessionIfLoginRequired } from '@/lib/api-guard'
import { resolveRequestPremium } from '@/lib/premium-access'

// 画像プロキシ（署名URL失効対策）。
// Notionアップロード画像（type:'file'）の署名URLは約1hで失効するため、リーダー本文には
// この安定したプロキシURLを載せ、表示のたびにここが Notion から新しい署名URLを取り直して
// リダイレクトする。これで doc をキャッシュしても画像が「時々ハテナ」にならない。
//
// 対象は id（=pageId）＋ b（=blockId）で画像ブロック、または id＋cover=1 でページカバー。
// プレミアム限定（/api/subscription/page と同じゲート）。取り直したURLは Notion 往復を
// 減らすため短時間だけキャッシュ（署名の約1h失効より十分短い25分）。

function fileUrl(node: unknown): string | null {
  const n = node as { type?: string; external?: { url?: string }; file?: { url?: string } } | null
  if (!n) return null
  if (n.type === 'external') return n.external?.url ?? null
  if (n.type === 'file') return n.file?.url ?? null
  return n.external?.url ?? n.file?.url ?? null
}

const freshBlockImageUrl = (blockId: string, token: string) =>
  unstable_cache(
    async () => {
      const notion = new Client({ auth: token })
      const block = await notion.blocks.retrieve({ block_id: blockId })
      return fileUrl((block as { image?: unknown }).image)
    },
    ['subscription-image-block', blockId],
    { revalidate: 1500 }, // 25分 < Notion署名の約1h失効
  )()

const freshCoverUrl = (pageId: string, token: string) =>
  unstable_cache(
    async () => {
      const notion = new Client({ auth: token })
      const page = await notion.pages.retrieve({ page_id: pageId })
      return fileUrl((page as { cover?: unknown }).cover)
    },
    ['subscription-image-cover', pageId],
    { revalidate: 1500 },
  )()

export async function GET(req: NextRequest) {
  const denied = await requireSessionIfLoginRequired()
  if (denied) return denied

  const sp = new URL(req.url).searchParams
  const pageId = sp.get('id')?.replace(/^subscription_/, '').trim()
  const blockId = sp.get('b')?.trim()
  const isCover = sp.get('cover') === '1'
  if (!blockId && !(isCover && pageId)) {
    return NextResponse.json({ error: 'missing id' }, { status: 400 })
  }

  const { premium } = await resolveRequestPremium()
  if (!premium) return NextResponse.json({ error: 'premium required' }, { status: 403 })

  const token = process.env.SUBSCRIPTION_NOTION_TOKEN
  if (!token) return NextResponse.json({ error: 'not configured' }, { status: 500 })

  try {
    const url = isCover
      ? (pageId ? await freshCoverUrl(pageId, token) : null)
      : (blockId ? await freshBlockImageUrl(blockId, token) : null)
    if (!url) return NextResponse.json({ error: 'not found' }, { status: 404 })
    // Location と Cache-Control を確実に両立させるため手組みで返す（307＝GETのまま転送）。
    return new NextResponse(null, {
      status: 307,
      headers: { Location: url, 'Cache-Control': 'private, max-age=300' },
    })
  } catch {
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 })
  }
}
