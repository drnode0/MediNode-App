// アカウントタブ「人が主役」リストの純ロジック（vitest対象・fetchなし）。
//
// アクティブ度の判定は既存「最終利用の内訳」（AdminLedgerClient の activity useMemo）と
// 同じ規則: 最終利用・最終ログイン・設定同期の最新値で、7日以内/30日以内/それ以上/形跡なし。
// 境界は「以内」（<=）。ここに切り出して一覧の行バッジと内訳グラフの判定ズレを防ぐ。

export type ActivityBand = 'week' | 'month' | 'older' | 'never'

export type PersonActivity = {
  lastUsedAt: string | null
  lastSignInAt: string | null
  settingsUpdatedAt: string | null
}

const DAY = 24 * 60 * 60 * 1000

// 「最後に見た形跡」。0 = 形跡なし。
export function lastSeenMs(r: PersonActivity): number {
  return Math.max(
    ...[r.lastUsedAt, r.lastSignInAt, r.settingsUpdatedAt]
      .filter((v): v is string => !!v)
      .map((v) => new Date(v).getTime()),
    0,
  )
}

export function activityBand(seenMs: number, nowMs: number): ActivityBand {
  if (seenMs === 0) return 'never'
  const ago = nowMs - seenMs
  if (ago <= 7 * DAY) return 'week'
  if (ago <= 30 * DAY) return 'month'
  return 'older'
}

// 行に出す相対日付。細かい正確さより「一目の把握」を優先した粗い段階表示。
// 正確な日時は詳細（展開側）の絶対表示が担う。
export function fmtRelative(seenMs: number, nowMs: number): string {
  if (seenMs === 0) return '—'
  const days = Math.floor((nowMs - seenMs) / DAY)
  if (days <= 0) return '今日'
  if (days === 1) return '昨日'
  if (days < 7) return `${days}日前`
  if (days < 30) return `${Math.floor(days / 7)}週間前`
  return `${Math.floor(days / 30)}か月前`
}

export function contributionScore(r: { cqCount: number; voteCount: number }): number {
  return r.cqCount + r.voteCount
}

export type PeopleSortMode = 'newest' | 'active' | 'contribution'

export type PersonSortable = PersonActivity & {
  createdAt: string | null
  cqCount: number
  voteCount: number
}

// 3プリセットの比較関数。返り値は Array.prototype.sort 互換（負= a が先）。
export function comparePeople(mode: PeopleSortMode, a: PersonSortable, b: PersonSortable): number {
  if (mode === 'newest') {
    const av = a.createdAt ? new Date(a.createdAt).getTime() : 0
    const bv = b.createdAt ? new Date(b.createdAt).getTime() : 0
    return bv - av
  }
  const aSeen = lastSeenMs(a)
  const bSeen = lastSeenMs(b)
  if (mode === 'active') return bSeen - aSeen
  // contribution: 合計降順 → 同数は最終利用の新しい順
  const diff = contributionScore(b) - contributionScore(a)
  return diff !== 0 ? diff : bSeen - aSeen
}
