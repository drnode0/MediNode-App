// 最終利用日の記録（アカウント台帳の「最終利用」列のデータ源）。
//
//   POST /api/usage/ping … ログイン中ユーザーの app_usage.last_used_at を今に更新する。
//
// クライアント（UsagePing）が「1日1回だけ」呼ぶ設計（localStorage で当日分を抑制）。
// 記録するのは日時のみで、検索内容などは一切保存しない。
// best-effort: テーブル未作成（マイグレーション未適用）等で失敗しても 200 を返し、
// アプリ側にエラーを見せない（台帳の列が「—」のままになるだけ）。

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
    // 未ログインは記録対象外（エラーではない）。
    return NextResponse.json({ ok: false })
  }

  try {
    const admin = createAdminClient()
    const { error } = await admin
      .from('app_usage')
      .upsert({ user_id: user.id, last_used_at: new Date().toISOString() }, { onConflict: 'user_id' })
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch {
    // テーブル未作成など。利用記録は補助機能なので黙って成功扱いにする。
    return NextResponse.json({ ok: false })
  }
}
