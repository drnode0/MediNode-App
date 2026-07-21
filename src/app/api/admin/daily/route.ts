// デイリー・コマンドセンター（/admin 最上部）のライブ状態を集約する管理者専用API。
//
//   GET /api/admin/daily
//     … 日次でチェックすべき外部ソースの「今の状態」を1つのJSONで返す。
//       ソースごとに独立した best-effort（1つ失敗しても他は返す・各々タイムアウト）。
//       トークン/ID未設定のソースは configured:false を返し、UI はリンクに劣化する。
//
// 台帳本体（/api/admin/ledger）とは別エンドポイントにして、重い台帳クエリを待たずに
// コマンドセンターだけ先に表示できるようにする（クライアントは2本を並列fetch）。
//
// 認可: requireAdmin（ログイン必須＋COMP_ADMIN_EMAILS のみ）。
// 注意: このリポジトリは公開テンプレート。オーナー固有のID/参照は直書きせず全て env 経由。

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/admin-guard'
import { countUnresolved, jstStartOfTodayMs, isJstToday, usagePct } from '@/lib/admin-daily'
import Stripe from 'stripe'

// Notion DB のURL（未対応ビューがあればそこへ）。env 未設定なら null（UIはリンクを出さない）。
function notionUrl(dbId?: string, viewId?: string): string | null {
  if (!dbId) return null
  const base = `https://www.notion.so/${dbId.replace(/-/g, '')}`
  return viewId ? `${base}?v=${viewId.replace(/-/g, '')}` : base
}

// Notion DB を全ページ辿って「未対応」件数を数える（best-effort・上限5ページ＝500件）。
async function countNotionUnresolved(dbId: string, token: string): Promise<number> {
  let cursor: string | undefined
  const all: Array<{ properties?: Record<string, unknown> | null }> = []
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(cursor ? { page_size: 100, start_cursor: cursor } : { page_size: 100 }),
      signal: AbortSignal.timeout(4000),
    })
    if (!res.ok) throw new Error(`notion ${res.status}`)
    const data = (await res.json()) as {
      results?: Array<{ properties?: Record<string, unknown> | null }>
      has_more?: boolean
      next_cursor?: string | null
    }
    all.push(...(data.results ?? []))
    if (!data.has_more || !data.next_cursor) break
    cursor = data.next_cursor
  }
  return countUnresolved(all)
}

// Notion 新着（未対応件数）。token は events DB と同じ SUBSCRIPTION_NOTION_TOKEN を第一候補。
async function fetchNotionPending(dbEnv: string | undefined, viewEnv: string | undefined) {
  const url = notionUrl(dbEnv, viewEnv)
  const token = process.env.SUBSCRIPTION_NOTION_TOKEN || process.env.NOTION_TOKEN
  if (!dbEnv || !token) return { configured: false, url }
  const pending = await countNotionUnresolved(dbEnv, token)
  return { configured: true, pending, url }
}

// Stripe: 今日（JST）の決済・失敗決済の件数。
async function fetchStripe(now: number) {
  const url = 'https://dashboard.stripe.com/payments'
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) return { configured: false, url }
  const stripe = new Stripe(key)
  const gte = Math.floor(jstStartOfTodayMs(now) / 1000)
  let todayCount = 0
  let failedCount = 0
  let startingAfter: string | undefined
  for (let i = 0; i < 5; i++) {
    const page = await stripe.charges.list({ created: { gte }, limit: 100, starting_after: startingAfter })
    for (const c of page.data) {
      if (c.paid && c.status === 'succeeded') todayCount++
      if (c.status === 'failed') failedCount++
    }
    if (!page.has_more || page.data.length === 0) break
    startingAfter = page.data[page.data.length - 1].id
  }
  return { configured: true, todayCount, failedCount, url }
}

// アプリ生存: 本番URL（NEXT_PUBLIC_APP_URL）へ軽く到達確認（2xxで稼働中・応答msも返す）。
async function fetchAppLiveness() {
  const base = process.env.NEXT_PUBLIC_APP_URL
  if (!base) return { configured: false, up: false, ms: 0, url: '' }
  const url = base.startsWith('http') ? base : `https://${base}`
  const started = Date.now()
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(4000), cache: 'no-store' })
    return { configured: true, up: res.ok, ms: Date.now() - started, url }
  } catch {
    return { configured: true, up: false, ms: Date.now() - started, url }
  }
}

