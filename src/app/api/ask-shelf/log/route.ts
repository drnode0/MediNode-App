import { NextResponse } from 'next/server'
import { requireAskShelf, serverError, notFound } from '@/lib/ask-shelf/guard'

export const dynamic = 'force-dynamic'
export { HEAD, OPTIONS, PUT, PATCH, DELETE } from '@/lib/ask-shelf/guard'
export const GET = notFound

// 段0を見たあと依頼に進んだことを記録する。完了条件の「送らずに済んだ割合」の分母と分子。
export async function POST(req: Request) {
  const g = await requireAskShelf()
  if (!g.ok) return g.response
  let logId: unknown
  try {
    logId = ((await req.json()) as { logId?: unknown }).logId
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  if (typeof logId !== 'number' || !Number.isFinite(logId)) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  // user_id で必ず絞る。id だけで更新できると、他人の記録を書き換えられる。
  const { error } = await g.admin().from('ask_shelf_queries')
    .update({ submitted: true }).eq('id', logId).eq('user_id', g.userId)
  if (error) return serverError('log の更新に失敗', error)
  return NextResponse.json({ ok: true })
}
