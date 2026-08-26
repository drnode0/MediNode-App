// アプリ内リーダーの「誌面」表示（TEXTBOOK LITE）のデータ模型。
// 設計: docs/superpowers/specs/2026-08-27-reader-spread-design.md
//
// 本文は必ず Notion原本由来の ReaderBlock をそのまま抱える（生成側が本文を書かない）。
// 表層の部品は原本のブロックから導出し、制作スキルからのオーバレイで上書きできる。
// ここは純関数だけに留めてテスト可能にする（描画は components/reader/spread 側）。
import {
  calloutRole,
  parseSectionHeading,
  sectionAnchor,
  type ReaderBlock,
  type ReaderDoc,
  type ReaderInline,
} from './reader-doc'

// 表層に出す部品。'none' は表層なし（深掘りだけ）を意味する。
export type SpreadPart =
  | { kind: 'comparison' | 'matrix'; rows: ReaderInline[][][] }
  | { kind: 'flow' | 'timeline'; steps: { label: string; inlines: ReaderInline[] }[] }
  | { kind: 'bignumber'; value: string; caption: ReaderInline[] }
  | { kind: 'gonogo'; go: ReaderInline[][]; noGo: ReaderInline[][] }
  | { kind: 'none' }

export type SpreadSection = {
  n: number | null
  anchor: string
  title: string
  shortLabel: string | null
  part: SpreadPart
  deep: ReaderBlock[]
}

export type SpreadQuiz = {
  id: string
  sectionAnchor: string
  question: string
  choices: string[]
  answerIndex: number
  // 根拠となる本文の逐語。原本と一致しなくなったら読者に出さない。
  evidence: string
  // オーナーの目視フラグ。false の間は読者に出さない。
  reviewed: boolean
}

export type SpreadDoc = {
  version: 1
  pageId: string
  title: string
  lead: ReaderBlock | null
  preface: ReaderBlock[]
  sections: SpreadSection[]
  tail: ReaderBlock[]
  quizzes: SpreadQuiz[]
  icons: Record<string, string>
}

// 制作スキルが渡すのはこれだけ。本文は渡さない（サーバーが原本から組む）。
export type SpreadOverlay = {
  shortLabels?: Record<string, string>
  parts?: Record<string, SpreadPart>
  icons?: Record<string, string>
  quizzes?: SpreadQuiz[]
}

export type SplitSection = { n: number | null; anchor: string; title: string; blocks: ReaderBlock[] }
export type SplitResult = {
  lead: ReaderBlock | null
  preface: ReaderBlock[]
  sections: SplitSection[]
  tail: ReaderBlock[]
}

export function textOf(inlines: ReaderInline[]): string {
  return inlines.map((i) => i.text).join('')
}

// 節に属さない末尾ブロック。署名・査読スタンプ・参考文献・免責は記事末にまとめる。
const TAIL_ROLES = new Set(['signature', 'stamp', 'evidence', 'disclaimer'])

function isTailBlock(b: ReaderBlock): boolean {
  return b.kind === 'callout' && TAIL_ROLES.has(calloutRole(b.icon))
}

/**
 * ReaderDoc を「⚡結論（lead）／H2前の本文（preface）／H2ごとの節／末尾（tail）」に切る。
 *
 * 節の区切りは既存の目次（tocSections）と同じ heading level 2。anchor は sectionAnchor が
 * 返した値そのもの（番号つき H2 なら "1"、"2" など。番号なし H2 なら "iN" 形式）。
 * 接頭辞は付けない。ReaderOverlay が querySelector で節番号と照合するため、接頭辞を付けると
 * 横断検索からの節ジャンプが無言で外れてしまう。
 */
export function splitSections(doc: ReaderDoc): SplitResult {
  let lead: ReaderBlock | null = null
  const preface: ReaderBlock[] = []
  const sections: SplitSection[] = []
  const tail: ReaderBlock[] = []
  let current: SplitSection | null = null

  doc.blocks.forEach((b, index) => {
    if (b.kind === 'callout' && calloutRole(b.icon) === 'conclusion' && !lead && !current) {
      lead = b
      return
    }
    if (isTailBlock(b)) {
      tail.push(b)
      return
    }
    if (b.kind === 'heading' && b.level === 2) {
      const title = textOf(b.inlines)
      const parsed = parseSectionHeading(b.inlines)
      // 接頭辞を付けないこと。ReaderOverlay が querySelector で節番号と照合するため、
      // 接頭辞を付けると横断検索からの節ジャンプが無言で外れる。
      const anchor = sectionAnchor(parsed?.n ?? null, index)
      current = { n: parsed?.n ?? null, anchor, title, blocks: [] }
      sections.push(current)
      return
    }
    if (current) current.blocks.push(b)
    else preface.push(b)
  })

  return { lead, preface, sections, tail }
}

