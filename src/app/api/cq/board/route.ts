// みんなの臨床疑問「受付中」の板。
//
// 作者が受付DBで「ボード公開」をONにした未対応の疑問を、票の多い順に BOARD_MAX 件返す。
// 一覧は非プレミアムにも公開する（resolved-cqs と同じ流儀。どんな疑問が動いているかは
// 購買動機になる）。返すのはタイトル・職種・ペンネーム・日付・票数だけで、
// 投稿者メールや通知先ユーザーIDのような個人が特定できる項目は一切含めない。
//
// GET /api/cq/board
//   - 認証: 不要（ログイン済みなら自分の投票状態 voted も返す）
//   - 戻り: { items: [{ id, title, posterRole, posterName, createdAt, voteCount, voted }],
//             canVote: boolean }
//   - env未設定・障害時は { items: [] }（板が出ないだけで他機能に波及させない）

import { NextResponse } from 'next/server'
import { Client } from '@notionhq/client'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveRequestPremium } from '@/lib/premium-access'
import { toBoardCqs, rankBoard, type NotionIntakePage } from '@/lib/cq-board'

export const dynamic = 'force-dynamic'

// 受付DBから引く上限。板に出すのは BOARD_MAX 件だが、
// 公開ON・未対応の絞り込みはこちら側で行うため多めに取る。
const QUERY_LIMIT = 100

export async function GET() {
  const token = process.env.CQ_INTAKE_NOTION_TOKEN || ''
  const dbId = process.env.CQ_INTAKE_DB_ID || ''
  if (!token || !dbId) return NextResponse.json({ items: [], canVote: false })

  try {
    const notion = new Client({ auth: token })
    const res = await notion.databases.query({
      database_id: dbId,
      page_size: QUERY_LIMIT,
    })
    const items = toBoardCqs(res.results as unknown as NotionIntakePage[])
    if (items.length === 0) return NextResponse.json({ items: [], canVote: false })

    // 票数と「自分が入れたか」。Supabase未設定でも板自体は出す（票が0で並ぶだけ）。
    const votes: Record<string, number> = {}
    const mine = new Set<string>()
    const supabaseReady = !!(
      process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    )
    const { premium, userId } = supabaseReady
      ? await resolveRequestPremium()
      : { premium: false, userId: null as string | null }

    if (supabaseReady) {
      const ids = items.map((i) => i.id)
      const admin = createAdminClient()
      const { data } = await admin.from('cq_votes').select('cq_id, user_id').in('cq_id', ids)
      for (const row of (data || []) as Array<{ cq_id: string; user_id: string }>) {
        votes[row.cq_id] = (votes[row.cq_id] ?? 0) + 1
        if (userId && row.user_id === userId) mine.add(row.cq_id)
      }
    }

    const ranked = rankBoard(items, votes).map((i) => ({ ...i, voted: mine.has(i.id) }))
    return NextResponse.json({ items: ranked, canVote: premium })
  } catch {
    return NextResponse.json({ items: [], canVote: false })
  }
}
