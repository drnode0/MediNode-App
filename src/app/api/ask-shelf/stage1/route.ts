// 段1(AIに組ませる)。設計: docs/superpowers/specs/2026-09-06-ask-shelf-stage1-design.md
//
// クライアントが送るのは logId だけ。問いも主張IDも受け取らない。
// 問いは ask_shelf_queries から読み(自分の行だけ)、入力集合は rankAskShelf を
// 呼び直して再現する。クライアントが主張IDを送る形にすると、覆い率 0.25 を回避して
// 任意の主張を送り込めるようになり、実測で引いた足切りの意味が段1で消える。
import { NextResponse } from 'next/server'
import { requireAskShelf, serverError, notFound } from '@/lib/ask-shelf/guard'
import { rankAskShelf, type ShelfClaim } from '@/lib/ask-shelf/rank'
import { callStage1 } from '@/lib/ask-shelf/stage1-call'
import { jstDayStart, dailyLimitState, noticeAfterStage1 } from '@/lib/ask-shelf/stage1-limit'

export const dynamic = 'force-dynamic'
// Vercel Pro の上限は 800 秒あるが、現行の4ルートと同じ 60 に揃える。
// 実効の締め切りは下の DEADLINE_MS(25秒)で、こちらは万一の暴走を止める外枠。
export const maxDuration = 60
export { HEAD, OPTIONS, PUT, PATCH, DELETE } from '@/lib/ask-shelf/guard'
export const GET = notFound

const DEADLINE_MS = 25_000

export async function POST(req: Request) {
  const started = Date.now()
  const g = await requireAskShelf()
  if (!g.ok) return g.response

  let logId = 0
  try {
    const body = (await req.json()) as { logId?: unknown }
    logId = typeof body.logId === 'number' && Number.isFinite(body.logId) ? body.logId : 0
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  if (!logId) return NextResponse.json({ error: 'bad_request' }, { status: 400 })

  const admin = g.admin()

  // 自分の行だけ。他人の logId を渡されても問いは読めない。
  const { data: logRow } = await admin
    .from('ask_shelf_queries').select('id, query')
    .eq('id', logId).eq('user_id', g.userId).maybeSingle()
  if (!logRow) return notFound()
  const query = String((logRow as { query?: unknown }).query ?? '')

  // 本日の回数。段1を踏んだ行(stage1_at が入っている行)だけを数える。
  const { count } = await admin
    .from('ask_shelf_queries').select('id', { count: 'exact', head: true })
    .eq('user_id', g.userId).gte('stage1_at', jstDayStart(new Date()).toISOString())
  const before = count ?? 0
  const limit = dailyLimitState(before)
  if (limit.blocked) return NextResponse.json({ error: 'daily_limit', notice: limit.notice }, { status: 429 })

  // 段0を呼び直して入力集合を再現する。層2・層3は段1に渡さないので取りに行かない。
  // 層1の結果は sections・boardItems に依存しないので、段0と同じ並びになる。
  const { data: claimRows, error: claimErr } = await admin
    .from('recall_claims')
    .select('claim_id, page_id, page_title, section_key, section_heading, body, source, confidence, keywords')
    .eq('active', true).limit(5000)
  if (claimErr) return serverError('claims の読み取りに失敗', claimErr)

  const { data: progRows } = await admin
    .from('recall_progress').select('claim_id').eq('user_id', g.userId).is('removed_at', null)

  const claims: ShelfClaim[] = (claimRows ?? []).map((r) => ({
    claimId: String(r.claim_id), pageId: String(r.page_id), pageTitle: String(r.page_title ?? ''),
    sectionKey: String(r.section_key ?? ''), sectionHeading: String(r.section_heading ?? ''),
    body: String(r.body ?? ''), source: String(r.source ?? ''), confidence: String(r.confidence ?? ''),
    keywords: String(r.keywords ?? ''),
  }))

  const result = rankAskShelf({
    query, claims, sections: [], boardItems: [],
    keptClaimIds: new Set((progRows ?? []).map((r) => String(r.claim_id))),
    // 段0と同じく今は必ず通す。公開時に実装する(継ぎ目9)。
    paid: true,
  })
  // 1件なら整理する対象が無い。0件ならそもそもボタンを出していない。
  if (result.claims.length < 2) return NextResponse.json({ error: 'not_enough_claims' }, { status: 400 })

  const call = await callStage1(
    { query, claims: result.claims.map((rc) => rc.claim) },
    { deadlineAt: started + DEADLINE_MS },
  )

  // 記録は結果によらず必ず書く。落ちた回の分類と費用を残さないと、
  // 失敗率もモデルの比較も後から測れない。
  await admin.from('ask_shelf_queries').update({
    stage1_at: new Date().toISOString(),
    stage1_model: call.model,
    stage1_claim_ids: result.claims.map((rc) => rc.claim.claimId),
    stage1_verdict: call.verdict,
    stage1_retried: call.retried,
    stage1_ms: Date.now() - started,
    stage1_input_tokens: call.inputTokens,
    stage1_output_tokens: call.outputTokens,
  }).eq('id', logId).eq('user_id', g.userId)

  if (call.verdict !== 'ok' || !call.output) return NextResponse.json({ ok: false })

  const after = noticeAfterStage1(before)
  return NextResponse.json({
    ok: true,
    groups: call.output.groups,
    notCovered: call.output.notCovered,
    remaining: after.remaining,
    notice: after.notice,
  })
}
