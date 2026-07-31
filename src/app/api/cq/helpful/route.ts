// 「役に立った」リアクションのトグル。
//
// POST /api/cq/helpful { objectId, helpful }
//   - 認証: ログイン＋プレミアム（本文を読める人だけが押せる。「私も気になる」投票と同じ線引き）
//   - helpful=true で付ける（既にあれば何もしない）／false で取り消す
//   - 戻り: { ok: true, helpful, count } … その対象の最新の合計数
//
// 誰が押したかは cq_reactions にのみ残り、他人には返さない（合計と自分の分だけ）。

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

  // 連打・スクリプトでの水増しを抑える（通常の利用は1日数回）。
  if (!(await rateLimitAsync(`cq-helpful:${userId}`, 120, 24 * 60 * 60_000))) {
    return NextResponse.json({ error: '操作が多すぎます。時間をおいてお試しください。' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'リクエストの形式が不正です。' }, { status: 400 })
  }
  const { objectId, helpful } = (body ?? {}) as { objectId?: unknown; helpful?: unknown }
  if (typeof objectId !== 'string' || !objectId.trim()) {
    return NextResponse.json({ error: '対象が指定されていません。' }, { status: 400 })
  }

  try {
    const admin = createAdminClient()
    if (helpful === true) {
      // 1人1回は primary key で担保。二重送信は上書きで無害に吸収する。
      await admin
        .from('cq_reactions')
        .upsert({ user_id: userId, object_id: objectId }, { onConflict: 'user_id,object_id' })
    } else {
      await admin.from('cq_reactions').delete().eq('user_id', userId).eq('object_id', objectId)
    }
    const { count } = await admin
      .from('cq_reactions')
      .select('object_id', { count: 'exact', head: true })
      .eq('object_id', objectId)
    return NextResponse.json({ ok: true, helpful: helpful === true, count: count ?? 0 })
  } catch {
    return NextResponse.json({ error: '記録できませんでした。時間をおいてお試しください。' }, { status: 500 })
  }
}
