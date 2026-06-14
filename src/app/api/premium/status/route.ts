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

  const sub = await getActiveStatusByUserId(user.id)
  if (!sub.active) {
    return NextResponse.json({
      loggedIn: true,
      active: false,
      status: sub.status,
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
    })
  }

  return NextResponse.json({
    loggedIn: true,
    active: true,
    status: sub.status,
    currentPeriodEnd: sub.currentPeriodEnd,
    algolia: { appId: algoliaAppId, searchKey: algoliaSearchKey, index: algoliaIndex },
  })
}
