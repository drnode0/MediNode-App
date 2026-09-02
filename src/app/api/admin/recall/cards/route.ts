// 篩の承認。伏せ字候補（holes が空でない主張）を一覧し、出す／出さない／穴を直す。
//
// このルートは admin-guard（requireAdmin）で守る。Recall のリーダー側ルート（src/lib/recall/guard.ts）
// のように「機能フラグが閉じている利用者には存在を見せない」ための本文なし404の全メソッド閉鎖はしない。
// 隣接する src/app/api/admin/** のルート（ledger・spread・spread/note）はどれもこの閉鎖をしておらず、
// requireAdmin() 自体が非管理者に 401/403 を返す（存在を隠す必要が無い＝管理画面はログインすれば
// URLが分かる）。ここもそれに合わせ、GET/PATCH 以外は Next の自動実装（405）に任せる。
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { createAdminClient } from '@/lib/supabase/server'
import { claimFromRow } from '@/lib/recall/guard'
import { MAX_HOLES } from '@/lib/recall/holes'
import { normalizeHoles } from '@/lib/recall/segments'

const STATUSES = ['pending', 'approved', 'rejected'] as const
const COLS = 'claim_id, page_id, page_title, page_kind, section_key, section_heading, body, source, confidence, genres, primary_genre, genre_slot, holes, cloze_status, active'

export async function GET(req: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const status = new URL(req.url).searchParams.get('status') ?? 'pending'
  let q = createAdminClient().from('recall_claims').select(COLS).eq('active', true).order('page_title').order('section_key').order('claim_id')
  if ((STATUSES as readonly string[]).includes(status)) q = q.eq('cloze_status', status)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const cards = (data ?? []).map(claimFromRow).filter((c) => c.holes.length > 0)
  return NextResponse.json({ cards })
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const body = (await req.json().catch(() => null)) as { claimId?: unknown; clozeStatus?: unknown; holes?: unknown } | null
  if (!body || typeof body.claimId !== 'string') return NextResponse.json({ error: 'claimId が必要です' }, { status: 400 })
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body.clozeStatus !== undefined) {
    if (!(STATUSES as readonly unknown[]).includes(body.clozeStatus)) return NextResponse.json({ error: 'clozeStatus が不正です' }, { status: 400 })
    patch.cloze_status = body.clozeStatus
  }
  if (body.holes !== undefined) {
    const h = body.holes
    // 「読者の画面（segments.ts の normalizeHoles/segmentBody）が実際に描く形」と、
    // ここで保存する holes を必ず一致させる。上限件数チェックの後、normalizeHoles に通し
    // （本文の長さはここでは持っていないので、範囲の上限側は実質チェックしない大きな値を渡す。
    // 下限0・整数・start<end・重なり/接する範囲の統合・並び替えは normalizeHoles と同じ規則で効く）、
    // 入力が正規化後と1件でも食い違えば拒否する。ここで正規化した値をそのまま保存する（＝
    // サイレントに直して保存する）と、管理画面が見せた範囲と実際に保存される範囲がずれる。
    // 「不正なら保存させて読者側で黙って直す」のではなく「不正なら保存させない」を選ぶ
    // （reader-spread の verifyVerbatim と同じ fail-closed の流儀）。
    const valid = Array.isArray(h) && h.length <= MAX_HOLES
    const normalized = valid ? normalizeHoles(Number.MAX_SAFE_INTEGER, h) : []
    const unchanged =
      valid &&
      normalized.length === (h as unknown[]).length &&
      normalized.every(([a, b], i) => {
        const pair = (h as unknown[])[i]
        return Array.isArray(pair) && pair[0] === a && pair[1] === b
      })
    if (!unchanged) return NextResponse.json({ error: `holes は [start,end] の配列（重なりなし・最大${MAX_HOLES}）です` }, { status: 400 })
    patch.holes = h
  }
  const { error } = await createAdminClient().from('recall_claims').update(patch).eq('claim_id', body.claimId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
