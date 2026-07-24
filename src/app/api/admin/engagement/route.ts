// エンゲージメント・継続の集約API（管理者専用）。
//
//   GET /api/admin/engagement
//     … 「使われ続けているか」を1JSONで返す。各ブロックは独立した best-effort
//       （1つ失敗しても他は返す・テーブル未適用でも 0/null で劣化）。
//
// 認可: requireAdmin（ログイン必須＋COMP_ADMIN_EMAILS）。
// 集計の純粋ロジックは @/lib/engagement-metrics に分離（ここは DB I/O と組み立てのみ）。
// プライバシー: 日付・件数・user_id・種別のみ。何を検索/閲覧したかは扱わない。

import { NextResponse } from 'next/server'
import algoliasearch from 'algoliasearch'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin-guard'
import { jstDateKey } from '@/lib/admin-daily'
import { deriveMemberKind, type SubscriptionSummary } from '@/lib/member-ledger'
import {
  countUsageOn,
  avgDailyUnique,
  memberActiveRate,
  stickiness,
  continuityDistribution,
  weeklyRetention,
  optOutRate,
  pct,
} from '@/lib/engagement-metrics'

const DAY = 24 * 60 * 60 * 1000

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const now = Date.now()
  const nowDate = new Date(now)
  const admin = createAdminClient()

  const todayKey = jstDateKey(now)
  const yesterdayKey = jstDateKey(now - DAY)
  const last7Keys = Array.from({ length: 7 }, (_, i) => jstDateKey(now - i * DAY))
  const prev7Keys = Array.from({ length: 7 }, (_, i) => jstDateKey(now - (i + 7) * DAY))
  const last30Cutoff = jstDateKey(now - 29 * DAY)

  // レスポンス骨格（各ブロックが埋める。未適用/失敗は null のまま＝UIはリンク/注記に劣化）。
  const res: {
    usage: { today: number; yesterday: number; avg7: number } | null
    members: { active: number; total: number; pct: number } | null
    stickiness: { dau: number; mau: number; pct: number } | null
    continuity: {
      buckets: { d1: number; d2_3: number; d4_6: number; daily: number }
      repeaterRate: number
    } | null
    retention: {
      thisWeekActive: number
      continuing: number
      newOrReturning: number
      churnRisk: number
    } | null
    dailyQuestion: { answeredToday: number; answered7: number; rate: number } | null
    topCq: Array<{ objectId: string; title: string | null; viewCount: number }> | null
    push: { activeSubscribers: number; everSubscribed: number; optOutRate: number } | null
    generatedAt: string
  } = {
    usage: null,
    members: null,
    stickiness: null,
    continuity: null,
    retention: null,
    dailyQuestion: null,
    topCq: null,
    push: null,
    generatedAt: nowDate.toISOString(),
  }

  // --- 1. 日次アクティブ（app_usage_daily 直近30日）: DAU/MAU/継続/週次 ---
  let dauToday = 0
  try {
    const { data, error } = await admin
      .from('app_usage_daily')
      .select('user_id, used_on')
      .gte('used_on', last30Cutoff)
      .limit(20000)
    if (error) throw new Error(error.message)
    const rows = (data ?? []).map((r) => ({
      user_id: String(r.user_id),
      used_on: String(r.used_on),
    }))
    dauToday = countUsageOn(rows, todayKey)
    const mau = new Set(rows.map((r) => r.user_id)).size
    res.usage = {
      today: dauToday,
      yesterday: countUsageOn(rows, yesterdayKey),
      avg7: avgDailyUnique(rows, last7Keys),
    }
    res.stickiness = { dau: dauToday, mau, pct: stickiness(dauToday, mau) }
    res.continuity = continuityDistribution(rows, last7Keys)
    res.retention = weeklyRetention(rows, last7Keys, prev7Keys)
  } catch {
    // テーブル未適用など。usage系は null のまま。
  }

  // --- 2. 会員稼働率（users × subscriptions × app_usage.last_used_at） ---
  try {
    const users: Array<{ id: string; email: string | null; user_metadata?: Record<string, unknown> }> = []
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      if (error) throw new Error(error.message)
      users.push(...(data.users as typeof users))
      if (!data.users || data.users.length < 1000) break
    }
    const { data: subs, error: subErr } = await admin
      .from('subscriptions')
      .select('user_id, plan, status, trial_ends_at, stripe_customer_id')
    if (subErr) throw new Error(subErr.message)
    const subByUser = new Map<string, SubscriptionSummary>()
    for (const s of subs ?? []) {
      subByUser.set(String(s.user_id), {
        plan: (s.plan as string | null) ?? null,
        status: (s.status as string | null) ?? null,
        trial_ends_at: (s.trial_ends_at as string | null) ?? null,
        stripe_customer_id: (s.stripe_customer_id as string | null) ?? null,
      })
    }
    const { data: usage, error: usageErr } = await admin
      .from('app_usage')
      .select('user_id, last_used_at')
    if (usageErr) throw new Error(usageErr.message)
    const lastUsedByUser = new Map<string, string | null>()
    for (const u of usage ?? []) {
      lastUsedByUser.set(String(u.user_id), (u.last_used_at as string | null) ?? null)
    }
    const adminEmails = (process.env.COMP_ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
    const memberRows = users.map((u) => {
      const summary = subByUser.get(u.id)
      const meta = u.user_metadata ?? {}
      if (summary) summary.auto_trial_granted_at = (meta.auto_trial_granted_at as string | undefined) ?? null
      const isAdmin = !!u.email && adminEmails.includes(u.email.toLowerCase())
      return {
        kind: deriveMemberKind(isAdmin, summary, nowDate),
        lastUsedAt: lastUsedByUser.get(u.id) ?? null,
      }
    })
    res.members = memberActiveRate(memberRows, now, 7)
  } catch {
    // 会員稼働率は null のまま。
  }

  // --- 3. 今日の1問 回答率（daily_question_log 直近7日） ---
  try {
    const { data, error } = await admin
      .from('daily_question_log')
      .select('user_id, answered_on')
      .gte('answered_on', last7Keys[6])
    if (error) throw new Error(error.message)
    const rows = data ?? []
    const answeredTodayUsers = new Set(
      rows.filter((r) => String(r.answered_on) === todayKey).map((r) => String(r.user_id)),
    )
    const answered7Users = new Set(rows.map((r) => String(r.user_id)))
    res.dailyQuestion = {
      answeredToday: answeredTodayUsers.size,
      answered7: answered7Users.size,
      rate: pct(answeredTodayUsers.size, dauToday),
    }
  } catch {
    // 今日の1問は null のまま。
  }

  // --- 4. コンテンツ反応（解決CQ参照 上位10・タイトルはAlgoliaでbest-effort解決） ---
  try {
    const { data, error } = await admin
      .from('cq_views')
      .select('object_id, view_count')
      .order('view_count', { ascending: false })
      .limit(10)
    if (error) throw new Error(error.message)
    const top = (data ?? []).map((r) => ({
      objectId: String(r.object_id),
      viewCount: Number(r.view_count) || 0,
    }))
    const titles = new Map<string, string>()
    const appId = process.env.SUBSCRIPTION_ALGOLIA_APP_ID
    const adminKey = process.env.SUBSCRIPTION_ALGOLIA_ADMIN_KEY
    const indexName = process.env.SUBSCRIPTION_ALGOLIA_INDEX || 'Medical Knowledge_DB（サブスク用）'
    if (appId && adminKey && top.length > 0) {
      try {
        const index = algoliasearch(appId, adminKey).initIndex(indexName)
        const objs = await index.getObjects<{ objectID: string; title?: string }>(
          top.map((t) => t.objectId),
          { attributesToRetrieve: ['title'] },
        )
        for (const o of objs.results) {
          if (o && o.title) titles.set(o.objectID, o.title)
        }
      } catch {
        // タイトル解決失敗時は objectId 表示にフォールバック。
      }
    }
    res.topCq = top.map((t) => ({ ...t, title: titles.get(t.objectId) ?? null }))
  } catch {
    // 参照回数テーブル未適用など。null のまま。
  }

  // --- 5. Push健全性（購読者数・オプトアウト率） ---
  try {
    const { data, error } = await admin.from('push_subscriptions').select('user_id, revoked_at')
    if (error) throw new Error(error.message)
    const rows = data ?? []
    const everSubscribed = new Set(rows.map((r) => String(r.user_id)))
    const activeSubscribers = new Set(
      rows.filter((r) => !r.revoked_at).map((r) => String(r.user_id)),
    )
    // 全端末が失効した人 = 一度購読したが今は有効購読ゼロ。
    const optedOut = [...everSubscribed].filter((u) => !activeSubscribers.has(u)).length
    res.push = {
      activeSubscribers: activeSubscribers.size,
      everSubscribed: everSubscribed.size,
      optOutRate: optOutRate(everSubscribed.size, optedOut),
    }
  } catch {
    // Push未適用など。null のまま。
  }

  return NextResponse.json(res)
}
