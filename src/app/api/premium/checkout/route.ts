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
/**
 * 決済環境の状態を返す（フロントでテスト決済バッジ等を出すため）。
 * GET /api/premium/checkout
 * Body なし。
 *   - enabled  ... Stripe設定（Secret Key + Price ID）が揃っているか
 *   - testMode ... Secret Key が sk_test_ で始まる（テストモード）か。
 *                  ライブ化（sk_live_）すると自動的に false になり、テスト表記が消える。
 */
export async function GET() {
  const stripeKey = process.env.STRIPE_SECRET_KEY || ''
  const priceId = process.env.STRIPE_PRICE_ID || ''
  const enabled = !!(stripeKey && priceId)
  const testMode = stripeKey.startsWith('sk_test_')
  // 解約用 Stripe カスタマーポータルのログインURL。未設定ならフロントはメール問い合わせにフォールバック。
  const portalUrl = process.env.STRIPE_PORTAL_URL || ''
  return NextResponse.json({ enabled, testMode, portalUrl })
}

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
    // ログイン中ユーザーのID（契約をアカウントに紐付けるため）。未ログインなら undefined。
    const userId = typeof body.userId === 'string' && body.userId ? body.userId : undefined

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      ...(email ? { customer_email: email } : {}),
      // ログイン中なら user_id を session に紐付け（webhook/verify でアカウントに結びつける）。
      ...(userId ? { client_reference_id: userId } : {}),
      // 成功時: ?session_id={CHECKOUT_SESSION_ID} を付けてリダイレクト
      success_url: `${appUrl}/?premium_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/`,
      locale: 'ja',
      subscription_data: {
        metadata: { source: 'medinode', ...(userId ? { user_id: userId } : {}) },
        // 最初の無料トライアル（既定7日）。トライアル中も subscription.status は 'trialing' となり、
        // /api/premium/verify が 'trialing' を許可しているためプレミアムが利用できる。
        // 期間経過後に登録カードへ自動課金される（解約しなければ継続）。
        // note特典コード（TRIAL_CODES=14日）より短くし、note購入動線を相対的に優遇する。
        // 日数は STRIPE_TRIAL_DAYS で変更可（未設定なら7）。
        trial_period_days: (() => {
          const n = Number(process.env.STRIPE_TRIAL_DAYS || '7')
          return Number.isFinite(n) && n > 0 ? n : 7
        })(),
        // トライアル終了時に有効な支払い方法が無ければサブスクをキャンセル（請求漏れ・未払い放置を防ぐ）。
        // Stripe ダッシュボード側でトライアル終了前のリマインドメールをONにしておくこと。
        trial_settings: {
          end_behavior: { missing_payment_method: 'cancel' },
        },
      },
      // トライアル登録時もカード情報を必須にする（トライアル終了後の自動課金に必要）。
      payment_method_collection: 'always',
    })

    return NextResponse.json({ url: session.url })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
