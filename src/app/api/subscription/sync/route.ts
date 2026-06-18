import { NextRequest, NextResponse } from 'next/server'
import { runSubscriptionSync, isSyncSecretValid } from './_core'

/**
 * サブスクリプション用 sync API（手動実行）
 *
 * サブスク用Notion DBの内容を、サブスク用 Algoliaインデックス
 * （既定: Medical Knowledge_DB（サブスク用））へ同期する。
 *
 * 認証:
 *   - x-sync-secret ヘッダー or ?secret=xxx クエリで SUBSCRIPTION_SYNC_SECRET と一致確認
 *   - 設定されていない or 不一致の場合は 401
 *
 * 実際の同期ロジックと環境変数は ./_core.ts に集約。
 * Vercel Cron（/api/cron/subscription-sync）も同じ _core を使う。
 */

function getRequestSecret(req: NextRequest): string | null {
  const headerSecret = req.headers.get('x-sync-secret')
  if (headerSecret) return headerSecret
  const url = new URL(req.url)
  return url.searchParams.get('secret')
}

export async function POST(req: NextRequest) {
  try {
    // 認証チェック
    if (!isSyncSecretValid(getRequestSecret(req))) {
      return NextResponse.json(
        { error: 'Unauthorized: 有効な x-sync-secret が必要です' },
        { status: 401 },
      )
    }

    const result = await runSubscriptionSync()
    if (!('success' in result)) {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error('Subscription sync error:', err)
    const message = err instanceof Error ? err.message : '不明なエラーが発生しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// GETでも実行可能にしておく（ブラウザURLから叩けるように）
export async function GET(req: NextRequest) {
  return POST(req)
}
