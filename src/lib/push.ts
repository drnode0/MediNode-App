// Web Push の共有ロジック。段階公開・preview判定・送信スロット・通知設定を純関数で切り出す。
// 「今日の1問」の daily-question.ts と同じ型（stage列・TTLキャッシュ・env上書き）。
import { jstToday } from './daily-question'

export type PushStage = 'off' | 'preview' | 'on'
export const PUSH_FLAG_KEY = 'push'

export type PushKind = 'daily' | 'resolved_cq' | 'announce'

export const DAILY_SLOTS = ['07:00', '07:30', '08:00', '12:30', '20:00', '21:00'] as const
export const DEFAULT_SLOT = '07:30'

export function parseStage(raw: unknown): PushStage {
  return raw === 'on' || raw === 'preview' ? raw : 'off'
}

export function parseSlot(raw: unknown): string {
  return (DAILY_SLOTS as readonly string[]).includes(raw as string) ? (raw as string) : DEFAULT_SLOT
}

// JSTの現在スロット（HH:MM）。cronの一致判定に使う。utc+9は分を保つのでプリセットと揃う。
export function jstSlot(nowMs = Date.now()): string {
  return new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(11, 16)
}

export function isPreviewEmail(email: string | null | undefined): boolean {
  if (!email) return false
  const list = [process.env.COMP_ADMIN_EMAILS || '', process.env.PUSH_PREVIEW_EMAILS || '']
    .join(',')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return list.includes(email.toLowerCase())
}

export type NotifyPrefs = {
  master: boolean
  daily: boolean
  resolvedCq: boolean
  announce: boolean
  slot: string
}

export const DEFAULT_PREFS: NotifyPrefs = {
  master: true,
  daily: true,
  resolvedCq: true,
  announce: true,
  slot: DEFAULT_SLOT,
}

export function parsePrefs(raw: unknown): NotifyPrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  return {
    master: bool(o.master, DEFAULT_PREFS.master),
    daily: bool(o.daily, DEFAULT_PREFS.daily),
    resolvedCq: bool(o.resolvedCq, DEFAULT_PREFS.resolvedCq),
    announce: bool(o.announce, DEFAULT_PREFS.announce),
    slot: parseSlot(o.slot),
  }
}

export function kindEnabled(prefs: NotifyPrefs, kind: PushKind): boolean {
  if (!prefs.master) return false
  if (kind === 'daily') return prefs.daily
  if (kind === 'resolved_cq') return prefs.resolvedCq
  return prefs.announce
}

// ── stage読取（TTLキャッシュ・daily-question.ts と同型）──
const STAGE_TTL_MS = 30_000
let stageCache: { value: PushStage; at: number } | null = null

export function __resetPushStageCache(): void {
  stageCache = null
}

export async function readPushStage(opts?: {
  nowMs?: number
  fetchImpl?: typeof fetch
}): Promise<PushStage> {
  const envStage = process.env.PUSH_STAGE
  if (envStage) return parseStage(envStage)

  const nowMs = opts?.nowMs ?? Date.now()
  const fetchImpl = opts?.fetchImpl ?? fetch
  if (stageCache && nowMs - stageCache.at < STAGE_TTL_MS) return stageCache.value

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) return stageCache?.value ?? 'off'
  try {
    const res = await fetchImpl(
      `${url}/rest/v1/app_flags?select=stage&key=eq.${PUSH_FLAG_KEY}`,
      { headers: { apikey: anon, Authorization: `Bearer ${anon}` }, cache: 'no-store' },
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

// 再エクスポート（呼び出し側の import を1本化）。
export { jstToday }
