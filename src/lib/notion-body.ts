// Notion blocks API の結果から本文冒頭の抜粋を作る。
// 要約列が空のページを索引するためのフォールバック（spec 1d）。

const TEXT_BLOCK_TYPES = [
  'paragraph',
  'heading_1',
  'heading_2',
  'heading_3',
  'bulleted_list_item',
  'numbered_list_item',
  'quote',
  'callout',
  'toggle',
] as const

export function extractBodyExcerpt(blocks: unknown[], maxLen = 300): string {
  const parts: string[] = []
  let total = 0
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const b = block as Record<string, unknown>
    const type = b.type as string
    if (!TEXT_BLOCK_TYPES.includes(type as (typeof TEXT_BLOCK_TYPES)[number])) continue
    const payload = b[type] as { rich_text?: Array<{ plain_text?: string }> } | undefined
    const text = (payload?.rich_text || [])
      .map((t) => t.plain_text || '')
      .join('')
      .trim()
    if (!text) continue
    parts.push(text)
    total += text.length
    if (total >= maxLen) break
  }
  return parts.join(' ').slice(0, maxLen)
}
