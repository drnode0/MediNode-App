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
// 注意: Usage API は Premium プラン以上＋「Usage」ACL のキーが必要（Adminキーで代用できない場合あり）。
// 無料プランでは 401/403 になり configured:false（＝リンク）に劣化する。専用キーは ALGOLIA_USAGE_KEY。
async function fetchAlgolia(now: number) {
  const url = 'https://dashboard.algolia.com/'
  const appId = process.env.ALGOLIA_APP_ID
  const apiKey = process.env.ALGOLIA_USAGE_KEY || process.env.ALGOLIA_ADMIN_KEY
  const quota = 10000 // 無料枠 10,000 検索/月（プラン変更時に更新）
  if (!appId || !apiKey) return { configured: false, url }
  // 当月1日0:00(UTC)〜現在。月次合計の概算として十分。
  const d = new Date(now)
  const startDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString()
  const endDate = new Date(now).toISOString()
  const params = new URLSearchParams({ startDate, endDate })
  const res = await fetch(`https://usage.algolia.com/1/usage/total_search_operations?${params.toString()}`, {
    headers: { 'X-Algolia-Application-Id': appId, 'X-Algolia-API-Key': apiKey },
    signal: AbortSignal.timeout(4000),
  })
  if (!res.ok) throw new Error(`algolia ${res.status}`)
  // レスポンスは統計名をキーにした {t,v} の配列: { total_search_operations: [{t,v}, ...] }
  const data = (await res.json()) as Record<string, Array<{ v?: number }> | undefined>
  const series = data.total_search_operations ?? []
  const used = series.reduce((sum, p) => sum + (Number(p?.v) || 0), 0)
  return { configured: true, used, quota, pct: usagePct(used, quota), url }
}

export async function GET() {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  const now = Date.now()
  const SB_USAGE_URL = 'https://supabase.com/dashboard/project/_/settings/billing/usage'

  // Supabase系: 今日の新規登録数・推定MAU（自前データから算出）・DB容量（RPC）。
  // PATは不要。auth.users を1回読み、last_sign_in_at で直近30日のアクティブ数を数える。
  // DB容量は get_db_size()（migration 0013）。関数未適用なら dbBytes=null（UIはリンクに劣化）。
  const supabaseP = (async () => {
    const admin = createAdminClient()
    let signupsToday = 0
    let mau = 0
    let dbBytes: number | null = null
    try {
      const { data } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      const users = data?.users ?? []
      // 「登録を完了した人だけ」。OTPログインはメールを入れた時点で auth.users に行ができるため、
      // メール確認済み（email_confirmed_at あり）に絞って未完了・テストの水増しを除く。
      signupsToday = users.filter(
        (u) => u.email_confirmed_at && isJstToday(u.created_at, now),
      ).length
      const cutoff = now - 30 * 24 * 60 * 60 * 1000
      mau = users.filter((u) => u.last_sign_in_at && new Date(u.last_sign_in_at).getTime() >= cutoff).length
    } catch {
      // 取れなくても続行（0のまま）。
    }
    try {
      const { data } = await admin.rpc('get_db_size')
      const n = typeof data === 'number' ? data : data != null ? Number(data) : NaN
      if (Number.isFinite(n)) dbBytes = n
    } catch {
      // 関数未適用なら null（DB容量ゲージはリンク表示）。
    }
    return {
      signupsToday,
      supabase: {
        mau,
        mauQuota: 50000,
        dbBytes,
        dbQuota: 500 * 1024 * 1024, // 無料枠 500MB
        url: SB_USAGE_URL,
      },
    }
  })()

  // 各ソースは独立に best-effort。失敗しても fallback に落として全体は返す。
  const settled = await Promise.allSettled([
    supabaseP,
    fetchNotionPending(process.env.FEEDBACK_NOTION_DB, process.env.FEEDBACK_NOTION_VIEW),
    fetchNotionPending(process.env.CQ_NOTION_DB, process.env.CQ_NOTION_VIEW),
    fetchStripe(now),
    fetchAppLiveness(),
    fetchVercel(),
    fetchAlgolia(now),
  ])

  const val = <T,>(i: number, fallback: T): T =>
    settled[i].status === 'fulfilled' ? (settled[i] as PromiseFulfilledResult<T>).value : fallback

  const sb = val(0, {
    signupsToday: 0,
    supabase: { mau: 0, mauQuota: 50000, dbBytes: null as number | null, dbQuota: 500 * 1024 * 1024, url: SB_USAGE_URL },
  })

  return NextResponse.json({
    ok: true,
    signupsToday: sb.signupsToday,
    supabase: sb.supabase,
    feedback: val(1, { configured: false, url: notionUrl(process.env.FEEDBACK_NOTION_DB, process.env.FEEDBACK_NOTION_VIEW) }),
    cq: val(2, { configured: false, url: notionUrl(process.env.CQ_NOTION_DB, process.env.CQ_NOTION_VIEW) }),
    stripe: val(3, { configured: false, url: 'https://dashboard.stripe.com/payments' }),
    app: val(4, { configured: false, up: false, ms: 0, url: process.env.NEXT_PUBLIC_APP_URL || '' }),
    vercel: val(5, { configured: false, url: 'https://vercel.com/dashboard' }),
    algolia: val(6, { configured: false, url: 'https://dashboard.algolia.com/' }),
    // Resend の使用量は安定した公開API/権限が要るため当面リンクのみ（週次チェック）。
    resend: { configured: false, url: 'https://resend.com/emails' },
  })
}
