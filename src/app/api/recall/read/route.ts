import { NextResponse } from 'next/server'
import { requireRecall, serverError, notFound, validId } from '@/lib/recall/guard'
import { normalizePageId } from '@/lib/recall/extract-claims'

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
  const raw = body ? validId(body.pageId) : null
  const sectionKey = body ? validId(body.sectionKey) : null
  if (!raw || !sectionKey) {
    return NextResponse.json({ error: 'pageId と sectionKey が必要です' }, { status: 400 })
  }
  // 主張側の page_id は extract-claims の normalizePageId を通して保存されている
  // （ダッシュ無し・小文字）。読了記録は `pageId#sectionKey` で主張と突き合わせるので、
  // ここで同じ正規化を通さないと、呼び出し側がダッシュ付きのIDを送った日から
  // 突き合わせが静かに外れる（エラーは出ず「読んだ」が0のまま）。
  const pageId = normalizePageId(raw)
  const { error } = await g.supabase.from('recall_section_reads').upsert(
    { user_id: g.userId, page_id: pageId, section_key: sectionKey, read_at: new Date().toISOString() },
    { onConflict: 'user_id,page_id,section_key' },
  )
  if (error) return serverError('read: 読了記録の書き込みに失敗', error)
  return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } })
}
