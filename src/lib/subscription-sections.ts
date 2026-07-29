// サブスク同期の「節レコード」化（横断本文検索用）。
// 本文を「N. 」形式のH2で節に切り、Algoliaのレコード上限に収まるようbyte上限で分割する。
import { blockText, type NotionBlockLite } from './content-stats'

export type SectionChunk = { sectionNo: number; sectionTitle: string; part: number; text: string }

// Algoliaレコードは~10KB上限。親から引き継ぐ属性ぶんの余白を残して本文は7500バイトまで。
export const SECTION_MAX_BYTES = 7500

function byteLen(s: string): number {
  return new TextEncoder().encode(s).length
}

// byte上限を超えるテキストを「。」区切りの文単位で詰め直す（1文が上限超なら強制分割）。
function splitByBytes(text: string): string[] {
  if (byteLen(text) <= SECTION_MAX_BYTES) return [text]
  const sentences = text.split(/(?<=。)/)
  const out: string[] = []
  let buf = ''
  for (let s of sentences) {
    while (byteLen(s) > SECTION_MAX_BYTES) {
      // 1文が上限超の異常ケース: 文字単位で上限まで切り出す
      let cut = ''
      for (const ch of s) {
        if (byteLen(cut + ch) > SECTION_MAX_BYTES) break
        cut += ch
      }
      if (buf) { out.push(buf); buf = '' }
      out.push(cut)
      s = s.slice(cut.length)
    }
    if (byteLen(buf + s) > SECTION_MAX_BYTES) { out.push(buf); buf = s }
    else buf += s
  }
  if (buf.trim()) out.push(buf)
  return out
}

const SECTION_HEAD_RE = /^(\d+)\.\s*(.*)$/

// トップレベルブロック列を節に分割する。境界は「N. 」形式のheading_2のみ。
// 最初の境界より前（⚡結論・署名・大前提）は sec0。節見出しテキストも本文に含める。
export function splitIntoSections(blocks: NotionBlockLite[]): SectionChunk[] {
  type Acc = { sectionNo: number; sectionTitle: string; texts: string[] }
  const accs: Acc[] = []
  let cur: Acc | null = null
  for (const block of blocks) {
    const text = blockText(block)
    const m = block.type === 'heading_2' ? text.trim().match(SECTION_HEAD_RE) : null
    if (m) {
      cur = { sectionNo: Number(m[1]), sectionTitle: m[2].trim(), texts: [text] }
      accs.push(cur)
      continue
    }
    if (!cur) {
      cur = { sectionNo: 0, sectionTitle: '', texts: [] }
      accs.push(cur)
    }
    if (text) cur.texts.push(text)
  }
  const out: SectionChunk[] = []
  for (const acc of accs) {
    const joined = acc.texts.join('\n').trim()
    if (!joined) continue
    splitByBytes(joined).forEach((part, i) => {
      out.push({ sectionNo: acc.sectionNo, sectionTitle: acc.sectionTitle, part: i, text: part })
    })
  }
  return out
}

// 節チャンク→Algolia子レコード。親の属性（title/genre/source/owner/要約等）をそのまま引き継ぎ、
// distinct(parentId) 集約とタブ側フィルタ（source/genre等）の整合をとる。
export function buildSectionRecords(
  parent: Record<string, unknown>,
  chunks: SectionChunk[],
): Record<string, unknown>[] {
  const parentID = String(parent.objectID)
  return chunks
    .filter((c) => c.text.trim())
    .map((c) => ({
      ...parent,
      objectID: `${parentID}#sec${c.sectionNo}${c.part > 0 ? `-${c.part}` : ''}`,
      parentId: parentID,
      isParent: 0,
      recordType: 'section',
      sectionNo: c.sectionNo,
      sectionTitle: c.sectionTitle,
      sectionText: c.text,
    }))
}

// Notionのrelationプロパティ→ページID配列（25件超のhas_moreは追わない: ナレッジの文献数は十数件想定）。
export function extractRelationIds(prop: Record<string, unknown>): string[] {
  if (!prop || (prop as { type?: string }).type !== 'relation') return []
  return (((prop as { relation?: Array<{ id: string }> }).relation) || []).map((r) => r.id)
}
