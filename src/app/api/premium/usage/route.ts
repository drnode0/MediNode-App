// プレミアム利用の記録（アカウント台帳「プレミアム利用」列のデータ源）。
//
//   POST /api/premium/usage … ログイン中ユーザーの user_metadata.premium_last_used_at を今に更新する。
//     クライアント（recordPremiumUse）がプレミアム検索の成功時に1時間1回だけ呼ぶ。
//
// 「トライアル中なのに一度もプレミアムを見ていない人」を台帳で抽出するための記録。
// 日時だけを保存し、検索内容は受け取らない。user_metadata なので DB マイグレーション不要。
// best-effort: 失敗してもアプリ側にエラーは見せない（台帳の列が「—」のままになるだけ）。

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function POST() {
  const supabaseReady = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  if (!supabaseReady) return NextResponse.json({ ok: false })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    // 未ログイン（ローカルキーのみでの利用等）は記録対象外（エラーではない）。
    return NextResponse.json({ ok: false })
  }

  try {
    const admin = createAdminClient()
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...user.user_metadata,
        premium_last_used_at: new Date().toISOString(),
      },
    })
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch {
    // 補助機能なので黙って失敗扱い（クライアントが次の時間帯に再試行する）。
    return NextResponse.json({ ok: false })
  }
}
