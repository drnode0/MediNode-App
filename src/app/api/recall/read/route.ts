import { NextResponse } from 'next/server'
import { requireRecall, serverError, notFound } from '@/lib/recall/guard'

export const dynamic = 'force-dynamic'

// このルートは POST が本業なので、guard.ts の POST エイリアスは再輸出できない（衝突する）。
// 6つのメソッドをここで個別に notFound へ束ね、GET 含め7メソッドを漏れなく閉じる。
export const GET = notFound
export const HEAD = notFound
export const OPTIONS = notFound
export const PUT = notFound
export const PATCH = notFound
export const DELETE = notFound

// 節を「確かめた」記録。何度読んでも1行に収まる（onConflict で洗い替え）。
export async function POST(req: Request) {
  const g = await requireRecall()
  if (!g.ok) return g.response
  const body = (await req.json().catch(() => null)) as { pageId?: unknown; sectionKey?: unknown } | null
  if (!body || typeof body.pageId !== 'string' || typeof body.sectionKey !== 'string') {
    return NextResponse.json({ error: 'pageId と sectionKey が必要です' }, { status: 400 })
  }
  const { error } = await g.supabase.from('recall_section_reads').upsert(
    { user_id: g.userId, page_id: body.pageId, section_key: body.sectionKey, read_at: new Date().toISOString() },
    { onConflict: 'user_id,page_id,section_key' },
  )
  if (error) return serverError('read: 読了記録の書き込みに失敗', error)
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } })
}
