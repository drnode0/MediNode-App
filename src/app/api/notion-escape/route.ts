// 「Notionで開く」タップ（アプリ外離脱）の記録。
//
//   POST /api/notion-escape … body { context } の発生場所を当日分 +1 する。
//
// クライアント（recordNotionEscape）が、個人/部署ページをNotionへ飛ばす瞬間に叩く。
// 記録するのは発生場所と回数だけで、ページ・閲覧者は一切保存しない。ログイン不要。
// best-effort: テーブル/関数未作成（マイグレーション0025未適用）や env 未設定でも
// ok:false を返すだけで、アプリ側にエラーを見せない（/adminの数字が出ないだけ）。

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// 未知の文字列を貯めない（荒らし・タイポでテーブルが濁るのを防ぐ）。
const CONTEXTS = new Set(['quiz', 'daily_question', 'reader', 'search'])

export async function POST(req: Request) {
  const supabaseReady = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  if (!supabaseReady) return NextResponse.json({ ok: false })

  try {
    const body = (await req.json()) as { context?: unknown }
    const context = typeof body.context === 'string' ? body.context.trim() : ''
    if (!CONTEXTS.has(context)) return NextResponse.json({ ok: false })

    const admin = createAdminClient()
    const { error } = await admin.rpc('increment_notion_escape', { p_context: context })
    if (error) throw new Error(error.message)

    return NextResponse.json({ ok: true })
  } catch {
    // テーブル未作成など。離脱計測は補助機能なので黙って失敗扱いにする。
    return NextResponse.json({ ok: false })
  }
}
