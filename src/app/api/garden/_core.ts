import algoliasearch from 'algoliasearch'
import { timingSafeEqual } from 'crypto'

// 知の庭（chi-no-niwa）連携の共通コア。
// kind判定は知識レベル準拠（「解決済みCQ」という独立概念は存在しない・2026-07-29裁定）。

export type GardenKind = 'cq' | 'knowledge' | 'matome' | 'reference'

export interface GardenHit {
  objectID: string
  source?: string
  title?: string
  knowledgeLevel?: string
  createdAt?: string
  notionUrl?: string
  genre?: string[]
}

export function kindOf(hit: Pick<GardenHit, 'source' | 'knowledgeLevel'>): GardenKind {
  if (hit.source === 'reference') return 'reference'
  const level = hit.knowledgeLevel || ''
  if (level.includes('💡')) return 'knowledge'
  if (level.includes('📋')) return 'matome'
  return 'cq'
}

// 定数時間比較（タイミング攻撃対策）。env未設定なら一切通さない。
export function secretMatches(given: string | null, expected: string | undefined): boolean {
  if (!expected || !given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(a, b)
  } catch {
    return false
  }
}

// 庭以外のサイトからは読めないようにする（ブラウザのCORSで抑止）。
const ALLOWED_ORIGINS = new Set([
  'https://chi-no-niwa.vercel.app',
  'http://localhost:5173', // 庭のローカルプレビュー
])

export function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://chi-no-niwa.vercel.app'
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    // token/keyがURLに乗るため共有キャッシュ（s-maxage）は使わない
    'Cache-Control': 'private, max-age=300',
  }
}

// サブスクindexの親レコード全件。節レコードはrecordType:pageで除外。
export async function fetchGardenHits(): Promise<GardenHit[]> {
  const appId = process.env.SUBSCRIPTION_ALGOLIA_APP_ID
  const adminKey = process.env.SUBSCRIPTION_ALGOLIA_ADMIN_KEY
  // インデックス名は同期側（sync/_core.ts）・検索側（lib/algolia.ts）と一致させる。
  const indexName = process.env.SUBSCRIPTION_ALGOLIA_INDEX || 'Medical Knowledge_DB（サブスク用）'
  if (!appId || !adminKey) return []
  const res = await algoliasearch(appId, adminKey)
    .initIndex(indexName)
    .search<GardenHit>('', {
      filters: 'recordType:page',
      hitsPerPage: 1000,
      // Admin Keyはindex既定の取得制限が掛からないので、明示的に絞る（本文を漏らさない）
      attributesToRetrieve: ['objectID', 'source', 'title', 'knowledgeLevel', 'createdAt', 'notionUrl', 'genre'],
      attributesToHighlight: [],
    })
  return res.hits
}
