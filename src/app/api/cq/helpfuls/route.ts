// 「役に立った」数のまとめ読み（リーダー末尾・解決済みCQ一覧のバッジ表示用）。
//
//   GET /api/cq/helpfuls?ids=a,b,c
//     … { counts: { [objectId]: number }, mine: string[] }
//
// counts は集計値のみで個人情報を含まないため誰でも読める（/api/cq/views と同じ）。
// mine（自分が押した対象）はログイン時のみ。他人が何に押したかは誰にも返さない。
// best-effort: 未適用・env未設定・失敗時は空を返す（バッジが出ないだけ）。

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveRequestPremium } from '@/lib/premium-access'

export const dynamic = 'force-dynamic'

// 1リクエストで問い合わせる objectId の上限（一覧の全件でも十分収まる）。
const MAX_IDS = 200

export async function GET(req: Request) {
  const supabaseReady = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  if (!supabaseReady) return NextResponse.json({ counts: {}, mine: [] })

  try {
    const idsParam = new URL(req.url).searchParams.get('ids') || ''
    const ids = idsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_IDS)
    if (ids.length === 0) return NextResponse.json({ counts: {}, mine: [] })

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('cq_reactions')
      .select('object_id, user_id')
      .in('object_id', ids)
    if (error) throw new Error(error.message)

    const { userId } = await resolveRequestPremium()
    const counts: Record<string, number> = {}
    const mine: string[] = []
    for (const row of data || []) {
      const id = row.object_id as string
      counts[id] = (counts[id] || 0) + 1
      if (userId && row.user_id === userId) mine.push(id)
    }
    return NextResponse.json({ counts, mine })
  } catch {
    return NextResponse.json({ counts: {}, mine: [] })
  }
}
