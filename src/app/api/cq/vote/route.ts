// 「私も気になる」投票のトグル。
//
// POST /api/cq/vote { cqId, voted }
//   - 認証: ログイン＋プレミアム（投稿と同じ線引き。非会員は板を見るだけ）
//   - voted=true で1票入れる（既にあれば何もしない）／false で取り消す
//   - 戻り: { ok: true, voteCount } … その疑問の最新の合計票数
//
// 誰がどれに入れたかは cq_votes にのみ残り、他人には返さない（合計と自分の分だけ）。

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveRequestPremium } from '@/lib/premium-access'
import { rateLimitAsync } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabaseReady = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  if (!supabaseReady) {
    return NextResponse.json({ error: 'サーバー設定が不足しています' }, { status: 500 })
  }

  const { premium, userId } = await resolveRequestPremium()
  if (!userId) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 })
  }
  if (!premium) {
    return NextResponse.json({ error: 'premium_required' }, { status: 403 })
  }

  // 連打・スクリプトでの票の水増しを抑える（通常の利用は1日数回）。
  if (!(await rateLimitAsync(`cq-vote:${userId}`, 60, 24 * 60 * 60_000))) {
    return NextResponse.json({ error: '投票の操作が多すぎます。時間をおいてお試しください。' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'リクエストの形式が不正です。' }, { status: 400 })
  }
  const { cqId, voted } = (body ?? {}) as { cqId?: unknown; voted?: unknown }
  if (typeof cqId !== 'string' || !cqId.trim()) {
    return NextResponse.json({ error: '対象の疑問が指定されていません。' }, { status: 400 })
  }

  try {
    const admin = createAdminClient()
    if (voted === true) {
      // 1人1票は primary key で担保。二重送信は上書きで無害に吸収する。
      await admin.from('cq_votes').upsert({ user_id: userId, cq_id: cqId }, { onConflict: 'user_id,cq_id' })
    } else {
      await admin.from('cq_votes').delete().eq('user_id', userId).eq('cq_id', cqId)
    }
    const { count } = await admin
      .from('cq_votes')
      .select('cq_id', { count: 'exact', head: true })
      .eq('cq_id', cqId)
    return NextResponse.json({ ok: true, voteCount: count ?? 0 })
  } catch {
    return NextResponse.json({ error: '投票を記録できませんでした。時間をおいてお試しください。' }, { status: 500 })
  }
}