// Vercel: 最新デプロイの状態（READY/ERROR/BUILDING など）。
async function fetchVercel() {
  const url = 'https://vercel.com/dashboard'
  const token = process.env.VERCEL_TOKEN
  const projectId = process.env.VERCEL_PROJECT_ID
  if (!token || !projectId) return { configured: false, url }
  const params = new URLSearchParams({ projectId, limit: '1' })
  if (process.env.VERCEL_TEAM_ID) params.set('teamId', process.env.VERCEL_TEAM_ID)
  const res = await fetch(`https://api.vercel.com/v6/deployments?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(4000),
  })
  if (!res.ok) throw new Error(`vercel ${res.status}`)
  const data = (await res.json()) as { deployments?: Array<{ state?: string; readyState?: string }> }
  const dep = data.deployments?.[0]
  const state = dep?.readyState || dep?.state || 'UNKNOWN'
  return { configured: true, state, url }
}

// Algolia: 当月の検索オペレーション数（Usage API・best-effort）。取れなければ configured:false。
async function fetchAlgolia() {
  const url = 'https://dashboard.algolia.com/'
  const appId = process.env.ALGOLIA_APP_ID
  const apiKey = process.env.ALGOLIA_ADMIN_KEY
  const quota = 10000 // 無料枠 10,000 検索/月（プラン変更時に更新）
  if (!appId || !apiKey) return { configured: false, url }
  const res = await fetch('https://usage.algolia.com/1/usage/total_search_operations/period/month', {
    headers: { 'X-Algolia-Application-Id': appId, 'X-Algolia-API-Key': apiKey },
    signal: AbortSignal.timeout(4000),
  })
  if (!res.ok) throw new Error(`algolia ${res.status}`)
  const data = (await res.json()) as { dates?: Array<{ v?: number }> }
  const used = (data.dates ?? []).reduce((sum, d) => sum + (Number(d.v) || 0), 0)
  return { configured: true, used, quota, pct: usagePct(used, quota), url }
}

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const now = Date.now()

  // 今日の新規登録数（JST）。auth.users を軽く読むだけ（台帳の重い突合はしない）。
  const signupsTodayP = (async () => {
    try {
      const admin = createAdminClient()
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      return (data?.users ?? []).filter((u) => isJstToday(u.created_at, now)).length
    } catch {
      return 0
    }
  })()

  // 各ソースは独立に best-effort。失敗しても fallback に落として全体は返す。
  const settled = await Promise.allSettled([
    signupsTodayP,
    fetchNotionPending(process.env.FEEDBACK_NOTION_DB, process.env.FEEDBACK_NOTION_VIEW),
    fetchNotionPending(process.env.CQ_NOTION_DB, process.env.CQ_NOTION_VIEW),
    fetchStripe(now),
    fetchAppLiveness(),
    fetchVercel(),
    fetchAlgolia(),
  ])

  const val = <T,>(i: number, fallback: T): T =>
    settled[i].status === 'fulfilled' ? (settled[i] as PromiseFulfilledResult<T>).value : fallback

  return NextResponse.json({
    ok: true,
    signupsToday: val(0, 0),
    feedback: val(1, { configured: false, url: notionUrl(process.env.FEEDBACK_NOTION_DB, process.env.FEEDBACK_NOTION_VIEW) }),
    cq: val(2, { configured: false, url: notionUrl(process.env.CQ_NOTION_DB, process.env.CQ_NOTION_VIEW) }),
    stripe: val(3, { configured: false, url: 'https://dashboard.stripe.com/payments' }),
    app: val(4, { configured: false, up: false, ms: 0, url: process.env.NEXT_PUBLIC_APP_URL || '' }),
    vercel: val(5, { configured: false, url: 'https://vercel.com/dashboard' }),
    algolia: val(6, { configured: false, url: 'https://dashboard.algolia.com/' }),
    // Resend・Supabase の使用量は安定した公開API/権限が要るため当面リンクのみ（週次チェック）。
    resend: { configured: false, url: 'https://resend.com/emails' },
    supabase: { configured: false, url: 'https://supabase.com/dashboard/project/_/settings/billing/usage' },
  })
}
