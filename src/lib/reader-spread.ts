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
import { stripLeadingEmoji } from './labels'

// 表層に出す部品。'none' は表層なし（深掘りだけ）を意味する。
export type SpreadPart =
  | { kind: 'comparison' | 'matrix'; rows: ReaderInline[][][] }
  // intro はフロー全体の前提条件（「高CO₂血症リスクなしで SpO₂ 85%以上」等）、
  // note は各ステップに添える小さな補足行。どちらも医学的内容なので逐語一致検査の対象
  // （label だけが表示上の命名＝対象外）。旧 SpreadDoc には無いキーなので optional。
  // dose は流量など「大きく出す数値」（パイロットの .flow-dev .dose）。医学的内容なので
  // intro / note と同じく逐語一致検査の対象で、label だけが表示上の命名＝対象外。
  | { kind: 'flow' | 'timeline'; steps: { label: string; inlines: ReaderInline[]; dose?: ReaderInline[]; note?: ReaderInline[] }[]; intro?: ReaderInline[] }
  | { kind: 'bignumber'; value: string; caption: ReaderInline[] }
  // 2枚組の比較カード（パイロット誌面の節5 COT vs HFNC）。title はカードの呼び名
  // （命名＝検査対象外）、lines は逐語一致検査の対象。primary は主役側のカードで、
  // 見出し帯を塗る（パイロットの .vs-col.hero）。表示上の指定なので検査の対象外。
  | { kind: 'cards'; cards: { title: string; lines: ReaderInline[][]; primary?: boolean }[] }
  // 表層の補足ノート（パイロット誌面の「高流量か低流量かの線引きは…」等）。逐語一致検査の対象。
  | { kind: 'note'; inlines: ReaderInline[] }
  // goLabel / noGoLabel は枠の見出し（既定は「こうする」「こうしない」）。
  // 節6のように「NIVを選ぶ／侵襲的人工呼吸への移行を判断する」の対では、既定ラベルだと
  // 「こうしない」が誤読になる（移行の判断は禁止事項ではない）ため、オーバレイで名前を渡せる。
  // shortLabel と同じ表示上の呼び名なので、逐語一致検査の対象にはしない。
  | { kind: 'gonogo'; go: ReaderInline[][]; noGo: ReaderInline[][]; goLabel?: string; noGoLabel?: string }
  // 実測値の帯グラフ（パイロット誌面の死亡率ゲージ）。value は本文中の数値の逐語、
  // label はその値の条件（SpO₂帯など）で、どちらも逐語一致検査の対象。
  // 帯の長さは表示側が value から導く。title は図の呼び名（shortLabel と同じ表示上の
  // 命名＝検査の対象外。主張や数値は title に書かず、value / label に逐語で置くこと）。
  // warn は「悪い側の値」を琥珀で示す表示フラグ。
  | { kind: 'gauge'; title?: string; items: { value: string; label: ReaderInline[]; warn?: boolean }[] }
  | { kind: 'none' }

