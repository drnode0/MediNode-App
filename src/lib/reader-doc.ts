// color は Notion の annotations.color（'red' / 'yellow_background' 等・default は省略）。
// 執筆側が付けた文字色・蛍光マーカーを読者にもそのまま届ける。
export type ReaderInline = { text: string; bold?: boolean; italic?: boolean; code?: boolean; href?: string; color?: string }

export type ReaderBlock =
  | { kind: 'heading'; level: 1 | 2 | 3; inlines: ReaderInline[] }
  | { kind: 'paragraph'; inlines: ReaderInline[] }
  | { kind: 'list_item'; ordered: boolean; inlines: ReaderInline[] }
  | { kind: 'callout'; icon: string | null; color: string | null; blocks: ReaderBlock[] }
  | { kind: 'image'; url: string; caption: string | null }
  | { kind: 'divider' }
  | { kind: 'table'; rows: ReaderInline[][][] }
  | { kind: 'unsupported'; text: string }

export type ReaderDoc = {
  title: string
  icon: string | null
  cover: string | null
  lastEdited: string | null
  blocks: ReaderBlock[]
}

type RichText = {
  plain_text?: string
  href?: string | null
  annotations?: { bold?: boolean; italic?: boolean; code?: boolean; color?: string }
  text?: { content?: string; link?: { url?: string } | null }
}
export type RawBlock = { type: string; has_children?: boolean; children?: RawBlock[] } & Record<string, any>
export type RawPage = { last_edited_time?: string; icon?: any; cover?: any; properties?: Record<string, any> }

function inlines(rich: RichText[] | undefined): ReaderInline[] {
  if (!Array.isArray(rich)) return []
  return rich.map((r) => {
    const text = r.plain_text ?? r.text?.content ?? ''
    const href = r.href ?? r.text?.link?.url ?? undefined
    const a = r.annotations ?? {}
    const out: ReaderInline = { text }
    if (a.bold) out.bold = true
    if (a.italic) out.italic = true
    if (a.code) out.code = true
    if (a.color && a.color !== 'default') out.color = a.color
    if (href) out.href = href
    return out
  })
}

function iconOf(icon: any): string | null {
  if (icon?.type === 'emoji') return icon.emoji ?? null
  if (icon?.type === 'external') return icon.external?.url ?? null
  if (icon?.type === 'file') return icon.file?.url ?? null
  return null
}

function fileUrlOf(node: any): string | null {
  if (!node) return null
  if (node.type === 'external') return node.external?.url ?? null
  if (node.type === 'file') return node.file?.url ?? null
  return node.external?.url ?? node.file?.url ?? null
}

function plain(rich: RichText[] | undefined): string {
  return inlines(rich).map((i) => i.text).join('')
}

export function mapBlocks(blocks: RawBlock[]): ReaderBlock[] {
  const out: ReaderBlock[] = []
  for (const b of blocks || []) {
    switch (b.type) {
      case 'heading_1': out.push({ kind: 'heading', level: 1, inlines: inlines(b.heading_1?.rich_text) }); break
      case 'heading_2': out.push({ kind: 'heading', level: 2, inlines: inlines(b.heading_2?.rich_text) }); break
      case 'heading_3': out.push({ kind: 'heading', level: 3, inlines: inlines(b.heading_3?.rich_text) }); break
      case 'paragraph': out.push({ kind: 'paragraph', inlines: inlines(b.paragraph?.rich_text) }); break
      case 'bulleted_list_item':
        out.push({ kind: 'list_item', ordered: false, inlines: inlines(b.bulleted_list_item?.rich_text) }); break
      case 'numbered_list_item':
        out.push({ kind: 'list_item', ordered: true, inlines: inlines(b.numbered_list_item?.rich_text) }); break
      case 'callout': {
        const body: ReaderBlock[] = []
        const rich = inlines(b.callout?.rich_text)
        if (rich.length) body.push({ kind: 'paragraph', inlines: rich })
        body.push(...mapBlocks(b.children || []))
        out.push({ kind: 'callout', icon: iconOf(b.callout?.icon), color: b.callout?.color ?? null, blocks: body })
        break
      }
      case 'image':
        out.push({ kind: 'image', url: fileUrlOf(b.image) ?? '', caption: plain(b.image?.caption) || null }); break
      case 'divider': out.push({ kind: 'divider' }); break
      case 'quote': out.push({ kind: 'paragraph', inlines: inlines(b.quote?.rich_text) }); break
      case 'table': {
        const rows = (b.children || [])
          .filter((r) => r.type === 'table_row')
          .map((r) => (r.table_row?.cells || []).map((cell: RichText[]) => inlines(cell)))
        out.push({ kind: 'table', rows }); break
      }
      default:
        out.push({ kind: 'unsupported', text: `[未対応ブロック: ${b.type}]` })
    }
    if (b.children?.length && b.type !== 'callout' && b.type !== 'table') {
      out.push(...mapBlocks(b.children))
    }
  }
  return out
}

function titleOf(props: Record<string, any> | undefined): string {
  if (!props) return ''
  for (const p of Object.values(props)) {
    if (p?.type === 'title') return plain(p.title)
  }
  return ''
}

export function mapBlocksToReaderDoc(page: RawPage, blocks: RawBlock[]): ReaderDoc {
  return {
    title: titleOf(page.properties),
    icon: iconOf(page.icon),
    cover: fileUrlOf(page.cover),
    lastEdited: page.last_edited_time ?? null,
    blocks: mapBlocks(blocks),
  }
}

export type CalloutRole = 'conclusion' | 'signature' | 'stamp' | 'evidence' | 'disclaimer' | 'plain'

// アイコン絵文字は異体字セレクタ/ZWJ を含みうるため includes で判定する。
export function calloutRole(icon: string | null): CalloutRole {
  if (!icon) return 'plain'
  if (icon.includes('⚡')) return 'conclusion'
  if (icon.includes('⚕')) return 'signature' // 🧑‍⚕️
  if (icon.includes('🤖')) return 'stamp'
  if (icon.includes('📚')) return 'evidence'
  if (icon.includes('⚠')) return 'disclaimer'
  return 'plain'
}

export function findTldr(doc: ReaderDoc): (ReaderBlock & { kind: 'callout' }) | null {
  for (const b of doc.blocks) {
    if (b.kind === 'callout' && calloutRole(b.icon) === 'conclusion') return b
  }
  return null
}

export function parseSectionHeading(inlines: ReaderInline[]): { n: number; rest: string } | null {
  const text = inlines.map((i) => i.text).join('').trim()
  const m = text.match(/^(\d+)\.\s*(.+)$/)
  if (!m) return null
  return { n: Number(m[1]), rest: m[2].trim() }
}

export function sectionAnchor(n: number | null, index: number): string {
  return n != null ? String(n) : `i${index}`
}

export function tocSections(doc: ReaderDoc): { n: number | null; title: string; index: number; anchor: string }[] {
  const out: { n: number | null; title: string; index: number; anchor: string }[] = []
  doc.blocks.forEach((b, index) => {
    if (b.kind === 'heading' && b.level === 2) {
      const p = parseSectionHeading(b.inlines)
      const n = p ? p.n : null
      const title = p ? p.rest : b.inlines.map((i) => i.text).join('').trim()
      out.push({ n, title, index, anchor: sectionAnchor(n, index) })
    }
  })
  return out
}

export function isRecapText(text: string): boolean {
  return /^\s*→/.test(text)
}
