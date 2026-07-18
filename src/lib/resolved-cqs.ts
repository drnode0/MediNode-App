import {
  createSubscriptionSearchClient,
  getSubscriptionIndexName,
  hasSubscriptionConfig,
} from './algolia'

// ============================================================
// 解決済み臨床疑問（プレミアム限定）
// ------------------------------------------------------------
// 読者から投稿された臨床疑問のうち、作者がナレッジ化して公開したもの
// （サブスクDBで 由来=現場の疑問 のページ）を新しい順に取得する。
// 投稿者は実名を扱わず、職種（投稿者職種）とペンネーム（空なら匿名）のみ。
// 通知バナー（ResolvedCqBanner）と設定内の一覧（ResolvedCqHistory）で共用。
// ============================================================

export type ResolvedCq = {
  objectID: string
  title: string
  posterRole: string // Notion「投稿者職種」プロパティ。空なら職種を出さない
  posterName: string // Notion「ペンネーム」プロパティ。空なら「匿名さん」
  createdAt: string
  notionUrl: string
}

// 「匿名さん（看護師）」「〇〇さん（薬剤師）」のような表示名を作る。
export function posterLabel(cq: Pick<ResolvedCq, 'posterRole' | 'posterName'>): string {
  const name = cq.posterName ? `${cq.posterName}さん` : '匿名さん'
  return cq.posterRole ? `${name}（${cq.posterRole}）` : name
}

export function resolvedDateLabel(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })
}

export async function fetchResolvedCqs(limit = 100): Promise<ResolvedCq[]> {
  if (!hasSubscriptionConfig()) return []
  try {
    const res = await createSubscriptionSearchClient()
      .initIndex(getSubscriptionIndexName())
      .search('', {
        filters: 'origin:"現場の疑問"',
        hitsPerPage: limit,
        attributesToRetrieve: ['title', 'posterRole', 'posterName', 'createdAt', 'notionUrl'],
        attributesToHighlight: [],
      })
    return (res.hits as Array<Record<string, unknown>>)
      .map((h) => ({
        objectID: String(h.objectID || ''),
        title: String(h.title || ''),
        posterRole: String(h.posterRole || ''),
        posterName: String(h.posterName || ''),
        createdAt: String(h.createdAt || ''),
        notionUrl: String(h.notionUrl || ''),
      }))
      .filter((c) => c.title)
      // インデックスは lastEdited 順のため、通知は「公開された順」= createdAt で並べ直す
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  } catch {
    // origin が未facet（再同期前）やキー失効時は、通知を出さないだけで他機能へ波及させない
    return []
  }
}
