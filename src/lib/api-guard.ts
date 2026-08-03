// データ系 API のアクセス制御（S-3: middleware ゲートだけに依存しない二重化）。
//
// proxy.ts の REQUIRE_LOGIN ゲートは「ページ表示」のみ対象で、/api/* は matcher から
// 除外されている。さらに Next.js の middleware 層には過去に認証バイパス脆弱性
// （例: CVE-2025-29927）が出ているため、route handler 内でも独立にセッションを検証する。
//
// REQUIRE_LOGIN=true のときだけ有効（モニター期・ローカル開発では従来どおり素通し）。
// 同一オリジンの fetch は Supabase セッション Cookie を自動送信するため、
// ログイン済みクライアントの呼び出しはそのまま通る。

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { rateLimitAsync, clientIp } from '@/lib/rate-limit'
import { resolveRequestPremium, type PremiumDeps } from '@/lib/premium-access'

// プレミアム限定APIの入口。認証（401）と権限（403）を **1回のセッション解決** で決める。
//
// 以前は requireSessionIfLoginRequired() と resolveRequestPremium() を続けて呼んでおり、
// どちらも内部で supabase.auth.getUser() を叩いていた。getUser() は getSession() と違い
// 毎回認証サーバーへネットワークに出る仕様なので、この重複はそのまま待ち時間になる。
// 本文がキャッシュ済みでも必ず払う固定費だった（本文・画像の各リクエストごとに）。
//
// 二重化（S-3）の趣旨は「middleware だけに依存せず route 内でも検証すること」であり、
// 同じ検証を2回行うことではない。ここで1回検証すれば趣旨は満たされる。
export async function requirePremiumRequest(
  deps?: Partial<PremiumDeps>,
): Promise<{ denied: NextResponse; userId: null } | { denied: null; userId: string; email: string | null }> {
  const { premium, userId, email } = await resolveRequestPremium(deps)

  // ログイン必須の運用では、未ログインは 403 ではなく 401 で返す（クライアントが再ログインへ導ける）。
  if (process.env.REQUIRE_LOGIN === 'true' && !userId) {
    return { denied: NextResponse.json({ error: 'login_required' }, { status: 401 }), userId: null }
  }
  if (!premium) {
    return { denied: NextResponse.json({ error: 'premium required' }, { status: 403 }), userId: null }
  }
  return { denied: null, userId: userId as string, email }
}

// REQUIRE_LOGIN=true なら Supabase セッションを検証し、未ログインは 401 を返す。
// 通過時は null を返す（呼び出し側は `const denied = await requireSessionIfLoginRequired(); if (denied) return denied` の形で使う）。
export async function requireSessionIfLoginRequired(): Promise<NextResponse | null> {
  if (process.env.REQUIRE_LOGIN !== 'true') return null

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  // Supabase 未設定の環境では検証しようがない（ローカル等）。ゲートは proxy 側と同様に無効化。
  if (!url || !anonKey) return null

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 })
  }
  return null
}

// セットアップ専用の緩和ガード（requireSessionIfLoginRequired の代替）。
//
// REQUIRE_LOGIN=true でも、初回導線は「オンボーディング → 設定 → 最後にアカウント登録」
// （オーナー決定 2026-07-15）のため、セットアップ途中に呼ばれるルート
// （接続テスト /api/notion/check-props・初回同期 /api/sync）だけは未ログインを許可する。
// ただしオープンプロキシ化（任意トークンの代理リクエスト悪用）を防ぐため、
// 未ログイン呼び出しには IP 単位のレート制限をかける。ログイン済みは従来どおり素通し。
// 上限は「1人のセットアップ＋やり直し数回」が収まる値にし、機械的な連打だけを弾く。
export async function requireSessionOrSetupRateLimit(
  req: Request,
  routeKey: string,
  limit: number,
  windowMs: number,
): Promise<NextResponse | null> {
  if (process.env.REQUIRE_LOGIN !== 'true') return null

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) return null

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) return null

  // 未ログイン＝セットアップ中の呼び出しとみなし、IPレート制限だけで通す。
  if (!(await rateLimitAsync(`setup:${routeKey}:${clientIp(req)}`, limit, windowMs))) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429 })
  }
  return null
}

// 管理者（COMP_ADMIN_EMAILS）専用ガード。デバッグ用エンドポイント等、
// REQUIRE_LOGIN の値に関係なく常にオーナーのみに制限したい場所で使う。
export async function requireAdminSession(): Promise<NextResponse | null> {
  const supabaseReady = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
  if (!supabaseReady) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'login_required' }, { status: 401 })
  }
  const adminEmails = (process.env.COMP_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  const isAdmin = !!user.email && adminEmails.includes(user.email.toLowerCase())
  if (!isAdmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  return null
}
