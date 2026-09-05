// 段0の層2（節・記事）と層3（板の近い疑問）の取得。どちらも既存の経路をそのまま使い、
// 新しい索引・新しい保管場所を作らない。失敗しても空配列を返し、段0全体は止めない
// （層1が出ていれば段0は成立する）。
import { Client } from '@notionhq/client'
import type { ShelfSection, ShelfBoardItem } from './rank'
import { createSubscriptionSearchClient, getSubscriptionIndexName } from '@/lib/algolia'
import { toBoardCqs, rankBoard, type NotionIntakePage } from '@/lib/cq-board'
import { createAdminClient } from '@/lib/supabase/server'

type SectionHit = {
  objectID?: unknown
  parentId?: unknown
  title?: unknown
  sectionNo?: unknown
  sectionTitle?: unknown
}

export async function fetchSections(query: string): Promise<ShelfSection[]> {
  try {
    // 既存のサブスク索引に節レコード（recordType:section）がある。
    // parentId は親ページの objectID そのもの（`subscription_<pageId>`。
    // src/app/api/subscription/sync/_core.ts）。recall_claims.page_id は
    // normalizePageId（trim・lowercase・ダッシュ除去、src/lib/recall/claim-text.ts）
    // を通した「素のpageId」で保存されているため、比べる前に prefix を落として揃える
    // （揃えないと層1・層2の重複判定が常に不一致になる）。
    const client = createSubscriptionSearchClient()
    const index = client.initIndex(getSubscriptionIndexName())
    const { hits } = await index.search<SectionHit>(query, {
      filters: 'recordType:section',
      hitsPerPage: 8,
    })
    return hits.map((h) => {
      const sectionNo = h.sectionNo != null ? String(h.sectionNo) : ''
      const sectionTitle = String(h.sectionTitle ?? '')
      return {
        objectID: String(h.objectID ?? ''),
        pageId: String(h.parentId ?? '').replace(/^subscription_/, '').replace(/-/g, '').toLowerCase(),
        pageTitle: String(h.title ?? ''),
        sectionHeading: sectionNo ? `${sectionNo}. ${sectionTitle}` : sectionTitle,
      }
    })
  } catch (err) {
    console.error('[ask-shelf] 節の取得に失敗（層2は空で続行）:', err)
    return []
  }
}

export async function fetchBoardItems(): Promise<ShelfBoardItem[]> {
  try {
    // 板の取得ロジックは /api/cq/board（src/app/api/cq/board/route.ts）と同じ経路を
    // ここでも組み立てる。cq-board.ts は純関数だけで fetch を持たないため。
    const token = process.env.CQ_INTAKE_NOTION_TOKEN || ''
    const dbId = process.env.CQ_INTAKE_DB_ID || ''
    if (!token || !dbId) return []

    const notion = new Client({ auth: token })
    const res = await notion.databases.query({ database_id: dbId, page_size: 100 })
    const items = toBoardCqs(res.results as unknown as NotionIntakePage[])
    if (items.length === 0) return []

    const votes: Record<string, number> = {}
    const supabaseReady = !!(
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    )
    if (supabaseReady) {
      const ids = items.map((i) => i.id)
      const admin = createAdminClient()
      const { data } = await admin.from('cq_votes').select('cq_id, user_id').in('cq_id', ids)
      for (const row of (data || []) as Array<{ cq_id: string; user_id: string }>) {
        votes[row.cq_id] = (votes[row.cq_id] ?? 0) + 1
      }
    }

    return rankBoard(items, votes).map((i) => ({ id: i.id, title: i.title, voteCount: i.voteCount }))
  } catch (err) {
    console.error('[ask-shelf] 板の取得に失敗（層3は空で続行）:', err)
    return []
  }
}
