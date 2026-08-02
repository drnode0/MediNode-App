// ログイン中ユーザーの契約状態をサーバーから取得する。
// 端末またぎ解決の中核: 別端末でログインしても、ここがサーバーの記録を見て
// 契約が有効なら Algolia のプレミアム用 Search-Only キーを返す。
//
// GET /api/premium/status
//   - 認証: Supabaseセッション（Cookie）。未ログインなら { loggedIn:false }。
//   - 戻り: { loggedIn, active, status, algolia? }

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveStatusByUserId } from '@/lib/supabase/subscriptions'
import { issuePremiumSearchKey } from '@/lib/algolia-secured'
import { resolveEarlyAccess, resolveFeatures } from '@/lib/feature-access'
import { readLedger } from '@/lib/supabase/early-access'

export async function GET() {
  const supabaseReady = !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  if (!supabaseReady) {
    return NextResponse.json({ loggedIn: false, active: false, reason: 'supabase_not_configured' })
  }

  // セッションからユーザーを特定。
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ loggedIn: false, active: false })
  }

  // 用途①: 自分専用（開発者として常時無料）。
  // COMP_ADMIN_EMAILS（カンマ区切り）にログインメールが含まれていれば、
  // DBの契約状態に依らず無条件でプレミアム有効とする。DB書き込みすら不要で最も堅牢。
  const adminEmails = (process.env.COMP_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  const isAdmin = !!user.email && adminEmails.includes(user.email.toLowerCase())

  // 先行体験。env or 台帳 or GA。機能ごとに開閉するため、台帳からは
  // レガシーboolean（early_access）と機能配列（early_access_features）の両方を読む。
  // early_access_features 列が未適用でも落とさない（readLedger が early_access だけで再取得する）。
  const ledger = await readLedger(supabase, user.id)
  const featureInput = { email: user.email, ledgerEarlyAccess: ledger.earlyAccess, ledgerFeatures: ledger.features }
  // 既存クライアント（PWAキャッシュ含む）のために boolean も返し続ける。
  const earlyAccess = resolveEarlyAccess(featureInput)
  const features = resolveFeatures(featureInput)

  const sub = isAdmin
    ? { active: true, status: 'comp_admin', currentPeriodEnd: null, trialEndsAt: null, cancelAtPeriodEnd: false }
    : await getActiveStatusByUserId(user.id)

  if (!sub.active) {
    return NextResponse.json({
      loggedIn: true,
      active: false,
      status: sub.status,
      earlyAccess,
      features,
    })
  }

  // 有効契約 → プレミアム用Algoliaキーを配布（画面には出さずクライアントが設定に保存）。
  const algoliaAppId = process.env.SUBSCRIPTION_ALGOLIA_APP_ID
  const algoliaSearchKey = process.env.SUBSCRIPTION_ALGOLIA_SEARCH_KEY
  const algoliaIndex = process.env.SUBSCRIPTION_ALGOLIA_INDEX || 'Medical Knowledge_DB（サブスク用）'

  if (!algoliaAppId || !algoliaSearchKey) {
    return NextResponse.json({
      loggedIn: true,
      active: true,
      status: sub.status,
      error: 'Algolia設定が不足しています',
      earlyAccess,
      features,
    })
  }

  // S-4: 生の共有キーではなく、有効期限付きの Secured API Key を配布する。
  // 期限は日単位でグリッド化されており、同じ日のうちは同じキーが返る
  // （PremiumSync の「キー変更時のみ保存＆リロード」が日1回しか発火しない）。
  // 漏えいしても数日で失効し、ログイン中のユーザーはこのAPIで自動更新され続ける。
  return NextResponse.json({
    loggedIn: true,
    active: true,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
    trialEndsAt: sub.trialEndsAt ?? null,
    // 解約予約（期間末で終了・以降課金なし）。クライアントは currentPeriodEnd とセットで
    // 「解約手続き済み・◯/◯まで利用可能」を表示する。
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd ?? false,
    earlyAccess,
    features,
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
