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
  // blockType/blockId は個人・部署リーダーのプレースホルダ用（Notionのブロックアンカーを組む）。
  // サブスク側の既存キャッシュには無いキーなので、常に optional として扱うこと。
  | { kind: 'unsupported'; text: string; blockType?: string; blockId?: string }

export type ReaderDoc = {
  title: string
  icon: string | null
  cover: string | null
  lastEdited: string | null
  blocks: ReaderBlock[]
  // 「Notionで開く」逃げ道・プレースホルダのリンク先（個人・部署リーダーのみ設定）。
  // サブスク配信は本文防衛のため設定しない（undefined のまま）。
  sourceUrl?: string | null
}

// mapBlocks / mapBlocksToReaderDoc の挙動オプション。
// imageProxyBase: file画像・coverの安定プロキシの起点。既定はサブスク用
//   （/api/subscription/image）。個人・部署リーダーは /api/personal/image を渡す。
export type MapBlocksOptions = { imageProxyBase?: string }

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

// 画像URLの解決。Notionアップロード画像（type:'file'）の署名URLは約1hで失効するため、
// pageId/blockId が渡されていれば安定したプロキシ（既定 /api/subscription/image）URLに置き換える。
// プロキシが表示のたびに新しい署名URLを取り直すので、doc をキャッシュしても画像が切れない。
// external 画像は失効しないので直リンクのまま。proxyPath 未指定（テスト等）は従来どおり直リンク。
const DEFAULT_IMAGE_PROXY = '/api/subscription/image'

function imageUrlOf(node: any, proxyPath: string | null, proxyBase: string = DEFAULT_IMAGE_PROXY): string {
  if (!node) return ''
  if (node.type === 'external') return node.external?.url ?? ''
  if (node.type === 'file') {
    if (proxyPath) return `${proxyBase}?${proxyPath}`
    return node.file?.url ?? ''
  }
  return fileUrlOf(node) ?? ''
}

function plain(rich: RichText[] | undefined): string {
  return inlines(rich).map((i) => i.text).join('')
}

export function mapBlocks(blocks: RawBlock[], pageId?: string, opts?: MapBlocksOptions): ReaderBlock[] {
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
        body.push(...mapBlocks(b.children || [], pageId, opts))
        out.push({ kind: 'callout', icon: iconOf(b.callout?.icon), color: b.callout?.color ?? null, blocks: body })
        break
      }
      case 'image': {
        const proxyPath = pageId && b.id ? `id=${encodeURIComponent(pageId)}&b=${encodeURIComponent(String(b.id))}` : null
        out.push({ kind: 'image', url: imageUrlOf(b.image, proxyPath, opts?.imageProxyBase), caption: plain(b.image?.caption) || null }); break
      }
      case 'divider': out.push({ kind: 'divider' }); break
      case 'quote': out.push({ kind: 'paragraph', inlines: inlines(b.quote?.rich_text) }); break
      case 'table': {
        const rows = (b.children || [])
          .filter((r) => r.type === 'table_row')
          .map((r) => (r.table_row?.cells || []).map((cell: RichText[]) => inlines(cell)))
        out.push({ kind: 'table', rows }); break
      }
      default:
        out.push({ kind: 'unsupported', text: `[未対応ブロック: ${b.type}]`, blockType: b.type, blockId: b.id ? String(b.id) : undefined })
    }
    if (b.children?.length && b.type !== 'callout' && b.type !== 'table') {
      out.push(...mapBlocks(b.children, pageId, opts))
    }
  }
  return out
}

// リーダーが描画できるNotionブロックtype（mapBlocksのswitchと同期させること）。
// /adminのブロックタイプ分布で「未対応がどれだけ出るか」を分類する基準にも使う。
// table_row は table の子として描画されるためここに含める。
export const READER_SUPPORTED_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'heading_1', 'heading_2', 'heading_3',
  'paragraph', 'bulleted_list_item', 'numbered_list_item',
  'callout', 'image', 'divider', 'quote', 'table', 'table_row',
])

function titleOf(props: Record<string, any> | undefined): string {
  if (!props) return ''
  for (const p of Object.values(props)) {
    if (p?.type === 'title') return plain(p.title)
  }
  return ''
}

export function mapBlocksToReaderDoc(page: RawPage, blocks: RawBlock[], pageId?: string, opts?: MapBlocksOptions): ReaderDoc {
  return {
    title: titleOf(page.properties),
    icon: iconOf(page.icon),
    cover: imageUrlOf(page.cover, pageId ? `id=${encodeURIComponent(pageId)}&cover=1` : null, opts?.imageProxyBase),
    lastEdited: page.last_edited_time ?? null,
    blocks: mapBlocks(blocks, pageId, opts),
  }
}

// 未対応ブロックの量（降格判定用）。個人・部署リーダーが「このページはNotionの方が
// 読みやすそう」案内を出すかを決める。判定は自動・無言 —「あなたの書き方が悪い」という
// シグナルにならないよう、閾値は「一部欠けている」でなく「明らかに読みにくい」に置く。
export const DEGRADE_MIN_UNSUPPORTED = 3
export const DEGRADE_MIN_RATIO = 0.3

export function unsupportedStats(doc: ReaderDoc): { unsupported: number; total: number; degraded: boolean } {
  let unsupported = 0
  let total = 0
  const walk = (blocks: ReaderBlock[]) => {
    for (const b of blocks) {
      total++
      if (b.kind === 'unsupported') unsupported++
      if (b.kind === 'callout') walk(b.blocks)
    }
  }
  walk(doc.blocks)
  const degraded = total > 0 && unsupported >= DEGRADE_MIN_UNSUPPORTED && unsupported / total >= DEGRADE_MIN_RATIO
  return { unsupported, total, degraded }
}

export type CalloutRole = 'conclusion' | 'signature' | 'stamp' | 'evidence' | 'disclaimer' | 'note' | 'plain'

// アイコン絵文字は異体字セレクタ/ZWJ を含みうるため includes で判定する。
export function calloutRole(icon: string | null): CalloutRole {
  if (!icon) return 'plain'
  if (icon.includes('⚡')) return 'conclusion'
  if (icon.includes('⚕')) return 'signature' // 🧑‍⚕️
  if (icon.includes('🤖')) return 'stamp'
  if (icon.includes('📚')) return 'evidence'
  if (icon.includes('⚠')) return 'disclaimer'
  if (icon.includes('📝')) return 'note' // 「このページの背景」等のメモ枠
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
