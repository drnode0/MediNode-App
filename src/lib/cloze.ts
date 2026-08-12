// 赤マーカー穴埋めの抽出ロジック（設計: docs/superpowers/specs/2026-08-12-quiz-cloze-design.md）。
// Notion blocks API の結果から red_background でマークされた箇所を伏せ字候補として抜き出す。
// 機械による推測は一切しない：マークのあるブロックだけを、直近の見出しを添えて返す。
// sync時（サブスク _core / 個人・部署 /api/sync）にも同じ関数を使う想定の純関数。

export type ClozeSegment = { text: string; hidden: boolean }
export type ClozeBlock = { heading: string | null; segments: ClozeSegment[] }
export type ClozeData = {
  blocks: ClozeBlock[]
  // 伏せ字の総数（カードの「穴埋め N問」チップに使う）
  blankCount: number
  // 上限打ち切りが起きたか（起きたら「本文を読む」誘導が受け皿）
  truncated: boolean
}

export const CLOZE_MARK_COLOR = 'red_background'
// 文書先頭から数えて、カードに載せるマーク付きブロックの上限（設計で確定）
export const CLOZE_MAX_BLOCKS = 3

// notion-body.ts の TEXT_BLOCK_TYPES と同族。ネスト（トグル内・カラム内）は対象外＝
// トップレベルのテキストブロックのみ見る。取れない場所は「出ない」だけで壊れない。
const TEXT_BLOCK_TYPES = [
  'paragraph',
  'bulleted_list_item',
  'numbered_list_item',
  'quote',
  'callout',
] as const

const HEADING_TYPES = ['heading_1', 'heading_2', 'heading_3'] as const

type RichText = { plain_text?: string; annotations?: { color?: string } }

function plainOf(rich: RichText[] | undefined): string {
  return (rich || []).map((t) => t.plain_text || '').join('')
}

// rich_text の連続runを hidden/visible の2値でまとめたセグメント列にする。
// 隣接する同種セグメントは結合する（Notionは装飾切替のたびにrunが割れるため）。
function segmentsOf(rich: RichText[]): ClozeSegment[] {
  const out: ClozeSegment[] = []
  for (const run of rich) {
    const text = run.plain_text || ''
    if (!text) continue
    const hidden = run.annotations?.color === CLOZE_MARK_COLOR
    const last = out[out.length - 1]
    if (last && last.hidden === hidden) last.text += text
    else out.push({ text, hidden })
  }
  return out
}

// ブロックに `children` 配列が添付されていれば（expandChildrenが付ける非標準キー）、
// その中も再帰的に見る。⚡結論ボックス等のcallout内マークは実際の原稿で多用されるため、
// トップレベル走査だけでは構造的に見えない（2026-08-12に本番で発生）。
// callout・トグルの子は、その枠の文言（例:「この問いへの答え」）を文脈ラベルとして継承する。
export function extractCloze(blocks: unknown[]): ClozeData | null {
  const picked: ClozeBlock[] = []
  let blankCount = 0
  let truncated = false

  const walk = (list: unknown[], inheritedHeading: string | null) => {
    let heading = inheritedHeading
    for (const block of list) {
      if (!block || typeof block !== 'object') continue
      const b = block as Record<string, unknown> & { children?: unknown[] }
      const type = b.type as string

      if (HEADING_TYPES.includes(type as (typeof HEADING_TYPES)[number])) {
        const payload = b[type] as { rich_text?: RichText[] } | undefined
        heading = plainOf(payload?.rich_text).trim() || null
        continue
      }

      const payload = b[type] as { rich_text?: RichText[] } | undefined
      if (TEXT_BLOCK_TYPES.includes(type as (typeof TEXT_BLOCK_TYPES)[number])) {
        const segments = segmentsOf(payload?.rich_text || [])
        const blanks = segments.filter((s) => s.hidden).length
        if (blanks > 0) {
          if (picked.length >= CLOZE_MAX_BLOCKS) {
            truncated = true
          } else {
            picked.push({ heading, segments })
            blankCount += blanks
          }
        }
      }

      if (Array.isArray(b.children) && b.children.length > 0) {
        const ownText =
          type === 'callout' || type === 'toggle' ? plainOf(payload?.rich_text).trim() : ''
        // 子スコープの見出しは漏れない（walkのローカル変数なので兄弟に影響しない）
        walk(b.children, ownText || heading)
      }
    }
  }

  walk(blocks, null)
  if (picked.length === 0) return null
  return { blocks: picked, blankCount, truncated }
}
