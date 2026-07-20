// Supabaseセッションを各リクエストで自動更新する Proxy（旧 middleware）。
// これにより一度ログインすればトークンが裏で更新され続け、実質ログインしっぱなしになる。
// Next.js 16 で middleware → proxy に名称変更されたため proxy() をエクスポートする。
//
// アクセス制御（REQUIRE_LOGIN）:
//   環境変数 REQUIRE_LOGIN=true のときだけ、未ログインのページ表示を /login へ
//   リダイレクトする「全員ログイン前提」ゲートを有効化する。
//   フラグが未設定/true以外なら従来通り＝検索など基本機能は未ログインでも動く
//   （モニター期はOFF、一般公開時にON へ切替する段階導入用フラグ）。
//   ※ コードを入れても REQUIRE_LOGIN が無ければ挙動は一切変わらない。

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { REQUIRE_LOGIN_COOKIE } from '@/lib/login-policy'
import {
  MAINTENANCE_BYPASS_COOKIE,
  readMaintenanceFlag,
  verifyBypassToken,
  shouldBlockForMaintenance,
} from '@/lib/maintenance'

// ログイン必須フラグ。明示的に 'true' のときだけ有効。
const REQUIRE_LOGIN = process.env.REQUIRE_LOGIN === 'true'

// REQUIRE_LOGIN の現在値をクライアントへ伝える cookie を全ページ応答に載せる。
// トップ（'/'）は公開のためサーバー側では止められず、「設定済み端末×未ログイン」を
// ホームに着地させない判定はクライアント（page.tsx）が この cookie を見て行う。
// PWAはService Workerキャッシュから起動することがあるため、セッションcookieではなく
// 30日持たせる（フラグ切替は次のネットワーク経由のページ表示で自然に追従する）。
function withPolicyCookie(res: NextResponse): NextResponse {
  res.cookies.set(REQUIRE_LOGIN_COOKIE, REQUIRE_LOGIN ? '1' : '0', {
    path: '/',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 30,
  })
  return res
}

// REQUIRE_LOGIN 有効時でもログイン無しでアクセスを許可するパス。
// /login 自身・認証コールバック・法務ページ等（無限リダイレクト防止＆規約閲覧の確保）。
const PUBLIC_PREFIXES = ['/login', '/auth', '/privacy', '/terms', '/legal']

function isPublicPath(pathname: string): boolean {
  // トップ（'/'）は REQUIRE_LOGIN=true でも公開する（オーナー決定 2026-07-15）。
  //
  // 初回導線は「オンボーディング → 入口分岐（アカウントあり=ログイン／はじめて=設定）
  // → 設定の最後にアカウント登録」。オンボーディングとセットアップは未ログインのまま進む。
  // セットアップ途中に必要な代理API（接続テスト /api/notion/check-props・初回同期 /api/sync）は
  // requireSessionOrSetupRateLimit（api-guard.ts）で「未ログインはIPレート制限つき許可」に
  // 緩和してあるため、以前あった login_required(401) で詰まる問題は起きない。
  // その他のページ・APIは従来どおりログイン必須（オープンプロキシ化の防止は維持）。
  // ログアウト（端末リセット→'/'）も、この公開トップ＝セットアップ入口に着地する。
  if (pathname === '/') return true
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  // ── メンテナンスゲート（REQUIRE_LOGIN より手前）──
  // フラグ ON かつ 非オーナー（有効な通行cookie無し）かつ 非許可パス なら /maintenance を表示。
  // rewrite（URLは変えず内容だけ差し替え）で、ブックマークやPWAの start_url を壊さない。
  {
    const maintenance = await readMaintenanceFlag()
    if (maintenance) {
      const bypass = request.cookies.get(MAINTENANCE_BYPASS_COOKIE)?.value
      const hasValidBypass = await verifyBypassToken(bypass)
      if (
        shouldBlockForMaintenance({
          maintenance,
          pathname: request.nextUrl.pathname,
          hasValidBypass,
        })
      ) {
        const url = request.nextUrl.clone()
        url.pathname = '/maintenance'
        url.search = ''
        return NextResponse.rewrite(url)
      }
    }
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  // 環境変数が無い場合は何もしない（ローカルで未設定でもアプリが落ちないように）。
  if (!url || !anonKey) return withPolicyCookie(response)

  // セッションCookieの有無（未ログイン判定にも、後段のセッション更新スキップにも使う）。
  const hasAuthCookie = request.cookies
    .getAll()
    .some((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'))

  // ── アクセス制御ゲート（REQUIRE_LOGIN=true のときだけ動く）──
  // 未ログイン かつ 公開パス以外 なら /login へ。元のパスを next で引き継ぐ。
  if (REQUIRE_LOGIN && !hasAuthCookie) {
    const { pathname, search } = request.nextUrl
    if (!isPublicPath(pathname)) {
      const loginUrl = request.nextUrl.clone()
      loginUrl.pathname = '/login'
      loginUrl.search = ''
      loginUrl.searchParams.set('next', `${pathname}${search}`)
      return NextResponse.redirect(loginUrl)
    }
  }

  // 高速化: セッションCookieが無い（＝未ログイン）リクエストでは、更新するものが無いので
  // Supabase認証サーバーへの問い合わせ（getUser）を丸ごとスキップする。
  // モニター期間中は未ログインの初回アクセスが大半なので、初回表示の遅延を大きく減らせる。
  // （hasAuthCookie は上部で算出済み）
  if (!hasAuthCookie) return withPolicyCookie(response)

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
        response = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        )
      },
    },
  })

  // セッションを更新（getUser を呼ぶとトークンのリフレッシュが走る）。
  await supabase.auth.getUser()

  return withPolicyCookie(response)
}

export const config = {
  matcher: [
    // 静的アセット・画像・API・認証コールバックを除く「ページ表示」リクエストでのみ実行。
    // API（/api/*）は各自で認証を処理するため、ここでのセッション更新は不要（無駄な往復を避ける）。
    // mp4 はセットアップ動画（/guide/setup-video.mp4）。未ログインのセットアップ中に再生するため、
    // 画像と同様にゲート対象から除外する（除外しないと REQUIRE_LOGIN 時に 307 でリダイレクトされ再生不能）。
    '/((?!_next/static|_next/image|api|auth/confirm|favicon.ico|manifest.json|sw.js|icon-.*\\.png|apple-touch-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4)$).*)',
  ],
}
