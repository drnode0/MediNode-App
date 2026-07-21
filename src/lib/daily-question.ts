// 「今日の1問」の共有ロジック。
// 監修ライブラリ（サブスクAlgolia）から毎日1問、全員に同じ問題を決定的に選ぶ。
// 段階公開（off/preview/on）は app_flags の stage 列で管理し、切替は /admin/maintenance から。

export type DailyQuestionStage = 'off' | 'preview' | 'on'

export const DAILY_QUESTION_FLAG_KEY = 'daily_question'

export function parseStage(raw: unknown): DailyQuestionStage {
  return raw === 'on' || raw === 'preview' ? raw : 'off'
}

// 出題プール条件。クイズタブの quizCandidates（page.tsx）と同じ判定。
// サーバー側（API route）でも使うため純関数として切り出している。
export function isDailyQuestionCandidate(r: {
  title?: string
  aiSummary?: string
  summary?: string
  knowledgeLevel?: string
}): boolean {
  const summaryText = ((r.aiSummary || '') + (r.summary || '')).trim()
  if (summaryText.length < 10) return false
  const lvl = r.knowledgeLevel || ''
  const isKnowledge = lvl.includes('💡') || lvl.includes('ナレッジ') || lvl.toLowerCase().includes('knowledge')
  if (!isKnowledge) return false
  const t = (r.title || '').trim()
  const titleIsCQ = t.startsWith('❓') || t.includes('CQ：') || t.includes('CQ:')
  return !titleIsCQ
}

// 日付文字列（YYYY-MM-DD）から決定的にプールの1件を選ぶ。全員が同じ問題になる。
// 「経過日数 mod プール数」の単純ローテーションではなく文字列ハッシュにして、
// 連日の並びがプールの追加で丸ごとズレる度合いを下げる。プールが空なら -1。
export function pickDailyIndex(dateJst: string, poolSize: number): number {
  if (poolSize <= 0) return -1
  let h = 0
  for (let i = 0; i < dateJst.length; i++) {
    h = (h * 31 + dateJst.charCodeAt(i)) >>> 0
  }
  return h % poolSize
}

// 日本時間の今日（YYYY-MM-DD）。usage/ping と同じ丸め方（利用者は国内前提）。
export function jstToday(nowMs = Date.now()): string {
  return new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// preview段階で見られるメール（カンマ区切りenvの合算・大文字小文字無視）。
// COMP_ADMIN_EMAILS＝オーナー。モニターを足すときは DAILY_QUESTION_PREVIEW_EMAILS へ。
export function isPreviewEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const list = [process.env.COMP_ADMIN_EMAILS || '', process.env.DAILY_QUESTION_PREVIEW_EMAILS || '']
    .join(',')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return list.includes(email.toLowerCase())
}

// ── stage読取（TTLキャッシュ付き・maintenance.ts の readMaintenanceFlag と同型）──
// env DAILY_QUESTION_STAGE があれば最優先（ローカル動作確認用。本番Vercelでは未設定）。
// stage列が無い（migration 0012 未適用）・ネットワーク不調は 'off' 側に倒す＝カード非表示。
const STAGE_TTL_MS = 30_000
let stageCache: { value: DailyQuestionStage; at: number } | null = null

export function __resetDailyQuestionStageCache(): void {
  stageCache = null
}

export async function readDailyQuestionStage(opts?: {
  nowMs?: number
  fetchImpl?: typeof fetch
}): Promise<DailyQuestionStage> {
  const envStage = process.env.DAILY_QUESTION_STAGE
  if (envStage) return parseStage(envStage)

  const nowMs = opts?.nowMs ?? Date.now()
  const fetchImpl = opts?.fetchImpl ?? fetch

  if (stageCache && nowMs - stageCache.at < STAGE_TTL_MS) return stageCache.value

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return stageCache?.value ?? 'off'

  try {
    const res = await fetchImpl(
      `${url}/rest/v1/app_flags?select=stage&key=eq.${DAILY_QUESTION_FLAG_KEY}`,
      {
        headers: { apikey: anon, Authorization: `Bearer ${anon}` },
        cache: 'no-store',
      },
    )
    if (!res.ok) return stageCache?.value ?? 'off'
    const rows = (await res.json()) as Array<{ stage?: unknown }>
    const value = parseStage(rows[0]?.stage)
    stageCache = { value, at: nowMs }
    return value
  } catch {
    return stageCache?.value ?? 'off'
  }
}
