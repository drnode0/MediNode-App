// 台帳のマーケ指標（転換率ファネル・継続/解約・流入元の質・売上）。
// すべて既存の /api/admin/ledger レスポンスから派生する純関数。テスト対象。
import type { MemberKind } from './member-ledger'

// プレミアムは単一プラン月額980円（税込）。
export const PREMIUM_MONTHLY_JPY = 980

// 「一度でも試用/課金に至った」区分。課金中(premium)も試用は済んでいるため含む。
const TRIAL_OR_PAID: MemberKind[] = ['premium', 'stripe_trial', 'trial', 'auto_trial']

// 小数第1位までの百分率。母数が0以下なら0を返す（ゼロ除算回避）。
export function pct(part: number, whole: number): number {
  if (whole <= 0) return 0
  return Math.round((part / whole) * 1000) / 10
}

export type FunnelStage = { label: string; count: number; pct: number | null }

export function computeFunnel(input: {
  lpVisits: number
  registered: number
  trialStarted: number
  paying: number
}): FunnelStage[] {
  const { lpVisits, registered, trialStarted, paying } = input
  return [
    { label: 'LP訪問', count: lpVisits, pct: null },
    { label: '登録', count: registered, pct: lpVisits > 0 ? pct(registered, lpVisits) : null },
    { label: 'トライアル開始', count: trialStarted, pct: pct(trialStarted, registered) },
    { label: '課金', count: paying, pct: pct(paying, trialStarted) },
  ]
}

export function countTrialStarted(rows: { kind: MemberKind }[]): number {
  return rows.filter((r) => TRIAL_OR_PAID.includes(r.kind)).length
}

export type Retention = {
  payingActive: number
  churnedPaying: number
  trialToPaying: number // 0..1
  churn: number // 0..1
}

export function computeRetention(rows: { kind: MemberKind; hasStripe: boolean }[]): Retention {
  const payingActive = rows.filter((r) => r.kind === 'premium').length
  const churnedPaying = rows.filter((r) => r.kind === 'expired' && r.hasStripe).length
  // 試用母集団 = 現在 試用/課金中 の全員（premium含む）＋ 課金から解約した人。
  const trialPool = rows.filter((r) => TRIAL_OR_PAID.includes(r.kind)).length + churnedPaying
  const trialToPaying = trialPool > 0 ? payingActive / trialPool : 0
  const denom = payingActive + churnedPaying
  const churn = denom > 0 ? churnedPaying / denom : 0
  return { payingActive, churnedPaying, trialToPaying, churn }
}

export type SourceQuality = {
  source: string
  registered: number
  trial: number
  paying: number
  cvr: number // paying/registered %
}

export function computeSourceQuality(
  rows: { source: string; kind: MemberKind }[]
): SourceQuality[] {
  const map = new Map<string, { registered: number; trial: number; paying: number }>()
  for (const r of rows) {
    const cur = map.get(r.source) ?? { registered: 0, trial: 0, paying: 0 }
    cur.registered += 1
    if (r.kind === 'premium') cur.paying += 1
    else if (TRIAL_OR_PAID.includes(r.kind)) cur.trial += 1
    map.set(r.source, cur)
  }
  return [...map.entries()]
    .map(([source, v]) => ({ source, ...v, cvr: pct(v.paying, v.registered) }))
    .sort((a, b) => b.registered - a.registered)
}

export type Revenue = {
  payingCount: number
  mrr: number
  arr: number
  monthly: Array<{ month: string; count: number }> // 課金開始の累積（YYYY-MM）
}

export function computeRevenue(
  rows: { kind: MemberKind; subCreatedAt: string | null }[],
  unitPrice: number
): Revenue {
  const paying = rows.filter((r) => r.kind === 'premium')
  const byMonth = new Map<string, number>()
  for (const r of paying) {
    if (!r.subCreatedAt) continue
    const m = r.subCreatedAt.slice(0, 7)
    byMonth.set(m, (byMonth.get(m) ?? 0) + 1)
  }
  let acc = 0
  const monthly = [...byMonth.keys()]
    .sort()
    .map((month) => {
      acc += byMonth.get(month)!
      return { month, count: acc }
    })
  const payingCount = paying.length
  return { payingCount, mrr: payingCount * unitPrice, arr: payingCount * unitPrice * 12, monthly }
}
