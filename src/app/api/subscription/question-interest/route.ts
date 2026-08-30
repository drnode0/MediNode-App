// 📚 Essentials「この節から生まれた問い」への「気になる」投票。
//
// POST /api/subscription/question-interest { blockId, pageId, voted }
//   - 認証: ログイン＋プレミアム（cq/vote と同じ線引き。Essentials を読める人だけが押せる）
//   - voted=true で1票入れる（既にあれば何もしない）／false で取り消す
//   - 戻り: { ok: true, count } … その問いの最新の合計票数
//
// GET /api/subscription/question-interest?ids=a,b,c
//   - 戻り: { counts: { [blockId]: number }, mine: string[] }
//   - counts は集計値で個人情報を含まない。mine はログイン本人の分だけ。
//
// 誰がどの問いに入れたかは question_interest にのみ残り、他人には返さない
// （合計と自分の分だけ。cq_votes＝0017 と同じ扱い）。
// blockId は Notion 原本の問い行（箇条書きブロック）のID。準備中の問いにはページが
// 無いため、ページIDではなくブロックIDで数える。オーナーはこの集計を見て
// 次に作るCQを決める（票の多い準備中の問いから着手する）。

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/server'
import { resolveRequestPremium } from '@/lib/premium-access'
import { rateLimitAsync } from '@/lib/rate-limit'
import { canonicalPageId } from '@/lib/reader-spread'

export const dynamic = 'force-dynamic'

// Notion のブロックID（ハイフン有無どちらも受け、ハイフンなし32桁へ正規化する）。
// 自由文字列を主キーに入れさせない（テーブルをゴミ箱にしない）ための関門。
function canonicalBlockId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim().replace(/-/g, '').toLowerCase()
  return /^[0-9a-f]{32}$/.test(t) ? t : null
}

const supabaseReady = () =>
  !!(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)

export async function POST(req: NextRequest) {
  if (!supabaseReady()) {
    return NextResponse.json({ error: 'サーバー設定が不足しています' }, { status: 500 })
  }

  const { premium, userId } = await resolveRequestPremium()
  if (!userId) return NextResponse.json({ error: 'login_required' }, { status: 401 })
  if (!premium) return NextResponse.json({ error: 'premium_required' }, { status: 403 })

  // 連打・スクリプトでの票の水増しを抑える（通常の利用は1記事で数回）。
  if (!(await rateLimitAsync(`question-interest:${userId}`, 120, 24 * 60 * 60_000))) {
    return NextResponse.json({ error: '操作が多すぎます。時間をおいてお試しください。' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'リクエストの形式が不正です。' }, { status: 400 })
  }
  const { blockId: rawBlock, pageId: rawPage, voted } = (body ?? {}) as {
    blockId?: unknown
    pageId?: unknown
    voted?: unknown
  }
  const blockId = canonicalBlockId(rawBlock)
  const pageId = typeof rawPage === 'string' ? canonicalPageId(rawPage) : ''
  if (!blockId || !/^[0-9a-f]{32}$/.test(pageId)) {
    return NextResponse.json({ error: '対象の問いが指定されていません。' }, { status: 400 })
  }

  try {
    const admin = createAdminClient()
    if (voted === true) {
      // 1人1票は primary key で担保。二重送信は上書きで無害に吸収する。
      await admin
        .from('question_interest')
        .upsert({ user_id: userId, block_id: blockId, page_id: pageId }, { onConflict: 'user_id,block_id' })
    } else {
      await admin.from('question_interest').delete().eq('user_id', userId).eq('block_id', blockId)
    }
    const { count } = await admin
      .from('question_interest')
      .select('block_id', { count: 'exact', head: true })
      .eq('block_id', blockId)
    return NextResponse.json({ ok: true, count: count ?? 0 })
  } catch {
    return NextResponse.json({ error: '記録できませんでした。時間をおいてお試しください。' }, { status: 500 })
  }
}

// 1リクエストで問い合わせる id の上限（1記事の問いは数十で収まる）。
const MAX_IDS = 100

export async function GET(req: NextRequest) {
  if (!supabaseReady()) return NextResponse.json({ counts: {}, mine: [] })

  try {
    const ids = (new URL(req.url).searchParams.get('ids') || '')
      .split(',')
      .map((s) => canonicalBlockId(s))
      .filter((s): s is string => !!s)
      .slice(0, MAX_IDS)
    if (ids.length === 0) return NextResponse.json({ counts: {}, mine: [] })

    const { userId } = await resolveRequestPremium()
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('question_interest')
      .select('block_id, user_id')
      .in('block_id', ids)
    if (error) throw new Error(error.message)

    const counts: Record<string, number> = {}
    const mine: string[] = []
    for (const row of data ?? []) {
      const b = row.block_id as string
      counts[b] = (counts[b] ?? 0) + 1
      if (userId && row.user_id === userId) mine.push(b)
    }
    return NextResponse.json({ counts, mine })
  } catch {
    return NextResponse.json({ counts: {}, mine: [] })
  }
}
