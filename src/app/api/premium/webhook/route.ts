import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

/**
 * Stripe Webhook エンドポイント
 *
 * POST /api/premium/webhook
 *
 * Stripeダッシュボードで以下のイベントを登録:
 *   - customer.subscription.deleted  → サブスク解約時
 *   - customer.subscription.updated  → プラン変更・支払い失敗時
 *   - invoice.payment_failed         → 支払い失敗時
 *
 * 必要な環境変数:
 *   - STRIPE_SECRET_KEY         ... StripeのSecret Key
 *   - STRIPE_WEBHOOK_SECRET     ... Webhook署名検証用のシークレット (whsec_...)
 *
 * Phase 1: イベントを受け取ってログに残すだけ（サーバーサイドDBなし）
 * Phase 2: Supabaseなどへの会員ステータス書き込みはここで行う
 */
export async function POST(req: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!stripeKey || !webhookSecret) {
    return NextResponse.json({ error: 'Stripe Webhook設定が不足しています' }, { status: 500 })
  }

  const body = await req.text()
  const signature = req.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Stripe-Signatureヘッダーがありません' }, { status: 400 })
  }

  let event: Stripe.Event
  try {
    const stripe = new Stripe(stripeKey)
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret)
  } catch (err) {
    const message = err instanceof Error ? err.message : '署名検証失敗'
    console.error('Webhook署名検証エラー:', message)
    return NextResponse.json({ error: `Webhook Error: ${message}` }, { status: 400 })
  }

  // イベント処理（Phase 2: Supabaseの契約状態を同期）
  // Supabase未設定の環境ではDB書き込みをスキップして 200 を返す（決済自体は動かす）。
  const supabaseReady = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        // 初回の契約成立。client_reference_id / metadata.user_id からアカウントに紐付ける。
        const session = event.data.object as Stripe.Checkout.Session
        const userId =
          session.client_reference_id ||
          (session.metadata && session.metadata.user_id) ||
          undefined
        const customerId = typeof session.customer === 'string' ? session.customer : undefined
        const subscriptionId =
          typeof session.subscription === 'string' ? session.subscription : undefined

        if (supabaseReady && userId) {
          const { upsertSubscriptionByUserId } = await import('@/lib/supabase/subscriptions')
          // この時点のサブスク状態を取得（trialing/active を反映）。
          let status: string | null = 'active'
          let periodEnd: string | null = null
          if (subscriptionId) {
            const stripe = new Stripe(stripeKey)
            const sub = await stripe.subscriptions.retrieve(subscriptionId)
            status = sub.status
            periodEnd = sub.items.data[0]?.current_period_end
              ? new Date(sub.items.data[0].current_period_end * 1000).toISOString()
              : null
          }
          await upsertSubscriptionByUserId({
            user_id: userId,
            stripe_customer_id: customerId ?? null,
            stripe_subscription_id: subscriptionId ?? null,
            status,
            current_period_end: periodEnd,
            trial_ends_at: null, // Stripe正式登録は無期限（コード式トライアルの期限は使わない）
            plan: 'premium',
            cancel_at_period_end: false, // 新規契約なので解約予約フラグをリセット
          })
        }
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription
        const customerId = typeof sub.customer === 'string' ? sub.customer : null
        const periodEnd = sub.items.data[0]?.current_period_end
          ? new Date(sub.items.data[0].current_period_end * 1000).toISOString()
          : null
        if (supabaseReady && customerId) {
          const { updateStatusByCustomer } = await import('@/lib/supabase/subscriptions')
          // cancel_at_period_end はカスタマーポータルでの解約（期間末終了の予約）で true になる。
          // アプリ側の「解約手続き済み・◯/◯まで利用可能」表示の元データ。
          await updateStatusByCustomer(customerId, sub.status, periodEnd, !!sub.cancel_at_period_end)
        }
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription
        const customerId = typeof sub.customer === 'string' ? sub.customer : null
        if (supabaseReady && customerId) {
          const { updateStatusByCustomer } = await import('@/lib/supabase/subscriptions')
          await updateStatusByCustomer(customerId, 'canceled')
        }
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        const customerId = typeof invoice.customer === 'string' ? invoice.customer : null
        if (supabaseReady && customerId) {
          const { updateStatusByCustomer } = await import('@/lib/supabase/subscriptions')
          await updateStatusByCustomer(customerId, 'past_due')
        }
        break
      }

      default:
        break
    }
  } catch (err) {
    // DB同期に失敗しても 200 を返すと Stripe が再送してくれる。ログだけ残す。
    console.error('Webhook処理エラー:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'webhook処理に失敗しました' }, { status: 500 })
  }

  return NextResponse.json({ received: true })
}