const MIN_FLOW_STEPS = 3

/**
 * 節のブロックから表層部品を推定する。
 *
 * 推定は控えめにする。医学的な意味づけ（この表は分類マトリクスか比較表か等）は
 * 機械には決められないので、迷ったら 'none'（表層なし）に倒し、
 * 制作スキルのオーバレイで明示的に上書きしてもらう。
 */
export function classifyPart(blocks: ReaderBlock[]): SpreadPart {
  const table = blocks.find((b) => b.kind === 'table')
  if (table && table.kind === 'table') return { kind: 'comparison', rows: table.rows }

  const ordered = blocks.filter((b) => b.kind === 'list_item' && b.ordered)
  if (ordered.length >= MIN_FLOW_STEPS) {
    return {
      kind: 'flow',
      steps: ordered.map((b, i) => ({
        label: String(i + 1),
        inlines: b.kind === 'list_item' ? b.inlines : [],
      })),
    }
  }
  return { kind: 'none' }
}

/**
 * 原本の ReaderDoc から SpreadDoc の下書きを組む。
 * 本文（deep）は原本のブロックをそのまま持つので、この時点で逐語一致は保証される。
 */
export function buildSpreadDraft(doc: ReaderDoc, pageId: string): SpreadDoc {
  const split = splitSections(doc)
  return {
    version: 1,
    pageId,
    title: doc.title,
    lead: split.lead,
    preface: split.preface,
    sections: split.sections.map((s) => ({
      n: s.n,
      anchor: s.anchor,
      title: s.title,
      shortLabel: null,
      part: classifyPart(s.blocks),
      deep: s.blocks,
    })),
    tail: split.tail,
    quizzes: [],
    icons: {},
  }
}

// SpreadPart の既知の kind。SpreadPartView（描画側）が対応しているのはこれだけ。
const KNOWN_PART_KINDS = new Set<SpreadPart['kind']>(['comparison', 'matrix', 'flow', 'timeline', 'bignumber', 'gonogo', 'none'])

// part の中の ReaderInline から href だけを落とす（text/bold/italic/code/color は残す）。
function stripInlineHref(list: ReaderInline[]): ReaderInline[] {
  return list.map((i) => {
    if (!i.href) return i
    const { href: _href, ...rest } = i
    return rest
  })
}

// オーバレイ由来の part から出典リンクを落とす。part.kind ごとに ReaderInline の在り処が違うので分岐する。
function stripPartHref(part: SpreadPart): SpreadPart {
  switch (part.kind) {
    case 'comparison':
    case 'matrix':
      return { ...part, rows: part.rows.map((row) => row.map(stripInlineHref)) }
    case 'flow':
    case 'timeline':
      return { ...part, steps: part.steps.map((s) => ({ ...s, inlines: stripInlineHref(s.inlines) })) }
    case 'bignumber':
      return { ...part, caption: stripInlineHref(part.caption) }
    case 'gonogo':
      return { ...part, go: part.go.map(stripInlineHref), noGo: part.noGo.map(stripInlineHref) }
    case 'none':
      return part
  }
}

/**
 * 制作スキルから渡されたオーバレイを、SpreadDoc に重ねる前に正規化する。
 *
 * 1. part.kind を許可リストで検査する。未知の kind は SpreadPartView が描画できず
 *    黙って何も出ない表層になるため、投入時に弾く（そのアンカーの上書きを採用しない）。
 * 2. part 内の ReaderInline から href を落とす。表層の部品（比較表・フロー・go/no-go等）に
 *    出典リンクを載せない、という前提をコードで固定する。生成側はLLMなので、もっともらしい
 *    URLの捏造は起こりうる誤りであり、逐語一致検査（verifyVerbatim）はテキストしか見ないため
 *    href の捏造までは検出できない。
 *
 * ここで触れるのはオーバレイ由来の part（overlay.parts）だけ。classifyPart が原本の表や
 * 番号付きリストから自動で作る part（節の既定の part）には触れない。あちらは原本の
 * ReaderInline をそのまま使っており、原本にあるリンクは正当なので落とす理由がない。
 */
