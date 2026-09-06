// 段1の1日20回。オーナー専用の v1 では課金の線ではなく、
// 不具合でボタンが連打されたときの止め弁として置く。
//
// 数える場所を Upstash ではなく Supabase の記録にした理由は monthly-limit.ts と同じ
// (Upstash が本番未設定で、未設定だと rate-limit.ts はメモリ版に落ちる。
//  サーバーが入れ替わるたびにカウンタが消えるので窓を保てない）。
//
// 月5件が30日の移動窓なのに対し、こちらは暦日にする。「本日の残り」を出すため。
import { STAGE1_LAST_ONE_NOTICE, STAGE1_LIMIT_REACHED } from './copy'

export const DAILY_LIMIT = 20

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/** now を含む JST の暦日の 0 時を返す。サーバーは UTC で動くので、ここで足して引く。 */
export function jstDayStart(now: Date): Date {
  const jst = new Date(now.getTime() + JST_OFFSET_MS)
  const start = Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate())
  return new Date(start - JST_OFFSET_MS)
}

export function dailyLimitState(count: number): { blocked: boolean; remaining: number; notice: string | null } {
  const remaining = Math.max(DAILY_LIMIT - count, 0)
  if (remaining === 0) return { blocked: true, remaining, notice: STAGE1_LIMIT_REACHED }
  return { blocked: false, remaining, notice: remaining === 1 ? STAGE1_LAST_ONE_NOTICE : null }
}

/**
 * 成功の返事に乗せる残り回数と案内。
 * 数えた count は「この呼び出しが記録される前」の件数なので、+1 してから判定する。
 * 素の dailyLimitState をそのまま使うと、この呼び出しで上限に達したときに
 * 「あと1回です」と誤って伝える一つずれになる（monthly-limit.ts の
 * noticeAfterSubmission がこれと同じ罠を踏んで直された）。
 * ちょうど上限に達したときの notice は止め文言なので、成功の返事には混ぜない。
 */
export function noticeAfterStage1(countBeforeThisCall: number): { remaining: number; notice: string | null } {
  const after = dailyLimitState(countBeforeThisCall + 1)
  return { remaining: after.remaining, notice: after.blocked ? null : after.notice }
}
