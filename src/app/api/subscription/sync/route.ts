import { NextRequest, NextResponse } from 'next/server'
import { runSubscriptionSync, isSyncSecretValid } from './_core'

/**
 * サブスクリプション用 sync API（手動実行）
 *
 * サブスク用Notion DBの内容を、サブスク用 Algoliaインデックス
 * （既定: Medical Knowledge_DB（サブスク用））へ同期する。
 *
 * 認証:
 *   - x-sync-secret ヘッダーで SUBSCRIPTION_SYNC_SECRET と一致確認（定数時間比較）
 *   - 設定されていない or 不一致の場合は 401
 *   - セキュリティ: シークレットは「ヘッダーのみ」で受け取る。?secret= のクエリ受理は
 *     アクセスログ・ブラウザ履歴・Referer に秘密が残るため廃止した。手動実行は
 *     `curl -X POST -H "x-sync-secret: ***" .../api/subscription/sync` で行う。
 *
 * 実際の同期ロジックと環境変数は ./_core.ts に集約。
 * Vercel Cron（/api/cron/subscription-sync）も同じ _core を使う。
 */

export async function POST(req: NextRequest) {
  try {
    // 認証チェック（ヘッダーのみ）
    if (!isSyncSecretValid(req.headers.get('x-sync-secret'))) {
      return NextResponse.json(
        { error: 'Unauthorized: 有効な x-sync-secret ヘッダーが必要です' },
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
