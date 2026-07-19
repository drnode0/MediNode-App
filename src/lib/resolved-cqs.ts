import {
  createSubscriptionSearchClient,
  getSubscriptionIndexName,
  hasSubscriptionConfig,
} from './algolia'

// ============================================================
// 解決済み臨床疑問
// ------------------------------------------------------------
// 読者から投稿された臨床疑問のうち、作者がナレッジ化して公開したもの
// （サブスクDBで 由来=現場の疑問 のページ）を新しい順に取得する。
// 投稿者は実名を扱わず、職種（投稿者職種）とペンネーム（空なら匿名）のみ。
// 通知バナー（ResolvedCqBanner）と設定内の一覧（ResolvedCqHistory）で共用。
// 一覧は非プレミアムにも公開する（解決の実績とペースを見せて購買動機に
// つなげる）が、非プレミアムはプレミアム検索キーを持たないため公開ティーザー
// API（/api/resolved-cqs）経由で取得し、notionUrl（本文リンク）は渡さない。
// ============================================================

// 既読水位（最後に確認した createdAt）。ResolvedCqBanner が更新し、
// author-additions.ts が「CQバナーが出る起動か」の判定（ダイジェスト抑制）にも読む。
export const RESOLVED_CQ_SEEN_KEY = 'medinode_resolved_cq_seen_v1'

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

function toResolvedCqs(hits: Array<Record<string, unknown>>): ResolvedCq[] {
  return hits
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
}

export async function fetchResolvedCqs(limit = 100): Promise<ResolvedCq[]> {
  try {
    // プレミアム会員は手元のキーで直接Algoliaへ（notionUrl＝本文リンク付き）
    if (hasSubscriptionConfig()) {
      const res = await createSubscriptionSearchClient()
        .initIndex(getSubscriptionIndexName())
        .search('', {
          filters: 'origin:"現場の疑問"',
          hitsPerPage: limit,
          attributesToRetrieve: ['title', 'posterRole', 'posterName', 'createdAt', 'notionUrl'],
          attributesToHighlight: [],
        })
      return toResolvedCqs(res.hits as Array<Record<string, unknown>>)
    }
    // 非プレミアムは公開ティーザーAPI経由（notionUrlなし）
    const res = await fetch('/api/resolved-cqs')
    if (!res.ok) return []
    const data = (await res.json()) as { items?: Array<Record<string, unknown>> }
    return toResolvedCqs(data.items || []).slice(0, limit)
  } catch {
    // origin が未facet（再同期前）やキー失効時は、一覧が空になるだけで他機能へ波及させない
    return []
  }
}
