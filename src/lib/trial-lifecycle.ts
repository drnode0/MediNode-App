// 体験（トライアル）終了のお知らせ配信の「対象判定」を純関数で切り出す。
// 対象は "カードなしトライアル" のみ（trial_ends_at がサーバー期限で、Stripe顧客IDが無い）。
//   - auto_trial（登録のみ・7/3日）、trial（noteコード・紹介コード）が該当。
//   - Stripe カードトライアル（stripe_customer_id あり）は Stripe 側で扱うため対象外。
//   - comp（無期限）は trial_ends_at=null なので自然に対象外。
// 生成AI・DB非依存の純ロジック。cron からもテストからも同じ判定を使う。

export type TrialLifecycleStage = 'ending_soon' | 'ended' | 'none'

// 前日ナッジの窓。日次 cron で「あと1日」を1回だけ捕捉できるよう約1日強を採る。
export const ENDING_SOON_WINDOW_MS = 26 * 60 * 60 * 1000
// 失効を「終了時」として扱う猶予。これを大きく過ぎた古い失効は蒸し返さない
// （初回デプロイ時に何日も前に切れた人へ一斉送信しないため）。
export const ENDED_GRACE_MS = 14 * 24 * 60 * 60 * 1000

export type TrialSubShape = {
  trial_ends_at: string | null
  stripe_customer_id: string | null
  plan?: string | null
}

// 「カードなしトライアル」の plan 値。これ以外（comp/premium/null）は、たとえ古い
// trial_ends_at が残っていても対象外にする（comp/管理者などアクセスを失わない人への誤送信を防ぐ）。
export const TRIAL_PLANS = ['trial', 'auto_trial'] as const
export function isTrialPlan(plan: string | null | undefined): boolean {
  return plan === 'trial' || plan === 'auto_trial'
}

// 管理者（COMP_ADMIN_EMAILS）はメール override でプレミアムなので、トライアル行が
// 期限切れになってもアクセスを失わない → お知らせ対象から除外する。
export function isAdminEmail(email: string | null | undefined, adminEmailsCsv: string | undefined): boolean {
  if (!email) return false
  const list = (adminEmailsCsv || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return list.includes(email.toLowerCase())
}

export function classifyTrialLifecycle(
  sub: TrialSubShape,
  opts: { now: number; endingSoonWindowMs?: number; endedGraceMs?: number },
): TrialLifecycleStage {
  const { now } = opts
  const endingSoonWindowMs = opts.endingSoonWindowMs ?? ENDING_SOON_WINDOW_MS
  const endedGraceMs = opts.endedGraceMs ?? ENDED_GRACE_MS

  // カードトライアル（Stripe管理）は触らない。
  if (sub.stripe_customer_id) return 'none'
  // カードなしトライアル（trial/auto_trial）だけが対象。comp/premium などに残った
  // 古い trial_ends_at では通知しない（誤送信の根本原因だった）。
  if (!isTrialPlan(sub.plan)) return 'none'
  if (!sub.trial_ends_at) return 'none'

  const end = Date.parse(sub.trial_ends_at)
  if (Number.isNaN(end)) return 'none'

  if (end <= now) {
    // 既に失効：猶予内なら「終了時」。
    return now - end <= endedGraceMs ? 'ended' : 'none'
  }
  // まだ有効：窓内なら「まもなく終了」。
  return end - now <= endingSoonWindowMs ? 'ending_soon' : 'none'
}

// 重複送信防止。通知済みかどうかは「どの期限値に対して通知したか」で判定する。
// こうすると延長（trial_ends_at が後ろへ動く）で値が変わったとき、新しい期限に対して
// もう一度だけ通知できる（同一期限の二重送信は防ぎつつ、延長には追従する）。
export type NotifiedMeta = {
  trial_ending_notified_for?: string | null
  trial_ended_notified_for?: string | null
}

export function shouldNotify(
  stage: TrialLifecycleStage,
  currentTrialEndsAt: string,
  meta: NotifiedMeta,
): boolean {
  if (stage === 'ending_soon') return meta.trial_ending_notified_for !== currentTrialEndsAt
  if (stage === 'ended') return meta.trial_ended_notified_for !== currentTrialEndsAt
  return false
}

// user_metadata に書き戻す「通知済みフラグ」のキー名。cron と共有。
export const NOTIFIED_META_KEY: Record<Exclude<TrialLifecycleStage, 'none'>, keyof NotifiedMeta> = {
  ending_soon: 'trial_ending_notified_for',
  ended: 'trial_ended_notified_for',
}
