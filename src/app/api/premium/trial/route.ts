import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { grantComplimentaryByUserId, grantTrialByUserId } from '@/lib/supabase/subscriptions'
import { notifyCompGranted } from '@/lib/comp-notify'
import { rateLimit, clientIp } from '@/lib/rate-limit'
import { issuePremiumSearchKey } from '@/lib/algolia-secured'
import { trialCodeDays, REFERRAL_NEW_USER_DAYS } from '@/lib/campaign'
import { looksLikeReferralCode, normalizeReferralCode, canRedeemReferral, isSameMailbox } from '@/lib/referral'
import {
  findReferralCodeOwner,
  hasRedeemedReferral,
  getRedeemerContext,
  insertReferralRedemption,
  deleteReferralRedemption,
  grantReferrerReward,
} from '@/lib/supabase/referrals'
import type { User } from '@supabase/supabase-js'

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
 * このエンドポイントは3種類のコードを受け付ける（UIは共通の1入力欄）:
 *   (A) 通常のトライアルコード（PREMIUM_TRIAL_CODE）… 期限付き・端末ローカル保存（従来動作・ログイン不要）
 *   (B) 招待コード（COMP_INVITE_CODES）… 無期限・ログイン必須・subscriptions(plan=comp)へサーバー保存
 *   (C) 期限付きトライアルコード（TRIAL_CODES）… note特典など一般向け。カード不要・14日（既定）で
 *       自動失効・ログイン必須・subscriptions(plan=trial, trial_ends_at=付与+日数)へサーバー保存。
 *       サーバーが trial_ends_at を見て失効させるため、端末またぎでも期限が効く（無期限compとは別系統）。
 *   (D) 友達紹介コード（MN-XXXXXXXX・referral_codes）… 新規14日・紹介者+14日・ログイン必須。
 *       env系に一致せず紹介コードの形をした入力だけDB照合する（handleReferralRedemption）。
 *   いずれも目立つUIを足さず、同じ入力欄に入れたコードの種別でサーバーが分岐する。
 *
 * 必要な環境変数:
 *   - PREMIUM_TRIAL_CODE              ... トライアル開始用のクーポンコード（例: MEDINODE2026）
 *   - PREMIUM_TRIAL_DAYS             ... トライアル日数（未設定なら14）
 *   - COMP_INVITE_CODES               ... 招待コード（カンマ区切り・無期限comp）。任意
 *   - TRIAL_CODES                     ... 期限付きトライアルコード（カンマ区切り・note特典用）。任意
 *   - TRIAL_DAYS                      ... 期限付きトライアルの日数（未設定ならキャンペーン中30・通常21）
 *   - SUBSCRIPTION_ALGOLIA_APP_ID     ... サブスク用AlgoliaのApp ID
 *   - SUBSCRIPTION_ALGOLIA_SEARCH_KEY ... サブスク用Algoliaの検索専用キー（Search-only）
 *   - SUBSCRIPTION_ALGOLIA_INDEX      ... サブスク用インデックス名
 */
