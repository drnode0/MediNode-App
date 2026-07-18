// 流入元の記録（アカウント台帳の「流入元」列のデータ源）。
//
//   POST /api/source … Body: { source, medium?, at? }
//     ログイン中ユーザーの user_metadata に「最初に計測できた流入元」を記録する。
//     既に記録済みなら何もしない（first-touch を守る＝後からの再訪で上書きしない）。
//
// クライアント（SourceCapture）が LP 経由の utm_source（x / note / line / direct 等）を送ってくる。
// user_metadata を使うので DB マイグレーション不要（auto_trial_granted_at と同じ置き場所）。
// best-effort: 失敗してもアプリ側にエラーは見せない（台帳の列が「—」のままになるだけ）。

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

export async function POST(req: NextRequest) {
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
    const { source, medium, at } = (await req.json()) as {
      source?: unknown
      medium?: unknown
      at?: unknown
    }
    if (typeof source !== 'string' || !source.trim()) {
      return NextResponse.json({ ok: false })
    }

    // 既に記録済みなら first-touch を守って何もしない（ok=true でクライアントの再送も止める）。
    if (typeof user.user_metadata?.acq_source === 'string') {
      return NextResponse.json({ ok: true, recorded: false })
    }

    const admin = createAdminClient()
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...user.user_metadata,
        acq_source: source.trim().slice(0, 40),
        acq_medium: typeof medium === 'string' ? medium.trim().slice(0, 40) : null,
        // 端末で最初に計測した時刻（クライアント申告）。形式が怪しければ今の時刻にする。
        acq_recorded_at:
          typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? at : new Date().toISOString(),
      },
    })
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true, recorded: true })
  } catch {
    // 補助機能なので黙って失敗扱い（クライアントが次回再試行する）。
    return NextResponse.json({ ok: false })
  }
}
