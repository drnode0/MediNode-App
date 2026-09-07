// Essentials の制作進捗（/admin Essentials タブ）。管理者専用。
//
//   GET /api/admin/essentials            … 5分以内に読んだ結果があればそれを返す
//   GET /api/admin/essentials?refresh=1  … Notion を読み直す
//
// Notion の2つのDB（制作DB＝主題1行、出典台帳DB＝論文1行）を全件読んで返す。
// 進捗の中身はこのリポジトリに置かない。DBのIDは環境変数、本文は Notion にだけある。
//   ESSENTIALS_NOTION_DB          … 📚 Essentials 制作DB のID
//   ESSENTIALS_SOURCES_NOTION_DB  … 📄 出典台帳DB のID
//   SUBSCRIPTION_NOTION_TOKEN     … 既存の連携トークン（両DBをこの連携に共有しておく）
//
// 未設定・未共有は 200 で { ready:false, reason } を返す。画面がその理由を出して、直す場所を示す。
// 500 で落とすと「壊れた」に見えるが、実際は設定の手順が1つ残っているだけなので区別する。

import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import {
  fetchNotionDatabase,
  mapSourcePage,
  mapTopicPage,
  spreadReadyTopicIds,
  type EssentialsSource,
  type EssentialsTopic,
} from '@/lib/essentials-admin'
import { createAdminClient } from '@/lib/supabase/server'
import { subscriptionRowOf } from '@/lib/spread-progress'
import { isWithheldFromReaders } from '@/lib/subscription-publish-gate'

export const dynamic = 'force-dynamic'

export type EssentialsPayload =
  | {
      ready: true
      topics: EssentialsTopic[]
      sources: EssentialsSource[]
      fetchedAt: string
      topicsDbUrl: string
      sourcesDbUrl: string
      // 段階6のまま、スプレッドが読者に出ている主題。画面が「段階を7に上げる」を出す。
      spreadReadyTopicIds: string[]
    }
  | { ready: false; reason: 'not_configured'; missing: string[] }
  | { ready: false; reason: 'not_shared'; topicsDbUrl: string; sourcesDbUrl: string }
  | { ready: false; reason: 'fetch_failed'; detail: string }

const CACHE_TTL_MS = 5 * 60 * 1000
let cache: { at: number; body: EssentialsPayload } | null = null

function notionUrl(id: string): string {
  return `https://www.notion.so/${id.replace(/-/g, '')}`
}

export async function GET(req: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.response

  const refresh = new URL(req.url).searchParams.get('refresh') === '1'
  if (!refresh && cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return NextResponse.json(cache.body)
  }

  const topicsDb = process.env.ESSENTIALS_NOTION_DB
  const sourcesDb = process.env.ESSENTIALS_SOURCES_NOTION_DB
  const token = process.env.SUBSCRIPTION_NOTION_TOKEN
  const missing = [
    !topicsDb && 'ESSENTIALS_NOTION_DB',
    !sourcesDb && 'ESSENTIALS_SOURCES_NOTION_DB',
    !token && 'SUBSCRIPTION_NOTION_TOKEN',
  ].filter((x): x is string => !!x)
  if (!topicsDb || !sourcesDb || !token) {
    const body: EssentialsPayload = { ready: false, reason: 'not_configured', missing }
    return NextResponse.json(body)
  }

  const [topicsRes, sourcesRes] = await Promise.all([
    fetchNotionDatabase(topicsDb, token),
    fetchNotionDatabase(sourcesDb, token),
  ])

  let body: EssentialsPayload
  if (!topicsRes.ok || !sourcesRes.ok) {
    const failed = [topicsRes, sourcesRes].filter((r): r is Extract<typeof r, { ok: false }> => !r.ok)
    if (failed.some((r) => r.reason === 'not_shared')) {
      body = { ready: false, reason: 'not_shared', topicsDbUrl: notionUrl(topicsDb), sourcesDbUrl: notionUrl(sourcesDb) }
    } else {
      const detail = failed.map((r) => (r.status ? `${r.reason} (${r.status})` : r.reason)).join(', ')
      body = { ready: false, reason: 'fetch_failed', detail }
    }
    // 失敗はキャッシュしない。共有し直した直後に「まだ未共有」と5分間言い続けないため。
    return NextResponse.json(body)
  }

  // 読者に出ているスプレッドの記事名。サブスクDBの一覧（制作ステータス）と
  // reader_spreads（公開状態）の両方を見ないと「読者に出ている」は決まらない。
  // どちらかが引けなければ促さない（空配列）。誤って段階を上げさせないため。
  const topics = topicsRes.pages.map(mapTopicPage)
  let readyTitles: string[] = []
  const subDb = process.env.SUBSCRIPTION_MEDICAL_DB_ID
  if (subDb) {
    try {
      const admin = createAdminClient()
      const [{ data: spreadRows }, subRes] = await Promise.all([
        admin.from('reader_spreads').select('page_id').eq('status', 'published'),
        fetchNotionDatabase(subDb, token),
      ])
      if (subRes.ok && spreadRows) {
        const published = new Set((spreadRows as { page_id: string }[]).map((r) => r.page_id))
        readyTitles = subRes.pages
          .map(subscriptionRowOf)
          .filter((r) => published.has(r.pageId) && !isWithheldFromReaders(r.productionStatus))
          .map((r) => r.title)
      }
    } catch {
      // 促しが出ないだけ。Essentials タブ自体は出す。
      readyTitles = []
    }
  }

  body = {
    ready: true,
    topics,
    sources: sourcesRes.pages.map(mapSourcePage),
    fetchedAt: new Date().toISOString(),
    topicsDbUrl: notionUrl(topicsDb),
    sourcesDbUrl: notionUrl(sourcesDb),
    spreadReadyTopicIds: spreadReadyTopicIds(topics, readyTitles),
  }
  cache = { at: Date.now(), body }
  return NextResponse.json(body)
}
