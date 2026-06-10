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

  // イベント処理（Phase 1: ログのみ）
  switch (event.type) {
    case 'customer.subscription.deleted':
      console.log('サブスク解約:', event.data.object.id)
      // Phase 2: ここでDBのステータスをcanceledに更新
      break

    case 'customer.subscription.updated':
      console.log('サブスク更新:', event.data.object.id, event.data.object.status)
      // Phase 2: ここでDBのステータスを同期
      break

    case 'invoice.payment_failed':
      console.log('支払い失敗: invoice.payment_failed received')
      // Phase 2: ここでDBのステータスをpast_dueに更新 + ユーザー通知
      break

    default:
      // その他のイベントは無視
      break
  }

  return NextResponse.json({ received: true })
}
