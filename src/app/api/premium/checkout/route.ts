import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'

/**
 * プレミアム サブスク Checkout Session 作成
 *
 * POST /api/premium/checkout
 * Body: { email?: string }
 *
 * 必要な環境変数:
 *   - STRIPE_SECRET_KEY  ... StripeのSecret Key (sk_live_... or sk_test_...)
 *   - STRIPE_PRICE_ID    ... Stripeで作成した月額プランのPrice ID (price_...)
 *   - NEXT_PUBLIC_APP_URL ... アプリのURL (例: https://your-app.vercel.app)
 */
export async function POST(req: NextRequest) {
  const stripeKey = process.env.STRIPE_SECRET_KEY
  const priceId = process.env.STRIPE_PRICE_ID
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  if (!stripeKey || !priceId) {
    return NextResponse.json(
      { error: 'Stripe設定が不足しています。環境変数を確認してください。' },
      { status: 500 },
    )
  }

  const stripe = new Stripe(stripeKey)

  try {
    const body = await req.json().catch(() => ({}))
    const email = typeof body.email === 'string' ? body.email : undefined

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      ...(email ? { customer_email: email } : {}),
      // 成功時: ?session_id={CHECKOUT_SESSION_ID} を付けてリダイレクト
      success_url: `${appUrl}/?premium_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/`,
      locale: 'ja',
      subscription_data: {
        metadata: { source: 'medinode' },
      },
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
