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
  // 回答は canonicalClaimIds[0] の1件だけを出す（裁定3。2件目以降は今は使わない）。
  const claimId = canonicalClaimIds[0]

  if (!claimId) {
    // 対応済みでも正本化前（メールだけ先行）のことがある。回答なしは異常ではない。
    return NextResponse.json({ question, answer: null, target: { kind: 'none' }, kept: false } satisfies AnsweredResponse)
  }

  const admin = createAdminClient()
  // recall_claims は RLS 有効・ポリシー無し（service_role のみ）。admin で読む。
  const { data: claimRows, error: claimErr } = await admin
    .from('recall_claims')
    .select('claim_id, page_id, page_title, section_key, section_heading, body, source, confidence')
    .eq('claim_id', claimId)
    .limit(1)
  if (claimErr) return serverError('answered: claim の読み取りに失敗', claimErr)
  const row = (claimRows ?? [])[0] as Record<string, unknown> | undefined

  if (!row) {
    // 正本主張IDはあるが、主張コーパスから既に消えている（取り下げ等）。回答なし扱いにする。
    return NextResponse.json({ question, answer: null, target: { kind: 'none' }, kept: false } satisfies AnsweredResponse)
  }

  const pageId = String(row.page_id ?? '')
  const sectionKey = String(row.section_key ?? '')
  const target = resolveAnswerTarget({
    canonicalClaimIds: [claimId],
    claimsById: new Map([[claimId, { pageId, sectionKey }]]),
  })

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
