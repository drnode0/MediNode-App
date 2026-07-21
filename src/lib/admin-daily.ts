// デイリー・コマンドセンター（/admin 最上部）の純粋ロジック。
// 外部ソース（Notion/Stripe/Algolia/Resend/Vercel/アプリ生存）の取得は API route 側が
// best-effort で行い、ここは「取れた値をどう解釈・色分けするか」だけを担う（テスト対象）。

// 状態シグナル（タイルの色）。緑=正常／橙=要確認／赤=異常。
export type Signal = 'ok' | 'warn' | 'alert'

// 使用量パーセント（使用/上限）。上限0以下は0（ゼロ除算回避）。超過は実値（>100 もあり得る）。
export function usagePct(used: number, quota: number): number {
  if (quota <= 0) return 0
  return Math.round((used / quota) * 100)
}

// 使用量%→シグナル。既定は80%で警告・100%以上で異常。
export function usageSignal(pct: number, warnAt = 80): Signal {
  if (pct >= 100) return 'alert'
  if (pct >= warnAt) return 'warn'
  return 'ok'
}

// 未対応件数→シグナル（0件は正常・1件以上で要確認）。
export function pendingSignal(count: number): Signal {
  return count > 0 ? 'warn' : 'ok'
}

// 失敗決済件数→シグナル（0件は正常・1件以上で異常）。
export function failedSignal(count: number): Signal {
  return count > 0 ? 'alert' : 'ok'
}

// アプリ生存→シグナル。
export function livenessSignal(up: boolean): Signal {
  return up ? 'ok' : 'alert'
}

// Notion select プロパティが「未対応」か。空・null・未知値は未対応。
// '対応済み'/'対応不要' のみを処理済みとみなす（＝バッジに数えない）。
const RESOLVED_STATES = new Set(['対応済み', '対応不要'])
export function isUnresolved(state: string | null | undefined): boolean {
  if (!state) return true
  return !RESOLVED_STATES.has(state.trim())
}

// Notion query results（best-effort・型は緩め）から未対応件数を数える。
// フォーム投稿は 対応状態 が空で入るため、空＝未対応として拾う。
export function countUnresolved(
  results: Array<{ properties?: Record<string, unknown> | null }>,
  statusProp = '対応状態',
): number {
  let n = 0
  for (const page of results) {
    const prop = (page.properties ?? {})[statusProp] as
      | { select?: { name?: string } | null }
      | undefined
    const name = prop?.select?.name ?? null
    if (isUnresolved(name)) n++
  }
  return n
}

// JST の当日日付キー（YYYY-MM-DD）。localStorage チェックリストの日次リセットに使う。
export function jstDateKey(now: number): string {
  return new Date(now + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

// ある ISO 日時が JST 当日か（今日の新規登録・今日の決済の判定に使う）。
export function isJstToday(iso: string | null | undefined, now: number): boolean {
  if (!iso) return false
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return false
  return jstDateKey(t) === jstDateKey(now)
}

// JST 今日の 0:00 の UNIX ミリ秒（Stripe charges の created 下限などに使う）。
export function jstStartOfTodayMs(now: number): number {
  return Date.parse(`${jstDateKey(now)}T00:00:00+09:00`)
}
