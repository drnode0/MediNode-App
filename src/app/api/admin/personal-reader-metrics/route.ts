// 個人・部署リーダー Phase 0 計測の読み出し（/admin 分析タブ）。管理者専用。
//
//   GET /api/admin/personal-reader-metrics
//     … { blockTypes: [{ type, count }], escapes: { total, byContext, recentDays }, ready }
//
// blockTypes: 個人/部署syncの穴埋め抽出が読んだ本文のtype別出現数（block_type_stats）。
//   どのブロック対応を優先するか＝降格式リーダーの対応追加をデータで決めるための分布。
// escapes: 「Notionで開く」タップ（notion_escape_taps）。発生場所別合計と直近14日の日別。
//   ＝アプリ内リーダーの需要の数値化。
// best-effort: マイグレーション0025未適用・env未設定なら ready:false（空）を返す。

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin-guard'

export const dynamic = 'force-dynamic'

const RECENT_DAYS = 14

export async function GET() {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.response

  try {
    const admin = createAdminClient()

    const { data: typeRows, error: typeErr } = await admin
      .from('block_type_stats')
      .select('block_type, seen_count')
      .order('seen_count', { ascending: false })
    if (typeErr) return NextResponse.json({ blockTypes: [], escapes: null, ready: false })

    const blockTypes = (typeRows || []).map((r) => ({
      type: String(r.block_type),
      count: Number(r.seen_count) || 0,
    }))

    // 離脱タップ。分布とテーブルが別なので、片方だけ失敗しても他方は返す。
    let escapes: {
      total: number
      byContext: Record<string, number>
      recentDays: Array<{ day: string; count: number }>
    } | null = null
    try {
      // day はJST日付で貯まる（increment_notion_escape）ので、境界もJSTで切る。
      const since = new Date(Date.now() + 9 * 60 * 60 * 1000 - RECENT_DAYS * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
      const { data: tapRows, error: tapErr } = await admin
        .from('notion_escape_taps')
        .select('context, day, tap_count')
      if (!tapErr) {
        const byContext: Record<string, number> = {}
        const byDay = new Map<string, number>()
        let total = 0
        for (const r of tapRows || []) {
          const n = Number(r.tap_count) || 0
          total += n
          const ctx = String(r.context)
          byContext[ctx] = (byContext[ctx] || 0) + n
          const day = String(r.day)
          if (day >= since) byDay.set(day, (byDay.get(day) || 0) + n)
        }
        escapes = {
          total,
          byContext,
          recentDays: [...byDay.entries()]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([day, count]) => ({ day, count })),
        }
      }
    } catch {
      // 分布だけでも返す。
    }

    return NextResponse.json({ blockTypes, escapes, ready: true })
  } catch {
    return NextResponse.json({ blockTypes: [], escapes: null, ready: false })
  }
}
