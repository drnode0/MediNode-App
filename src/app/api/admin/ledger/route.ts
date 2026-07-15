// アカウント台帳（管理者専用）。
//
//   GET /api/admin/ledger
//     … 全登録ユーザー（auth.users）と契約状態（subscriptions）を突き合わせ、
//       「誰がプレミアムで、誰が永続無料か」を1行1ユーザーで返す。/admin 画面のデータ源。
//
// アクセス制御: requireAdmin（ログイン必須＋COMP_ADMIN_EMAILS のみ）。
// service_role でRLSをバイパスして全件を読むため、認可はこのガードが唯一の砦。

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin-guard'
import { deriveMemberKind, type SubscriptionSummary } from '@/lib/member-ledger'

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  try {
    const admin = createAdminClient()

    // 全ユーザー（1000件/ページ。現規模では1ページで足りるが念のためループ）。
    const users: Array<{
      id: string
      email?: string
      created_at?: string
      last_sign_in_at?: string
    }> = []
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) throw new Error(`ユーザー一覧の取得に失敗: ${error.message}`)
      users.push(...data.users)
      if (data.users.length < 1000) break
    }

    const { data: subs, error: subErr } = await admin
      .from('subscriptions')
      .select('user_id, plan, status, trial_ends_at, current_period_end, stripe_customer_id, updated_at')
    if (subErr) throw new Error(`契約状態の取得に失敗: ${subErr.message}`)

    const subByUser = new Map((subs ?? []).map((s) => [s.user_id as string, s]))

    const adminEmails = (process.env.COMP_ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)

    const now = new Date()
    const rows = users
      .map((u) => {
        const s = subByUser.get(u.id)
        const summary: SubscriptionSummary | null = s
          ? {
              plan: s.plan ?? null,
              status: s.status ?? null,
              trial_ends_at: s.trial_ends_at ?? null,
              stripe_customer_id: s.stripe_customer_id ?? null,
            }
          : null
        const isAdmin = !!u.email && adminEmails.includes(u.email.toLowerCase())
        return {
          userId: u.id,
          email: u.email ?? null,
          createdAt: u.created_at ?? null,
          lastSignInAt: u.last_sign_in_at ?? null,
          kind: deriveMemberKind(isAdmin, summary, now),
          plan: summary?.plan ?? null,
          status: summary?.status ?? null,
          trialEndsAt: summary?.trial_ends_at ?? null,
          subUpdatedAt: (s?.updated_at as string | undefined) ?? null,
        }
      })
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))

    return NextResponse.json({ ok: true, count: rows.length, rows })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
