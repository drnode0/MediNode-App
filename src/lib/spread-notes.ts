// スプレッドノート（非公開DB）の取得。
//
// スプレッドの表層部品に使う圧縮文言（フローの補足行・Go/No-Goの短文など）は、
// サブスク原本のページに置けない。原本には公開リンク（notion.site）が付いており、
// ページ上のブロックはアプリが隠しても Notion を直接開く読者に見えるため。
//
// 代わりに、読者から見えない専用DB（環境変数 SUBSCRIPTION_SPREAD_NOTES_DB）に
// 記事ごとのノートページを置き、逐語一致検査の照合先を「原本＋ノート」に広げる。
// ノートページの特定は「タイトルに記事の pageId（ハイフンなし32桁）を含める」約束で行う。
//
// 見つからない・環境変数が無い・取得に失敗したときは null を返す。照合先が増えない
// だけなので、ノート由来の文言を使ったオーバレイは逐語検査で落ちる（fail-closed）。
import { fetchPageBlocks, type BlockLister } from './notion-page'
import { mapBlocks, pageTitleOf, type ReaderBlock } from './reader-doc'

// notion-page.ts の BlockLister と同じ流儀の構造型（テストで実クライアント無しに差し替えるため）。
export type NotesClient = BlockLister & {
  databases: {
    query: (a: { database_id: string; start_cursor?: string; page_size?: number }) => Promise<{
      results: unknown[]; has_more: boolean; next_cursor: string | null
    }>
  }
}

const MAX_NOTES_PAGES = 5 // 100件×5ページ。ノートDBがこれを超える運用は想定しない

export async function fetchSpreadNotesBlocks(notion: NotesClient, pageId: string): Promise<ReaderBlock[] | null> {
  const dbId = process.env.SUBSCRIPTION_SPREAD_NOTES_DB
  if (!dbId) return null
  const bare = pageId.replace(/-/g, '')
  try {
    let cursor: string | undefined
    let page = 0
    do {
      const res = await notion.databases.query({ database_id: dbId, start_cursor: cursor, page_size: 100 })
      for (const row of res.results as unknown as { id: string; properties?: Record<string, unknown> }[]) {
        const title = pageTitleOf(row.properties as Parameters<typeof pageTitleOf>[0]).replace(/-/g, '')
        if (!title.includes(bare)) continue
        const blocks = await fetchPageBlocks(notion, row.id)
        return mapBlocks(blocks)
      }
      page++
      cursor = res.has_more && page < MAX_NOTES_PAGES ? (res.next_cursor ?? undefined) : undefined
    } while (cursor)
    return null
  } catch {
    return null
  }
}
