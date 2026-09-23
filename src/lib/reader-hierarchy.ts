import { isRecapText, type ReaderBlock } from './reader-doc'

// 作者が冒頭全体を太字にした段落を、表示上の枠で区別する。
// 結論かどうかを医学文言から推測せず、既存calloutや節本文には適用しない。
export function leadingEmphasisIndex(blocks: ReaderBlock[]): number | undefined {
  const index = blocks.findIndex((block) => block.kind !== 'paragraph' || block.inlines.some((inline) => inline.text.trim()))
  const block = blocks[index]
  if (!block || block.kind !== 'paragraph' || isRecapText(block.inlines.map((inline) => inline.text).join(''))) return undefined
  const text = block.inlines.filter((inline) => inline.text.trim())
  return text.length > 0 && text.every((inline) => inline.bold && !inline.code) ? index : undefined
}
