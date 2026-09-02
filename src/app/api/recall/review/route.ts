import { NextResponse } from 'next/server'
import { requireRecall, progressFromRow, progressToRow, serverError, notFound, validId } from '@/lib/recall/guard'
import { applyResult } from '@/lib/recall/srs'

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

// 「覚えた／まだ」の記録。段の進み方は applyResult（Task 8）だけが決める。
// ここでは前後の間隔をログへ渡すだけで、間隔そのものは一切計算しない。
export async function POST(req: Request) {
  const g = await requireRecall()
  if (!g.ok) return g.response
  const body = (await req.json().catch(() => null)) as { claimId?: unknown; result?: unknown } | null
  const claimId = body ? validId(body.claimId) : null
  const result = body?.result
  if (!claimId || (result !== 'ok' && result !== 'ng')) {
    return NextResponse.json({ error: 'claimId と result（ok/ng）が必要です' }, { status: 400 })
  }
  // 読み取り→JSで計算→書き戻しの間に、外す(keep:false)が割り込むと、外す前の状態を
  // removedAt:null で書き戻し、外した主張を復活させうる（DB側の条件付き更新でないと閉じ切れない
  // ので対象外）。読み取り時点で既に外し済みの行は、下の判定で先に404にして通さない。
  const { data, error } = await g.supabase.from('recall_progress').select(COLS).eq('user_id', g.userId).eq('claim_id', claimId).maybeSingle()
  if (error) return serverError('review: 既存記録の読み取りに失敗', error)
  // 残していない（＝記録が無い）主張、あるいは外し済みの主張は確かめられない。
  if (!data || data.removed_at) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const before = progressFromRow(data)
  const now = new Date()
  const next = applyResult(before, result, now)
  const up = await g.supabase.from('recall_progress').upsert(progressToRow(g.userId, next), { onConflict: 'user_id,claim_id' })
  if (up.error) return serverError('review: 記録の書き込みに失敗', up.error)
  const log = await g.supabase.from('recall_review_log').insert({
    user_id: g.userId, claim_id: next.claimId, result,
    interval_before: before.intervalDays, interval_after: next.intervalDays, reviewed_at: now.toISOString(),
  })
  // ログは記録の補助（分析用）であり、本体の progress 書き込みは既に成功している。
  // ここで失敗させて段の更新自体を無かったことにはしない。詳細はサーバー側のログにだけ残す。
  if (log.error) console.error('[recall] review: ログ追記失敗', log.error.message)
  return NextResponse.json({ progress: next }, { headers: { 'Cache-Control': 'private, no-store' } })
}
