// 間隔反復と状態(純関数)。描画を知らない。時刻は引数で受ける(テストで日付を進めるため)。
import type { RecallProgress, RecallState } from './types'
// 「同じ日」は日本の暦日で数える。UTC の 0 時区切りだと JST の 0〜9 時がずれるため、
// 既存の JST 日付キー（依存を持たない純関数）をそのまま使う。
import { jstDateKey } from '@/lib/admin-daily'

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
  // 日時として読めない記録は「経過しきった」扱いにする(remaining 0)。NaN を返すと
  // 離脱候補の判定(< ESCAPE_THRESHOLD)が false になって静かに一覧から消えるため、
  // 逆に確実に一覧へ出す(隠すより、目に触れさせて安全側に倒す)方向へ倒す。
  if (!Number.isFinite(from)) return 0
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

// 次の期限の答え。overdue=true は「もう期限が来ている」＝ at は now そのもので、
// count は期限切れ全件（最も古い日の分だけではない）。
// overdue=false は未来の最も早い期限で、count はその日（日本の暦日）に並ぶ件数。
// 呼び出し側は overdue を見るだけで「今すぐ」と「◯日後」を出し分けられる。
export type NextDue = { at: Date; count: number; overdue: boolean }

export function nextDue(progress: RecallProgress[], now: Date): NextDue | null {
  const kept = progress.filter(isKept)
  if (!kept.length) return null
  const nowMs = now.getTime()
  // dueAt が日時として読めない記録は数に入れず飛ばす(jstDateKey は NaN で例外を投げるため、
  // ここで弾かないと1件の壊れた記録で呼び出し全体が落ちる)。
  const times = kept.map((p) => new Date(p.dueAt).getTime()).filter((t) => Number.isFinite(t)).sort((a, b) => a - b)
  if (!times.length) return null
  const overdue = times.filter((t) => t <= nowMs)
  if (overdue.length) return { at: new Date(nowMs), count: overdue.length, overdue: true }
  const first = times[0]
  const key = jstDateKey(first)
  return { at: new Date(first), count: times.filter((t) => jstDateKey(t) === key).length, overdue: false }
}
