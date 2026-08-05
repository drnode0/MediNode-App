// 葉から知識の本文へ戻る導線。初見レビューが「機能全体でいちばん惜しい」と指摘した点——
// 記録を見に来たのに、記録の中身に触れない——への答え。
//
// ⚠️ 台帳（Step）には何も足さない。検索レコードの objectID が `${owner}_${pageId}` 形式
// （notion/search/route.ts・sync/route.ts・subscription/sync/_core.ts が共通で採る）なので、
// 行き先は id だけで決まる。owner や URL を歩に持たせると、過去の歩には無い値ができて
// 「古い葉だけ本文へ行けない」という壊れ方をする。
//
// アプリ内リーダーはサブスク配信専用（/api/subscription/page が会員ゲート）。
// 個人・部署の知識は既存のカードと同じく Notion を開く。
export type LeafDestination =
  | { mode: 'reader'; objectID: string }
  | { mode: 'notion'; url: string }
  | { mode: 'none' }

const PAGE_ID = /^[0-9a-f]{32}$/i

// NotionのページidをURLにする。ダッシュ有無どちらの表記でも受ける。
// ページidに見えないものは空文字（＝導線を出さない）。
export function notionUrlFor(pageId: string): string {
  const flat = pageId.replace(/-/g, '')
  if (!PAGE_ID.test(flat)) return ''
  return `https://www.notion.so/${flat.toLowerCase()}`
}

export function leafDestination(id: string, subscriptionReady: boolean): LeafDestination {
  const m = /^(personal|team|subscription)_(.+)$/.exec(id)
  if (!m) return { mode: 'none' }
  // 節レコード（…#secN）は親ページに解決する。本文APIも同じ正規化をしている。
  const pageId = m[2].replace(/#.*$/, '').trim()
  const flat = pageId.replace(/-/g, '')
  if (!PAGE_ID.test(flat)) return { mode: 'none' }
  if (m[1] === 'subscription') {
    // プレミアムが無効なあいだは本文が取れない。Notionの原本も他人のDBなので開けない。
    return subscriptionReady ? { mode: 'reader', objectID: `subscription_${pageId}` } : { mode: 'none' }
  }
  return { mode: 'notion', url: notionUrlFor(pageId) }
}
