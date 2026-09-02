import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireRecall, claimFromRow } from '@/lib/recall/guard'

export const dynamic = 'force-dynamic'

export async function GET() {
  const g = await requireRecall()
  if (!g.ok) return g.response
  // recall_claims は RLS 有効・ポリシー無し（service_role のみが読める。supabase/migrations/0029_recall.sql）。
  // authenticated に select を開くと PostgREST 経由で誰でも主張コーパスを読めてしまい、
  // 「機能が閉じている利用者には Recall のいずれの API からも存在を見せない」という設計が崩れる。
  // そのため requireRecall() の 404/401 ガードを通過した後にのみ、service_role で読む。
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('recall_claims')
    .select('claim_id, page_id, page_title, page_kind, section_key, section_heading, body, source, confidence, genres, primary_genre, genre_slot, holes, cloze_status, active')
    .eq('active', true)
    .order('claim_id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ claims: (data ?? []).map(claimFromRow) })
}
