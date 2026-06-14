// Supabaseセッションを各リクエストで自動更新する Proxy（旧 middleware）。
// これにより一度ログインすればトークンが裏で更新され続け、実質ログインしっぱなしになる。
// Next.js 16 で middleware → proxy に名称変更されたため proxy() をエクスポートする。
// 注意: ここではルートのアクセス制限（リダイレクト）は行わない。
//       検索など基本機能は未ログインでも従来通り動かす設計のため、
//       認証が必要な操作（プレミアム契約まわり）の判定はクライアント/API側で行う。

import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  // 環境変数が無い場合は何もしない（ローカルで未設定でもアプリが落ちないように）。
  if (!url || !anonKey) return response

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
    // 静的アセット・画像・APIの一部を除く全パスで実行。
    '/((?!_next/static|_next/image|favicon.ico|manifest.json|icon-.*\\.png|apple-touch-icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
