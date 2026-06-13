import { NextRequest, NextResponse } from 'next/server'

/**
 * プレミアム 無料トライアル（クーポンコード式・カード不要）
 *
 * POST /api/premium/trial
 * Body: { code: string }
 *
 * note等に記載したクーポンコードを検証し、一致すれば
 * プレミアム用 Algolia の Search-only Key とトライアル有効期限を返す。
 * Stripe決済を介さずにプレミアムを一定期間開放するための導線。
 *
 * 必要な環境変数:
 *   - PREMIUM_TRIAL_CODE              ... トライアル開始用のクーポンコード（例: MEDINODE2026）
 *   - PREMIUM_TRIAL_DAYS             ... トライアル日数（未設定なら14）
 *   - SUBSCRIPTION_ALGOLIA_APP_ID     ... サブスク用AlgoliaのApp ID
 *   - SUBSCRIPTION_ALGOLIA_SEARCH_KEY ... サブスク用Algoliaの検索専用キー（Search-only）
 *   - SUBSCRIPTION_ALGOLIA_INDEX      ... サブスク用インデックス名
 */
export async function POST(req: NextRequest) {
  const trialCode = process.env.PREMIUM_TRIAL_CODE || ''
  const trialDays = Number(process.env.PREMIUM_TRIAL_DAYS || '14')
  const algoliaAppId = process.env.SUBSCRIPTION_ALGOLIA_APP_ID
  const algoliaSearchKey = process.env.SUBSCRIPTION_ALGOLIA_SEARCH_KEY
  const algoliaIndex = process.env.SUBSCRIPTION_ALGOLIA_INDEX || 'Medical Knowledge_DB（サブスク用）'

  // トライアルコードが未設定なら、トライアル機能自体を無効として扱う。
  if (!trialCode) {
    return NextResponse.json({ error: 'トライアルは現在利用できません' }, { status: 503 })
  }
  if (!algoliaAppId || !algoliaSearchKey) {
    return NextResponse.json({ error: 'Algolia設定が不足しています' }, { status: 500 })
  }

  try {
    const { code } = await req.json()
    if (!code || typeof code !== 'string') {
      return NextResponse.json({ error: 'コードを入力してください' }, { status: 400 })
    }

    // 前後の空白を除去し、大文字小文字を無視して照合（入力ミスを吸収）。
    const normalized = code.trim().toLowerCase()
    if (normalized !== trialCode.trim().toLowerCase()) {
      return NextResponse.json({ error: 'コードが正しくありません' }, { status: 403 })
    }

    // トライアル期限 = 今日 + trialDays 日
    const days = Number.isFinite(trialDays) && trialDays > 0 ? trialDays : 14
    const trialEndsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

    return NextResponse.json({
      ok: true,
      trialDays: days,
      trialEndsAt,
      algolia: {
        appId: algoliaAppId,
        searchKey: algoliaSearchKey,
        index: algoliaIndex,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
