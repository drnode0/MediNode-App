// LP（medinode-lp.vercel.app）の訪問カウンター。
//
//   POST /api/lp/visit … 今日（JST）の訪問数を +1 し、今日・昨日・累計を返す
//   GET  /api/lp/visit … 今日・昨日・累計を返す（カウントしない）
//
// LP側のスクリプト（assets/lp-counter.js）が、1ブラウザセッションにつき1回だけ POST し、
// 2回目以降の表示は GET で読む。記録するのは日付ごとの数だけで、IP・UA等は保存しない。
// best-effort: テーブル未作成（マイグレーション0005未適用）等で失敗しても ok:false を
// 返すだけで、LP側は何も表示しない（ページの動作には影響しない）。

import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'

// LP以外のサイトからは読めない・数えられないようにする（ブラウザのCORSで抑止）。
const ALLOWED_ORIGINS = new Set([
  'https://medinode-lp.vercel.app',
  'http://localhost:8765', // LPのローカルプレビュー
])

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://medinode-lp.vercel.app'
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  }
}

// JST（UTC+9）の日付文字列（YYYY-MM-DD）。「今日・昨日」は日本時間で区切る。
function jstDay(offsetDays = 0): string {
  return new Date(Date.now() + 9 * 3600_000 - offsetDays * 86_400_000).toISOString().slice(0, 10)
}

async function readCounts() {
  const admin = createAdminClient()
  const { data, error } = await admin.from('lp_visits').select('day,count')
  if (error) throw new Error(error.message)
  const today = jstDay()
  const yesterday = jstDay(1)
  let t = 0
  let y = 0
  let total = 0
  for (const row of data ?? []) {
    total += row.count
    if (row.day === today) t = row.count
    if (row.day === yesterday) y = row.count
  }
  return { ok: true, today: t, yesterday: y, total }
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) })
}

export async function GET(req: Request) {
  const headers = corsHeaders(req.headers.get('origin'))
  try {
    return NextResponse.json(await readCounts(), { headers })
  } catch {
    return NextResponse.json({ ok: false }, { headers })
  }
}

export async function POST(req: Request) {
  const headers = corsHeaders(req.headers.get('origin'))
  const supabaseReady = !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  if (!supabaseReady) return NextResponse.json({ ok: false }, { headers })

  // 機械的な連打によるカウンター水増しを抑える（1IPあたり1分に10回まで）。
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`lp-visit:${ip}`, 10, 60_000)) {
    return NextResponse.json({ ok: false }, { status: 429, headers })
  }

  try {
    const admin = createAdminClient()
    const { error } = await admin.rpc('increment_lp_visit', { visit_day: jstDay() })
    if (error) throw new Error(error.message)
    return NextResponse.json(await readCounts(), { headers })
  } catch {
    return NextResponse.json({ ok: false }, { headers })
  }
}
