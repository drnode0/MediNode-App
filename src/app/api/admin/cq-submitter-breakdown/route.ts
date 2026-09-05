// 投稿者の内訳（/admin 分析タブ）。管理者専用。
//
//   GET /api/admin/cq-submitter-breakdown
//     … cq_submissions（migration 0019・アプリ内CQ投稿の管理用記録）の role（職種）・
//       years（経験年数）を集計し、件数の内訳を返す。
//       { byOccupation: [{ label, count }], byExperience: [{ label, count }], total, ready }
//
// 「聞ける棚（ask_shelf）にどんな属性の人が疑問を寄せているか」を作者が把握するための
// 集計。低件数・低頻度のアプリ規模を踏まえ、SQLの集約は使わずJSでタリーする
// （KnowledgeRankingCard・engagement と同じ、素朴な件数集計の作法に揃える）。
// best-effort: テーブル未適用なら ready:false（空の内訳）を返す。
//
// プライバシー: role・years の件数のみを返す。user_id・question 等の個人が辿れる値は返さない。
// 公開面には出さない（/admin 専用。requireAdmin で守る）。

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin-guard'

export const dynamic = 'force-dynamic'

type Tally = { label: string; count: number }

function tally(values: Array<string | null>): Tally[] {
  const counts = new Map<string, number>()
  for (const v of values) {
    const label = v && v.trim() ? v : '未回答'
    counts.set(label, (counts.get(label) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
}

export async function GET() {
  const gate = await requireAdmin()
  if (!gate.ok) return gate.response

  try {
    const admin = createAdminClient()
    const { data, error } = await admin.from('cq_submissions').select('role, years')
    if (error) {
      // テーブル未適用（マイグレーション0019待ち）など。まだ計測が始まっていない扱い。
      return NextResponse.json({ byOccupation: [], byExperience: [], total: 0, ready: false })
    }
    const rows = (data || []) as Array<{ role: string | null; years: string | null }>
    return NextResponse.json({
      byOccupation: tally(rows.map((r) => r.role)),
      byExperience: tally(rows.map((r) => r.years)),
      total: rows.length,
      ready: true,
    })
  } catch {
    return NextResponse.json({ byOccupation: [], byExperience: [], total: 0, ready: false })
  }
}
