import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { createClient } from '@/lib/supabase/server'
import { rateLimit, clientIp } from '@/lib/rate-limit'

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
  // Stripe Checkout セッションの無制限量産（APIレート枠・ダッシュボード汚染）を抑止。
  // 正規ユーザーの購入は数回で足りるため、IP単位で 10回/10分に制限する。
  if (!rateLimit(`checkout:${clientIp(req)}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json(
      { error: '試行回数が多すぎます。しばらく待ってからお試しください' },
      { status: 429 },
    )
  }

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

    // 契約を紐付けるユーザーIDはセッションから取得する（body渡しは廃止）。
    // body の userId を信用すると、第三者が任意のアカウントに契約を紐付けられてしまう。
    // 未ログイン（またはSupabase未設定環境）なら従来どおり紐付けなしで決済だけ通す。
    let userId: string | undefined
    let sessionEmail: string | undefined
    if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          userId = user.id
          sessionEmail = user.email ?? undefined
        }
      } catch {
        // セッション取得失敗は「未ログイン」として扱う。
      }
    }
    // Checkout画面に事前入力するメール。セッション優先・未ログイン時のみbodyを許容。
    const email = sessionEmail ?? (typeof body.email === 'string' ? body.email : undefined)

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
