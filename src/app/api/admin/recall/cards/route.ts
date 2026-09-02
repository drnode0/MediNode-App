// 篩の承認。伏せ字候補（holes が空でない主張）を一覧し、伏せ字にする／しないを決め、穴を直す。
//
// このルートは admin-guard（requireAdmin）で守る。Recall のリーダー側ルート（src/lib/recall/guard.ts）
// のように「機能フラグが閉じている利用者には存在を見せない」ための本文なし404の全メソッド閉鎖はしない。
// 隣接する src/app/api/admin/** のルート（ledger・spread・spread/note）はどれもこの閉鎖をしておらず、
// requireAdmin() 自体が非管理者に 401/403 を返す（存在を隠す必要が無い＝管理画面はログインすれば
// URLが分かる）。ここもそれに合わせ、GET/PATCH 以外は Next の自動実装（405）に任せる。
//
// cloze_status が決めるのは「伏せ字カードにするかどうか」だけで、主張が読者に出るかどうかではない
// （/api/recall/claims は active だけで絞る）。承認しなければ全文を思い出す想起カードとして出る。
// 画面の文言もそのように書く。ここで主張そのものを取り下げるなら active を落とす別の口が要る。
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { logAdminAction } from '@/lib/admin-audit'
import { createAdminClient } from '@/lib/supabase/server'
import { claimFromRow, validId } from '@/lib/recall/guard'
import { MAX_HOLES } from '@/lib/recall/holes'
import { normalizeHoles } from '@/lib/recall/segments'

const STATUSES = ['pending', 'approved', 'rejected'] as const
const COLS = 'claim_id, page_id, page_title, page_kind, section_key, section_heading, body, source, confidence, genres, primary_genre, genre_slot, holes, cloze_status, active'

export async function GET(req: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const params = new URL(req.url).searchParams
  const status = params.get('status') ?? 'pending'
  // 穴の無い主張も呼び出せるようにする。最後の穴を外すと holes は [] になり、既定の
  // 「穴を持つ主張だけ」からは消える。そのままだと二度とこの画面に出せず、cloze_status が
  // 外した時点の値で固まる（伏せ字にしないつもりで外したのに approved のまま、等）。
  // 裏の本文は穴が無くても出るので、この一覧から穴を付け直せる。
  const holes = params.get('holes') === 'none' ? 'none' : 'some'
  let q = createAdminClient().from('recall_claims').select(COLS).eq('active', true).order('page_title').order('section_key').order('claim_id')
  if ((STATUSES as readonly string[]).includes(status)) q = q.eq('cloze_status', status)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const cards = (data ?? []).map(claimFromRow).filter((c) => (holes === 'none' ? c.holes.length === 0 : c.holes.length > 0))
  return NextResponse.json({ cards })
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  const body = (await req.json().catch(() => null)) as { claimId?: unknown; clozeStatus?: unknown; holes?: unknown } | null
  const claimId = validId(body?.claimId)
  if (!claimId) return NextResponse.json({ error: 'claimId が必要です' }, { status: 400 })
  const admin = createAdminClient()

  // 本文を先に読む。範囲の検査には本文の長さが要る（後述）ほか、存在しない claim_id への
  // update は 0行更新の成功になり、画面には「直った」と出てしまう。
  const { data: row, error: readError } = await admin.from('recall_claims').select('body').eq('claim_id', claimId).maybeSingle()
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 })
  if (!row) return NextResponse.json({ error: 'その主張は見つかりません' }, { status: 404 })
  const bodyLength = String((row as { body?: unknown }).body ?? '').length

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (body?.clozeStatus !== undefined) {
    if (!(STATUSES as readonly unknown[]).includes(body.clozeStatus)) return NextResponse.json({ error: 'clozeStatus が不正です' }, { status: 400 })
    patch.cloze_status = body.clozeStatus
  }
  if (body?.holes !== undefined) {
    const h = body.holes
    // 「読者の画面（segments.ts の normalizeHoles/segmentBody）が実際に描く形」と、
    // ここで保存する holes を必ず一致させる。上限件数チェックの後、実際の本文の長さで
    // normalizeHoles に通し（下限0・整数・start<end・本文の外・重なり/接する範囲の統合・
    // 並び替えが同じ規則で効く）、入力が正規化後と1件でも食い違えば拒否する。ここで正規化した
    // 値をそのまま保存する（＝サイレントに直して保存する）と、管理画面が見せた範囲と実際に
    // 保存される範囲がずれる。「不正なら保存させて読者側で黙って直す」のではなく
    // 「不正なら保存させない」を選ぶ（reader-spread の verifyVerbatim と同じ fail-closed の流儀）。
    //
    // 本文の長さで検査するのが要点。上限を Number.MAX_SAFE_INTEGER のような大きな値にすると、
    // 本文の外を指す範囲（読者側では丸められる・落とされる）をそのまま通してしまい、
    // 管理画面で見えた穴と読者に出る穴が食い違う。
    const valid = Array.isArray(h) && h.length <= MAX_HOLES
    const normalized = valid ? normalizeHoles(bodyLength, h) : []
    const unchanged =
      valid &&
      normalized.length === (h as unknown[]).length &&
      normalized.every(([a, b], i) => {
        const pair = (h as unknown[])[i]
        return Array.isArray(pair) && pair[0] === a && pair[1] === b
      })
    if (!unchanged) return NextResponse.json({ error: `holes は [start,end] の配列（本文の中・重なりなし・最大${MAX_HOLES}）です` }, { status: 400 })
    patch.holes = h
  }
  const { error } = await admin.from('recall_claims').update(patch).eq('claim_id', claimId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  // 隣の管理操作（ledger・spread・spread/note）と同じく監査ログに残す。ここが書き換える列は
  // 読者に伏せ字カードとして何が出るかを直接決めるので、誰がいつ変えたかを追えるようにする。
  // admin_audit_log.target_user_id は uuid 型なので、claim_id は detail に入れる。
  await logAdminAction(admin, {
    actorEmail: auth.email,
    action: 'review_recall_cloze',
    detail: { claimId, clozeStatus: patch.cloze_status ?? null, holes: patch.holes ?? null },
  })
  return NextResponse.json({ ok: true })
}
