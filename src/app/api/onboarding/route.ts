// セットアップ行動の記録（アカウント台帳の「セットアップ状況」グラフのデータ源）。
//
//   POST /api/onboarding … Body: { furthest?, targets?, mode?, dbSetup? }
//     ログイン中ユーザーの user_metadata に、セットアップでの選択と到達ステップを記録する。
//     流入元（acq_source）と違い最新値で上書きする（選び直し・再設定を反映するため）。
//
// クライアント（SourceCapture）が localStorage の記録（setup-telemetry.ts）を送ってくる。
// 選択肢の名前だけを保存し、Token等の入力値は一切受け取らない。
// best-effort: 失敗してもアプリ側にエラーは見せない（台帳が「—」のままになるだけ）。

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'

const STEPS = new Set(['entry', 'start', 'mode', 'notion', 'algolia', 'sync', 'options'])
const TARGETS = new Set(['premium', 'personal', 'team'])
const MODES = new Set(['simple', 'power'])
const DB_SETUPS = new Set(['template', 'existing'])

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
    const body = (await req.json()) as {
      furthest?: unknown
      targets?: unknown
      mode?: unknown
      dbSetup?: unknown
    }

    // 既知の値だけ通す（自由文字列を metadata に書かせない）。
    const patch: Record<string, unknown> = {}
    if (typeof body.furthest === 'string' && STEPS.has(body.furthest)) {
      patch.onb_furthest = body.furthest
    }
    if (Array.isArray(body.targets)) {
      const targets = body.targets.filter((t): t is string => typeof t === 'string' && TARGETS.has(t))
      if (targets.length > 0) patch.onb_targets = targets
    }
    if (typeof body.mode === 'string' && MODES.has(body.mode)) {
      patch.onb_mode = body.mode
    }
    if (typeof body.dbSetup === 'string' && DB_SETUPS.has(body.dbSetup)) {
      patch.onb_db_setup = body.dbSetup
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ ok: false })

    const admin = createAdminClient()
    const { error } = await admin.auth.admin.updateUserById(user.id, {
      user_metadata: {
        ...user.user_metadata,
        ...patch,
        onb_updated_at: new Date().toISOString(),
      },
    })
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch {
    // 補助機能なので黙って失敗扱い（クライアントが次回再試行する）。
    return NextResponse.json({ ok: false })
  }
}
