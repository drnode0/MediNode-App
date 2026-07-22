import type { ReaderBlock, ReaderInline } from './reader-doc'

export type Confidence = 'ok' | 'caut' | 'unk'
export const CONFIDENCE_MARKS: Record<Confidence, string> = { ok: '✅', caut: '⚠️', unk: '❓' }
export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  ok: '確立', caut: '諸説あり・施設差', unk: '不明確',
}
const ORDER: Confidence[] = ['ok', 'caut', 'unk']

function textOf(inlines: ReaderInline[]): string {
  return inlines.map((i) => i.text).join('')
}

// U+FE0F（VARIATION SELECTOR-16）を除去する。⚠️ が本文へ渡る過程で選択子が
// 落ち、裸の U+26A0 になるケースがあるため、比較前に両辺から正規化して吸収する。
function stripVariationSelector(s: string): string {
  return s.replace(/️/g, '')
}

// 本文行（paragraph / list_item）が含む確信度マーク。順序は ok,caut,unk。
// マーク判定は VARIATION SELECTOR-16 の有無に依存しない（安全要件：⚠️ が裸の
// U+26A0 として届いても必ず 'caut' として検出できること）。
export function blockConfidence(block: ReaderBlock): Confidence[] {
  if (block.kind !== 'paragraph' && block.kind !== 'list_item') return []
  const t = stripVariationSelector(textOf(block.inlines))
  return ORDER.filter((c) => t.includes(stripVariationSelector(CONFIDENCE_MARKS[c])))
}

export function docConfidenceMarks(blocks: ReaderBlock[]): Confidence[] {
  const present = new Set<Confidence>()
  for (const b of blocks) blockConfidence(b).forEach((c) => present.add(c))
  return ORDER.filter((c) => present.has(c))
}

// 淡色化するか。構造ブロックと ⚠️/❓ 行は常に保護。✅行は ok が active に無ければ淡色化。
// 無マーク/recap 行は active が非空なら淡色化。
export function isDimmed(block: ReaderBlock, active: Set<Confidence>): boolean {
  if (active.size === 0) return false
  if (block.kind !== 'paragraph' && block.kind !== 'list_item') return false
  const marks = blockConfidence(block)
  if (marks.includes('caut') || marks.includes('unk')) return false
  const hit = marks.some((m) => active.has(m))
  return !hit
}