export type SpreadSection = {
  n: number | null
  anchor: string
  title: string
  shortLabel: string | null
  part: SpreadPart
  // 主役部品（part）に添える追加の部品。パイロット誌面の節1が「比較表＋死亡率ゲージ」の
  // 2枚構成だったように、1節に複数の表層を置きたいときにオーバレイで渡す。
  // 逐語一致検査は part と同じ扱い。保存済みの旧 SpreadDoc には無いキーなので optional。
  extraParts?: SpreadPart[]
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

// 「いまの状況から探す」の入口チップ。label は状況の呼び名（表示上の命名＝逐語検査の
// 対象外）、anchor は飛び先の節。存在しない節を指す入口は applyOverlay で捨てる。
export type SpreadEntry = { label: string; anchor: string }

export type SpreadDoc = {
  version: 1
  pageId: string
  title: string
  lead: ReaderBlock | null
  preface: ReaderBlock[]
  // 状況からの入口（パイロット誌面の「いまの状況から探す」）。旧 SpreadDoc には無いキー。
  entries?: SpreadEntry[]
  sections: SpreadSection[]
  tail: ReaderBlock[]
  quizzes: SpreadQuiz[]
  icons: Record<string, string>
}

// 制作スキルが渡すのはこれだけ。本文は渡さない（サーバーが原本から組む）。
export type SpreadOverlay = {
  shortLabels?: Record<string, string>
  parts?: Record<string, SpreadPart>
  extraParts?: Record<string, SpreadPart[]>
  entries?: SpreadEntry[]
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
  // 最後の節より後ろに入った領域（`# Evidence` 以降）にいるか。
  let afterSections = false

  doc.blocks.forEach((b, index) => {
    if (b.kind === 'callout' && calloutRole(b.icon) === 'conclusion' && !lead && !current && !afterSections) {
      lead = b
      return
    }
    if (isTailBlock(b)) {
      tail.push(b)
      return
    }
    // 節が始まったあとの level 1 見出し（`# Evidence` など）は、その節を閉じて以降を記事末へ送る。
    // これが無いと、📚callout だけが tail に拾われ、その下に続く参考文献の箇条書きと
    // PubMed検索例が「最後の節の深掘り」に飲み込まれる（畳まれた中に文献一覧が隠れる）。
    // 節より前の `# Question` `# Answer` は sections.length === 0 なのでここを通らない。
    if (b.kind === 'heading' && b.level === 1 && sections.length > 0) {
      current = null
      afterSections = true
      tail.push(b)
      return
    }
    if (afterSections) {
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
const KNOWN_PART_KINDS = new Set<SpreadPart['kind']>(['comparison', 'matrix', 'flow', 'timeline', 'bignumber', 'gonogo', 'gauge', 'cards', 'note', 'none'])

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
      return {
        ...part,
        ...(part.intro ? { intro: stripInlineHref(part.intro) } : {}),
        steps: part.steps.map((s) => ({
          ...s,
          inlines: stripInlineHref(s.inlines),
          ...(s.dose ? { dose: stripInlineHref(s.dose) } : {}),
          ...(s.note ? { note: stripInlineHref(s.note) } : {}),
        })),
      }
    case 'bignumber':
      return { ...part, caption: stripInlineHref(part.caption) }
    case 'gonogo':
      return { ...part, go: part.go.map(stripInlineHref), noGo: part.noGo.map(stripInlineHref) }
    case 'gauge':
      return { ...part, items: part.items.map((it) => ({ ...it, label: stripInlineHref(it.label) })) }
    case 'cards':
      return { ...part, cards: part.cards.map((c) => ({ ...c, lines: c.lines.map(stripInlineHref) })) }
    case 'note':
      return { ...part, inlines: stripInlineHref(part.inlines) }
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
  const out = { ...overlay }
  if (overlay.parts) {
    const parts: Record<string, SpreadPart> = {}
    for (const [anchor, part] of Object.entries(overlay.parts)) {
      if (!KNOWN_PART_KINDS.has(part.kind)) continue
      parts[anchor] = stripPartHref(part)
    }
    out.parts = parts
  }
  // 追加部品（extraParts）も主役部品と同じ関門を通す。
  if (overlay.extraParts) {
    const extra: Record<string, SpreadPart[]> = {}
    for (const [anchor, list] of Object.entries(overlay.extraParts)) {
      extra[anchor] = list.filter((p) => KNOWN_PART_KINDS.has(p.kind)).map(stripPartHref)
    }
    out.extraParts = extra
  }
  // 入口チップは label / anchor が空のものを捨てる（存在しない節の除外は applyOverlay で行う。
  // 節構成を知っているのは下書き側のため）。
  if (overlay.entries) {
    out.entries = overlay.entries.filter((e) => e.label?.trim() && e.anchor?.trim())
  }
  return out
}

/**
 * 制作スキルからのオーバレイを下書きに重ねる。
 * 本文（deep / lead / preface / tail）には一切触れない。触れさせないことが安全装置になる。
 */
export function applyOverlay(draft: SpreadDoc, overlay: SpreadOverlay): SpreadDoc {
  const anchors = new Set(draft.sections.map((s) => s.anchor))
  return {
    ...draft,
    sections: draft.sections.map((s) => ({
      ...s,
      shortLabel: overlay.shortLabels?.[s.anchor] ?? s.shortLabel,
      part: overlay.parts?.[s.anchor] ?? s.part,
      extraParts: overlay.extraParts?.[s.anchor] ?? s.extraParts,
    })),
    // 存在しない節を指す入口は黙って捨てる（押しても飛ばないチップを読者に出さない）。
    entries: (overlay.entries ?? draft.entries ?? []).filter((e) => anchors.has(e.anchor)),
    icons: { ...draft.icons, ...(overlay.icons ?? {}) },
    quizzes: overlay.quizzes ?? draft.quizzes,
  }
}

// 部品と理解チェックが持つ「原本に由来するはずの文」を集める。
// 短ラベルは目次チップ用の呼び名で原本には無くてよいので、対象に入れない。
function verbatimTargets(spread: SpreadDoc): string[] {
  const out: string[] = []
  const collect = (p: SpreadPart) => {
    if (p.kind === 'comparison' || p.kind === 'matrix') {
      for (const row of p.rows) for (const cell of row) out.push(textOf(cell))
    } else if (p.kind === 'flow' || p.kind === 'timeline') {
      if (p.intro) out.push(textOf(p.intro))
      for (const step of p.steps) {
        out.push(textOf(step.inlines))
        if (step.dose) out.push(textOf(step.dose))
        if (step.note) out.push(textOf(step.note))
      }
    } else if (p.kind === 'cards') {
      // title はカードの呼び名（命名）なので対象に入れない。
      for (const c of p.cards) for (const line of c.lines) out.push(textOf(line))
    } else if (p.kind === 'note') {
      out.push(textOf(p.inlines))
    } else if (p.kind === 'bignumber') {
      out.push(p.value, textOf(p.caption))
    } else if (p.kind === 'gonogo') {
      // goLabel / noGoLabel は枠の見出し（表示上の命名）なので対象に入れない。
      for (const line of [...p.go, ...p.noGo]) out.push(textOf(line))
    } else if (p.kind === 'gauge') {
      // title は図の呼び名（命名）なので対象に入れない。数値と条件は逐語で検査する。
      for (const it of p.items) out.push(it.value, textOf(it.label))
    }
  }
  for (const s of spread.sections) {
    collect(s.part)
    for (const p of s.extraParts ?? []) collect(p)
  }
  for (const q of spread.quizzes) out.push(q.evidence)
  return out.map((s) => s.trim()).filter(Boolean)
}

// ブロック列の全文（ブロックを跨いだ連結ではなく、ブロックごとの文字列の集合）。
function corpusOfBlocks(blocks: ReaderBlock[]): string {
  const parts: string[] = []
  const walk = (list: ReaderBlock[]) => {
    for (const b of list) {
      if (b.kind === 'heading' || b.kind === 'paragraph' || b.kind === 'list_item') parts.push(textOf(b.inlines))
      else if (b.kind === 'callout') walk(b.blocks)
      else if (b.kind === 'table') for (const row of b.rows) for (const cell of row) parts.push(textOf(cell))
      else if (b.kind === 'image' && b.caption) parts.push(b.caption)
    }
  }
  walk(blocks)
  // 改行と連続空白の揺れを吸収する。文字を落とす正規化はしない（別物を同一視しないため）。
  return parts.join('\n').replace(/[ \t]+/g, ' ')
}

function corpusOf(doc: ReaderDoc): string {
  return corpusOfBlocks(doc.blocks)
}

/**
 * 誌面が「原本＋誌面ノート」の逐語だけでできているかを検査する。
 * 落ちたら投入を拒否する。生成側が本文を書き換えたことを意味するため。
 *
 * notes は非公開の誌面ノートページ（src/lib/spread-notes.ts）のブロック。
 * 圧縮文言は公開ページに置けない（公開リンクで読者に見える）ため、照合先だけを
 * ノートに広げる。渡されなければ従来どおり原本だけで検査する（fail-closed）。
 */
export function verifyVerbatim(spread: SpreadDoc, doc: ReaderDoc, notes?: ReaderBlock[] | null): { ok: boolean; missing: string[] } {
  const corpus = notes && notes.length > 0 ? `${corpusOf(doc)}\n${corpusOfBlocks(notes)}` : corpusOf(doc)
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

// ---- 表示専用のビュー導出 ----
// ここから下は描画のための導出だけを行い、保存された SpreadDoc には一切触れない。
// visibleQuizzes の逐語照合や verifyVerbatim は保存形（section.deep の全ブロック）に
// 対して働くので、深掘りから見た目上ブロックを除くのは描画の直前でだけ行う。

function rowsText(rows: ReaderInline[][][]): string {
  return rows.map((row) => row.map((cell) => textOf(cell)).join('\t')).join('\n')
}

export type SectionDisplay = {
  // 節末の「→」段落。表層の「この節の答え」ボックスへ昇格する（パイロット誌面の recap）。
  recap: ReaderBlock | null
  // 表層へ昇格したブロック（recap・比較表の元テーブル）を除いた深掘り本文。
  deep: ReaderBlock[]
}

/**
 * 節の深掘りから、表層へ昇格させるブロックを取り分ける。
 *
 * 1. part が comparison / matrix で、深掘りの中に同じ中身の表があれば、その表を深掘りから
 *    除く（原本の表ブロックが classifyPart で表層に昇格した場合の二重表示を消す）。
 *    照合は行×セルのテキスト一致。JSON往復で参照が切れるため参照比較にはしない。
 *    オーバレイ由来の part で一致する表が無ければ何も除かない。
 * 2. 深掘り末尾側の「→」で始まる段落（最後の1つ）を recap として抜く。
 *    どちらも中身は表層に必ず表示されるので、読者から見える本文は失われない。
 */
// cards へ昇格しきった表かの判定。ヘッダ行と先頭列（行ラベル）はカードの構造
// （タイトルと条目の並び）が引き受けるので対象外。それ以外の本文セルが
// 「カードに載っている」か「空・ダッシュの飾りセル」だけで構成されるときに限り
// 昇格済みとみなす。部分集合の一致で除くと、カードに載らなかったセルが
// 誌面のどこにも出なくなる（本文の静かな欠落）ため、向きはこちらで固定する。
function tableCoveredByCards(rows: ReaderInline[][][], covered: Set<string>): boolean {
  const body = rows.slice(1).flatMap((row) => row.slice(1)).map((cell) => textOf(cell).trim())
  if (!body.some((t) => covered.has(t))) return false
  return body.every((t) => t === '' || t === '—' || t === '-' || covered.has(t))
}

export function sectionDisplay(section: SpreadSection): SectionDisplay {
  let deep = section.deep
  const part = section.part
  // 表層へ昇格した表を深掘りから除く（中身は表層に必ず表示されることが前提の除去）。
  const dropTable = (matches: (rows: ReaderInline[][][]) => boolean) => {
    const idx = deep.findIndex((b) => b.kind === 'table' && matches(b.rows))
    if (idx >= 0) deep = deep.filter((_, i) => i !== idx)
  }
  if (part.kind === 'comparison' || part.kind === 'matrix') {
    const promoted = rowsText(part.rows)
    dropTable((rows) => rowsText(rows) === promoted)
  }
  if (part.kind === 'cards') {
    const covered = new Set(
      [...part.cards.flatMap((c) => c.lines.map((l) => textOf(l).trim())), ...part.cards.map((c) => c.title.trim())]
        .filter(Boolean),
    )
    if (covered.size > 0) dropTable((rows) => tableCoveredByCards(rows, covered))
  }
  let recap: ReaderBlock | null = null
  for (let i = deep.length - 1; i >= 0; i--) {
    const b = deep[i]
    if (b.kind === 'paragraph' && textOf(b.inlines).trimStart().startsWith('→')) {
      recap = b
      deep = [...deep.slice(0, i), ...deep.slice(i + 1)]
      break
    }
  }
  // 凡例段落（「確信度の見方：…」）は誌面では出さない（凡例は誌面の上部に常設するため。
  // パイロット準拠）。段落を除いた結果、深掘り末尾に残る区切り線も出さない。
  // 何も除くものが無い節では配列をコピーしない（毎レンダー呼ばれる導出のため）。
  if (deep.some(isLegendParagraph)) deep = deep.filter((b) => !isLegendParagraph(b))
  let end = deep.length
  while (end > 0 && deep[end - 1].kind === 'divider') end--
  if (end < deep.length) deep = deep.slice(0, end)
  return { recap, deep }
}

// 本文フォーマットの凡例段落（「確信度の見方：」で始まる）。誌面では上部の凡例が担う。
// 「確信度の見方は…」のような通常の本文を巻き込まないよう、直後の区切り記号まで要求する。
export function isLegendParagraph(b: ReaderBlock): boolean {
  if (b.kind !== 'paragraph') return false
  if (!(b.inlines[0]?.text ?? '').trimStart().startsWith('確信度の見方')) return false
  return /^確信度の見方[：:]/.test(textOf(b.inlines).trim())
}

/**
 * 節の深掘りに出てくる出典リンクのラベルを、登場順・重複なしで返す。
 * 「この節の根拠を見る」の隣に「BTS guideline 2017・野口 2024…」と添えるためのもの
 * （パイロット誌面の出典サマリ）。ラベルは原本のリンクテキストそのままで、新しい文は作らない。
 */
export function sectionSources(deep: ReaderBlock[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const walk = (blocks: ReaderBlock[]) => {
    for (const b of blocks) {
      if (b.kind === 'heading' || b.kind === 'paragraph' || b.kind === 'list_item') {
        for (const inline of b.inlines) {
          const label = inline.href ? inline.text.trim() : ''
          if (label && !seen.has(label)) {
            seen.add(label)
            out.push(label)
          }
        }
      } else if (b.kind === 'callout') {
        walk(b.blocks)
      }
      // table 内のリンクは拾わない（表層の部品には出典リンクを載せない前提と揃える）
    }
  }
  walk(deep)
  return out
}

// ---- 誌面の編集ルール（パイロット誌面で確定した表示上の整形） ----
// ここも表示専用。原本と保存された SpreadDoc には触れない。
// パイロット誌面（最終目標）が本文フォーマットに対して行っていた整形を、そのまま規則にする。

// 誌面では出さない構造見出し。本文フォーマットの英語マーカー（# Question / # Answer / # Evidence）で、
// 読者向けの情報を持たない。タイトルが問いそのものであり、Evidence は📚calloutの見出しが担う。
const STRUCTURAL_H1 = new Set(['Question', 'Answer', 'Evidence'])

export function isStructuralHeading(b: ReaderBlock): boolean {
  return b.kind === 'heading' && b.level === 1 && STRUCTURAL_H1.has(textOf(b.inlines).trim())
}

/**
 * 前書きの表示用整形。構造見出しと、タイトルと同文の段落（# Question の直下に
 * 問いをもう一度書く書式）を除く。タイトルは絵文字を外して比較する。
 */
export function displayPreface(preface: ReaderBlock[], title: string): ReaderBlock[] {
  const bare = stripLeadingEmoji(title).trim()
  return preface.filter((b) => {
    if (isStructuralHeading(b)) return false
    if (b.kind === 'paragraph' && textOf(b.inlines).trim() === bare) return false
    return true
  })
}

// ⚡ボックスの見出しとして扱う既知のラベル行。原本の書式は「この問いへの答え」で、
// 誌面の呼び名は「この記事の要点」（パイロットで確定）。既知のラベルのときだけ
// 見出し帯に昇格させる。既知でない先頭段落は本文（結論文そのもの等）の可能性が
// あるので body に残し、原本の順序・装飾・検索ハイライトのまま描く。
const LEAD_LABELS = new Set(['この問いへの答え', 'この記事の要点'])
const LEAD_LABEL_TO = 'この記事の要点'

/**
 * 🤖査読スタンプ（tail に入る）から、対象範囲の但し書きを取り出す。
 * パイロット誌面は【査読済み】の宣言を記事末に置かず、⚡ボックス直後に但し書きだけを出す
 * （宣言行は⚡ボックス末尾の「査読済み：YYYY-MM」と重複するため誌面では出さない）。
 */
export function splitStampScope(tail: ReaderBlock[]): { scope: ReaderBlock[]; rest: ReaderBlock[] } {
  const idx = tail.findIndex((b) => b.kind === 'callout' && calloutRole(b.icon) === 'stamp')
  if (idx < 0) return { scope: [], rest: tail }
  const stamp = tail[idx]
  const scope = (stamp.kind === 'callout' ? stamp.blocks : []).filter((b) => {
    if (b.kind === 'divider') return false
    if ((b.kind === 'paragraph' || b.kind === 'list_item') && textOf(b.inlines).includes('【査読済み】')) return false
    return true
  })
  return { scope, rest: [...tail.slice(0, idx), ...tail.slice(idx + 1)] }
}

/**
 * 制作用の「PubMed検索キーワード例」（段落＋直後の箇条書き）は誌面では出さない（パイロット準拠）。
 * 読者の動線は文献リンクで足り、検索クエリの羅列は制作側の道具のため。
 */
export function dropPubmedExamples(tail: ReaderBlock[]): ReaderBlock[] {
  const idx = tail.findIndex((b) => b.kind === 'paragraph' && textOf(b.inlines).trim() === 'PubMed検索キーワード例')
  if (idx < 0) return tail
  let end = idx + 1
  while (end < tail.length && tail[end].kind === 'list_item') end++
  return [...tail.slice(0, idx), ...tail.slice(end)]
}

/**
 * 参考文献の箇条書きから「引用：」以降（原文引用と直後の本文リンク）を出さない（パイロット準拠）。
 * 誌面の文献一覧は「何の文献か」の一行案内に絞り、原文引用は原本（Notion・全文表示）に温存する。
 *
 * 対象は 📚callout（文献一覧の見出し）より後ろの箇条書きだけ。tail 全体に掛けると、
 * 免責や注記の箇条書きが本文中の「引用：」で切り落とされる誤爆が起きる。
 * 「引用：」の検出は連結テキストで行う（Notionのリッチテキストは書式の境目でインラインが
 * 割れるため、単一インライン内の includes では不発になる）。切った結果が空になる行は出さない。
 */
export function compressReferenceItems(blocks: ReaderBlock[]): ReaderBlock[] {
  const start = blocks.findIndex((b) => b.kind === 'callout' && calloutRole(b.icon) === 'evidence')
  if (start < 0) return blocks
  return blocks
    .map((b, index) => {
      if (index <= start || b.kind !== 'list_item') return b
      const at = textOf(b.inlines).search(/引用[：:]/)
      if (at < 0) return b
      const kept: ReaderInline[] = []
      let used = 0
      for (const inline of b.inlines) {
        if (used + inline.text.length <= at) {
          kept.push(inline)
          used += inline.text.length
          continue
        }
        const cut = inline.text.slice(0, at - used).trimEnd()
        if (cut) kept.push({ ...inline, text: cut })
        break
      }
      return kept.length > 0 ? { ...b, inlines: kept } : null
    })
    .filter((b): b is ReaderBlock => b !== null)
}

/**
 * 記事末の表示用整形（スタンプの除去・構造見出しの除去・PubMed検索例の除去・
 * 凡例段落の除去・参考文献の圧縮）をまとめて行う。
 */
export function displayTail(tail: ReaderBlock[]): { scope: ReaderBlock[]; rest: ReaderBlock[] } {
  const { scope, rest } = splitStampScope(tail)
  const cleaned = rest.filter((b) => !isStructuralHeading(b) && !isLegendParagraph(b))
  return { scope, rest: compressReferenceItems(dropPubmedExamples(cleaned)) }
}

// ---- 要点ボックス（⚡）の表示用導出 ----

export type DigestParts = { heading: string | null; body: ReaderBlock[]; foot: ReaderBlock[] }

/**
 * ⚡ボックスの中身を「見出し帯／本文（body）／査読済み行など（foot）」に分ける。
 * 誌面はこの3つを自前の枠（緑ヘッダー帯つきのボックス）で組み直し、展開ボタンを枠内に置く。
 *
 * 見出し帯へ昇格するのは、先頭の段落が既知のラベル（LEAD_LABELS）のときだけ。
 * body はラベルの後ろから最後の箇条書きまでを原本の順序のまま持つ（箇条書きの間に
 * 補足段落があっても並べ替えない）。foot は最後の箇条書きより後ろ（査読済み行）。
 * 区切り線は枠のヘッダーと余白が担うので出さない。
 */
export function splitDigest(lead: ReaderBlock | null): DigestParts {
  if (!lead || lead.kind !== 'callout') return { heading: null, body: [], foot: [] }
  const blocks = lead.blocks.filter((b) => b.kind !== 'divider')
  const first = blocks[0]
  const labeled = first?.kind === 'paragraph' && LEAD_LABELS.has(textOf(first.inlines).trim())
  const heading = labeled ? LEAD_LABEL_TO : null
  const rest = blocks.slice(labeled ? 1 : 0)
  let lastItem = -1
  rest.forEach((b, i) => {
    if (b.kind === 'list_item') lastItem = i
  })
  if (lastItem < 0) return { heading, body: rest, foot: [] }
  return { heading, body: rest.slice(0, lastItem + 1), foot: rest.slice(lastItem + 1) }
}

/**
 * 要点ボックス内の蛍光マーカー（_background）だけ落とす表示用の導出。
 * 原本の赤マーカー強調は、誌面の要点ボックスでは太字＝ブランドグリーンの数値強調に
 * 置き換わる（パイロット準拠）。文字色（単色系）と太字はそのまま残す。
 */
export function digestTone(blocks: ReaderBlock[]): ReaderBlock[] {
  const strip = (list: ReaderInline[]): ReaderInline[] =>
    list.map((i) => {
      if (!i.color || !i.color.endsWith('_background')) return i
      const { color: _color, ...rest } = i
      return rest
    })
  return blocks.map((b) =>
    b.kind === 'paragraph' || b.kind === 'heading' || b.kind === 'list_item'
      ? { ...b, inlines: strip(b.inlines) }
      : b,
  )
}

/**
 * ⚡ボックスの「査読済み：YYYY-MM」からバッジ行に出す年月を取り出す。無ければ null。
 * 原本側の書式ゆらぎ（2026/08・2026年8月・月1桁）は YYYY-MM に正規化して受ける。
 */
export function reviewedDateOf(lead: ReaderBlock | null): string | null {
  if (!lead || lead.kind !== 'callout') return null
  for (const b of lead.blocks) {
    if (b.kind !== 'paragraph' && b.kind !== 'list_item') continue
    const m = textOf(b.inlines).match(/査読済み[：:]\s*(\d{4})[-/年]\s*(\d{1,2})/)
    if (m) return `${m[1]}-${m[2].padStart(2, '0')}`
  }
  return null
}

// 節見出しの「1. 」接頭辞は番号バッジと重複するため、表示では落とす（番号なしH2はそのまま）。
export function sectionTitleText(s: Pick<SpreadSection, 'n' | 'title'>): string {
  return s.n != null ? s.title.replace(/^\s*\d+\s*[.．]\s*/, '') : s.title
}
