import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

/**
 * プレミアム サブスク 検証 & Algoliaキー配布
 *
 * POST /api/premium/verify
 * Body: { sessionId: string }
 *
 * Stripe Checkout 完了後に session_id を受け取り、
 * サブスクがアクティブであれば Algolia の Search-only Key を返す。
 *
 * 必要な環境変数:
 *   - STRIPE_SECRET_KEY               ... StripeのSecret Key
 *   - SUBSCRIPTION_ALGOLIA_APP_ID     ... サブスク用AlgoliaのApp ID
 *   - SUBSCRIPTION_ALGOLIA_SEARCH_KEY ... サブスク用Algoliaの検索専用キー（Search-only）
 *   - SUBSCRIPTION_ALGOLIA_INDEX      ... サブスク用インデックス名
 */
export async function POST(req: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  const algoliaAppId = process.env.SUBSCRIPTION_ALGOLIA_APP_ID
  const algoliaSearchKey = process.env.SUBSCRIPTION_ALGOLIA_SEARCH_KEY
  const algoliaIndex = process.env.SUBSCRIPTION_ALGOLIA_INDEX || 'Medical Knowledge_DB（サブスク用）'

  if (!stripeKey) {
    return NextResponse.json({ error: 'Stripe設定が不足しています' }, { status: 500 })
  }
  if (!algoliaAppId || !algoliaSearchKey) {
    return NextResponse.json({ error: 'Algolia設定が不足しています' }, { status: 500 })
  }

  try {
    const { sessionId } = await req.json()
    if (!sessionId || typeof sessionId !== 'string') {
      return NextResponse.json({ error: 'sessionId が必要です' }, { status: 400 })
    }

    const stripe = new Stripe(stripeKey)

    // Checkout Sessionを取得
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    })

    // Payment成功 + サブスクアクティブの確認
    if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
      return NextResponse.json(
        { error: '支払いが完了していません', status: session.payment_status },
        { status: 402 },
      )
    }

    const subscription = session.subscription
    if (!subscription || typeof subscription === 'string') {
      return NextResponse.json({ error: 'サブスクリプション情報を取得できませんでした' }, { status: 400 })
    }

    if (subscription.status !== 'active' && subscription.status !== 'trialing') {
      return NextResponse.json(
        { error: `サブスクリプションが有効ではありません (${subscription.status})` },
        { status: 402 },
      )
    }

    // 契約をアカウントに紐付けてサーバー保存（端末またぎ解決の要）。
    // session の client_reference_id / metadata.user_id にログイン中ユーザーIDが入っている。
    const userId =
      session.client_reference_id ||
      (session.metadata && session.metadata.user_id) ||
      undefined
    const supabaseReady = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
    if (supabaseReady && userId) {
      try {
        const { upsertSubscriptionByUserId } = await import('@/lib/supabase/subscriptions')
        const customerId = typeof session.customer === 'string' ? session.customer : null
        const periodEnd = subscription.items.data[0]?.current_period_end
          ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
          : null
        await upsertSubscriptionByUserId({
          user_id: userId,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscription.id,
          status: subscription.status,
          current_period_end: periodEnd,
          trial_ends_at: null,
          plan: 'premium',
        })
      } catch (e) {
        // DB保存に失敗してもキー配布は継続（webhookが後で同期する）。
        console.error('verify: subscriptions保存失敗', e instanceof Error ? e.message : e)
      }
    }

    // アクティブ確認済み → Algoliaキーを返す
    return NextResponse.json({
      ok: true,
      subscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
      // ログイン＆DB保存できたか（フロントが「端末間で引き継ぎ可能」を表示する用）。
      linkedToAccount: !!(supabaseReady && userId),
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