export async function POST(req: NextRequest) {
  // S-5: 共有コードの総当たり対策。IP単位で 10回/10分 まで（正規ユーザーの
  // 入力ミス数回は許容しつつ、機械的な列挙を止める）。
  if (!rateLimit(`trial:${clientIp(req)}`, 10, 10 * 60 * 1000)) {
    return NextResponse.json(
      { error: '試行回数が多すぎます。しばらく待ってからお試しください' },
      { status: 429 },
    )
  }

  const trialCode = process.env.PREMIUM_TRIAL_CODE || ''
  const trialDays = Number(process.env.PREMIUM_TRIAL_DAYS || '14')
  const inviteCodes = (process.env.COMP_INVITE_CODES || '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)
  // 期限付きトライアル（note特典など）。無期限compとは別の環境変数で管理し、取り違えを防ぐ。
  const trialCodes = (process.env.TRIAL_CODES || '')
    .split(',')
    .map((c) => c.trim().toLowerCase())
    .filter(Boolean)
  // 未設定なら公開記念キャンペーン中30日・通常21日（campaign.ts）。環境変数が優先。
  const trialPeriodDays = Number(process.env.TRIAL_DAYS || String(trialCodeDays()))
  const algoliaAppId = process.env.SUBSCRIPTION_ALGOLIA_APP_ID
  const algoliaSearchKey = process.env.SUBSCRIPTION_ALGOLIA_SEARCH_KEY
  const algoliaIndex = process.env.SUBSCRIPTION_ALGOLIA_INDEX || 'Medical Knowledge_DB（サブスク用）'

  // どのコード系統も未設定なら、機能自体を無効として扱う。
  if (!trialCode && inviteCodes.length === 0 && trialCodes.length === 0) {
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

    const isInvite = inviteCodes.includes(normalized)
    const isTrial = trialCodes.includes(normalized)
    const isPlain = !!trialCode && normalized === trialCode.trim().toLowerCase()

    // オラクル対策（総当たり防止）: 招待/期限付きトライアルコードはログイン必須。
    // ここで「有効コードだがログインが必要(401)」と「無効コード(403)」を区別できると、
    // 未ログインの攻撃者が応答コードの違いだけで有効コードを特定できてしまう。
    // そこで、ログイン不要の (A) 通常トライアルコード以外は、コードの当否を判定する前に
    // ログインを要求し、未ログインには常に同一の 401 を返す（当否を漏らさない）。
    if (!isPlain) {
      const supabaseReady = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
      const supabase = await createClient()
      const { data: { user } } = supabaseReady
        ? await supabase.auth.getUser()
        : { data: { user: null } }
      if (!user) {
        // 有効な招待/トライアルコードでも、無効コードでも、未ログインなら同じ応答。
        return NextResponse.json({ error: 'login_required' }, { status: 401 })
      }

      // ここから先はログイン済み。コード種別で分岐する。
      if (!isInvite && !isTrial) {
        // (D) 友達紹介コード（MN-XXXXXXXX）。env系コードに一致しない入力のうち、
        //     紹介コードの形をしているものだけDBに照合する。実在しなければ無効コードと同じ403
        //     （形式の当否で応答を変えず、総当たりに情報を漏らさない）。
        const refCode = normalizeReferralCode(code)
        if (looksLikeReferralCode(refCode) && supabaseReady) {
          return handleReferralRedemption({
            refCode,
            user,
            algolia: { appId: algoliaAppId, parentSearchKey: algoliaSearchKey, index: algoliaIndex },
          })
        }
        return NextResponse.json({ error: 'コードが正しくありません' }, { status: 403 })
      }
      if (!supabaseReady) {
        return NextResponse.json({ error: 'サーバー設定が不足しています' }, { status: 500 })
      }

      // (B) 招待コード → 無期限comp。ログイン必須でサーバー(subscriptions)に紐付ける。
      if (isInvite) {
        await grantComplimentaryByUserId(user.id)
        // オーナー通知＆棚卸し台帳への記録（best-effort。失敗しても付与は成功扱い）。
        await notifyCompGranted({ userId: user.id, email: user.email ?? null, code: normalized })
        return NextResponse.json({
          ok: true,
          comp: true,
          trialEndsAt: null, // 無期限（キー自体は短命。ログイン中は PremiumSync が自動更新する）
          algolia: {
            appId: algoliaAppId,
            searchKey: issuePremiumSearchKey({
              appId: algoliaAppId,
              parentSearchKey: algoliaSearchKey,
              index: algoliaIndex,
            }),
            index: algoliaIndex,
          },
        })
      }

      // (C) 期限付きトライアルコード（note特典など一般向け）→ サーバー保存・自動失効。
      //     plan=trial で trial_ends_at を入れる。getActiveStatusByUserId が期限を見て失効させる。
      const days = Number.isFinite(trialPeriodDays) && trialPeriodDays > 0 ? trialPeriodDays : trialCodeDays()
      const trialEndsAt = await grantTrialByUserId(user.id, days)
      // plan='trial' であることを通知側に伝え、台帳で無期限compと区別できるようにする。
      await notifyCompGranted({ userId: user.id, email: user.email ?? null, code: normalized, plan: 'trial', trialEndsAt })
      return NextResponse.json({
        ok: true,
        trial: true,
        trialDays: days,
        trialEndsAt, // この日時を過ぎるとサーバーが失効させる（キーも同時刻で暗号的に失効）
        algolia: {
          appId: algoliaAppId,
          searchKey: issuePremiumSearchKey({
            appId: algoliaAppId,
            parentSearchKey: algoliaSearchKey,
            index: algoliaIndex,
            expiresAt: trialEndsAt,
          }),
          index: algoliaIndex,
        },
      })
    }

    // (A) 通常のトライアルコード（期限付き・従来動作・ログイン不要）。
    // ここに来る時点で isPlain===true が確定しているが、防御的に再照合する。
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
        // S-4: 期限をキー自体に埋め込む。localStorage の trialEndsAt を改ざんしても
        // 期限を過ぎたキーでは Algolia 検索自体が通らない。
        searchKey: issuePremiumSearchKey({
          appId: algoliaAppId,
          parentSearchKey: algoliaSearchKey,
          index: algoliaIndex,
          expiresAt: trialEndsAt,
        }),
        index: algoliaIndex,
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// (D) 友達紹介コードの償還。
//   新規側: 14日トライアル（plan='trial'・サーバー保存・自動失効。noteコードと同じ挙動）
//   紹介者: +14日（契約状態に応じて延長/付与。best-effort — 失敗しても新規側は成功扱い）
// 二重受け取りは referral_redemptions.referred_user_id UNIQUE がDBレベルで防ぐ。
async function handleReferralRedemption(opts: {
  refCode: string
  user: User
  algolia: { appId: string; parentSearchKey: string; index: string }
}) {
  const { refCode, user, algolia } = opts

  const referrerId = await findReferralCodeOwner(refCode)
  if (!referrerId) {
    // 実在しないコードは無効コードと同じ応答（有効コードの探索に情報を漏らさない）。
    return NextResponse.json({ error: 'コードが正しくありません' }, { status: 403 })
  }

  const [alreadyRedeemed, ctx] = await Promise.all([
    hasRedeemedReferral(user.id),
    getRedeemerContext(user.id),
  ])
  // サブアカ自作自演の最安手口（Gmailの+エイリアス・ドット違い）を弾く。
  // メール実体が同じなら、アカウントが別でも自己紹介として扱う。
  let sameMailbox = false
  try {
    const { data: refUser } = await createAdminClient().auth.admin.getUserById(referrerId)
    sameMailbox = isSameMailbox(refUser?.user?.email, user.email)
  } catch {
    // 取得失敗時はこのガードだけスキップ（他の検証と生涯1回制限は生きている）。
  }
  const verdict = canRedeemReferral({
    isOwnCode: referrerId === user.id || sameMailbox,
    alreadyRedeemed,
    hasStripeHistory: ctx.hasStripeHistory,
    hasComp: ctx.hasComp,
  })
  if (!verdict.ok) {
    const message =
      verdict.reason === 'self_referral'
        ? 'ご自身の紹介コードは使えません'
        : verdict.reason === 'already_redeemed'
          ? '紹介コードの特典は、おひとり1回までです'
          : 'このコードは、はじめての方向けです'
    return NextResponse.json({ error: message }, { status: 403 })
  }

  // 先に成立記録（UNIQUEで同時リクエストの片方が false になる）。
  const inserted = await insertReferralRedemption({
    referrerId,
    referredId: user.id,
    code: refCode,
  })
  if (!inserted) {
    return NextResponse.json({ error: '紹介コードの特典は、おひとり1回までです' }, { status: 403 })
  }

  let trialEndsAt: string
  try {
    trialEndsAt = await grantTrialByUserId(user.id, REFERRAL_NEW_USER_DAYS)
  } catch (err) {
    // 付与に失敗したら記録を巻き戻して再試行できるようにする。
    await deleteReferralRedemption(user.id)
    throw err
  }

  // 紹介者への還元とオーナー通知は best-effort。
  try {
    await grantReferrerReward(referrerId)
  } catch (err) {
    console.error('referral: 紹介者還元に失敗:', err instanceof Error ? err.message : err)
  }
  await notifyCompGranted({
    userId: user.id,
    email: user.email ?? null,
    code: refCode,
    plan: 'trial',
    trialEndsAt,
  })

  return NextResponse.json({
    ok: true,
    trial: true,
    referral: true,
    trialDays: REFERRAL_NEW_USER_DAYS,
    trialEndsAt,
    algolia: {
      appId: algolia.appId,
      searchKey: issuePremiumSearchKey({
        appId: algolia.appId,
        parentSearchKey: algolia.parentSearchKey,
        index: algolia.index,
        expiresAt: trialEndsAt,
      }),
      index: algolia.index,
    },
  })
}
