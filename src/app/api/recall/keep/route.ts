import { NextResponse } from 'next/server'
import { requireRecall, progressFromRow, progressToRow, serverError, notFound } from '@/lib/recall/guard'
import { newProgress } from '@/lib/recall/srs'

export const dynamic = 'force-dynamic'

// このルートは POST が本業なので、guard.ts の POST エイリアスは再輸出できない（衝突する）。
// 6つのメソッドをここで個別に notFound へ束ね、GET 含め7メソッドを漏れなく閉じる。
export const GET = notFound
export const HEAD = notFound
export const OPTIONS = notFound
export const PUT = notFound
export const PATCH = notFound
export const DELETE = notFound

const COLS = 'claim_id, kept_at, streak, interval_days, due_at, last_reviewed_at, last_result, ok_count, ng_count, removed_at'

// 主張を「残す」／外す。外す（keep: false）は removed_at を立てるだけの論理削除で、
// 再び残したとき（keep: true）は streak・interval_days・ok_count/ng_count 等の記録を
// そのまま引き継いで removed_at だけを null に戻す（＝再開の履歴を消さない）。
export async function POST(req: Request) {
  const g = await requireRecall()
  if (!g.ok) return g.response
  const body = (await req.json().catch(() => null)) as { claimId?: unknown; keep?: unknown } | null
  if (!body || typeof body.claimId !== 'string' || typeof body.keep !== 'boolean') {
    return NextResponse.json({ error: 'claimId と keep が必要です' }, { status: 400 })
  }
  const { data, error } = await g.supabase.from('recall_progress').select(COLS).eq('user_id', g.userId).eq('claim_id', body.claimId).maybeSingle()
  if (error) return serverError('keep: 既存記録の読み取りに失敗', error)
  const now = new Date()
  let next
  if (body.keep) {
    // 既存があれば streak 等を保ったまま removedAt だけ外す。無ければ新規に間隔1日で開始する。
    next = data ? { ...progressFromRow(data), removedAt: null } : newProgress(body.claimId, now)
  } else {
    // 残していない主張を外すことはできない（そもそも記録が無い）。
    // ここは requireRecall() を通った後のアプリ内部の404なので、guard.notFound() の
    // 本文なし404（機能の存在自体を隠す用）ではなく、理由の分かる本文を返してよい。
    if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    next = { ...progressFromRow(data), removedAt: now.toISOString() }
  }
  const up = await g.supabase.from('recall_progress').upsert(progressToRow(g.userId, next), { onConflict: 'user_id,claim_id' })
  if (up.error) return serverError('keep: 記録の書き込みに失敗', up.error)
  // 本人の記録なので、どの層にも残させない。
  return NextResponse.json({ progress: next }, { headers: { 'Cache-Control': 'private, no-store' } })
}
