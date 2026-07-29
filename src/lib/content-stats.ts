// Notionページ本文の「充実度」統計（文字数・H2セクション数・見出しリスト）。
// サブスク同期（/api/subscription/sync/_core.ts）がAlgoliaレコードに載せ、
// 一覧カード（ResultCard）が「約N分・Mセクション」を表示するために使う。
// モニターFB「中にどれだけ入っているかが一覧から分からない」への対応。

export type NotionBlockLite = { type: string } & Record<string, unknown>

const MAX_HEADINGS = 5
// 日本語の平均読速の目安（600字/分）。医療文書はやや遅めに読む前提で控えめな値。
const CHARS_PER_MINUTE = 600

export function blockText(block: NotionBlockLite): string {
  const payload = block[block.type] as { rich_text?: Array<{ plain_text?: string }> } | undefined
  if (!payload || !Array.isArray(payload.rich_text)) return ''
  return payload.rich_text.map((t) => t.plain_text || '').join('')
}

export function computeContentStats(blocks: NotionBlockLite[]): {
  contentChars: number
  sectionCount: number
  headings: string[]
} {
  let contentChars = 0
  let sectionCount = 0
  const headings: string[] = []
  for (const block of blocks) {
    const text = blockText(block)
    contentChars += text.length
    if (block.type === 'heading_2') {
      sectionCount++
      if (headings.length < MAX_HEADINGS && text) headings.push(text)
    }
  }
  return { contentChars, sectionCount, headings }
}

export function readingMinutes(contentChars: number): number {
  if (contentChars <= 0) return 0
  return Math.max(1, Math.round(contentChars / CHARS_PER_MINUTE))
}
