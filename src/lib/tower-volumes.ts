// 巻（30歩ごとの時系列製本）とくすみ（要再確認）と、演出のゆらぎ。
// すべて純関数。描画とテストが同じ源を見る。
import type { Step } from './tower-steps'
import { DULL_DAYS } from './tower-steps'
import type { QuizStat } from './quiz-srs'
import { canonicalGenreKey } from './genre'

export const VOLUME_SIZE = 30

export type GenreStripe = { genreKey: string; count: number }
export type Volume = { n: number; steps: Step[]; stripes: GenreStripe[]; leaves: number; from: string; to: string }

export function deriveVolumes(steps: Step[]): { volumes: Volume[]; loose: Step[] } {
  const sorted = [...steps].sort((a, b) => (a.at < b.at ? -1 : 1))
  const volumes: Volume[] = []
  for (let i = 0; i + VOLUME_SIZE <= sorted.length; i += VOLUME_SIZE) {
    const chunk = sorted.slice(i, i + VOLUME_SIZE)
    const byGenre = new Map<string, number>()
    for (const s of chunk) {
      const key = s.genre ? canonicalGenreKey(s.genre) : '未分類'
      byGenre.set(key, (byGenre.get(key) || 0) + 1)
    }
    volumes.push({
      n: volumes.length + 1,
      steps: chunk,
      stripes: [...byGenre.entries()]
        .map(([genreKey, count]) => ({ genreKey, count }))
        .sort((a, b) => b.count - a.count),
      leaves: chunk.filter((s) => s.kind === 'recall' || s.kind === 'repolish').length,
      from: chunk[0].at,
      to: chunk[chunk.length - 1].at,
    })
  }
  return { volumes, loose: sorted.slice(volumes.length * VOLUME_SIZE) }
}

// 要再確認: 過去に「即答できる」になったが、最終okがDULL_DAYS日以上前のもの。
// 塔は縮まない——このSetはブロックの彩度を落とすためだけに使う。
export function dullIds(stats: Record<string, QuizStat>, nowIso: string): Set<string> {
  const staleMs = DULL_DAYS * 24 * 60 * 60 * 1000
  const now = new Date(nowIso).getTime()
  const out = new Set<string>()
  for (const [id, st] of Object.entries(stats)) {
    if (st.ok > 0 && st.lastResult === 'ok' && now - new Date(st.last).getTime() >= staleMs) out.add(id)
  }
  return out
}

// 積まれ方のゆらぎ（決定的）。同じ歩はいつ描いても同じズレ・同じ傾き。
export function jitterFor(id: string): { offset: number; rot: number } {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  const a = ((h >>> 0) % 1000) / 1000 // 0..1
  const b = ((h >>> 10) % 1000) / 1000
  return { offset: Math.round((a - 0.5) * 16), rot: Math.round((b - 0.5) * 50) / 10 }
}

export function lastLeafStep(steps: Step[]): Step | null {
  const leaves = steps.filter((s) => s.kind === 'recall' || s.kind === 'repolish')
  if (leaves.length === 0) return null
  return leaves.reduce((a, b) => (a.at > b.at ? a : b))
}

// 去年の今日（±3日）に積んだ歩。振り返りのログ行に使う。
export function aYearAgoStep(steps: Step[], nowIso: string): Step | null {
  const now = new Date(nowIso)
  const target = new Date(now)
  target.setFullYear(now.getFullYear() - 1)
  const windowMs = 3 * 24 * 60 * 60 * 1000
  const inWindow = steps.filter((s) => Math.abs(new Date(s.at).getTime() - target.getTime()) <= windowMs)
  if (inWindow.length === 0) return null
  return inWindow.reduce((a, b) =>
    Math.abs(new Date(a.at).getTime() - target.getTime()) <= Math.abs(new Date(b.at).getTime() - target.getTime()) ? a : b,
  )
}
