// クイズの簡易・間隔反復（SRS）。
// 「覚えた／まだ」の自己申告を localStorage に記録し、出題順を
//   ① まだ（直近の申告が「まだ」寄り）→ ② 未学習 → ③ 覚えた
// の優先度で並べる（各グループ内はシャッフル）。
// サーバー同期はしない（端末ローカルの学習記録。設定同期の対象にもしない＝機微でないため軽量に）。

export type QuizStat = {
  ok: number // 「覚えた」回数
  ng: number // 「まだ」回数
  last: string // 最終申告日時（ISO）
  lastResult: 'ok' | 'ng'
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

// 「覚えた」(ok=true)／「まだ」(ok=false) を記録する。
export function recordQuizResult(objectID: string, ok: boolean) {
  const stats = loadStats()
  const cur = stats[objectID] || { ok: 0, ng: 0, last: '', lastResult: 'ng' as const }
  if (ok) cur.ok++
  else cur.ng++
  cur.last = new Date().toISOString()
  cur.lastResult = ok ? 'ok' : 'ng'
  stats[objectID] = cur
  saveStats(stats)
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// SRS優先度つきの出題順を返す（元配列は変更しない）。
//   まだ（lastResult==='ng'）→ 未学習 → 覚えた（lastResult==='ok'）
export function weightedQuizOrder<T extends { objectID: string }>(hits: T[]): T[] {
  const stats = loadStats()
  const again: T[] = []
  const fresh: T[] = []
  const known: T[] = []
  for (const h of hits) {
    const s = stats[h.objectID]
    if (!s) fresh.push(h)
    else if (s.lastResult === 'ng') again.push(h)
    else known.push(h)
  }
  return [...shuffleInPlace(again), ...shuffleInPlace(fresh), ...shuffleInPlace(known)]
}
