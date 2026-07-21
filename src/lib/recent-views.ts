// 「最近見た」の記録。結果カードからNotionページを開いた履歴を端末ローカルに残し、
// 検索タブの空状態（検索語なし）から再訪できるようにする。
// サーバー同期はしない（閲覧内容をサーバーに保存しない方針。quiz-srs と同じ扱い）。

export type RecentView = {
  objectID: string
  title: string
  notionUrl: string
  knowledgeLevel?: string
  owner?: string
  at: string // 開いた日時（ISO）
}

const KEY = 'medinode_recent_views_v1'
export const MAX_RECENT_VIEWS = 8

// 純関数：リストに1件追加。同じページは先頭へ引き上げ、上限超過は古い順に切り捨て。
export function pushRecentView(list: RecentView[], entry: RecentView): RecentView[] {
  return [entry, ...list.filter((v) => v.objectID !== entry.objectID)].slice(0, MAX_RECENT_VIEWS)
}

// 壊れた値（配列でないJSON・欠損フィールド）が入っていても落ちないよう検証する。
export function sanitizeRecentViews(raw: unknown): RecentView[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter(
      (v): v is RecentView =>
        !!v &&
        typeof v === 'object' &&
        typeof (v as RecentView).objectID === 'string' &&
        typeof (v as RecentView).title === 'string' &&
        typeof (v as RecentView).notionUrl === 'string',
    )
    .slice(0, MAX_RECENT_VIEWS)
}

export function loadRecentViews(): RecentView[] {
  try {
    return sanitizeRecentViews(JSON.parse(localStorage.getItem(KEY) || '[]'))
  } catch {
    return []
  }
}

// Notionリンクを開いた瞬間に呼ぶ。localStorage不可（プライベートブラウズ等）でも閲覧は妨げない。
export function recordRecentView(hit: {
  objectID: string
  title: string
  notionUrl: string
  knowledgeLevel?: string
  owner?: string
}) {
  try {
    const next = pushRecentView(loadRecentViews(), {
      objectID: hit.objectID,
      title: hit.title,
      notionUrl: hit.notionUrl,
      knowledgeLevel: hit.knowledgeLevel,
      owner: hit.owner,
      at: new Date().toISOString(),
    })
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {}
}

export function clearRecentViews() {
  try {
    localStorage.removeItem(KEY)
  } catch {}
}
