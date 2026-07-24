// エンゲージメント・継続の純粋集計ロジック。
//
// DB I/O は /api/admin/engagement（route）で行い、ここは「取得済みの行」を受けて数えるだけ。
// admin-daily.ts / ledger-metrics.ts と同じ流儀（純粋関数＝fixtureでテスト可能）。
//
// プライバシー: 入力は日付・user_id・種別のみ。何を検索/閲覧したかは扱わない。

import { pct } from './ledger-metrics'

export { pct }

const DAY_MS = 24 * 60 * 60 * 1000

// 「有効会員」= 現在プレミアムにアクセスできる人（課金＋各種試用）。
// ledger-metrics の TRIAL_OR_PAID と同義（会員稼働率の分母を台帳と一致させる）。
export const ACTIVE_MEMBER_KINDS = ['premium', 'stripe_trial', 'trial', 'auto_trial'] as const

type DailyRow = { used_on: string }
type DailyUserRow = { user_id: string; used_on: string }
type MemberRow = { kind: string; lastUsedAt: string | null }

/** その日付の行数（app_usage_daily は user×日でユニークなので = その日のユニーク使用者数）。 */
export function countUsageOn(dailyRows: DailyRow[], dateKey: string): number {
  return dailyRows.reduce((n, r) => (r.used_on === dateKey ? n + 1 : n), 0)
}

/** 直近7日（keys）の日次件数の平均（四捨五入）。keys が空なら0。 */
export function avgDailyUnique(dailyRows: DailyRow[], last7Keys: string[]): number {
  if (last7Keys.length === 0) return 0
  const sum = last7Keys.reduce((s, k) => s + countUsageOn(dailyRows, k), 0)
  return Math.round(sum / last7Keys.length)
}

/** 有効会員のうち lastUsedAt が days 日以内の割合。分母は有効会員のみ。 */
export function memberActiveRate(
  members: MemberRow[],
  nowMs: number,
  days = 7,
): { active: number; total: number; pct: number } {
  const eligible = members.filter((m) =>
    (ACTIVE_MEMBER_KINDS as readonly string[]).includes(m.kind),
  )
  const windowMs = days * DAY_MS
  const active = eligible.filter((m) => {
    if (!m.lastUsedAt) return false
    const t = Date.parse(m.lastUsedAt)
    if (Number.isNaN(t)) return false
    return nowMs - t <= windowMs
  }).length
  return { active, total: eligible.length, pct: pct(active, eligible.length) }
}

/** スティッキネス DAU/MAU（%）。 */
export function stickiness(dauToday: number, mau: number): number {
  return pct(dauToday, mau)
}

/** 直近7日の「利用日数」分布とリピーター率（利用日数≥2 / ≥1）。 */
export function continuityDistribution(
  dailyUserRows: DailyUserRow[],
  last7Keys: string[],
): { buckets: { d1: number; d2_3: number; d4_6: number; daily: number }; repeaterRate: number } {
  const keySet = new Set(last7Keys)
  // user_id → その週に利用した「日」の集合（重複日は1回）。
  const daysByUser = new Map<string, Set<string>>()
  for (const r of dailyUserRows) {
    if (!keySet.has(r.used_on)) continue
    let set = daysByUser.get(r.user_id)
    if (!set) {
      set = new Set()
      daysByUser.set(r.user_id, set)
    }
    set.add(r.used_on)
  }
  const buckets = { d1: 0, d2_3: 0, d4_6: 0, daily: 0 }
  let atLeastOne = 0
  let atLeastTwo = 0
  for (const set of daysByUser.values()) {
    const n = set.size
    if (n < 1) continue
    atLeastOne += 1
    if (n >= 2) atLeastTwo += 1
    if (n === 1) buckets.d1 += 1
    else if (n <= 3) buckets.d2_3 += 1
    else if (n <= 6) buckets.d4_6 += 1
    else buckets.daily += 1
  }
  return { buckets, repeaterRate: pct(atLeastTwo, atLeastOne) }
}

/** 週次の継続／新規・復帰／離脱注意。窓は「直近7日」と「その前7日」。 */
export function weeklyRetention(
  dailyUserRows: DailyUserRow[],
  thisWeekKeys: string[],
  lastWeekKeys: string[],
): { thisWeekActive: number; continuing: number; newOrReturning: number; churnRisk: number } {
  const thisSet = new Set(thisWeekKeys)
  const lastSet = new Set(lastWeekKeys)
  const thisWeekUsers = new Set<string>()
  const lastWeekUsers = new Set<string>()
  for (const r of dailyUserRows) {
    if (thisSet.has(r.used_on)) thisWeekUsers.add(r.user_id)
    if (lastSet.has(r.used_on)) lastWeekUsers.add(r.user_id)
  }
  let continuing = 0
  let newOrReturning = 0
  for (const u of thisWeekUsers) {
    if (lastWeekUsers.has(u)) continuing += 1
    else newOrReturning += 1
  }
  let churnRisk = 0
  for (const u of lastWeekUsers) {
    if (!thisWeekUsers.has(u)) churnRisk += 1
  }
  return { thisWeekActive: thisWeekUsers.size, continuing, newOrReturning, churnRisk }
}

/** オプトアウト率（失効した人 / 一度でも購読した人）。 */
export function optOutRate(everSubscribed: number, revoked: number): number {
  return pct(revoked, everSubscribed)
}
