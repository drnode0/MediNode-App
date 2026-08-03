// 葉の状態機械（純関数）。設計の核＝「高さ=行為の累積（不可逆）／葉の色=いまの状態（可逆）」の分離。
// read=輪郭のみ（検索練習未通過の誠実な表示・褪せない）／wrote=双葉（希少な生成行為・褪せない）／
// recall・repolish=青葉（検索強度に応じて色褪せ）。磨き直して戻した葉は「照り葉」——
// 一度忘れて思い出した知識が最も強い、を絵で語る。
// ⚠️ 色褪せを数字で集計してUIに出すことは永久禁止（負債台帳化＝この設計全体の死）。
import type { QuizStat } from './quiz-srs'
import type { Step } from './tower-steps'
import type { Reread } from './reader-marks'

export type LeafForm = 'outline' | 'futaba' | 'green'
// line=読み返しの濃度（輪郭の葉のみ意味を持つ・0〜3）
export type LeafVisual = { form: LeafForm; fade: number; teri: boolean; line: 0 | 1 | 2 | 3 }

// 期限90日（quiz-srsは簡易SRSで期限日を持たないため、DULL_DAYSと同じ「last+90日」を期限とみなす）。
// 期限〜+2日は微減（最大0.15）→ +2〜+7日ではっきり→1で打ち止め。枯れ落ち・降格はしない。
export const FADE_DUE_DAYS = 90
export const FADE_PRE_DAYS = 2
export const FADE_RAMP_DAYS = 5
const PRE_FADE_MAX = 0.15
const DAY_MS = 86_400_000

export function fadeLevel(stat: QuizStat | undefined, nowIso: string): number {
  if (!stat || !stat.last) return 0
  if (stat.lastResult === 'ng') return 1 // 実測で落ちている＝即・合図
  const days = (Date.parse(nowIso) - Date.parse(stat.last)) / DAY_MS
  const pre = Math.max(0, Math.min(1, (days - FADE_DUE_DAYS) / FADE_PRE_DAYS)) * PRE_FADE_MAX
  const main = Math.max(0, Math.min(1, (days - FADE_DUE_DAYS - FADE_PRE_DAYS) / FADE_RAMP_DAYS))
  return Math.max(pre, main)
}

// ⚠️ 渡す steps は leafSteps 済み（attemptなし）が契約。attemptは葉ではなく芽（pendingBudIds）。
export function buildLeafVisuals(
  steps: Step[], stats: Record<string, QuizStat>, nowIso: string,
  rereads?: Record<string, Reread>,
): LeafVisual[] {
  const repolished = new Set(steps.filter((s) => s.kind === 'repolish').map((s) => s.id))
  return steps.map((s) => {
    if (s.kind === 'read') {
      const line = Math.max(0, Math.min(3, rereads?.[s.id]?.count ?? 0)) as 0 | 1 | 2 | 3
      return { form: 'outline' as const, fade: 0, teri: false, line }
    }
    // wrote=双葉、resolved=本葉（緑）。どちらも生成行為なので褪せない・照りは想起系だけの性質
    if (s.kind === 'wrote') return { form: 'futaba' as const, fade: 0, teri: false, line: 0 as const }
    if (s.kind === 'resolved') return { form: 'green' as const, fade: 0, teri: false, line: 0 as const }
    let fade = fadeLevel(stats[s.id], nowIso)
    // 褪せた青葉は、最後のクイズより新しい読み返しで色が半分戻る（照りは出ない＝正典§9）。
    // 読み返しは思い出すことより弱い——全快はさせない。
    const rr = rereads?.[s.id]
    if (fade > 0 && rr && stats[s.id]?.last && Date.parse(rr.lastAt) > Date.parse(stats[s.id].last)) {
      fade = fade / 2
    }
    return { form: 'green' as const, fade, teri: fade === 0 && repolished.has(s.id), line: 0 as const }
  })
}

// まだの芽（正典§9）。クイズに挑んで「まだ」だったが、まだ思い出せていない知識。
// 穂先の未展開葉として描く（スロット＝高さを持つ葉、の不変条件を守るため葉の列には入れない）。
// 思い出せたら（recall/repolish）芽はひらいて葉になる＝ここからは消える。
export function pendingBudIds(steps: Step[]): string[] {
  const opened = new Set(steps.filter((s) => s.kind === 'recall' || s.kind === 'repolish').map((s) => s.id))
  return [...new Set(steps.filter((s) => s.kind === 'attempt').map((s) => s.id))].filter((id) => !opened.has(id))
}

// 「磨きどきの葉」をそっと目立たせる選定（蛙が近くに座る対象でもある）。
// fadeが1に達したidを、lastが新しい順（=まだ記憶の残り香がある順）に最大limit件。
export function spotlightFaded(
  steps: Step[], stats: Record<string, QuizStat>, nowIso: string, limit = 3,
): string[] {
  const ids = [...new Set(steps.filter((s) => s.kind === 'recall' || s.kind === 'repolish').map((s) => s.id))]
  return ids
    .filter((id) => fadeLevel(stats[id], nowIso) >= 1)
    .sort((a, b) => (stats[b]?.last || '').localeCompare(stats[a]?.last || ''))
    .slice(0, limit)
}
