// 抽出した主張を recall_claims に保存する。同期のたびに全件 upsert し、今回見つからなかった
// 主張を active=false にする（行は消さない。ユーザーの記録が主張IDにぶら下がる）。
// cloze_status（承認状態）と holes 以外の列は上書きしてよいが、cloze_status は管理画面の
// 判断なので同期では触らない。holes は検出規則が変わったら更新したいので上書きする。
//
// ただし1つだけ例外がある。穴が入れ替わった主張は cloze_status を pending に戻す。
// 「同期は cloze_status を書かない」という規則は、自動処理がオーナーの判断を上書きしない
// ためにある。承認は「この穴でよい」という判断であって、別の穴に対する判断ではない。
// 検出規則が変わって holes だけが差し替わると、古い承認が新しい穴にそのまま被さり、
// 誰も見ていない穴が承認済みとして読者に出る（管理画面の承認がまさにそれを止める関門
// なので、ここを素通しにすると関門ごと無効になる）。穴が変わっていなければ触らない。
//
// 非活性化の対象は「主張IDの列挙の外側」ではなく「この同期で updated_at を付け直さなかった
// 行」で選ぶ。列挙方式は主張が数百件になるとクエリ文字列が2万字を超え、リクエスト行の
// 上限に当たる（PATCH のURLに全IDが載るため）。
import type { SupabaseClient } from '@supabase/supabase-js'
import type { RecallClaim } from './types'

const CHUNK = 200

// holes の同一判定に使う文字列。jsonb から返る値と抽出結果を同じ形にしてから比べる
// （配列でない値・null が入っていても落ちないよう、配列以外は空として扱う）。
function holesKey(holes: unknown): string {
  return JSON.stringify(Array.isArray(holes) ? holes : [])
}

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
    const chunk = claims.slice(i, i + CHUNK)
    const rows = chunk.map((c) => ({
      claim_id: c.claimId, page_id: c.pageId, page_title: c.pageTitle, page_kind: c.pageKind,
      section_key: c.sectionKey, section_heading: c.sectionHeading, body: c.body, source: c.source,
      confidence: c.confidence, genres: c.genres, primary_genre: c.primaryGenre, genre_slot: c.genreSlot,
      holes: c.holes, active: true, updated_at: now,
    }))
    // 上書き前の holes を読む。1件ずつ読むと主張の数だけ往復が増えるので、upsert と同じ
    // 200件のかたまりごとに1本の select にまとめる（同期1回あたりの追加は
    // 「かたまりの数」ぶんの select と、穴が変わった主張があったときだけ同じ数の update）。
    const { data: before, error: readError } = await admin
      .from('recall_claims')
      .select('claim_id, holes')
      .in('claim_id', chunk.map((c) => c.claimId))
    if (readError) {
      throw new RecallClaimsSaveError(`recall_claims 既存 holes の読み取り失敗: ${readError.message}`, {
        upserted, deactivated: 0,
      })
    }
    const next = new Map(chunk.map((c) => [c.claimId, holesKey(c.holes)]))
    // 既に行がある主張だけが対象。新しい主張は既定値の pending で入るので戻す必要がない。
    const resetIds = (before ?? [])
      .map((r) => r as { claim_id?: unknown; holes?: unknown })
      .filter((r) => typeof r.claim_id === 'string' && next.get(r.claim_id) !== undefined && next.get(r.claim_id) !== holesKey(r.holes))
      .map((r) => r.claim_id as string)

    const { error } = await admin.from('recall_claims').upsert(rows, { onConflict: 'claim_id' })
    if (error) {
      throw new RecallClaimsSaveError(`recall_claims upsert 失敗: ${error.message}`, {
        upserted, deactivated: 0,
      })
    }
    upserted += rows.length

    if (resetIds.length) {
      // updated_at はここでは触らない。upsert が入れた now のままにしておかないと、
      // 下の非活性化（updated_at < now の active 行）の判定がずれる。
      const { error: resetError } = await admin
        .from('recall_claims')
        .update({ cloze_status: 'pending' })
        .in('claim_id', resetIds)
        .neq('cloze_status', 'pending')
      if (resetError) {
        throw new RecallClaimsSaveError(`recall_claims 承認の差し戻し失敗: ${resetError.message}`, {
          upserted, deactivated: 0,
        })
      }
    }
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
