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
import { rateLimitAsync } from '@/lib/rate-limit'

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

// 現在のJST時間帯（0〜23）。時間帯ヒストグラム用。
function jstHour(): number {
  return new Date(Date.now() + 9 * 3600_000).getUTCHours()
}

// 流入元を既知の少数の値に丸める（カーディナリティを抑える。生ホスト名やゴミは 'other'/'direct'）。
const SOURCE_ALIAS: Record<string, string> = {
  't.co': 'x', 'x.com': 'x', 'twitter.com': 'x',
  'note.com': 'note', 'note.mu': 'note',
  'notion.so': 'notion', 'notion.com': 'notion', 'notion.site': 'notion',
  'line.me': 'line', 'liff.line.me': 'line',
}
const KNOWN_SOURCES = new Set(['x', 'note', 'notion', 'line', 'lp', 'direct', 'instagram', 'youtube', 'search'])
function normalizeSource(raw: unknown): string {
  if (typeof raw !== 'string') return 'direct'
  const s0 = raw.trim().toLowerCase().slice(0, 40)
  if (!s0) return 'direct'
  if (['google.', 'bing.', 'yahoo.', 'duckduckgo.', 'baidu.', 'ecosia.'].some((h) => s0.includes(h))) return 'search'
  const s = SOURCE_ALIAS[s0] ?? s0
  return KNOWN_SOURCES.has(s) ? s : 'other'
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
  if (!(await rateLimitAsync(`lp-visit:${ip}`, 10, 60_000))) {
    return NextResponse.json({ ok: false }, { status: 429, headers })
  }

  // 媒体はLP側（lp-counter.js）が本文で送る。無くても記録は続行（direct 扱い）。
  let source = 'direct'
  try {
    const body = (await req.json()) as { source?: unknown }
    source = normalizeSource(body?.source)
  } catch {
    // 本文なし・不正JSONでも direct として記録する。
  }

  try {
    const admin = createAdminClient()
    // 時間帯・媒体つきの上位版（migration 0010）。未適用ならエラーになるので従来版へフォールバック。
    const { error } = await admin.rpc('record_lp_visit', {
      visit_day: jstDay(),
      visit_hour: jstHour(),
      visit_source: source,
    })
    if (error) {
      // 0010 未適用: 日別カウントだけ従来どおり記録する（推移は維持）。
      const { error: e2 } = await admin.rpc('increment_lp_visit', { visit_day: jstDay() })
      if (e2) throw new Error(e2.message)
    }
    return NextResponse.json(await readCounts(), { headers })
  } catch {
    return NextResponse.json({ ok: false }, { headers })
  }
}
