// 「今日の1問」API。
//   GET  /api/daily-question … 今日の1問を返す（全員同じ1問・決定的選定）。
//                              段階公開: off=返さない / preview=許可メールのみ / on=全員。
//                              深掘りリンク（notionUrl）はプレミアム有効セッションにのみ含める
//                              ＝「答えまで無料・深掘りのみ有料」の線引きをサーバー側で担保。
//   POST /api/daily-question … 管理者限定。段階（off/preview/on）を切り替える。
//
// フェイルセーフ: migration未適用・Algolia未設定・読取失敗はすべて { available:false }
// （カード非表示になるだけでアプリは通常どおり動く）。

import { NextRequest, NextResponse } from 'next/server'
import algoliasearch from 'algoliasearch'
import { createClient, createAdminClient } from '@/lib/supabase/server'
import { getActiveStatusByUserId } from '@/lib/supabase/subscriptions'
import { requireAdmin } from '@/lib/admin-guard'
import { isAdminEmail } from '@/lib/maintenance'
import {
  DAILY_QUESTION_FLAG_KEY,
  isDailyQuestionCandidate,
  isPreviewEmail,
  jstToday,
  parseStage,
  pickDailyIndex,
  readDailyQuestionStage,
  __resetDailyQuestionStageCache,
} from '@/lib/daily-question'

type PoolHit = {
  objectID: string
  title?: string
  aiSummary?: string
  summary?: string
  genre?: string | string[]
  knowledgeLevel?: string
  notionUrl?: string
}

export async function GET() {
  const stage = await readDailyQuestionStage()

  // セッション（未ログインでも動く）。preview判定とプレミアム判定に使う。
  let email: string | null = null
  let userId: string | null = null
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    email = user?.email ?? null
    userId = user?.id ?? null
  } catch {}

  // 管理者にはstageも返す（/admin/maintenance の切替カードが現状表示に使う）。
  const adminExtra = isAdminEmail(email) ? { stage } : {}

  if (stage === 'off') return NextResponse.json({ available: false, ...adminExtra })
  if (stage === 'preview' && !isPreviewEmail(email)) {
    return NextResponse.json({ available: false })
  }

  const appId = process.env.SUBSCRIPTION_ALGOLIA_APP_ID
  const adminKey = process.env.SUBSCRIPTION_ALGOLIA_ADMIN_KEY
  const indexName = process.env.SUBSCRIPTION_ALGOLIA_INDEX || 'Medical Knowledge_DB（サブスク用）'
  if (!appId || !adminKey) return NextResponse.json({ available: false, ...adminExtra })

  try {
    const res = await algoliasearch(appId, adminKey)
      .initIndex(indexName)
      .search('', {
        hitsPerPage: 1000,
        attributesToRetrieve: ['title', 'aiSummary', 'summary', 'genre', 'knowledgeLevel', 'notionUrl'],
        attributesToHighlight: [],
      })

    // 決定的選定: 候補を objectID でソートしてから日付ハッシュで1件選ぶ
    // （Algoliaのランキング順は変動しうるため、並びを固定してから選ぶ）。
    const pool = (res.hits as PoolHit[])
      .filter(isDailyQuestionCandidate)
      .sort((a, b) => (a.objectID < b.objectID ? -1 : 1))
    const date = jstToday()
    const idx = pickDailyIndex(date, pool.length)
    if (idx < 0) return NextResponse.json({ available: false, ...adminExtra })
    const q = pool[idx]

    // プレミアム判定（premium/status と同じ規則: COMP_ADMIN_EMAILS は無条件active）。
    let premium = false
    if (isAdminEmail(email)) premium = true
    else if (userId) {
      try {
        premium = (await getActiveStatusByUserId(userId)).active
      } catch {}
    }

    return NextResponse.json({
      available: true,
      date,
      question: {
        objectID: q.objectID,
        title: q.title || '',
        genre: q.genre,
        knowledgeLevel: q.knowledgeLevel,
      },
      answer: q.aiSummary || q.summary || '',
      ...(premium && q.notionUrl ? { notionUrl: q.notionUrl } : {}),
      premium,
      ...adminExtra,
    })
  } catch {
    return NextResponse.json({ available: false, ...adminExtra })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin()
  if (!auth.ok) return auth.response

  let body: { stage?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSONが不正です' }, { status: 400 })
  }
  if (body.stage !== 'off' && body.stage !== 'preview' && body.stage !== 'on') {
    return NextResponse.json(
      { error: 'stage は off / preview / on のいずれかで指定してください' },
      { status: 400 },
    )
  }
  const stage = parseStage(body.stage)

  try {
    const admin = createAdminClient()
    const { error } = await admin.from('app_flags').upsert(
      {
        key: DAILY_QUESTION_FLAG_KEY,
        value: stage !== 'off',
        stage,
        updated_at: new Date().toISOString(),
        updated_by: auth.email,
      },
      { onConflict: 'key' },
    )
    if (error) throw new Error(error.message)
    __resetDailyQuestionStageCache() // このインスタンスは次の読取で即最新化
    return NextResponse.json({ ok: true, stage })
  } catch (err) {
    const message = err instanceof Error ? err.message : '不明なエラー'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
