// 抽出した主張を recall_claims に保存する。同期のたびに全件 upsert し、今回見つからなかった
// 主張を active=false にする（行は消さない。ユーザーの記録が主張IDにぶら下がる）。
// cloze_status（承認状態）以外の列は上書きしてよいが、cloze_status は管理画面の判断なので
// 同期では触らない。
//
// holes（伏せ字の範囲）は条件つきで上書きする。まだ未判断（pending）の主張には毎回いまの
// 検出結果を書く（検出規則を直したら、誰もまだ見ていない主張には反映されてほしい）。一方、
// オーナーが既に判断した主張（cloze_status が pending 以外＝承認・非承認）の holes は書き換えず、
// 保存されている値をそのまま書き戻す。
//   計画には「検出規則の改善を行き渡らせるため holes は常に上書きする」と書いたが、ここは
//   狭める。人が直した穴は検出器の当て推量より確かな情報で、それを毎晩捨てるなら承認画面
//   （穴を直す操作）が意味を失うため。自動検出の誤りは管理画面で直され、その修正が翌朝の
//   同期で検出結果に戻されて同じ誤りが復活する、という往復をここで止める。
//   ※「判断済みの行だけ holes のキーを外す」書き方にはしない。supabase-js の upsert は
//     渡した全行のキーの和集合を columns クエリに載せ、キーの無い行は NULL 扱いで書く
//     （defaultToNull の既定が true）。キーを外すと holes が NULL で潰れる。同じ値を書き戻す。
//
// 承認の差し戻し（cloze_status を pending に戻す）は upsert より先に行う。後に回すと、
// upsert が新しい holes を書いた直後に差し戻しが失敗した場合（あるいは2文の間で処理が落ちた
// 場合）、行には「新しい穴＋古い承認」が残る。次の同期は保存済み holes と新しい holes が
// 一致するので差分を見つけられず、誰も見ていない穴に承認が付いたまま二度と直らない。
// 先に戻しておけば、最悪でも「穴は書き換わっていないのに pending に戻った主張」で済み、
// オーナーが承認し直せばよい。
//
// 判断済みの主張は holes を書き換えないので、そもそも穴は変わらず差し戻しの対象にならない。
// この差し戻しが効くのは、既存行を pending として読んだ後・書き込みまでの間にオーナーが
// 承認した場合（読み取りと書き込みは同一トランザクションではない）。その1件を pending に
// 戻すのが、新しい穴に古い承認を残すより安全なので、経路は残す。
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
    // 上書き前の holes と、オーナーが判断済みかどうかを読む。1件ずつ読むと主張の数だけ
    // 往復が増えるので、upsert と同じ200件のかたまりごとに1本の select にまとめる
    // （cloze_status は列を1つ足すだけで、往復は増えない）。同期1回あたりの追加は
    // 「かたまりの数」ぶんの select と、穴が変わった主張があったときだけ同じ数の update。
    const { data: before, error: readError } = await admin
      .from('recall_claims')
      .select('claim_id, holes, cloze_status')
      .in('claim_id', chunk.map((c) => c.claimId))
    if (readError) {
      throw new RecallClaimsSaveError(`recall_claims 既存 holes の読み取り失敗: ${readError.message}`, {
        upserted, deactivated: 0,
      })
    }
    // 既存行の holes と「判断済みか」。cloze_status が文字列でない（NULL 等）行は未判断として
    // 扱う（判断済みの側を広く取ると、検出規則の改善が届かない主張が静かに増える）。
    const stored = new Map<string, { holes: unknown; decided: boolean }>()
    for (const r of (before ?? []) as Array<{ claim_id?: unknown; holes?: unknown; cloze_status?: unknown }>) {
      if (typeof r.claim_id !== 'string') continue
      stored.set(r.claim_id, {
        holes: r.holes,
        decided: typeof r.cloze_status === 'string' && r.cloze_status !== 'pending',
      })
    }
    const rows = chunk.map((c) => {
      const prev = stored.get(c.claimId)
      return {
        claim_id: c.claimId, page_id: c.pageId, page_title: c.pageTitle, page_kind: c.pageKind,
        keywords: c.keywords ?? '',
        section_key: c.sectionKey, section_heading: c.sectionHeading, body: c.body, source: c.source,
        confidence: c.confidence, genres: c.genres, primary_genre: c.primaryGenre, genre_slot: c.genreSlot,
        // 判断済みならオーナーが直した穴を書き戻す。未判断ならいまの検出結果を書く。
        holes: prev?.decided ? prev.holes : c.holes,
        active: true, updated_at: now,
      }
    })
    // 差し戻しの対象は「既に行があり・未判断として読めて・これから書く holes が保存済みと違う」主張。
    // 判断済みの主張は holes を書き換えないのでここには入らない（＝承認は消えない）。
    const resetIds = chunk
      .filter((c) => {
        const prev = stored.get(c.claimId)
        return prev !== undefined && !prev.decided && holesKey(prev.holes) !== holesKey(c.holes)
      })
      .map((c) => c.claimId)

    if (resetIds.length) {
      // upsert より先に出す。順序の理由はファイル冒頭に書いた（後に回すと、新しい穴に古い
      // 承認が付いた行が残り、次の同期は差分を見つけられない）。
      // updated_at はここでは触らない。この後の upsert が入れる now のままにしておかないと、
      // 下の非活性化（updated_at < now の active 行）の判定がずれる。
      // neq があるので、読み取り時に pending だった行はサーバー側で対象外になる。実際に書き換わる
      // のは、読み取りから今までの間にオーナーが判断した行だけ（無駄な更新を出さない）。
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
