// 「今日の1問」の回答日ログ。
//   POST /api/daily-question/answered … ログイン中ユーザーの回答日（日付のみ）を記録する。
//
// 記録するのは「答えた日」だけ。何を答えたか・覚えた/まだの中身は保存しない
// （学習内容をサーバーに持たない方針。usage/ping と同型のbest-effort）。
// 草（アクティビティ）・ログインボーナス・復帰頻度の土台になる。

import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { jstToday } from '@/lib/daily-question'

export async function POST() {
  const supabaseReady = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  if (!supabaseReady) return NextResponse.json({ ok: false })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    // 未ログインは記録対象外（エラーではない。カード自体は使える）。
    return NextResponse.json({ ok: false })
  }

  try {
    const admin = createAdminClient()
    const { error } = await admin
      .from('daily_question_log')
      .upsert(
        { user_id: user.id, answered_on: jstToday() },
        { onConflict: 'user_id,answered_on', ignoreDuplicates: true },
      )
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch {
    // テーブル未作成（migration 0012 未適用）など。記録は補助機能なので黙って成功扱い。
    return NextResponse.json({ ok: false })
  }
}
