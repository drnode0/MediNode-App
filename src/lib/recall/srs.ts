// 間隔反復と状態(純関数)。描画を知らない。時刻は引数で受ける(テストで日付を進めるため)。
import type { RecallProgress, RecallState } from './types'

export const SRS_INTERVAL_DAYS = [1, 3, 7, 14, 30, 60, 120, 240, 365] as const
export const SETTLED_MIN_DAYS = 90
export const ESCAPE_THRESHOLD = 0.28
export const MAX_CANDIDATES = 5
const DAY = 86400000

export function newProgress(claimId: string, now: Date): RecallProgress {
  const iso = now.toISOString()
  return {
    claimId, keptAt: iso, streak: 0, intervalDays: 1, dueAt: new Date(now.getTime() + DAY).toISOString(),
    lastReviewedAt: iso, lastResult: null, okCount: 0, ngCount: 0, removedAt: null,
  }
}

export function applyResult(p: RecallProgress, result: 'ok' | 'ng', now: Date): RecallProgress {
  const streak = result === 'ok' ? p.streak + 1 : 0
  const intervalDays = result === 'ok'
    ? SRS_INTERVAL_DAYS[Math.min(streak, SRS_INTERVAL_DAYS.length) - 1]
    : SRS_INTERVAL_DAYS[0]
  return {
    ...p, streak, intervalDays,
    dueAt: new Date(now.getTime() + intervalDays * DAY).toISOString(),
    lastReviewedAt: now.toISOString(), lastResult: result,
    okCount: p.okCount + (result === 'ok' ? 1 : 0), ngCount: p.ngCount + (result === 'ng' ? 1 : 0),
  }
}

export function remainingOf(p: RecallProgress, now: Date): number {
  const from = new Date(p.lastReviewedAt ?? p.keptAt).getTime()
  const elapsed = (now.getTime() - from) / DAY
  return Math.max(0, Math.min(1, 1 - elapsed / Math.max(p.intervalDays, 1e-6)))
}

const isKept = (p: RecallProgress | undefined): p is RecallProgress => !!p && !p.removedAt

export function stateOf(_claimId: string, p: RecallProgress | undefined, isRead: boolean, now: Date): RecallState {
  if (isKept(p)) {
    return { kind: p.intervalDays >= SETTLED_MIN_DAYS ? 'settled' : 'kept', remaining: remainingOf(p, now) }
  }
  return { kind: isRead ? 'touched' : 'cold', remaining: 0 }
}

export function pickCandidates(progress: RecallProgress[], now: Date, max = MAX_CANDIDATES): RecallProgress[] {
  return progress
    .filter(isKept)
    .map((p) => ({ p, r: remainingOf(p, now) }))
    .filter((x) => x.r < ESCAPE_THRESHOLD)
    .sort((a, b) => a.r - b.r || a.p.claimId.localeCompare(b.p.claimId))
    .slice(0, max)
    .map((x) => x.p)
}

export function nextDue(progress: RecallProgress[], now: Date): { at: Date; count: number } | null {
  const kept = progress.filter(isKept)
  if (!kept.length) return null
  const times = kept.map((p) => new Date(p.dueAt).getTime()).sort((a, b) => a - b)
  const first = times[0]
  const dayStart = Math.floor(first / DAY) * DAY
  const count = times.filter((t) => t >= dayStart && t < dayStart + DAY).length
  void now
  return { at: new Date(first), count }
}
