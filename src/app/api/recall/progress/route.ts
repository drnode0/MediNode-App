import { NextResponse } from 'next/server'
import { requireRecall, progressFromRow, readFromRow } from '@/lib/recall/guard'

export const dynamic = 'force-dynamic'

export async function GET() {
  const g = await requireRecall()
  if (!g.ok) return g.response
  const [p, r] = await Promise.all([
    g.supabase.from('recall_progress').select('claim_id, kept_at, streak, interval_days, due_at, last_reviewed_at, last_result, ok_count, ng_count, removed_at').eq('user_id', g.userId),
    g.supabase.from('recall_section_reads').select('page_id, section_key, read_at').eq('user_id', g.userId),
  ])
  if (p.error) return NextResponse.json({ error: p.error.message }, { status: 500 })
  if (r.error) return NextResponse.json({ error: r.error.message }, { status: 500 })
  return NextResponse.json({ progress: (p.data ?? []).map(progressFromRow), reads: (r.data ?? []).map(readFromRow) })
}
