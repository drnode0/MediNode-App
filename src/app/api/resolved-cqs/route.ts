// 解決済み臨床疑問の公開ティーザーAPI。
// 「どんな疑問がどのくらいのペースで解決されているか」を非プレミアムにも見せて
// 購買動機につなげるため、認証なしで一覧を返す。ただし返すのはタイトル・職種・
// ペンネーム・日付のみで、ナレッジ本文へのリンク（notionUrl）や要約は含めない
// （本文はプレミアム限定のまま）。
//
// GET /api/resolved-cqs
//   - 認証: なし（公開）
//   - 戻り: { items: [{ objectID, title, posterRole, posterName, createdAt }] }

import { NextResponse } from 'next/server'
import algoliasearch from 'algoliasearch'

export async function GET() {
  const appId = process.env.SUBSCRIPTION_ALGOLIA_APP_ID
  const adminKey = process.env.SUBSCRIPTION_ALGOLIA_ADMIN_KEY
  // インデックス名は同期側（sync/_core.ts）・検索側（lib/algolia.ts）と一致させる。
  const indexName = process.env.SUBSCRIPTION_ALGOLIA_INDEX || 'Medical Knowledge_DB（サブスク用）'
  if (!appId || !adminKey) {
    return NextResponse.json({ items: [] })
  }

  try {
    const res = await algoliasearch(appId, adminKey)
      .initIndex(indexName)
      .search('', {
        filters: 'origin:"現場の疑問"',
        hitsPerPage: 100,
        attributesToRetrieve: ['title', 'posterRole', 'posterName', 'createdAt'],
        attributesToHighlight: [],
      })
    const items = (res.hits as Array<Record<string, unknown>>).map((h) => ({
      objectID: String(h.objectID || ''),
      title: String(h.title || ''),
      posterRole: String(h.posterRole || ''),
      posterName: String(h.posterName || ''),
      createdAt: String(h.createdAt || ''),
    }))
    // ティーザーはCDNキャッシュ可（更新は同期タイミングのみで、鮮度要件も緩い）
    return NextResponse.json(
      { items },
      { headers: { 'Cache-Control': 'public, s-maxage=600, stale-while-revalidate=3600' } },
    )
  } catch {
    return NextResponse.json({ items: [] })
  }
}
