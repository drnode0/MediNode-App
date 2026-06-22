import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { grantComplimentaryByUserId } from '@/lib/supabase/subscriptions'
import { notifyCompGranted } from '@/lib/comp-notify'

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
 * このエンドポイントは2種類のコードを受け付ける（UIは共通の1入力欄）:
 *   (A) 通常のトライアルコード（PREMIUM_TRIAL_CODE）… 期限付き・端末ローカル保存（従来動作）
 *   (B) 招待コード（COMP_INVITE_CODES）… 無期限・ログイン必須・subscriptions(plan=comp)へサーバー保存
 *       目立つUIを足さず、同じ入力欄に隠しコードを入れたときだけ無期限解放になる。
 *
 * 必要な環境変数:
 *   - PREMIUM_TRIAL_CODE              ... トライアル開始用のクーポンコード（例: MEDINODE2026）
 *   - PREMIUM_TRIAL_DAYS             ... トライアル日数（未設定なら14）
 *   - COMP_INVITE_CODES               ... 招待コード（カンマ区切り・無期限comp）。任意
 *   - SUBSCRIPTION_ALGOLIA_APP_ID     ... サブスク用AlgoliaのApp ID
 *   - SUBSCRIPTION_ALGOLIA_SEARCH_KEY ... サブスク用Algoliaの検索専用キー（Search-only）
 *   - SUBSCRIPTION_ALGOLIA_INDEX      ... サブスク用インデックス名
 */
export async function POST(req: NextRequest) {
  const trialCode = process.env.PREMIUM_TRIAL_CODE || ''
  const trialDays = Number(process.env.PREMIUM_TRIAL_DAYS || '14')
  const inviteCodes = (process.env.COMP_INVITE_CODES || '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)
  const algoliaAppId = process.env.SUBSCRIPTION_ALGOLIA_APP_ID
  const algoliaSearchKey = process.env.SUBSCRIPTION_ALGOLIA_SEARCH_KEY
  const algoliaIndex = process.env.SUBSCRIPTION_ALGOLIA_INDEX || 'Medical Knowledge_DB（サブスク用）'

  // トライアルコード・招待コードのどちらも未設定なら、機能自体を無効として扱う。
  if (!trialCode && inviteCodes.length === 0) {
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

    // (B) 招待コード → 無期限comp。ログイン必須でサーバー(subscriptions)に紐付ける。
    if (inviteCodes.includes(normalized)) {
      const supabaseReady = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
      if (!supabaseReady) {
        return NextResponse.json({ error: 'サーバー設定が不足しています' }, { status: 500 })
      }
      const supabase = await createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        // 端末またぎ・無期限のためログインが前提。
        return NextResponse.json({ error: 'login_required' }, { status: 401 })
      }
      await grantComplimentaryByUserId(user.id)
      // オーナー通知＆棚卸し台帳への記録（best-effort。失敗しても付与は成功扱い）。
      await notifyCompGranted({ userId: user.id, email: user.email ?? null, code: normalized })
      return NextResponse.json({
        ok: true,
        comp: true,
        trialEndsAt: null, // 無期限
        algolia: {
          appId: algoliaAppId,
          searchKey: algoliaSearchKey,
          index: algoliaIndex,
        },
      })
    }

    // (A) 通常のトライアルコード（期限付き・従来動作）。
    if (!trialCode || normalized !== trialCode.trim().toLowerCase()) {
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
