import { NextResponse } from 'next/server'
import { requireRecall, progressFromRow, readFromRow, serverError } from '@/lib/recall/guard'

export const dynamic = 'force-dynamic'

// GET 以外は Next の自動実装（OPTIONS→204+Allow／他→405）に任せず、同じ 404 で塞ぐ。
export { HEAD, OPTIONS, POST, PUT, PATCH, DELETE } from '@/lib/recall/guard'

export async function GET() {
  const g = await requireRecall()
  if (!g.ok) return g.response
  // 本人の記録は RLS 下のユーザースコープのクライアントで読む（service_role は使わない）。
  const [p, r] = await Promise.all([
    g.supabase.from('recall_progress').select('claim_id, kept_at, streak, interval_days, due_at, last_reviewed_at, last_result, ok_count, ng_count, removed_at').eq('user_id', g.userId),
    g.supabase.from('recall_section_reads').select('page_id, section_key, read_at').eq('user_id', g.userId),
  ])
  if (p.error) return serverError('progress の読み取りに失敗', p.error)
  if (r.error) return serverError('section_reads の読み取りに失敗', r.error)
  // 1人分の記録なので、どの層にも残させない。
  return NextResponse.json(
    { progress: (p.data ?? []).map(progressFromRow), reads: (r.data ?? []).map(readFromRow) },
    { headers: { 'Cache-Control': 'private, no-store' } },
  )
}
