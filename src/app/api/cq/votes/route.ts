// 「気になる」票のまとめ読み。
//
//   GET /api/cq/votes?ids=a,b,c
//     → { counts: { [cqId]: number }, mine: string[] }
//
// /cq の「みんなが待っている問い」は、作者のCQ（プレミアムindexのobjectID）と
// 読者投稿（受付DBのページID）が同じ空に並ぶ。板のAPIは受付DB側しか知らないので、
// idを渡して票だけを引く口をここに置く。
//
// counts は集計値で個人情報を含まないため会員・非会員どちらからも引ける。
// mine（自分が入れた分）はログインしている本人にだけ返す。
// 他人が誰に入れたかは一切返さない（cq_votes の扱いは board と同じ）。

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveRequestPremium } from '@/lib/premium-access'

export const dynamic = 'force-dynamic'

// 1リクエストで問い合わせる id の上限（空に浮かぶ件数でも十分収まる）。
const MAX_IDS = 100

export async function GET(req: NextRequest) {
  const supabaseReady = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  if (!supabaseReady) return NextResponse.json({ counts: {}, mine: [] })

  try {
    const ids = (new URL(req.url).searchParams.get('ids') || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_IDS)
    if (ids.length === 0) return NextResponse.json({ counts: {}, mine: [] })

    const { userId } = await resolveRequestPremium()
    const admin = createAdminClient()
    const { data, error } = await admin.from('cq_votes').select('cq_id, user_id').in('cq_id', ids)
    if (error) throw new Error(error.message)

    const counts: Record<string, number> = {}
    const mine: string[] = []
    for (const row of (data || []) as Array<{ cq_id: string; user_id: string }>) {
      counts[row.cq_id] = (counts[row.cq_id] ?? 0) + 1
      if (userId && row.user_id === userId) mine.push(row.cq_id)
    }
    return NextResponse.json({ counts, mine })
  } catch {
    // 票が出ないだけ。空そのものは成立する。
    return NextResponse.json({ counts: {}, mine: [] })
  }
}
