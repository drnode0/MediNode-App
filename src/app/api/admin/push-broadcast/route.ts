// お知らせ一斉送信（admin専用）。
//   POST { title, body, url? } → 失効していない全購読ユーザー（announceトグルON）へ送信。
//
// 週1程度に留める運用は /admin 側のUI注記のみ（本APIは回数制限をかけない）。

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-guard'
import { createAdminClient } from '@/lib/supabase/server'
import { sendToUsers } from '@/lib/push-send'

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

  const admin = createAdminClient()
  const { data: subs, error } = await admin
    .from('push_subscriptions')
    .select('user_id')
    .is('revoked_at', null)
  if (error) {
    return NextResponse.json({ error: `購読者の取得に失敗しました: ${error.message}` }, { status: 500 })
  }
  const userIds = [...new Set((subs ?? []).map((s: { user_id: string }) => s.user_id))]

  const res = await sendToUsers(admin, userIds, 'announce', {
    title: body.title,
    body: body.body,
    url: body.url || '/',
    tag: 'announce',
  })
  return NextResponse.json({ ok: true, ...res })
}
