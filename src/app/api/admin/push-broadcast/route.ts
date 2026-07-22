// お知らせ一斉送信（admin専用）。
//   POST { title, body, url? } → 失効していない全購読ユーザー（announceトグルON）へ送信。
//
// 週1程度に留める運用は /admin 側のUI注記のみ（本APIは回数制限をかけない）。

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { createAdminClient } from '@/lib/supabase/server'
import { sendToUsers } from '@/lib/push-send'
import { readPushStage, isPreviewEmail } from '@/lib/push'

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body: { title?: string; body?: string; url?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSONが不正です' }, { status: 400 })
  }
  if (!body.title || !body.body) {
    return NextResponse.json({ error: 'title と body は必須です' }, { status: 400 })
  }

  // 予期せぬ例外（VAPID設定・getUserById・送信）でも必ずJSONを返す。
  // 包まないと非JSONの500になり、クライアントの res.json() が
  // 「The string did not match the expected pattern.」等の分かりにくいエラーになる。
  try {
    // stage/preview姿勢を一斉送信にも反映（オーナー限定preview中に全員へ漏れないように）。
    const stage = await readPushStage()
    if (stage === 'off') return NextResponse.json({ ok: true, skipped: 'off', sent: 0, pruned: 0 })

    const admin = createAdminClient()
    const { data: subs, error } = await admin
      .from('push_subscriptions')
      .select('user_id')
      .is('revoked_at', null)
    if (error) throw new Error(`購読者の取得に失敗しました: ${error.message}`)
    let userIds = [...new Set((subs ?? []).map((s: { user_id: string }) => s.user_id))]

    if (stage === 'preview') {
      const eligible: string[] = []
      for (const uid of userIds) {
        const { data: u, error: userError } = await admin.auth.admin.getUserById(uid)
        if (userError) throw new Error(userError.message)
        if (isPreviewEmail(u.user?.email)) eligible.push(uid)
      }
      userIds = eligible
    }

    const res = await sendToUsers(admin, userIds, 'announce', {
      title: body.title,
      body: body.body,
      url: body.url || '/',
      tag: 'announce',
    })
    return NextResponse.json({ ok: true, ...res })
  } catch (err) {
    const message = err instanceof Error ? err.message : '送信に失敗しました'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
