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

// ログイン必須フラグ。明示的に 'true' のときだけ有効。
const REQUIRE_LOGIN = process.env.REQUIRE_LOGIN === 'true'

// REQUIRE_LOGIN 有効時でもログイン無しでアクセスを許可するパス。
// /login 自身・認証コールバック・法務ページ等（無限リダイレクト防止＆規約閲覧の確保）。
const PUBLIC_PREFIXES = ['/login', '/auth', '/privacy', '/terms', '/legal']

function isPublicPath(pathname: string): boolean {
  // REQUIRE_LOGIN=true のときは、トップ（'/'）も含めて全ページをログイン必須にする。
  //
  // 以前は '/' を公開扱い（未ログインでもオンボーディング＋セットアップを見せる）に
  // していたが、それだとセットアップ途中の「接続テスト」「同期」など代理APIが
  // REQUIRE_LOGIN で 401(login_required) になり、ログイン前のユーザーが詰まる。
  // 「ログイン必須」なら順番も「ログイン → オンボーディング → セットアップ」に統一するのが正しい
  // （ログイン後はセッションがあるので接続テスト・同期が通る。オンボーディングは
  //  ログイン後の新規アカウントで従来どおり表示される。公開前の紹介はティザーLPが担う）。
  // モニター期（REQUIRE_LOGIN 未設定）はこのゲート自体が動かないため、従来どおり '/' も見られる。
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  )
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  // 環境変数が無い場合は何もしない（ローカルで未設定でもアプリが落ちないように）。
  if (!url || !anonKey) return response

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
  if (!hasAuthCookie) return response

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

  return response
}

export const config = {
  matcher: [
    // 静的アセット・画像・API・認証コールバックを除く「ページ表示」リクエストでのみ実行。
    // API（/api/*）は各自で認証を処理するため、ここでのセッション更新は不要（無駄な往復を避ける）。
    '/((?!_next/static|_next/image|api|auth/confirm|favicon.ico|manifest.json|sw.js|icon-.*\\.png|apple-touch-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
