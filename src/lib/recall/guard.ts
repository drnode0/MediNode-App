// Recall ルートの共通ガード。機能が閉じている利用者には 404 を返し、存在を見せない。
import { NextResponse } from 'next/server'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { sessionHasFeature } from '@/lib/supabase/early-access'
import type { RecallClaim, RecallProgress, RecallSectionRead } from './types'

// 拒否には本文を持たせない。理由を書いた JSON を返すと、存在しない経路（Next の HTML の 404）
// との違いが本文で分かってしまい、機能があること自体を教えてしまう。
export function notFound(): NextResponse {
  return new NextResponse(null, { status: 404 })
}

// Next は route.ts が実装していないメソッドを自動で埋める
// （node_modules/next/dist/server/route-modules/app-route/helpers/auto-implement-methods.js）。
// OPTIONS には 204 と Allow ヘッダを返し、残りには 405 を返す。どちらも GET を呼ばない＝
// requireRecall() が走らないので、存在しない経路との違いが1リクエストで分かってしまう。
// Recall の各ルートはこの6つをそのまま再輸出し、GET 以外を同じ 404 で塞ぐ。
export const HEAD = notFound
export const OPTIONS = notFound
export const POST = notFound
export const PUT = notFound
export const PATCH = notFound
export const DELETE = notFound

export async function requireRecall(): Promise<
  | {
      ok: true
      supabase: Awaited<ReturnType<typeof createClient>>
      // service_role の客体はガードを通してのみ受け取れるようにする（ルートが個別に
      // createAdminClient() を呼び、ガードを忘れる経路を作らせない）。呼んだときだけ生成するので、
      // service_role を使わないルート（本人の記録を読む progress）は鍵に触れないままでいられる。
      admin: () => ReturnType<typeof createAdminClient>
      userId: string
    }
  | { ok: false; response: NextResponse }
> {
  if (!(await sessionHasFeature('recall'))) return { ok: false, response: notFound() }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'login_required' }, { status: 401 }) }
  return { ok: true, supabase, admin: () => createAdminClient(), userId: user.id }
}

// PostgREST/Postgres の生のメッセージ（テーブル名・列名・RLS の診断）を呼び出し元へ渡さない。
// 詳細はサーバー側のログにだけ残す。
export function serverError(where: string, error: { message: string }): NextResponse {
  console.error(`[recall] ${where}: ${error.message}`)
  return NextResponse.json({ error: 'server_error' }, { status: 500 })
}

type Row = Record<string, unknown>
export function claimFromRow(r: Row): RecallClaim {
  return {
    claimId: String(r.claim_id), pageId: String(r.page_id), pageTitle: String(r.page_title ?? ''), pageKind: String(r.page_kind ?? ''),
    sectionKey: String(r.section_key ?? ''), sectionHeading: String(r.section_heading ?? ''), body: String(r.body), source: String(r.source ?? ''),
    confidence: r.confidence as RecallClaim['confidence'], genres: (r.genres as string[]) ?? [], primaryGenre: String(r.primary_genre ?? ''),
    genreSlot: Number(r.genre_slot ?? 63), holes: (r.holes as [number, number][]) ?? [], clozeStatus: (r.cloze_status as RecallClaim['clozeStatus']) ?? 'pending',
    // 取り下げた主張を隠すためのフラグなので、null・欠落・boolean 以外は「出さない」側に倒す。
    active: r.active === true,
  }
}
export function progressFromRow(r: Row): RecallProgress {
  return {
    claimId: String(r.claim_id), keptAt: String(r.kept_at), streak: Number(r.streak ?? 0), intervalDays: Number(r.interval_days ?? 1),
    dueAt: String(r.due_at), lastReviewedAt: (r.last_reviewed_at as string | null) ?? null, lastResult: (r.last_result as 'ok' | 'ng' | null) ?? null,
    okCount: Number(r.ok_count ?? 0), ngCount: Number(r.ng_count ?? 0), removedAt: (r.removed_at as string | null) ?? null,
  }
}
export function progressToRow(userId: string, p: RecallProgress): Row {
  return {
    user_id: userId, claim_id: p.claimId, kept_at: p.keptAt, streak: p.streak, interval_days: p.intervalDays, due_at: p.dueAt,
    last_reviewed_at: p.lastReviewedAt, last_result: p.lastResult, ok_count: p.okCount, ng_count: p.ngCount, removed_at: p.removedAt,
    updated_at: new Date().toISOString(),
  }
}
export function readFromRow(r: Row): RecallSectionRead {
  return { pageId: String(r.page_id), sectionKey: String(r.section_key), readAt: String(r.read_at) }
}
