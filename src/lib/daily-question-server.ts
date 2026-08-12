// 「今日の1問」の出題選定（サーバー専用）。
// route.ts（カード）と cron/daily-push（通知）が“同じ1問”を出すための共有ロジック。
// ここを唯一の選定元にすることで、カードの問いと通知本文の問いがズレない。
import algoliasearch from 'algoliasearch'
import { isDailyQuestionCandidate, jstToday, pickDailyIndex } from './daily-question'
import type { ClozeData } from './cloze'

type PoolHit = {
  objectID: string
  title?: string
  aiSummary?: string
  summary?: string
  genre?: string | string[]
  knowledgeLevel?: string
  notionUrl?: string
  cloze?: ClozeData | null
}

export type DailyPick = {
  objectID: string
  title: string
  genre?: string | string[]
  knowledgeLevel?: string
  answer: string
  notionUrl?: string
  cloze?: ClozeData | null
}

// 今日の1問を決定的に1件選ぶ。Algolia未設定・取得失敗・候補ゼロなら null（呼び出し側でフォールバック）。
export async function pickTodaysDailyQuestion(): Promise<DailyPick | null> {
  const appId = process.env.SUBSCRIPTION_ALGOLIA_APP_ID
  const adminKey = process.env.SUBSCRIPTION_ALGOLIA_ADMIN_KEY
  const indexName = process.env.SUBSCRIPTION_ALGOLIA_INDEX || 'Medical Knowledge_DB（サブスク用）'
  if (!appId || !adminKey) return null

  try {
    const res = await algoliasearch(appId, adminKey)
      .initIndex(indexName)
      .search('', {
        hitsPerPage: 1000,
        attributesToRetrieve: ['title', 'aiSummary', 'summary', 'genre', 'knowledgeLevel', 'notionUrl', 'cloze'],
        attributesToHighlight: [],
      })

    // 決定的選定: 候補を objectID でソートしてから日付ハッシュで1件選ぶ
    // （Algoliaのランキング順は変動しうるため、並びを固定してから選ぶ）。
    const pool = (res.hits as PoolHit[])
      .filter(isDailyQuestionCandidate)
      .sort((a, b) => (a.objectID < b.objectID ? -1 : 1))
    const idx = pickDailyIndex(jstToday(), pool.length)
    if (idx < 0) return null
    const q = pool[idx]
    return {
      objectID: q.objectID,
      title: q.title || '',
      genre: q.genre,
      knowledgeLevel: q.knowledgeLevel,
      answer: q.aiSummary || q.summary || '',
      notionUrl: q.notionUrl,
      cloze: q.cloze ?? null,
    }
  } catch {
    return null
  }
}
