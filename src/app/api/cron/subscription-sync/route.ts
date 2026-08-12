import { NextRequest, NextResponse } from 'next/server'

// 実行時間上限（秒）。穴埋め抽出でcallout子の取得が増えるため明示する（/api/sync と同水準）。
export const maxDuration = 60
import { timingSafeEqual } from 'crypto'
import { runSubscriptionSync } from '../../subscription/sync/_core'
import { revalidateSubscriptionReaderDocs } from '@/lib/reader-cache'

/**
 * Vercel Cron 専用：サブスク用Notion → サブスク用Algolia の自動同期。
 *
 * vercel.json の crons 設定（1日1回・JST 6:00 = UTC 21:00）から呼ばれる。
 *
 * 認証:
 *   Vercel Cron はリクエストに `Authorization: Bearer ${CRON_SECRET}` を
 *   自動付与する。CRON_SECRET 環境変数（Vercelダッシュボードで設定）と
 *   一致しない場合は 401。これにより外部からの無断実行を防ぐ。
 *   （手動で叩きたい場合は従来どおり /api/subscription/sync を使う）
 *
 * 同期ロジック本体・必要な SUBSCRIPTION_* 環境変数は
 * ../../subscription/sync/_core.ts に集約（手動APIと共通）。
 */

function isCronAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false // 未設定なら一切実行させない
  const authHeader = req.headers.get('authorization')
  if (!authHeader) return false
  // 定数時間比較（タイミング攻撃対策）。
  const a = Buffer.from(authHeader)
  const b = Buffer.from(`Bearer ${expected}`)
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

export async function GET(req: NextRequest) {
  try {
    if (!isCronAuthorized(req)) {
      return NextResponse.json(
        { error: 'Unauthorized: Vercel Cron からの呼び出しのみ許可されています' },
        { status: 401 },
      )
    }

    const result = await runSubscriptionSync()
    if (!('success' in result)) {
      console.error('Cron subscription sync failed:', result.error)
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    // 日次syncでもプレミアム本文の共有キャッシュを失効させる（翌朝は最新本文で始まる）。
    revalidateSubscriptionReaderDocs()
    console.log('Cron subscription sync OK:', JSON.stringify(result.synced))
    return NextResponse.json(result)
  } catch (err) {
    console.error('Cron subscription sync error:', err)
    const message = err instanceof Error ? err.message : '不明なエラーが発生しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
