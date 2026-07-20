import type { MemberKind } from './member-ledger'

// メールを t***@domain へ。@が無い等の異常入力は安全にそのまま返す。
export function maskEmail(email: string | null): string {
  if (!email) return '—'
  const at = email.indexOf('@')
  if (at <= 0) return email
  return `${email[0]}***${email.slice(at)}`
}

export type ContractIssue = { userId: string; email: string | null; reason: string }

export function detectLocalContractIssues(
  rows: {
    userId: string
    email: string | null
    kind: MemberKind
    status: string | null
    plan: string | null
    hasStripe: boolean
  }[]
): ContractIssue[] {
  const issues: ContractIssue[] = []
  for (const r of rows) {
    if (r.status === 'active' && r.plan === 'premium' && !r.hasStripe) {
      issues.push({ userId: r.userId, email: r.email, reason: '課金中の記録だがStripe顧客IDが無い' })
    } else if (r.hasStripe && r.kind === 'free') {
      issues.push({ userId: r.userId, email: r.email, reason: 'Stripe顧客IDがあるのに区分が無効(free)' })
    }
  }
  return issues
}

export type AnomalySignal = {
  key: string
  label: string
  count: number
  level: 'info' | 'watch'
  hint: string
}

const DISPOSABLE_DOMAINS = [
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'yopmail.com', 'trashmail.com', 'sharklasers.com', 'getnada.com',
]

export function detectAnomalySignals(
  rows: {
    email: string | null
    kind: MemberKind
    referralCount: number
    premiumUsedAt: string | null
    trialEndsAt: string | null
    createdAt: string | null
  }[],
  now: number
): AnomalySignal[] {
  const signals: AnomalySignal[] = []

  // 1) 登録の急増スパイク
  const byDay = new Map<string, number>()
  for (const r of rows) {
    if (!r.createdAt) continue
    const d = r.createdAt.slice(0, 10)
    byDay.set(d, (byDay.get(d) ?? 0) + 1)
  }
  const counts = [...byDay.values()].sort((a, b) => a - b)
  const median = counts.length ? counts[Math.floor(counts.length / 2)] : 0
  const threshold = Math.max(5, median * 3)
  const spikes = [...byDay.values()].filter((c) => c > threshold)
  if (spikes.length) {
    signals.push({
      key: 'signup_spike',
      label: '登録が急増した日',
      count: spikes.length,
      level: 'watch',
      hint: `1日の新規が${threshold}件超の日。bot/乱用の可能性。日別グラフと突き合わせを。`,
    })
  }

  // 2) 紹介の異常集中
  const heavyReferrers = rows.filter((r) => r.referralCount >= 10).length
  if (heavyReferrers) {
    signals.push({
      key: 'referral_concentration',
      label: '紹介が突出した人',
      count: heavyReferrers,
      level: 'watch',
      hint: '10人以上を招待。自己紹介・不正招待でないか確認を。',
    })
  }

  // 3) 使い捨てメールドメイン
  const disposable = rows.filter((r) => {
    const at = r.email?.lastIndexOf('@') ?? -1
    if (!r.email || at < 0) return false
    return DISPOSABLE_DOMAINS.includes(r.email.slice(at + 1).toLowerCase())
  }).length
  if (disposable) {
    signals.push({
      key: 'disposable_email',
      label: '使い捨てメール',
      count: disposable,
      level: 'watch',
      hint: '既知の使い捨てドメインのメール。トライアル乱用の可能性。',
    })
  }

  // 4) 自動トライアル未利用のまま失効間近
  const soon = rows.filter((r) => {
    if (r.kind !== 'auto_trial' || r.premiumUsedAt || !r.trialEndsAt) return false
    const end = new Date(r.trialEndsAt).getTime()
    return end > now && end - now <= 24 * 60 * 60 * 1000
  }).length
  if (soon) {
    signals.push({
      key: 'trial_expiring_unused',
      label: '未利用トライアル失効間近',
      count: soon,
      level: 'info',
      hint: '24時間以内に失効する自動トライアルで、一度も利用が無い人。フォローの機会。',
    })
  }

  return signals
}

// Stripe照合の純粋部分。ローカルとStripeのサブスク配列を突合。
export type LocalSub = {
  userId: string
  email: string | null
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  status: string | null
}
export type StripeSub = { id: string; customer: string; status: string }
export type Reconciliation = {
  orphanStripe: { subscriptionId: string; customer: string; status: string }[]
  staleLocal: { userId: string; email: string | null; status: string | null }[]
}

export function reconcileStripe(local: LocalSub[], stripe: StripeSub[]): Reconciliation {
  const localByCustomer = new Set(
    local.map((l) => l.stripeCustomerId).filter((v): v is string => !!v)
  )
  const localBySubId = new Set(
    local.map((l) => l.stripeSubscriptionId).filter((v): v is string => !!v)
  )
  const activeStripe = stripe.filter((s) => s.status === 'active' || s.status === 'trialing')
  const orphanStripe = activeStripe
    .filter((s) => !localBySubId.has(s.id) && !localByCustomer.has(s.customer))
    .map((s) => ({ subscriptionId: s.id, customer: s.customer, status: s.status }))
  const activeCustomers = new Set(activeStripe.map((s) => s.customer))
  const staleLocal = local
    .filter((l) => l.status === 'active' && l.stripeCustomerId && !activeCustomers.has(l.stripeCustomerId))
    .map((l) => ({ userId: l.userId, email: l.email, status: l.status }))
  return { orphanStripe, staleLocal }
}