export function sanitizeOverlay(overlay: SpreadOverlay): SpreadOverlay {
  if (!overlay.parts) return overlay
  const parts: Record<string, SpreadPart> = {}
  for (const [anchor, part] of Object.entries(overlay.parts)) {
    if (!KNOWN_PART_KINDS.has(part.kind)) continue
    parts[anchor] = stripPartHref(part)
  }
  return { ...overlay, parts }
}

/**
 * 制作スキルからのオーバレイを下書きに重ねる。
 * 本文（deep / lead / preface / tail）には一切触れない。触れさせないことが安全装置になる。
 */
export function applyOverlay(draft: SpreadDoc, overlay: SpreadOverlay): SpreadDoc {
  return {
    ...draft,
    sections: draft.sections.map((s) => ({
      ...s,
      shortLabel: overlay.shortLabels?.[s.anchor] ?? s.shortLabel,
      part: overlay.parts?.[s.anchor] ?? s.part,
    })),
    icons: { ...draft.icons, ...(overlay.icons ?? {}) },
    quizzes: overlay.quizzes ?? draft.quizzes,
  }
}

// 部品と理解チェックが持つ「原本に由来するはずの文」を集める。
// 短ラベルは目次チップ用の呼び名で原本には無くてよいので、対象に入れない。
function verbatimTargets(spread: SpreadDoc): string[] {
  const out: string[] = []
  for (const s of spread.sections) {
    const p = s.part
    if (p.kind === 'comparison' || p.kind === 'matrix') {
      for (const row of p.rows) for (const cell of row) out.push(textOf(cell))
    } else if (p.kind === 'flow' || p.kind === 'timeline') {
      for (const step of p.steps) out.push(textOf(step.inlines))
    } else if (p.kind === 'bignumber') {
      out.push(p.value, textOf(p.caption))
    } else if (p.kind === 'gonogo') {
      for (const line of [...p.go, ...p.noGo]) out.push(textOf(line))
    }
  }
  for (const q of spread.quizzes) out.push(q.evidence)
  return out.map((s) => s.trim()).filter(Boolean)
}

// 原本の全文（ブロックを跨いだ連結ではなく、ブロックごとの文字列の集合）。
function corpusOf(doc: ReaderDoc): string {
  const parts: string[] = []
  const walk = (blocks: ReaderBlock[]) => {
    for (const b of blocks) {
      if (b.kind === 'heading' || b.kind === 'paragraph' || b.kind === 'list_item') parts.push(textOf(b.inlines))
      else if (b.kind === 'callout') walk(b.blocks)
      else if (b.kind === 'table') for (const row of b.rows) for (const cell of row) parts.push(textOf(cell))
      else if (b.kind === 'image' && b.caption) parts.push(b.caption)
    }
  }
  walk(doc.blocks)
  // 改行と連続空白の揺れを吸収する。文字を落とす正規化はしない（別物を同一視しないため）。
  return parts.join('\n').replace(/[ \t]+/g, ' ')
}

/**
 * 誌面が原本の逐語だけでできているかを検査する。
 * 落ちたら投入を拒否する。生成側が本文を書き換えたことを意味するため。
 */
export function verifyVerbatim(spread: SpreadDoc, doc: ReaderDoc): { ok: boolean; missing: string[] } {
  const corpus = corpusOf(doc)
  const missing = verbatimTargets(spread)
    .filter((s) => !corpus.includes(s.replace(/[ \t]+/g, ' ')))
  return { ok: missing.length === 0, missing }
}

/**
 * その節で読者に出してよい理解チェックだけを返す。
 *
 * 条件は2つとも必要。
 *  1. オーナーの目視を通っている（reviewed）
 *  2. 根拠の逐語が、その節の深掘り本文にそのまま含まれている
 * 原本が変わって根拠が消えた設問を、黙って出し続けないための関門。
 */
export function visibleQuizzes(spread: SpreadDoc, anchor: string): SpreadQuiz[] {
  const section = spread.sections.find((s) => s.anchor === anchor)
  if (!section) return []
  const corpus = corpusOf({ title: '', icon: null, cover: null, lastEdited: null, blocks: section.deep })
  return spread.quizzes.filter((q) => {
    if (q.sectionAnchor !== anchor || !q.reviewed) return false
    const evidence = q.evidence.trim()
    // 空文字は String.includes('') が常に true を返すため、検査をすり抜けて
    // 根拠のない設問を通してしまう。fail-closed で明示的に弾く。
    if (!evidence) return false
    return corpus.includes(evidence.replace(/[ \t]+/g, ' '))
  })
}
