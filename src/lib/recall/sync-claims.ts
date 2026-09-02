// 抽出した主張を recall_claims に保存する。同期のたびに全件 upsert し、今回見つからなかった
// 主張を active=false にする（行は消さない。ユーザーの記録が主張IDにぶら下がる）。
// cloze_status（承認状態）と holes 以外の列は上書きしてよいが、cloze_status は管理画面の
// 判断なので同期では触らない。holes は検出規則が変わったら更新したいので上書きする。
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RecallClaim } from './types'

const CHUNK = 200

export async function saveRecallClaims(
  admin: SupabaseClient,
  claims: RecallClaim[],
): Promise<{ upserted: number; deactivated: number }> {
  if (!claims.length) return { upserted: 0, deactivated: 0 }
  const now = new Date().toISOString()
  for (let i = 0; i < claims.length; i += CHUNK) {
    const rows = claims.slice(i, i + CHUNK).map((c) => ({
      claim_id: c.claimId, page_id: c.pageId, page_title: c.pageTitle, page_kind: c.pageKind,
      section_key: c.sectionKey, section_heading: c.sectionHeading, body: c.body, source: c.source,
      confidence: c.confidence, genres: c.genres, primary_genre: c.primaryGenre, genre_slot: c.genreSlot,
      holes: c.holes, active: true, updated_at: now,
    }))
    const { error } = await admin.from('recall_claims').upsert(rows, { onConflict: 'claim_id' })
    if (error) throw new Error(`recall_claims upsert 失敗: ${error.message}`)
  }
  const ids = claims.map((c) => c.claimId)
  const { error, count } = await admin
    .from('recall_claims')
    .update({ active: false, updated_at: now })
    .eq('active', true)
    .not('claim_id', 'in', `(${ids.map((id) => `"${id}"`).join(',')})`)
  if (error) throw new Error(`recall_claims inactive 化失敗: ${error.message}`)
  return { upserted: claims.length, deactivated: count ?? 0 }
}
