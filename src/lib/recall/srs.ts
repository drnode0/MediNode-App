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

// 惑星ごとに確かめる（09-04 決定2）ための席の絞り込み。
// 記録（recall_progress）は claimId しか持たないので、席は呼び出し側が対応を渡す。
// ここに主張コーパスを持ち込むと srs.ts が純関数でなくなり、日付を進めるテストが書けなくなる。
// slotOf が undefined を返す主張（同期で外れた等）は、席を指定したとき候補にしない
//（どの惑星のものか決まらないものを、たまたま開いている惑星の輪から離すのは誤り）。
export type SeatFilter = { slot: number; slotOf: (claimId: string) => number | undefined }

const inSeat = (p: RecallProgress, seat?: SeatFilter): boolean =>
  !seat || seat.slotOf(p.claimId) === seat.slot

export function stateOf(_claimId: string, p: RecallProgress | undefined, isRead: boolean, now: Date): RecallState {
  if (isKept(p)) {
    return { kind: p.intervalDays >= SETTLED_MIN_DAYS ? 'settled' : 'kept', remaining: remainingOf(p, now) }
  }
  return { kind: isRead ? 'touched' : 'cold', remaining: 0 }
}

// seat を渡すとその席の主張だけが候補になる。渡さなければ従来どおり全席から選ぶ
//（球の画面がそのまま動き続ける）。並びと上限の決め方は席の有無で変えない。
export function pickCandidates(progress: RecallProgress[], now: Date, max = MAX_CANDIDATES, seat?: SeatFilter): RecallProgress[] {
  return progress
    .filter(isKept)
    .filter((p) => inSeat(p, seat))
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

// seat を渡すとその席だけの答えになる。惑星単位の「次は◯日後に◯件」で全席の数を
// 出さないために要る（件数が合わないと、開いている惑星と画面の言葉が食い違う）。
export function nextDue(progress: RecallProgress[], now: Date, seat?: SeatFilter): NextDue | null {
  const kept = progress.filter(isKept).filter((p) => inSeat(p, seat))
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

// 「次の期限」の日数の出し方（過ぎていたら「日後」を作らない）。checkNotice（notice.ts）と
// 標本帳の一覧の帯（dex.ts）の両方がこの日数を要るので、NextDue のそばの1か所に置く。
// overdue の印だけでなく、日時そのものも見る（印の付け忘れ・時計のずれで過ぎた日付から
// 「◯日後」を作らないための二重の歯止め）。過ぎているときは null。
export function daysUntilDue(due: NextDue, now: Date): number | null {
  if (due.overdue || due.at.getTime() <= now.getTime()) return null
  return Math.max(1, Math.ceil((due.at.getTime() - now.getTime()) / DAY))
}
