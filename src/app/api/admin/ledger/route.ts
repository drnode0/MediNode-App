// アカウント台帳（管理者専用）。
//
//   GET /api/admin/ledger
//     … 全登録ユーザー（auth.users）と契約状態（subscriptions）を突き合わせ、
//       「誰がプレミアムで、誰が永続無料か」を1行1ユーザーで返す。/admin 画面のデータ源。
//   POST /api/admin/ledger
//     … 指定ユーザーへ永続無料（comp）をその場で付与する。Body: { userId }
//       招待コードを渡さなくても、台帳から特定の人だけを解放できる。
//       取り消しは従来どおり POST /api/premium/comp（revoke）。
//
// アクセス制御: requireAdmin（ログイン必須＋COMP_ADMIN_EMAILS のみ）。
// service_role でRLSをバイパスして全件を読むため、認可はこのガードが唯一の砦。

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin-guard'
import { grantComplimentaryByUserId } from '@/lib/supabase/subscriptions'
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
      user_metadata?: Record<string, unknown>
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

    // 設定同期の時刻（user_settings.updated_at）。ログインより実際の利用に近い目安として台帳に出す。
    // 設定を変えた・別端末でログイン復元した等でサーバー保存が走った時刻（検索のたびには動かない）。
    const { data: settings, error: setErr } = await admin
      .from('user_settings')
      .select('user_id, updated_at')
    if (setErr) throw new Error(`設定同期時刻の取得に失敗: ${setErr.message}`)
    const settingsByUser = new Map(
      (settings ?? []).map((s) => [s.user_id as string, s.updated_at as string | null]),
    )

    // 最終利用日（app_usage.last_used_at）。アプリを開くと1日1回記録される（/api/usage/ping）。
    // マイグレーション 0004 未適用の環境ではテーブルが無いので、失敗しても列を「—」にして続行する。
    const usageByUser = new Map<string, string | null>()
    try {
      const { data: usage } = await admin.from('app_usage').select('user_id, last_used_at')
      for (const u of usage ?? []) {
        usageByUser.set(u.user_id as string, (u.last_used_at as string | null) ?? null)
      }
    } catch {
      // テーブル未作成なら全員「—」のまま。
    }

    // 日別アクティブ数（直近60日・グラフ用）。0006 未適用ならテーブルが無いので空のまま続行。
    // 日付はJSTで記録されている（/api/usage/ping 参照）。日別ユニーク数へ集計して返す。
    const dailyActive: Array<{ date: string; count: number }> = []
    try {
      const sinceOn = new Date(Date.now() + 9 * 60 * 60 * 1000 - 60 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
      const { data: daily } = await admin
        .from('app_usage_daily')
        .select('used_on, user_id')
        .gte('used_on', sinceOn)
        .limit(20000) // 既定の1000行上限を外す（60日×ユーザー数。約330人/日まで欠けない）
      const countByDate = new Map<string, number>()
      for (const d of daily ?? []) {
        const date = String(d.used_on)
        countByDate.set(date, (countByDate.get(date) ?? 0) + 1)
      }
      for (const [date, count] of [...countByDate.entries()].sort()) {
        dailyActive.push({ date, count })
      }
    } catch {
      // テーブル未作成なら空配列（グラフ側が「蓄積待ち」を表示する）。
    }

    // 利用時間帯（直近30日・JST）。0〜23時の各時間帯に「延べ何人日の利用があったか」。
    // 0007 未適用ならテーブルが無いので全0のまま続行（グラフ側が「蓄積待ち」を表示する）。
    const hourlyActive: number[] = Array.from({ length: 24 }, () => 0)
    let hourlyTotal = 0
    try {
      const sinceOn = new Date(Date.now() + 9 * 60 * 60 * 1000 - 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10)
      const { data: hourly } = await admin
        .from('app_usage_hourly')
        .select('hour')
        .gte('used_on', sinceOn)
        .limit(20000)
      for (const h of hourly ?? []) {
        const hour = Number(h.hour)
        if (hour >= 0 && hour <= 23) {
          hourlyActive[hour]++
          hourlyTotal++
        }
      }
    } catch {
      // テーブル未作成なら全0のまま。
    }

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
              // auto_trial 導入前の plan='trial' 行を遡って分類するための材料。
              auto_trial_granted_at:
                (u.user_metadata?.auto_trial_granted_at as string | undefined) ?? null,
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
          settingsUpdatedAt: settingsByUser.get(u.id) ?? null,
          lastUsedAt: usageByUser.get(u.id) ?? null,
        }
      })
      .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))

    return NextResponse.json({
      ok: true,
      count: rows.length,
      rows,
      dailyActive,
      hourlyActive: hourlyTotal > 0 ? hourlyActive : [],
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// 永続無料（comp）の付与。台帳画面の「永続無料を付与」ボタンから呼ばれる。
export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response
  try {
    const { userId } = await req.json()
    if (!userId || typeof userId !== 'string') {
      return NextResponse.json({ error: 'userId を指定してください' }, { status: 400 })
    }
    // 実在するユーザーかを確認してから付与する（誤ったIDで幽霊行を作らない）。
    const admin = createAdminClient()
    const { data, error } = await admin.auth.admin.getUserById(userId)
    if (error || !data?.user) {
      return NextResponse.json({ error: '対象のユーザーが見つかりません' }, { status: 404 })
    }
    // 既にStripe契約の行がある場合は上書きしない（紐づけが切れるのを防ぐ安全弁）。
    const { data: existing } = await admin
      .from('subscriptions')
      .select('stripe_customer_id, status')
      .eq('user_id', userId)
      .maybeSingle()
    if (existing?.stripe_customer_id) {
      return NextResponse.json(
        { error: 'このユーザーはStripe契約の記録があるため、台帳からは付与できません' },
        { status: 409 },
      )
    }
    await grantComplimentaryByUserId(userId)
    return NextResponse.json({ ok: true, userId, plan: 'comp' })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
