// Recall ルートの共通ガード。機能が閉じている利用者には 404 を返し、存在を見せない。
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sessionHasFeature } from '@/lib/supabase/early-access'
import type { RecallClaim, RecallProgress, RecallSectionRead } from './types'

export async function requireRecall(): Promise<
  | { ok: true; supabase: Awaited<ReturnType<typeof createClient>>; userId: string }
  | { ok: false; response: NextResponse }
> {
  if (!(await sessionHasFeature('recall'))) {
    return { ok: false, response: NextResponse.json({ error: 'not_found' }, { status: 404 }) }
  }
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, response: NextResponse.json({ error: 'login_required' }, { status: 401 }) }
  return { ok: true, supabase, userId: user.id }
}

type Row = Record<string, unknown>
export function claimFromRow(r: Row): RecallClaim {
  return {
    claimId: String(r.claim_id), pageId: String(r.page_id), pageTitle: String(r.page_title ?? ''), pageKind: String(r.page_kind ?? ''),
    sectionKey: String(r.section_key ?? ''), sectionHeading: String(r.section_heading ?? ''), body: String(r.body), source: String(r.source ?? ''),
    confidence: r.confidence as RecallClaim['confidence'], genres: (r.genres as string[]) ?? [], primaryGenre: String(r.primary_genre ?? ''),
    genreSlot: Number(r.genre_slot ?? 63), holes: (r.holes as [number, number][]) ?? [], clozeStatus: (r.cloze_status as RecallClaim['clozeStatus']) ?? 'pending',
    active: r.active !== false,
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
