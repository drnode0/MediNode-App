// ナレッジ投稿ペースの純ロジック（/admin 今日の管理）。
// Notion ページの作成/最終更新時刻から JST 日次バケット・サマリー・週グリッドを組む。
// fetch も描画も含まない純関数群（vitest 対象）。
//
// 既知の制約: Notion からは「最後に触った日」しか取れないため、1ページの多重更新履歴は
// 最終更新日1点に畳まれる。直近の活動は正確に残る。

import { jstDateKey } from '@/lib/admin-daily'

export type PageTiming = { createdAt: string; lastEdited: string }

export type DayActivity = {
  date: string
  medicalNew: number
  medicalEdit: number
  referenceNew: number
  referenceEdit: number
}

export type ActivitySummary = {
  last7: { medical: number; reference: number }
  last30: { medical: number; reference: number }
  daysSinceLastMedical: number | null
  thisWeekMedical: number
}

const DAY_MS = 86_400_000

function emptyDay(date: string): DayActivity {
  return { date, medicalNew: 0, medicalEdit: 0, referenceNew: 0, referenceEdit: 0 }
}

// ISO → JST 日付キー。無効・空は null。
function isoToJstKey(iso: string): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return jstDateKey(ms)
}

function addSeries(
  daily: Map<string, DayActivity>,
  pages: PageTiming[],
  newKey: 'medicalNew' | 'referenceNew',
  editKey: 'medicalEdit' | 'referenceEdit',
): void {
  for (const p of pages) {
    const created = isoToJstKey(p.createdAt)
    if (created) {
      const d = daily.get(created) ?? emptyDay(created)
      d[newKey] += 1
      daily.set(created, d)
    }
    const edited = isoToJstKey(p.lastEdited)
    if (edited && edited !== created) {
      const d = daily.get(edited) ?? emptyDay(edited)
      d[editKey] += 1
      daily.set(edited, d)
    }
  }
}

export function aggregateDaily(
  medical: PageTiming[],
  reference: PageTiming[],
): Map<string, DayActivity> {
  const daily = new Map<string, DayActivity>()
  addSeries(daily, medical, 'medicalNew', 'medicalEdit')
  addSeries(daily, reference, 'referenceNew', 'referenceEdit')
  return daily
}

// 'YYYY-MM-DD' の曜日を月曜=0..日曜=6 で返す（カレンダー日付として TZ 非依存に算出）。
export function jstWeekdayMon0(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0=Sun..6=Sat
  return (dow + 6) % 7
}

// dateKey に days 日足した 'YYYY-MM-DD'（JST カレンダー加算）。
function shiftKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split('-').map(Number)
  const base = Date.UTC(y, m - 1, d)
  const shifted = new Date(base + days * DAY_MS)
  const yy = shifted.getUTCFullYear()
  const mm = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(shifted.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

// 'YYYY-MM-DD' を UTC 正午の epoch ms に（日数差算出用。TZ 端の丸め誤差を避ける）。
function keyToUtcMs(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

export function computeSummary(
  daily: Map<string, DayActivity>,
  nowMs: number,
): ActivitySummary {
  const todayKey = jstDateKey(nowMs)
  const last7 = { medical: 0, reference: 0 }
  const last30 = { medical: 0, reference: 0 }
  // 今週の月曜キー
  const weekMonday = shiftKey(todayKey, -jstWeekdayMon0(todayKey))
  const from7 = shiftKey(todayKey, -7)
  const from30 = shiftKey(todayKey, -30)
  let thisWeekMedical = 0
  let lastMedicalNewKey: string | null = null

  for (const [key, d] of daily) {
    const medical = d.medicalNew + d.medicalEdit
    const reference = d.referenceNew + d.referenceEdit
    // 直近30/7日（今日含む）
    if (key <= todayKey && key > from30) {
      last30.medical += medical
      last30.reference += reference
    }
    if (key <= todayKey && key > from7) {
      last7.medical += medical
      last7.reference += reference
    }
    if (key >= weekMonday && key <= todayKey) thisWeekMedical += medical
    if (d.medicalNew > 0 && (!lastMedicalNewKey || key > lastMedicalNewKey)) {
      lastMedicalNewKey = key
    }
  }

  const daysSinceLastMedical =
    lastMedicalNewKey == null
      ? null
      : Math.round((keyToUtcMs(todayKey) - keyToUtcMs(lastMedicalNewKey)) / DAY_MS)

  return { last7, last30, daysSinceLastMedical, thisWeekMedical }
}

// 由来プロパティが「読者から投稿された臨床疑問」由来か。
// サブスクMedical DBの 由来="現場の疑問" のページのみ true（ResultCard等と同じ判定）。
export function isReaderOrigin(origin: string | null | undefined): boolean {
  return (origin ?? '').trim() === '現場の疑問'
}

export type PaceStatus = { level: 'good' | 'warn' | 'alert' | 'idle'; message: string }

// サマリーと週目標から「今の状況」を一言で（帯に出す）。判断はナレッジ本体基準。
export function paceStatus(summary: ActivitySummary, weeklyGoal: number): PaceStatus {
  const since = summary.daysSinceLastMedical
  const week = summary.thisWeekMedical
  const goal = Math.max(1, Math.round(weeklyGoal))
  if (since == null) {
    return { level: 'idle', message: 'まだナレッジの投稿がありません' }
  }
  if (since >= 7) {
    return { level: 'alert', message: `${since}日ナレッジの投稿がありません。そろそろ更新を` }
  }
  if (week >= goal) {
    return { level: 'good', message: `今週は目標達成（${week}件）。良いペースです` }
  }
  const remain = goal - week
  if (since >= 3 || week === 0) {
    return {
      level: 'warn',
      message: `今週はやや低調 — 目標まであと${remain}件。最後の投稿は${since}日前`,
    }
  }
  return { level: 'good', message: `順調 — 今週あと${remain}件で目標です` }
}

export function buildWeekGrid(
  daily: Map<string, DayActivity>,
  nowMs: number,
  weeks: number,
): { columns: DayActivity[][]; todayKey: string } {
  const todayKey = jstDateKey(nowMs)
  const weekMonday = shiftKey(todayKey, -jstWeekdayMon0(todayKey))
  // 最右列 = 今週。最左列の月曜 = 今週月曜 -(weeks-1)週。
  const firstMonday = shiftKey(weekMonday, -(weeks - 1) * 7)
  const columns: DayActivity[][] = []
  for (let w = 0; w < weeks; w++) {
    const colMonday = shiftKey(firstMonday, w * 7)
    const col: DayActivity[] = []
    for (let day = 0; day < 7; day++) {
      const key = shiftKey(colMonday, day)
      col.push(daily.get(key) ?? emptyDay(key))
    }
    columns.push(col)
  }
  return { columns, todayKey }
}
