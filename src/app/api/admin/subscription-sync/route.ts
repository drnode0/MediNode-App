import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { runSubscriptionSync } from '../../subscription/sync/_core'

/**
 * サブスク同期の手動トリガー（オーナー限定・スマホから1タップ用）。
 *
 *   POST /api/admin/subscription-sync
 *     → サブスク用Notion DB を サブスク用Algoliaインデックスへ同期する。
 *
 * 認証:
 *   requireAdmin()（ログイン必須 ＋ COMP_ADMIN_EMAILS）。
 *   secret ヘッダーは不要 → /admin にログイン済みのオーナーがスマホからそのまま叩ける。
 *   （curl/CI からの実行は従来どおり x-sync-secret 版 /api/subscription/sync を使う）
 *
 * 同期ロジック本体は ../../subscription/sync/_core.ts に集約（cron・secret版と共通）。
 */
export async function POST() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  try {
    const result = await runSubscriptionSync()
    if (!('success' in result)) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
    return NextResponse.json(result)
  } catch (err) {
    console.error('Admin subscription sync error:', err)
    const message = err instanceof Error ? err.message : '同期に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
