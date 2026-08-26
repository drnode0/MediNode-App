import { NextRequest, NextResponse } from 'next/server'
import { unstable_cache } from 'next/cache'
import { Client } from '@notionhq/client'
import { requirePremiumRequest } from '@/lib/api-guard'
import { fetchPageBlocks } from '@/lib/notion-page'
import { mapBlocksToReaderDoc } from '@/lib/reader-doc'
import { SUBSCRIPTION_READER_TAG } from '@/lib/reader-cache'
import { createAdminClient } from '@/lib/supabase/server'
import type { SpreadDoc } from '@/lib/reader-spread'

// 本文はプレミアム全員で同一なので、Notionからの取得結果をサーバー側（Vercel Data Cache）で
// 共有キャッシュする。誰かが一度読めば、以後1時間は全員 Notion API 往復なしの即応答になる。
// プレミアム判定は毎リクエスト GET 側で行う（キャッシュするのはコンテンツだけ）。
const getReaderDocCached = (pageId: string, token: string) =>
  unstable_cache(
    async () => {
      const notion = new Client({ auth: token })
      const page = await notion.pages.retrieve({ page_id: pageId })
      const blocks = await fetchPageBlocks(notion, pageId)
      // pageId を渡すと file 画像/cover が安定プロキシURLになる（署名URL失効対策）。
      return mapBlocksToReaderDoc(page as Parameters<typeof mapBlocksToReaderDoc>[0], blocks, pageId)
    },
    ['subscription-reader-doc', pageId],
    // tags を付けることで、サブスク同期時に revalidateTag で明示パージできる
    // （付けないと最大1時間は古い本文が返り続ける）。
    { revalidate: 3600, tags: [SUBSCRIPTION_READER_TAG] },
  )()

// 公開済みの誌面だけを引く。無ければ null（＝従来の ReaderBody 描画になる）。
// Supabase 直読みは Notion API と違って速いので、Data Cache には載せない。
// 投入時に revalidateSubscriptionReaderDocs() が本文側のタグを失効させる。
async function getPublishedSpread(pageId: string): Promise<SpreadDoc | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null
  try {
    const admin = createAdminClient()
    const { data } = await admin
      .from('reader_spreads')
      .select('spread_doc')
      .eq('page_id', pageId)
      .eq('status', 'published')
      .maybeSingle()
    const spread = (data?.spread_doc as SpreadDoc | undefined) ?? null
    if (!spread) return null
    // 保存データ（spread_doc）自体は未目視の設問を含んだまま変えない。
    // /admin の目視画面はそれを必要とする。ここは読者に返す直前の関門で、
    // reviewed: true だけに絞る。visibleQuizzes（描画側）はさらに逐語一致も見るが、
    // 未目視の設問がJSONとしてブラウザに届くこと自体をここで止める。
    return { ...spread, quizzes: spread.quizzes.filter((q) => q.reviewed) }
  } catch {
    // 誌面が引けなくても本文は返す。読めなくなることだけは避ける。
    return null
  }
}

export async function GET(req: NextRequest) {
  // id の検証はセッション解決より先に済ませる（不正な id で認証サーバーへ出ないため）。
  const raw = new URL(req.url).searchParams.get('id')
  // 節レコードのobjectID（subscription_<pageId>#secN）が渡されても親ページとして解決する。
  const pageId = raw?.replace(/^subscription_/, '').replace(/#.*$/, '').trim()
  if (!pageId) return NextResponse.json({ error: 'missing id' }, { status: 400 })

  // 認証と権限を1回のセッション解決で判定する（getUser の往復を2回→1回に）。
  const { denied } = await requirePremiumRequest()
  if (denied) return denied

  const token = process.env.SUBSCRIPTION_NOTION_TOKEN
  if (!token) return NextResponse.json({ error: 'not configured' }, { status: 500 })

  try {
    const [doc, spread] = await Promise.all([getReaderDocCached(pageId, token), getPublishedSpread(pageId)])
    // 本文は日次syncでしか変わらないので、ブラウザ側で長めに持たせて再訪のラグをなくす
    // （private: 会員ゲート済みコンテンツを共有キャッシュに載せない）。
    return NextResponse.json({ doc, spread }, { headers: { 'Cache-Control': 'private, max-age=600, stale-while-revalidate=86400' } })
  } catch {
    return NextResponse.json({ error: 'fetch failed' }, { status: 502 })
  }
}
