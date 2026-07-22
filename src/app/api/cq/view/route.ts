// CQ参照回数の記録（「解決したみんなの臨床疑問」バッジのデータ源）。
//
//   POST /api/cq/view … body { objectId } のCQを +1 する。
//
// クライアント（recordCqView）が、サブスク公開ナレッジの本文を開いた瞬間に叩く。
// 記録するのは回数だけで、閲覧者・閲覧内容は一切保存しない。ログイン不要。
// best-effort: テーブル/関数未作成（マイグレーション0016未適用）や env 未設定でも
// ok:false を返すだけで、アプリ側にエラーを見せない（バッジが出ないだけ）。

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const supabaseReady = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  if (!supabaseReady) return NextResponse.json({ ok: false })

  try {
    const body = (await req.json()) as { objectId?: unknown }
    const objectId = typeof body.objectId === 'string' ? body.objectId.trim() : ''
    if (!objectId) return NextResponse.json({ ok: false })

    const admin = createAdminClient()
    const { error } = await admin.rpc('increment_cq_view', { p_object_id: objectId })
    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true })
  } catch {
    // テーブル未作成など。参照回数は補助機能なので黙って失敗扱いにする。
    return NextResponse.json({ ok: false })
  }
}
