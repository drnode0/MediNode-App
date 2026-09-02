// 抽出した主張を recall_claims に保存する。同期のたびに全件 upsert し、今回見つからなかった
// 主張を active=false にする（行は消さない。ユーザーの記録が主張IDにぶら下がる）。
// cloze_status（承認状態）と holes 以外の列は上書きしてよいが、cloze_status は管理画面の
// 判断なので同期では触らない。holes は検出規則が変わったら更新したいので上書きする。
//
// 非活性化の対象は「主張IDの列挙の外側」ではなく「この同期で updated_at を付け直さなかった
// 行」で選ぶ。列挙方式は主張が数百件になるとクエリ文字列が2万字を超え、リクエスト行の
// 上限に当たる（PATCH のURLに全IDが載るため）。
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RecallClaim } from './types'

const CHUNK = 200

export type SaveRecallClaimsOptions = {
  // Notion の全ページからブロックを取得できたときだけ true。1ページでも取りこぼしがあれば
  // false にし、非活性化そのものを行わない（取りこぼし＝主張の消失に見えるため）。
  canDeactivate: boolean
}

export type SaveRecallClaimsCounts = { upserted: number; deactivated: number }

/**
 * 途中まで書けた件数を持ったまま投げるエラー。
 *
 * 例外を投げる前に何行書けたのかを添えないと、呼び出し側（_core.ts）は「0件」としか
 * ログできない。数百行を upsert した直後に非活性化だけ失敗した場合でも運用者のログには
 * 0件と出てしまい、実際に起きたことと食い違う。
 */
export class RecallClaimsSaveError extends Error {
  readonly counts: SaveRecallClaimsCounts
  constructor(message: string, counts: SaveRecallClaimsCounts) {
    super(message)
    this.name = 'RecallClaimsSaveError'
    this.counts = counts
  }
}

export async function saveRecallClaims(
  admin: SupabaseClient,
  claims: RecallClaim[],
  options: SaveRecallClaimsOptions,
): Promise<SaveRecallClaimsCounts> {
  if (!claims.length) return { upserted: 0, deactivated: 0 }
  const now = new Date().toISOString()
  // 実際に書けた行数を積み上げる。途中で失敗したときに「どこまで書けたか」を
  // 例外へ載せるため、claims.length を最後にまとめて返す形にはしない。
  let upserted = 0
  for (let i = 0; i < claims.length; i += CHUNK) {
    const rows = claims.slice(i, i + CHUNK).map((c) => ({
      claim_id: c.claimId, page_id: c.pageId, page_title: c.pageTitle, page_kind: c.pageKind,
      section_key: c.sectionKey, section_heading: c.sectionHeading, body: c.body, source: c.source,
      confidence: c.confidence, genres: c.genres, primary_genre: c.primaryGenre, genre_slot: c.genreSlot,
      holes: c.holes, active: true, updated_at: now,
    }))
    const { error } = await admin.from('recall_claims').upsert(rows, { onConflict: 'claim_id' })
    if (error) {
      throw new RecallClaimsSaveError(`recall_claims upsert 失敗: ${error.message}`, {
        upserted, deactivated: 0,
      })
    }
    upserted += rows.length
  }
  if (!options.canDeactivate) {
    console.warn(
      'recall_claims: 本文を取得できなかったページがあったため、非活性化は行いませんでした（保存のみ実施）',
    )
    return { upserted, deactivated: 0 }
  }
  // upsert した行は updated_at === now。それより古い active な行が「今回見つからなかった主張」。
  const { error, count } = await admin
    .from('recall_claims')
    .update({ active: false, updated_at: now }, { count: 'exact' })
    .eq('active', true)
    .lt('updated_at', now)
  if (error) {
    throw new RecallClaimsSaveError(`recall_claims inactive 化失敗: ${error.message}`, {
      upserted, deactivated: 0,
    })
  }
  return { upserted, deactivated: count ?? 0 }
}
