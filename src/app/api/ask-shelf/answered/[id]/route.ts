// 回答の着地画面（/cq/answered/[id]）が呼ぶAPI。Task 13。
//
// ask_shelf が閉じていてもこの画面は開ける必要がある（通知はフラグの外にも飛びうる）ため、
// requireAskShelf() は使わない。ここで唯一守るのは「本人だけが開ける」。
// 受付DBの通知先ユーザーIDとログイン中の利用者が一致しなければ、他人の疑問は1文字も返さない
// （本文なしの404。guard.ts の慣習と同じ）。
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getIntakePage } from '@/lib/notion-intake'
import { readIntakeColumns } from '@/lib/ask-shelf/intake-columns'
import { resolveAnswerTarget, type AnswerTarget } from '@/lib/ask-shelf/landing'
import type { NotionIntakePage } from '@/lib/cq-board'

export const dynamic = 'force-dynamic'

function notFound(): NextResponse {
  return new NextResponse(null, { status: 404 })
}

function serverError(where: string, error: { message: string }): NextResponse {
  console.error(`[ask-shelf] ${where}: ${error.message}`)
  return NextResponse.json({ error: 'server_error' }, { status: 500 })
}

type Prop = Record<string, unknown> | undefined
function propOf(page: NotionIntakePage, name: string): Prop {
  return (page.properties?.[name] as Record<string, unknown> | undefined) ?? undefined
}
function plainText(p: Prop, key: 'title' | 'rich_text'): string {
  const arr = p?.[key]
  if (!Array.isArray(arr)) return ''
  return arr.map((t) => String((t as { plain_text?: unknown })?.plain_text ?? '')).join('').trim()
}

export type AnsweredResponse = {
  question: string
  answer: {
    claimId: string
    body: string
    source: string
    confidence: string
    pageId: string
    pageTitle: string
    sectionKey: string
    sectionHeading: string
  } | null
  target: AnswerTarget
  kept: boolean
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'login_required' }, { status: 401 })

  const { id } = await params
  const page = await getIntakePage(id)
  if (!page) return notFound()

  // 通知先ユーザーIDとログイン中の利用者が一致しなければ、存在すら教えない。
  const notifiedUserId = plainText(propOf(page, '通知先ユーザーID'), 'rich_text')
  if (!notifiedUserId || notifiedUserId !== user.id) return notFound()

  const question = plainText(propOf(page, '疑問'), 'title')
  const { canonicalClaimIds } = readIntakeColumns(page)

  if (canonicalClaimIds.length === 0) {
    // 対応済みでも正本化前（メールだけ先行）のことがある。回答なしは異常ではない。
    return NextResponse.json({ question, answer: null, target: { kind: 'none' }, kept: false } satisfies AnsweredResponse)
  }

  const admin = createAdminClient()
  // recall_claims は RLS 有効・ポリシー無し（service_role のみ）。admin で読む。
  // 正本主張IDは全件引く。1件目だけを見ると、1件目が取り下げ済みで2件目が生きている行で
  // 「回答はまだ準備中です」を出してしまう（通知 cron は resolveAnswerTarget に全件渡して
  // 生きている方を指すので、メールのリンク先と着地画面の判断が食い違う）。
  const { data: claimRows, error: claimErr } = await admin
    .from('recall_claims')
    .select('claim_id, page_id, page_title, section_key, section_heading, body, source, confidence')
    .in('claim_id', canonicalClaimIds)
    // active の絞り込みはポリシーが無い今、このコード1行だけが担っている
    // （消すと取り下げ・訂正済みの主張まで着地画面に出てしまう。recall/claims と同じ理由）。
    .eq('active', true)
    .limit(canonicalClaimIds.length)
  if (claimErr) return serverError('answered: claim の読み取りに失敗', claimErr)

  const rowsById = new Map<string, Record<string, unknown>>()
  for (const r of (claimRows ?? []) as Record<string, unknown>[]) rowsById.set(String(r.claim_id ?? ''), r)

  // 飛び先は cron と同じ関数で決める（2つの利用者が別の主張を指さないため）。
  const target = resolveAnswerTarget({
    canonicalClaimIds,
    claimsById: new Map(
      [...rowsById].map(([id, r]) => [id, { pageId: String(r.page_id ?? ''), sectionKey: String(r.section_key ?? '') }]),
    ),
  })
  // 出す主張の行。resolveAnswerTarget と同じ順（正本主張IDの並び順で最初に生きているもの）を辿る。
  // 節が空で target が 'article' になる場合も、本文を出す主張は同じこの行。
  const claimId = canonicalClaimIds.find((id) => rowsById.has(id))
  const row = claimId ? rowsById.get(claimId) : undefined

  if (!claimId || !row) {
    // 正本主張IDはあるが、どれも主張コーパスから消えている（取り下げ等）か非活性化されている。回答なし扱いにする。
    return NextResponse.json({ question, answer: null, target: { kind: 'none' }, kept: false } satisfies AnsweredResponse)
  }

  const pageId = String(row.page_id ?? '')
  const sectionKey = String(row.section_key ?? '')

  // kept は cron が事前に書いていない。本人がここか他画面で「残す」を押したかどうかそのもの
  // （2026-09-05 裁定1）。recall_progress も service_role 無しでは読めない列があるため admin で読む。
  const { data: progressRows, error: progressErr } = await admin
    .from('recall_progress')
    .select('removed_at')
    .eq('user_id', user.id)
    .eq('claim_id', claimId)
  if (progressErr) return serverError('answered: 残す状態の読み取りに失敗', progressErr)
  const progressRow = (progressRows ?? [])[0] as { removed_at?: string | null } | undefined
  const kept = progressRow != null && progressRow.removed_at == null

  return NextResponse.json({
    question,
    answer: {
      claimId,
      body: String(row.body ?? ''),
      source: String(row.source ?? ''),
      confidence: String(row.confidence ?? ''),
      pageId,
      pageTitle: String(row.page_title ?? ''),
      sectionKey,
      sectionHeading: String(row.section_heading ?? ''),
    },
    target,
    kept,
  } satisfies AnsweredResponse)
}
