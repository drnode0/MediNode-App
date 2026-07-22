// CQ参照回数のまとめ読み（「解決したみんなの臨床疑問」一覧のバッジ表示用）。
//
//   GET /api/cq/views?ids=a,b,c … 指定 object_id 群の現在の参照回数を返す。
//                                 { counts: { [objectId]: number } }
//
// 回数だけの集計値で個人情報を含まないため、会員・非会員どちらの一覧からも叩ける。
// best-effort: 未適用・env未設定・失敗時は空 { counts:{} } を返す（バッジが出ないだけ）。

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// 1リクエストで問い合わせる object_id の上限（一覧の全件でも十分収まる）。
const MAX_IDS = 200

export async function GET(req: Request) {
  const supabaseReady = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  if (!supabaseReady) return NextResponse.json({ counts: {} })

  try {
    const idsParam = new URL(req.url).searchParams.get('ids') || ''
    const ids = idsParam
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_IDS)
    if (ids.length === 0) return NextResponse.json({ counts: {} })

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('cq_views')
      .select('object_id, view_count')
      .in('object_id', ids)
    if (error) throw new Error(error.message)

    const counts: Record<string, number> = {}
    for (const row of data || []) {
      counts[row.object_id as string] = Number(row.view_count) || 0
    }
    return NextResponse.json({ counts })
  } catch {
    return NextResponse.json({ counts: {} })
  }
}
