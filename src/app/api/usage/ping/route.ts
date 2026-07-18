// 最終利用日の記録（アカウント台帳の「最終利用」列のデータ源）。
//
//   POST /api/usage/ping … ログイン中ユーザーの app_usage.last_used_at を今に更新し、
//                          app_usage_daily（日別アクティブのグラフ用）に当日1行、
//                          app_usage_hourly（利用時間帯ヒストグラム用）に当日×現時間帯1行を記録する。
//                          クライアント（UsagePing）が1時間に1回だけ呼ぶ。
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

    // 日次・時間帯ログ（グラフ用）。日付・時間帯は日本時間で丸める（利用者は国内前提）。
    // マイグレーション 0006/0007 未適用なら失敗するが、最終利用日の記録は済んでいるので成功扱い。
    const jstNow = new Date(Date.now() + 9 * 60 * 60 * 1000)
    const usedOn = jstNow.toISOString().slice(0, 10)
    await admin
      .from('app_usage_daily')
      .upsert({ user_id: user.id, used_on: usedOn }, { onConflict: 'user_id,used_on', ignoreDuplicates: true })
    await admin
      .from('app_usage_hourly')
      .upsert(
        { user_id: user.id, used_on: usedOn, hour: jstNow.getUTCHours() },
        { onConflict: 'user_id,used_on,hour', ignoreDuplicates: true },
      )

    return NextResponse.json({ ok: true })
  } catch {
    // テーブル未作成など。利用記録は補助機能なので黙って成功扱いにする。
    return NextResponse.json({ ok: false })
  }
}
