import { NextResponse } from 'next/server'
import { requireAskShelf, serverError, notFound } from '@/lib/ask-shelf/guard'
import { rankAskShelf, type ShelfClaim } from '@/lib/ask-shelf/rank'
import { fetchSections, fetchBoardItems } from '@/lib/ask-shelf/sources'
import { QUESTION_MAX } from '@/lib/cq-submit'

export const dynamic = 'force-dynamic'
export { HEAD, OPTIONS, PUT, PATCH, DELETE } from '@/lib/ask-shelf/guard'
// 問いは臨床の疑問で、患者背景が書かれうる。GET のクエリ文字列に載せない
// （アクセスログや履歴に残る）。POST だけを開ける。
export const GET = notFound

export async function POST(req: Request) {
  const g = await requireAskShelf()
  if (!g.ok) return g.response

  let query = ''
  // 記録するかどうか。既定は記録する（読者側の呼び出しは何も渡さない）。
  // /admin の候補検索だけが false を渡す（下の insert のコメント参照）。
  let log = true
  try {
    const body = (await req.json()) as { query?: unknown; log?: unknown }
    query = typeof body.query === 'string' ? body.query.trim() : ''
    if (body.log === false) log = false
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }
  // 上限は投稿フォームと同じ値を輸入する。二重に数字を持たない。
  if (query.length > QUESTION_MAX) return NextResponse.json({ error: 'too_long' }, { status: 400 })
  if (!query) {
    return NextResponse.json({ claims: [], sections: [], board: [], emptyMessage: null, topCoverage: 0, logId: null })
  }

  const admin = g.admin()

  // recall_claims は RLS 有効・ポリシー無し（service_role のみ・migration 0029）。
  // active の絞り込みはポリシーが無い今、この1行だけが担う（消すと取り下げた主張まで段0に出る）。
  // PGroonga 索引（0031・任意）が有る環境でも全件を読む。索引の有無で段0の結果が
  // 変わらないことを優先するため。主張が数千を超えたらここに候補の絞り込みを足す。
  const { data: claimRows, error: claimErr } = await admin
    .from('recall_claims')
    .select('claim_id, page_id, page_title, section_key, section_heading, body, source, confidence, keywords')
    .eq('active', true)
    .limit(5000)
  if (claimErr) return serverError('claims の読み取りに失敗', claimErr)

  const { data: progRows } = await admin
    .from('recall_progress').select('claim_id').eq('user_id', g.userId).is('removed_at', null)

  const claims: ShelfClaim[] = (claimRows ?? []).map((r) => ({
    claimId: String(r.claim_id), pageId: String(r.page_id), pageTitle: String(r.page_title ?? ''),
    sectionKey: String(r.section_key ?? ''), sectionHeading: String(r.section_heading ?? ''),
    body: String(r.body ?? ''), source: String(r.source ?? ''), confidence: String(r.confidence ?? ''),
    keywords: String(r.keywords ?? ''),
  }))

  const [sections, boardItems] = await Promise.all([fetchSections(query), fetchBoardItems()])

  const result = rankAskShelf({
    query, claims, sections, boardItems,
    keptClaimIds: new Set((progRows ?? []).map((r) => String(r.claim_id))),
    // オーナー専用の今も必ず通す。公開時に足すのではなく、最初から通しておく(継ぎ目9)。
    paid: true,
  })

  // 完了条件「段0を見せた後に送らずに済んだ割合」のための記録。
  // 作者が /admin で正本の主張を探した回は数えない（log:false）。同じ表を母数にした割合を
  // その検索窓のすぐ横に出しているので、トリアージの検索が分母も分子も膨らませてしまう。
  let logId: number | null = null
  if (log) {
    const { data: logRow } = await admin.from('ask_shelf_queries').insert({
      user_id: g.userId, query, claim_count: result.claims.length,
      section_count: result.sections.length, board_count: result.board.length,
      top_coverage: result.topCoverage, submitted: false,
    }).select().single()
    logId = logRow?.id ?? null
  }

  return NextResponse.json({ ...result, logId })
}
