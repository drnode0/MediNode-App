// ナレッジ参照回数ランキング（/admin 分析タブ）。管理者専用。
//
//   GET /api/admin/cq-ranking?limit=30
//     … cq_views（のべ参照回数）の上位を取り、サブスクIndexからタイトルを解決して返す。
//       { items: [{ objectID, title, count, notionUrl }], ready: boolean }
//
// 「みんながどのナレッジを気にしているか」を作者自身が把握するための一覧。
// 記録は全プレミアムナレッジ対象（recordCqView が owner==='subscription' を加算）なので、
// CQに限らず全ナレッジが対象になる。
// best-effort: テーブル未適用や env 未設定なら ready:false（空一覧）を返す。

import { NextResponse } from 'next/server'
import algoliasearch from 'algoliasearch'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin-guard'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 30
const MAX_LIMIT = 100

export async function GET(req: Request) {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.response

  const limitParam = Number(new URL(req.url).searchParams.get('limit'))
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, MAX_LIMIT) : DEFAULT_LIMIT

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('cq_views')
      .select('object_id, view_count')
      .order('view_count', { ascending: false })
      .limit(limit)
    if (error) {
      // テーブル未適用（マイグレーション0016待ち）など。まだ計測が始まっていない扱い。
      return NextResponse.json({ items: [], ready: false })
    }

    const rows = (data || []) as Array<{ object_id: string; view_count: number }>
    if (rows.length === 0) return NextResponse.json({ items: [], ready: true })

    // タイトル解決（サブスクIndex）。env未設定・失敗時はタイトルなしで回数だけ返す。
    const titles = new Map<string, string>()
    const appId = process.env.SUBSCRIPTION_ALGOLIA_APP_ID
    const adminKey = process.env.SUBSCRIPTION_ALGOLIA_ADMIN_KEY
    const indexName = process.env.SUBSCRIPTION_ALGOLIA_INDEX || 'Medical Knowledge_DB（サブスク用）'
    if (appId && adminKey) {
      try {
        const objs = await algoliasearch(appId, adminKey)
          .initIndex(indexName)
          .getObjects<Record<string, unknown>>(rows.map((r) => r.object_id), { attributesToRetrieve: ['title', 'notionUrl'] })
        for (const o of objs.results) {
          if (o && typeof o === 'object') {
            const id = String((o as Record<string, unknown>).objectID || '')
            if (id) titles.set(id, String((o as Record<string, unknown>).title || ''))
          }
        }
      } catch {
        // タイトルは付かなくても回数ランキングは返す。
      }
    }

    const items = rows.map((r) => ({
      objectID: r.object_id,
      title: titles.get(r.object_id) || '',
      count: Number(r.view_count) || 0,
    }))
    return NextResponse.json({ items, ready: true })
  } catch {
    return NextResponse.json({ items: [], ready: false })
  }
}
