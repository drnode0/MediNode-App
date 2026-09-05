// /admin の「聞ける棚」パネル用API。
//
//   GET  … 受付DBの未対応（対応状態が空）を新しい順で返す。
//   PATCH … ボード公開の切替／見送りの理由／正本の主張の紐づけを受付DBへ書き戻す。
//
// アクセス制御: requireAdmin（ログイン必須＋COMP_ADMIN_EMAILS のみ。src/lib/admin-guard.ts）。
// 書き込み先はNotionの受付DBだけ。Supabaseは「主張が取り下げ・改訂されていないか」を
// 確認するためだけに読む（recall_claims.active）。別の真実を作らない。
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { listIntakePages, updateIntakePage } from '@/lib/notion-intake'
import { readIntakeColumns, DECLINE_REASONS } from '@/lib/ask-shelf/intake-columns'
import { stageOf } from '@/lib/cq-mine'
import { createAdminClient } from '@/lib/supabase/server'
import type { NotionIntakePage } from '@/lib/cq-board'

export const dynamic = 'force-dynamic'

type Prop = Record<string, unknown> | undefined

function propOf(page: NotionIntakePage, name: string): Prop {
  return (page.properties?.[name] as Record<string, unknown> | undefined) ?? undefined
}
function plainText(p: Prop, key: 'title' | 'rich_text'): string {
  const arr = p?.[key]
  if (!Array.isArray(arr)) return ''
  return arr.map((t) => String((t as { plain_text?: unknown })?.plain_text ?? '')).join('').trim()
}
function selectName(p: Prop): string {
  const sel = p?.select as { name?: unknown } | null | undefined
  return sel?.name ? String(sel.name) : ''
}
function checkbox(p: Prop): boolean {
  return p?.checkbox === true
}

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  try {
    const pages = await listIntakePages()

    const base = pages.map((page) => {
      const cols = readIntakeColumns(page)
      const onBoard = checkbox(propOf(page, 'ボード公開'))
      return {
        id: page.id,
        question: plainText(propOf(page, '疑問'), 'title'),
        background: plainText(propOf(page, '背景・状況'), 'rich_text'),
        stage: stageOf(selectName(propOf(page, '対応状態')), onBoard),
        onBoard,
        shelfResult: cols.shelfResult,
        canonicalClaimIds: cols.canonicalClaimIds,
        declineReason: cols.declineReason,
        createdAt: page.created_time || '',
      }
    })

    // 一覧は「未対応」だけなので、通常は正本主張IDが付いた行はここに出ない
    // （選ぶと同時に対応状態が書かれ、次の読み込みで一覧から消えるため）。
    // それでもNotion側の手作業などで食い違った行が残りうるため、保険として
    // 正本主張IDが付いている行だけ、その主張がまだ active かを確認する。
    // 確認できなくても一覧自体は止めない（印が付かないだけ）。
    const allIds = [...new Set(base.flatMap((i) => i.canonicalClaimIds))]
    const activeById = new Map<string, boolean>()
    if (allIds.length > 0) {
      try {
        const admin = createAdminClient()
        const { data } = await admin.from('recall_claims').select('claim_id, active').in('claim_id', allIds)
        for (const row of (data ?? []) as Array<{ claim_id: string; active: boolean }>) {
          activeById.set(String(row.claim_id), row.active === true)
        }
      } catch {
        // 確認できなくても一覧は出す。
      }
    }

    const items = base.map((i) => ({
      ...i,
      // 選んだ主張が1件でも見つからない・非アクティブなら「取り下げ・改訂」の印を出す。
      // 選んでいない行（canonicalClaimIds が空）は null（判定対象外）。
      canonicalActive:
        i.canonicalClaimIds.length === 0 ? null : i.canonicalClaimIds.every((id) => activeById.get(id) === true),
    }))

    return NextResponse.json({ items })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body: { id?: unknown; onBoard?: unknown; declineReason?: unknown; canonicalClaimIds?: unknown }
  try {
    body = (await req.json()) as typeof body
  } catch {
    return NextResponse.json({ error: 'リクエストの形式が不正です' }, { status: 400 })
  }

  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return NextResponse.json({ error: 'id を指定してください' }, { status: 400 })

  const props: Record<string, unknown> = {}

  if (typeof body.onBoard === 'boolean') {
    props['ボード公開'] = { checkbox: body.onBoard }
  }

  // 見送りの理由。固定リストに無い文字列は400（誤字・改名で通知が壊れるのを防ぐ）。
  // 「既存の記事で答えられる」だけは対応済み、残る4つは対応不要と組む（設計書の判断）。
  if (body.declineReason !== undefined) {
    const reason = typeof body.declineReason === 'string' ? body.declineReason : ''
    if (!(DECLINE_REASONS as readonly string[]).includes(reason)) {
      return NextResponse.json({ error: '見送りの理由はリストから選択してください' }, { status: 400 })
    }
    props['見送りの理由'] = { select: { name: reason } }
    props['対応状態'] = { select: { name: reason === '既存の記事で答えられる' ? '対応済み' : '対応不要' } }
  }

  // 正本の主張。選ぶのは1件だけ（2026-09-05 裁定3）。配列で複数渡ってきても先頭だけを積む
  // （UI自体は複数選択を作らないが、APIとしても1件だけを書く約束を守る）。
  if (Array.isArray(body.canonicalClaimIds) && body.canonicalClaimIds.length > 0) {
    const claimId = String(body.canonicalClaimIds[0] ?? '').trim()
    if (claimId) {
      props['正本主張ID'] = { rich_text: [{ text: { content: claimId } }] }
      // 通知の合図はこの2つが揃うこと（継ぎ目5）。updateIntakePage 側でも
      // 片方だけ書ける状態なら両方見送る安全弁を持つが、ここでは常に対で渡す。
      props['対応状態'] = { select: { name: '対応済み' } }
    }
  }

  if (Object.keys(props).length === 0) {
    return NextResponse.json({ error: '更新する内容がありません' }, { status: 400 })
  }

  try {
    await updateIntakePage(id, props)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
