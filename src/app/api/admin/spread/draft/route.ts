import { NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { requireAdmin } from '@/lib/admin-guard'
import { createAdminClient } from '@/lib/supabase/server'
import { fetchPageBlocks } from '@/lib/notion-page'
import { mapBlocksToReaderDoc } from '@/lib/reader-doc'
import { fetchSpreadNotesBlocks } from '@/lib/spread-notes'
import { canonicalPageId, type SpreadOverlay } from '@/lib/reader-spread'

/**
 * スプレッドの編集画面が使う下書きの取り出し。オーナー専用。
 *
 * 返すのは「原本（ReaderDoc）／保存済みオーバレイ／スプレッドノートのブロック」の3つ。
 * 画面はこれを材料に、オーバレイを直すたびに buildSpreadDraft → applyOverlay →
 * verifyVerbatim を手元で回して即座にプレビューと逐語検査の結果を出す。
 *
 * スプレッド（spread_doc）そのものは返さない。編集中の見た目は必ず「今の原本＋今のオーバレイ」から
 * 組み直したものにしたいため（保存済みのスプレッドを編集の土台にすると、原本が動いたときに
 * 画面と保存内容が食い違う）。保存は従来どおり PUT /api/admin/spread が行い、
 * 本文はクライアントから受け取らない。
 */
export async function GET(req: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  // 保存済みオーバレイを reader_spreads から引くので、投入・配信と同じ正準形に揃える。
  const pageId = canonicalPageId(new URL(req.url).searchParams.get('pageId'))
  if (!pageId) return NextResponse.json({ error: 'missing pageId' }, { status: 400 })

  const token = process.env.SUBSCRIPTION_NOTION_TOKEN
  if (!token) return NextResponse.json({ error: 'not configured' }, { status: 500 })

  let doc
  let notes
  try {
    const notion = new Client({ auth: token })
    const page = await notion.pages.retrieve({ page_id: pageId })
    const blocks = await fetchPageBlocks(notion, pageId)
    doc = mapBlocksToReaderDoc(page as Parameters<typeof mapBlocksToReaderDoc>[0], blocks, pageId)
    notes = await fetchSpreadNotesBlocks(notion, pageId)
  } catch {
    return NextResponse.json({ error: 'notion_fetch_failed' }, { status: 502 })
  }

  // 保存済みのオーバレイ（あれば編集の出発点にする）。無いページは空から始める。
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('reader_spreads')
    .select('overlay, status')
    .eq('page_id', pageId)
    .maybeSingle()
  if (error) return NextResponse.json({ error: 'overlay_read_failed' }, { status: 500 })

  return NextResponse.json({
    doc,
    notes: notes ?? [],
    overlay: (data?.overlay as SpreadOverlay | null) ?? {},
    status: (data?.status as string | null) ?? null,
  })
}
