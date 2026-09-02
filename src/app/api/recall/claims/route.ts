import { NextResponse } from 'next/server'
import { requireRecall, claimFromRow, serverError, CLAIMS_LIMIT, warnIfClaimsTruncated } from '@/lib/recall/guard'

export const dynamic = 'force-dynamic'

// GET 以外は Next の自動実装（OPTIONS→204+Allow／他→405）に任せず、同じ 404 で塞ぐ。
export { HEAD, OPTIONS, POST, PUT, PATCH, DELETE } from '@/lib/recall/guard'

export async function GET() {
  const g = await requireRecall()
  if (!g.ok) return g.response
  // recall_claims は RLS 有効・ポリシー無し（service_role のみが読める。supabase/migrations/0029_recall.sql）。
  // authenticated に select を開くと PostgREST 経由で誰でも主張コーパスを読めてしまい、
  // 「機能が閉じている利用者には Recall のいずれの API からも存在を見せない」という設計が崩れる。
  // そのため service_role の客体は requireRecall() の 404/401 ガードを通してのみ受け取る。
  // active の絞り込みはポリシーが無い今、このコード1行だけが担っている（消すと取り下げた主張まで出る）。
  const { data, error } = await g.admin()
    .from('recall_claims')
    .select('claim_id, page_id, page_title, page_kind, section_key, section_heading, body, source, confidence, genres, primary_genre, genre_slot, holes, cloze_status, active')
    .eq('active', true)
    .order('claim_id')
    // 件数の上限を書かないと max-rows の既定で黙って切られる（理由は guard.ts の CLAIMS_LIMIT）。
    .limit(CLAIMS_LIMIT)
  if (error) return serverError('claims の読み取りに失敗', error)
  const rows = data ?? []
  warnIfClaimsTruncated(rows.length)
  return NextResponse.json({ claims: rows.map(claimFromRow) })
}
