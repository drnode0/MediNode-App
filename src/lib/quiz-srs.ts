// クイズの間隔反復（SRS）。
// 「覚えた／まだ」の自己申告を localStorage に記録し、出題順を
//   ① 期限到来（due超過。「まだ」はdue=今なので常にここ）→ ② 未学習 → ③ 期限前の「覚えた」
// の優先度で並べる（各グループ内はシャッフル）。間隔は「覚えた」の連続回数で
// 1→3→7→14→30日 と伸びるLeitner固定段（SM-2の難易度係数は入れない＝シンプル優先）。
// サーバー同期はしない（端末ローカルの学習記録。設定同期の対象にもしない＝機微でないため軽量に）。

export type QuizStat = {
  ok: number // 「覚えた」回数
  ng: number // 「まだ」回数
  last: string // 最終申告日時（ISO）
  lastResult: 'ok' | 'ng'
  streak?: number // 連続「覚えた」回数（間隔の段を決める）
  due?: string // 次回出題日時（ISO）。旧データは欠損＝lastResultで代用
}

// Leitner固定段。streak n回目の「覚えた」で SRS_INTERVAL_DAYS[min(n,5)-1] 日後に。
export const SRS_INTERVAL_DAYS = [1, 3, 7, 14, 30] as const

const INTERVAL_LABELS = ['明日', '3日後', '1週間後', '2週間後', '1か月後'] as const

// 申告後メッセージ用。streak=1 → '明日'
export function intervalLabelFor(streak: number): string {
  return INTERVAL_LABELS[Math.min(Math.max(streak, 1), INTERVAL_LABELS.length) - 1]
}

const KEY = 'medinode_quiz_stats'
const MAX_ENTRIES = 2000 // 肥大防止（超えたら古い順に間引く）

function loadStats(): Record<string, QuizStat> {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}')
  } catch {
    return {}
  }
}

function saveStats(stats: Record<string, QuizStat>) {
  try {
    const entries = Object.entries(stats)
    if (entries.length > MAX_ENTRIES) {
      entries.sort((a, b) => (a[1].last < b[1].last ? -1 : 1))
      stats = Object.fromEntries(entries.slice(entries.length - MAX_ENTRIES))
    }
    localStorage.setItem(KEY, JSON.stringify(stats))
  } catch {
    // localStorage不可（プライベートブラウズ等）でもクイズ自体は動かす。
  }
}

// 知の塔が「初めての即答か・磨き直しか」を判定するための読み取り口。
export function getQuizStat(objectID: string): QuizStat | undefined {
  return loadStats()[objectID]
}

// 「覚えた」(ok=true)／「まだ」(ok=false) を記録し、更新後のstatを返す。
export function recordQuizResult(objectID: string, ok: boolean): QuizStat {
  const stats = loadStats()
  const cur = stats[objectID] || { ok: 0, ng: 0, last: '', lastResult: 'ng' as const }
  const now = new Date()
  if (ok) {
    cur.ok++
    cur.streak = (cur.streak || 0) + 1
    const days = SRS_INTERVAL_DAYS[Math.min(cur.streak, SRS_INTERVAL_DAYS.length) - 1]
    cur.due = new Date(now.getTime() + days * 86_400_000).toISOString()
  } else {
    cur.ng++
    cur.streak = 0
    cur.due = now.toISOString()
  }
  cur.last = now.toISOString()
  cur.lastResult = ok ? 'ok' : 'ng'
  stats[objectID] = cur
  saveStats(stats)
  return cur
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// 間隔反復の出題順を返す（元配列は変更しない）。
//   ① 期限到来（due超過。「まだ」はdue=今なので常にここ）→ ② 未学習 → ③ 期限前の「覚えた」
// 期限前も隠さず末尾に置く（プールが小さい個人DBでタブが空になるのを防ぐ）。
// 旧データ（due欠損）は lastResult==='ng' を期限到来、'ok' を期限前として扱う。
export function weightedQuizOrder<T extends { objectID: string }>(
  hits: T[],
  nowMs: number = Date.now(),
): T[] {
  const stats = loadStats()
  const due: T[] = []
  const fresh: T[] = []
  const later: T[] = []
  for (const h of hits) {
    const s = stats[h.objectID]
    if (!s) {
      fresh.push(h)
      continue
    }
    const dueAt = s.due ? Date.parse(s.due) : s.lastResult === 'ng' ? 0 : Infinity
    if (dueAt <= nowMs) due.push(h)
    else later.push(h)
  }
  return [...shuffleInPlace(due), ...shuffleInPlace(fresh), ...shuffleInPlace(later)]
}
