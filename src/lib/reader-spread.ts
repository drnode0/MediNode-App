// アプリ内リーダーの「スプレッド」表示（TEXTBOOK LITE）のデータ模型。
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

/**
 * reader_spreads.page_id の正準形（ハイフンなし32桁の小文字）。
 *
 * スプレッドは「/admin から投入して Supabase に保存」「配信APIが page_id で引いて読者に返す」の
 * 2経路で同じ値を扱う。ここが揃っていないと、投入したスプレッドが読者に1件も届かない
 * （読者側の記事IDは Algolia の objectID＝ハイフンありのUUID、保存側はハイフンなし32桁、
 * という食い違いが実際に起きた）。書く側と読む側の両方で必ずこの関数を通すこと。
 *
 * 受け付けるのは素のUUID（ハイフン有無どちらも）、`subscription_` 接頭辞つき、
 * 節レコードの `#secN` サフィックスつき、NotionのURL。
 * 32桁が取れないときは入力（前後の空白を落としたもの）をそのまま返す。黙って捨てると
 * 呼び出し側が誤りに気づけないので、サーバー側のエラーで露見させる。
 */
export function canonicalPageId(raw: string | null | undefined): string {
  // 先に trim する。入力欄に貼られた値は前後に空白が付くことがあり、後から trim すると
  // 先頭一致の `^subscription_` が空白に阻まれて剥がれない。
  const trimmed = (raw ?? '').trim().replace(/^subscription_/, '').replace(/#.*$/, '').trim()
  // 16進が32桁以上続くところを全部拾い、最後のものの末尾32桁を取る。
  // 先頭から32桁ぶんを取る書き方だと、NotionのURL（.../Title-<id>）でタイトル末尾が
  // 16進の文字（a〜f）だったときに1桁ずれた別のIDになる。Notionのidはスラッグの末尾にある。
  const runs = trimmed.replace(/-/g, '').match(/[0-9a-f]{32,}/gi)
  if (!runs || runs.length === 0) return trimmed
  return runs[runs.length - 1].slice(-32).toLowerCase()
}

// 表層に出す部品。'none' は表層なし（深掘りだけ）を意味する。
// 比較表の主役セルの指定。行・列のどちらか片方だけでも渡せる。
// 両方渡したときは「その行の、その列」＝交点だけが主役になる（和ではない）。
export type CellFocus = { rows?: number[]; cols?: number[] }

/**
 * そのセルが主役か。focus を渡さない表は全セルが主役（＝今までの見た目）。
 *
 * 空配列は「指定なし」に倒す。JSON を手で書く経路と編集画面の両方があり、
 * 空配列を「1つも主役にしない」と解釈すると、表がまるごと沈んで数値が読めなくなる。
 * 落とすなら fail-safe は「元の見た目」の側に倒す。
 */
export function isFocusCell(focus: CellFocus | undefined, row: number, col: number): boolean {
  const rows = focus?.rows?.length ? focus.rows : null
  const cols = focus?.cols?.length ? focus.cols : null
  if (!rows && !cols) return true
  if (rows && !rows.includes(row)) return false
  if (cols && !cols.includes(col)) return false
  return true
}

export type SpreadPart =
  // focus は「この表で見るべきセル」の指定。数値セルは既定で全部が強調されるので、
  // 数値の多い表（6行×3列など）だと全部が同じ声量で叫んで強弱が消える。focus を渡した
  // ときだけ、主役でない数値セルを落ち着かせる。渡さなければ従来どおり全部が主役なので、
  // 公開済みのスプレッドの見た目は変わらない。行・列とも本文行（見出し行を除く）の0起点。
  // title は表の呼び名。原本の表は本文の小見出し（太字段落）の下にあるが、表層へ昇格すると
  // 小見出しは深掘りに残るため、表だけが文脈なしで現れる。それを補う「何の表か」の1行。
  // gauge.title・flow の step.label と同じ表示上の命名＝逐語一致検査の対象にしない。
  // 主張や数値は title に書かないこと（書くなら本文の逐語で rows に置く）。
  | { kind: 'comparison' | 'matrix'; title?: string; rows: ReaderInline[][][]; focus?: CellFocus }
  // intro はフロー全体の前提条件（「高CO₂血症リスクなしで SpO₂ 85%以上」等）、
  // note は各ステップに添える小さな補足行。どちらも医学的内容なので逐語一致検査の対象
  // （label だけが表示上の命名＝対象外）。旧 SpreadDoc には無いキーなので optional。
  // dose は流量など「大きく出す数値」（パイロットの .flow-dev .dose）。医学的内容なので
  // intro / note と同じく逐語一致検査の対象で、label だけが表示上の命名＝対象外。
  | { kind: 'flow' | 'timeline'; steps: { label: string; inlines: ReaderInline[]; dose?: ReaderInline[]; note?: ReaderInline[] }[]; intro?: ReaderInline[] }
  | { kind: 'bignumber'; value: string; caption: ReaderInline[] }
  // 2枚組の比較カード（パイロット版の節5 COT vs HFNC）。title はカードの呼び名
  // （命名＝検査対象外）、lines は逐語一致検査の対象。primary は主役側のカードで、
  // 見出し帯を塗る（パイロットの .vs-col.hero）。表示上の指定なので検査の対象外。
  | { kind: 'cards'; cards: { title: string; lines: ReaderInline[][]; primary?: boolean }[] }
  // 表層の補足ノート（パイロット版の「高流量か低流量かの線引きは…」等）。逐語一致検査の対象。
  | { kind: 'note'; inlines: ReaderInline[] }
  // goLabel / noGoLabel は枠の見出し（既定は「こうする」「こうしない」）。
  // 節6のように「NIVを選ぶ／侵襲的人工呼吸への移行を判断する」の対では、既定ラベルだと
  // 「こうしない」が誤読になる（移行の判断は禁止事項ではない）ため、オーバレイで名前を渡せる。
  // shortLabel と同じ表示上の呼び名なので、逐語一致検査の対象にはしない。
  | { kind: 'gonogo'; go: ReaderInline[][]; noGo: ReaderInline[][]; goLabel?: string; noGoLabel?: string }
  // 実測値の帯グラフ（パイロット版の死亡率ゲージ）。value は本文中の数値の逐語、
  // label はその値の条件（SpO₂帯など）で、どちらも逐語一致検査の対象。
  // 帯の長さは表示側が value から導く。title は図の呼び名（shortLabel と同じ表示上の
  // 命名＝検査の対象外。主張や数値は title に書かず、value / label に逐語で置くこと）。
  // warn は「悪い側の値」を琥珀で示す表示フラグ。
  | { kind: 'gauge'; title?: string; items: { value: string; label: ReaderInline[]; warn?: boolean }[] }
  // 条件で枝分かれする判断図。flow は縦一列で「順番に進む」しか表せず、
  // 「Ⅱ型呼吸不全のリスクがあるか？ → ある／ない」のような同時に並ぶ選択肢を書けない。
  // question は図の問いかけ、when は枝の条件チップで、どちらも表示上の命名なので
  // 逐語一致検査の対象にしない（gauge.title・flow の step.label と同じ扱い）。
  // then（その枝の答え）と note（但し書き）は医学的内容なので逐語検査の対象。
  | { kind: 'decision'; question?: string; branches: { when: string; then: ReaderInline[]; note?: ReaderInline[] }[] }
  | { kind: 'none' }

export type SpreadSection = {
  n: number | null
  anchor: string
  title: string
  shortLabel: string | null
  part: SpreadPart
  // 主役部品（part）に添える追加の部品。パイロット版の節1が「比較表＋死亡率ゲージ」の
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
  // 正解の言い直し（パイロットの「正解：」に続く太字の部分）。書き下ろしなので
  // 非公開のスプレッドノート_DBに置く。逐語一致検査の対象。
  // 保存済みの SpreadDoc には無いキーなので optional。
  answerLead?: string
  // 言い直しに続く解説の地の文。同じくスプレッドノートに置き、逐語一致検査の対象。
  // これが無ければ正解の面は従来どおり根拠の逐語を出す（供給していないスプレッドの
  // 出力を1文字も変えない fail-safe）。
  explanation?: string
}

// 参考文献の圧縮行。title / source / note は非公開のスプレッドノート_DB に置き、3つとも
// 逐語一致検査の対象。title は原本の完全タイトルを縮めたもので、頭の語が落ちたり途中が
// 略語に置き換わったりするため、文言から「原本のどの文献行か」を当てにいくと別の文献の
// リンクを読者に出しうる。そこで指す先は sourceId（原本の文献行のブロックID）で明示する。
//
// sourceId は保存済みの旧 SpreadDoc には無いキーなので型の上では optional。ただし
// 新しく作る圧縮行では必須の扱いで、指していない行は関門（refLinkage）が止める。
// href のキーは持たない。飛び先は必ず紐づけ先の原本の行から引く（refHrefs）。
export type SpreadRef = { title: string; source: string; note: string; sourceId?: string }

export type SpreadDoc = {
  version: 1
  pageId: string
  title: string
  lead: ReaderBlock | null
  preface: ReaderBlock[]
  sections: SpreadSection[]
  tail: ReaderBlock[]
  // 参考文献の圧縮行。無ければスプレッドは原本の箇条書きをそのまま出す（旧 SpreadDoc には
  // 無いキーなので optional。保存済みのスプレッドが壊れないよう、必ず「無ければ従来どおり」に倒す）。
  refs?: SpreadRef[]
  quizzes: SpreadQuiz[]
  icons: Record<string, string>
  // 節の深掘りを既定で開いた状態で出すか。📚Essentials は通読させる層なので開く。
  // 既定（未指定）は従来どおり閉じるので、公開中のCQ・ナレッジの出方は変わらない。
  deepOpen?: boolean
  // 節に属さず、⚡要点と目次の間に置く部品（「現場で先に見る数値」）。
  // 記事の中で最も使われる数値が最後の節にある、という並びを表示側だけで救うための枠。
  // 中身は節の部品と同じ逐語一致検査を通る。
  topParts?: SpreadPart[]
}

// 制作スキルが渡すのはこれだけ。本文は渡さない（サーバーが原本から組む）。
export type SpreadOverlay = {
  shortLabels?: Record<string, string>
  parts?: Record<string, SpreadPart>
  extraParts?: Record<string, SpreadPart[]>
  refs?: SpreadRef[]
  icons?: Record<string, string>
  quizzes?: SpreadQuiz[]
  // 比較表の主役セル。part を丸ごと差し替えずに主役だけを渡すための別口。
  // parts で comparison を渡すと表の中身をオーバレイに書き写すことになり、原本の表を
  // 直したときに黙って古くなる（本文はオーバレイに持たせない、という全体の方針にも反する）。
  // 表でない部品の節に指定しても無視される。
  tableFocus?: Record<string, CellFocus>
  // 自動昇格した表（節の主役部品）の呼び名。part を丸ごと差し替えずに表題だけを渡すための
  // 別口（tableFocus と同じ理由。parts で comparison を渡すと表の中身をオーバレイに書き写す
  // ことになり、原本の表を直したときに黙って古くなる）。表でない部品の節では無視される。
  partTitles?: Record<string, string>
  deepOpen?: boolean
  topParts?: SpreadPart[]
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
const KNOWN_PART_KINDS = new Set<SpreadPart['kind']>(['comparison', 'matrix', 'flow', 'timeline', 'bignumber', 'gonogo', 'gauge', 'cards', 'note', 'decision', 'none'])

// part の中の ReaderInline から href だけを落とす（text/bold/italic/code/color は残す）。
function stripInlineHref(list: ReaderInline[]): ReaderInline[] {
  return list.map((i) => {
    if (!i.href) return i
    const { href: _href, ...rest } = i
    return rest
  })
}

/**
 * 主役セルの指定を正規化する。表示だけの値なので逐語検査には掛からず、代わりにここで
 * 数として成立する添字だけを残す。壊れた値をそのまま通すと、どのセルにも当たらずに
 * 表がまるごと沈む（数値が全部灰色になる）。
 */
function sanitizeFocus(focus: CellFocus | undefined): CellFocus | undefined {
  if (!focus) return undefined
  const ints = (xs: number[] | undefined) =>
    Array.isArray(xs) ? xs.filter((n) => Number.isInteger(n) && n >= 0) : undefined
  const rows = ints(focus.rows)
  const cols = ints(focus.cols)
  if (!rows?.length && !cols?.length) return undefined
  return { ...(rows?.length ? { rows } : {}), ...(cols?.length ? { cols } : {}) }
}

// オーバレイ由来の part から出典リンクを落とす。part.kind ごとに ReaderInline の在り処が違うので分岐する。
function stripPartHref(part: SpreadPart): SpreadPart {
  switch (part.kind) {
    case 'comparison':
    case 'matrix': {
      const focus = sanitizeFocus(part.focus)
      return { ...part, rows: part.rows.map((row) => row.map(stripInlineHref)), ...(focus ? { focus } : {}) }
    }
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
    case 'decision':
      return {
        ...part,
        branches: part.branches.map((br) => ({
          ...br,
          then: stripInlineHref(br.then),
          ...(br.note ? { note: stripInlineHref(br.note) } : {}),
        })),
      }
    case 'none':
      return part
  }
}

/**
 * 参考文献の圧縮行を、スプレッドに載せる前に正規化する。
 *
 * 1. title の無い行を捨てる（スプレッドの一覧に空の項番だけが並ぶのを防ぐ）。
 *    source（略記の出典）と note（1行説明）は空でも通す。出典の略記が無い文献があるため。
 * 2. 既知のキー（title / source / note / sourceId）だけを通す。部品側の stripPartHref と
 *    同じ構えで、「生成側にURLを書かせない」を型と正規化の両方で担保する。
 *    JSONを直接編集する窓口・APIへの直接PUTからは href などの未知のキーが混ざりうる。
 * 3. 3つの文言を trim する。逐語一致検査は trim して照合するので、trim せずに通すと
 *    末尾に空白を持ったタイトルが検査を抜けてそのままスプレッドに出る。
 *
 * 保存形は JSON なので、キーが欠けていても値が文字列でなくても落ちないようにする。
 */
export function sanitizeRefs(refs: SpreadRef[]): SpreadRef[] {
  const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
  return refs
    .filter((r) => text(r?.title))
    .map((r) => {
      const out: SpreadRef = { title: text(r.title), source: text(r.source), note: text(r.note) }
      // sourceId は原本のブロックIDで、文言ではないので trim だけの正規化はしない
      // （refSourceId が読むときに trim する）。文字列でない値はキーごと落とす。
      if (typeof r.sourceId === 'string') out.sourceId = r.sourceId
      return out
    })
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
  // 表の呼び名は trim して空を落とす（title は命名なので逐語検査に掛からない。
  // 空文字を通すと「無題の表題行」が描画されるだけになる）。
  if (overlay.partTitles) {
    const titles: Record<string, string> = {}
    for (const [anchor, t] of Object.entries(overlay.partTitles)) {
      const v = typeof t === 'string' ? t.trim() : ''
      if (v) titles[anchor] = v
    }
    out.partTitles = titles
  }
  // 先頭に置く部品も主役部品と同じ関門を通す。
  if (overlay.topParts) {
    out.topParts = overlay.topParts.filter((p) => KNOWN_PART_KINDS.has(p.kind)).map(stripPartHref)
  }
  // 参考文献の圧縮行は行の取捨とキー・文言の正規化を sanitizeRefs に集める
  // （編集画面のビルダーも同じ1本を引き、関門の入力が中と外で割れないようにしている）。
  if (overlay.refs) {
    out.refs = sanitizeRefs(overlay.refs)
  }
  // 比較表の主役セルも同じ正規化を通す（part.focus と tableFocus で扱いが割れないように）。
  if (overlay.tableFocus) {
    const focus: Record<string, CellFocus> = {}
    for (const [anchor, f] of Object.entries(overlay.tableFocus)) {
      const ok = sanitizeFocus(f)
      if (ok) focus[anchor] = ok
    }
    out.tableFocus = focus
  }
  return out
}

/**
 * 制作スキルからのオーバレイを下書きに重ねる。
 * 本文（deep / lead / preface / tail）には一切触れない。触れさせないことが安全装置になる。
 */
// 主役の指定は比較表にだけ効かせる。表でない部品に focus を生やしても描画側が見ないので、
// 保存形に意味のないキーが残るだけになる。
function withTableFocus(part: SpreadPart, focus: CellFocus | undefined): SpreadPart {
  if (!focus || (part.kind !== 'comparison' && part.kind !== 'matrix')) return part
  return { ...part, focus }
}

// 表の呼び名も tableFocus と同じ別口で当てる。表でない部品には効かせない。
function withPartTitle(part: SpreadPart, title: string | undefined): SpreadPart {
  if (!title || (part.kind !== 'comparison' && part.kind !== 'matrix')) return part
  return { ...part, title }
}

export function applyOverlay(draft: SpreadDoc, overlay: SpreadOverlay): SpreadDoc {
  return {
    ...draft,
    sections: draft.sections.map((s) => ({
      ...s,
      shortLabel: overlay.shortLabels?.[s.anchor] ?? s.shortLabel,
      part: withPartTitle(
        withTableFocus(overlay.parts?.[s.anchor] ?? s.part, overlay.tableFocus?.[s.anchor]),
        overlay.partTitles?.[s.anchor],
      ),
      extraParts: overlay.extraParts?.[s.anchor] ?? s.extraParts,
    })),
    // 参考文献の圧縮行。渡されなければ下書きのまま（＝無いまま）にして、スプレッドは原本の
    // 箇条書きを出す。ここでも本文（tail のブロック）には触れない。
    refs: overlay.refs ?? draft.refs,
    icons: { ...draft.icons, ...(overlay.icons ?? {}) },
    quizzes: overlay.quizzes ?? draft.quizzes,
    deepOpen: overlay.deepOpen ?? draft.deepOpen,
    topParts: overlay.topParts ?? draft.topParts,
  }
}

// 部品と理解チェックが持つ「原本に由来するはずの文」を集める。
// 短ラベルは目次チップ用の呼び名で原本には無くてよいので、対象に入れない。
//
// 集める先を string ではなく string | undefined で持つ。保存形は JSON で、編集画面の
// 「JSONを直接編集」やAPIへの直接PUTからは型どおりでない（キーの欠けた）値が入りうる。
// そこで例外にすると、編集画面は useMemo の中で落ちて画面ごと消え、APIは 400 の
// verbatim_mismatch ではなく 500 になる。欠けたキーは空文字として扱い、末尾の
// filter(Boolean) で対象から外す（sanitizeOverlay が `r.title?.trim()` で守っているのと同じ流儀）。
function verbatimTargets(spread: SpreadDoc): string[] {
  const out: (string | undefined)[] = []
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
    } else if (p.kind === 'decision') {
      // question / when は表示上の命名なので対象に入れない。答えと但し書きは逐語で検査する。
      for (const br of p.branches) {
        out.push(textOf(br.then))
        if (br.note) out.push(textOf(br.note))
      }
    }
  }
  for (const p of spread.topParts ?? []) collect(p)
  for (const s of spread.sections) {
    collect(s.part)
    for (const p of s.extraParts ?? []) collect(p)
  }
  // 理解チェックは根拠の逐語に加えて、書き下ろしの解説（正解の言い直しと地の文）も対象に入れる。
  // どちらも原本には無くスプレッドノートにあるので、ノートにも原本にも無い文言はここで弾かれる。
  for (const q of spread.quizzes) out.push(q.evidence, q.answerLead, q.explanation)
  // 参考文献の圧縮行は3つとも対象に入れる。source と note は原本に無くスプレッドノートにあるので、
  // ノートにも原本にも無い文言（生成側が書いた説明）はここで弾かれる。
  for (const r of spread.refs ?? []) out.push(r.title, r.source, r.note)
  return out.map((s) => (s ?? '').trim()).filter(Boolean)
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
 * スプレッドが「原本＋スプレッドノート」の逐語だけでできているかを検査する。
 * 落ちたら投入を拒否する。生成側が本文を書き換えたことを意味するため。
 *
 * notes は非公開のスプレッドノートページ（src/lib/spread-notes.ts）のブロック。
 * 圧縮文言は公開ページに置けない（公開リンクで読者に見える）ため、照合先だけを
 * ノートに広げる。渡されなければ従来どおり原本だけで検査する（fail-closed）。
 */
export function verifyVerbatim(spread: SpreadDoc, doc: ReaderDoc, notes?: ReaderBlock[] | null): { ok: boolean; missing: string[] } {
  const ok = makeVerbatimChecker(doc, notes)
  const missing = verbatimTargets(spread).filter((s) => !ok(s))
  return { ok: missing.length === 0, missing }
}

/**
 * 1文だけの逐語照合器。編集画面が入力欄ごとに「この文は原本（＋スプレッドノート）にあるか」を
 * 即座に出すために使う。正規化は verifyVerbatim と同一（ここが割れると、画面では通るのに
 * 保存で落ちる、という食い違いが生まれる）。
 */
export function makeVerbatimChecker(doc: ReaderDoc, notes?: ReaderBlock[] | null): (s: string) => boolean {
  const corpus = notes && notes.length > 0 ? `${corpusOf(doc)}\n${corpusOfBlocks(notes)}` : corpusOf(doc)
  return (s: string) => corpus.includes(s.replace(/[ \t]+/g, ' '))
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
    // evidence のキーごと無い設問（JSONを直接編集した投入・APIへの直接PUT）でも
    // 例外にせず、空文字として扱って下の fail-closed に落とす（verbatimTargets と同じ扱い）。
    const evidence = (q.evidence ?? '').trim()
    // 空文字は String.includes('') が常に true を返すため、検査をすり抜けて
    // 根拠のない設問を通してしまう。fail-closed で明示的に弾く。
    if (!evidence) return false
    return corpus.includes(evidence.replace(/[ \t]+/g, ' '))
  })
}

/**
 * 理解チェックに答えたあと、正解の面に出す文を決める。
 *
 * 解説（explanation）が供給されているときだけ「正解：＋言い直し」＋解説に差し替え、
 * 無ければ null を返す。null は「従来どおり根拠の逐語（evidence）を出す」の意味で、
 * 供給していないスプレッドの出力を1文字も変えないための fail-safe。
 *
 * lead は「正解：」に続く太字の部分。空文字なら「正解：」だけを太字にする。
 * キーが欠けた設問（JSONを直接編集した投入・APIへの直接PUT）でも落ちないよう、
 * 値の取り出しは verbatimTargets と同じく「無ければ空文字」で扱う。
 */
export function quizFeedback(quiz: SpreadQuiz): { lead: string; body: string } | null {
  const explanation = (quiz.explanation ?? '').trim()
  if (!explanation) return null
  return { lead: (quiz.answerLead ?? '').trim(), body: explanation }
}

// ---- 表示専用のビュー導出 ----
// ここから下は描画のための導出だけを行い、保存された SpreadDoc には一切触れない。
// visibleQuizzes の逐語照合や verifyVerbatim は保存形（section.deep の全ブロック）に
// 対して働くので、深掘りから見た目上ブロックを除くのは描画の直前でだけ行う。

function rowsText(rows: ReaderInline[][][]): string {
  return rows.map((row) => row.map((cell) => textOf(cell)).join('\t')).join('\n')
}

export type SectionDisplay = {
  // 節末の「→」段落。表層の「この節の答え」ボックスへ昇格する（パイロット版の recap）。
  recap: ReaderBlock | null
  // 節末の「この節から生まれた問い」（見出し段落に続く箇条書き）。深掘りから取り分けて
  // 節末に常設し、「気になる」投票を付ける。見出しが無い記事（CQ・ナレッジ）では空。
  questions: ReaderBlock[]
  // 表層へ昇格したブロック（recap・比較表の元テーブル・問いリスト）を除いた深掘り本文。
  deep: ReaderBlock[]
}

// 「この節から生まれた問い」の見出し文言。Essentials の書式（medinode-essentials §4）。
const QUESTIONS_HEADING = 'この節から生まれた問い'

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
// スプレッドのどこにも出なくなる（本文の静かな欠落）ため、向きはこちらで固定する。
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
  // 凡例段落（「確信度の見方：…」）はスプレッドでは出さない（凡例はスプレッドの上部に常設するため。
  // パイロット準拠）。段落を除いた結果、深掘り末尾に残る区切り線も出さない。
  // 何も除くものが無い節では配列をコピーしない（毎レンダー呼ばれる導出のため）。
  if (deep.some(isLegendParagraph)) deep = deep.filter((b) => !isLegendParagraph(b))
  let end = deep.length
  while (end > 0 && deep[end - 1].kind === 'divider') end--
  if (end < deep.length) deep = deep.slice(0, end)
  // 節末の問いリストを取り分ける。見出し段落＋後続の箇条書きが深掘りの末尾まで続く
  // ときだけ抜く（後ろにまだ本文が残る構造では抜かない＝本文を欠落させない fail-safe）。
  let questions: ReaderBlock[] = []
  const qi = deep.findIndex((b) => b.kind === 'paragraph' && textOf(b.inlines).trim() === QUESTIONS_HEADING)
  if (qi >= 0) {
    let qEnd = qi + 1
    while (qEnd < deep.length && deep[qEnd].kind === 'list_item') qEnd++
    if (qEnd > qi + 1 && qEnd === deep.length) {
      questions = deep.slice(qi + 1, qEnd)
      deep = deep.slice(0, qi)
    }
  }
  return { recap, questions, deep }
}

// 本文フォーマットの凡例段落（「確信度の見方：」で始まる）。スプレッドでは上部の凡例が担う。
// 「確信度の見方は…」のような通常の本文を巻き込まないよう、直後の区切り記号まで要求する。
export function isLegendParagraph(b: ReaderBlock): boolean {
  if (b.kind !== 'paragraph') return false
  if (!(b.inlines[0]?.text ?? '').trimStart().startsWith('確信度の見方')) return false
  return /^確信度の見方[：:]/.test(textOf(b.inlines).trim())
}

/**
 * 節の深掘りに出てくる出典リンクのラベルを、登場順・重複なしで返す。
 * 「この節の根拠を見る」の隣に「BTS guideline 2017・野口 2024…」と添えるためのもの
 * （パイロット版の出典サマリ）。ラベルは原本のリンクテキストそのままで、新しい文は作らない。
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

// ---- スプレッドの編集ルール（パイロット版で確定した表示上の整形） ----
// ここも表示専用。原本と保存された SpreadDoc には触れない。
// パイロット版（最終目標）が本文フォーマットに対して行っていた整形を、そのまま規則にする。

// スプレッドでは出さない構造見出し。本文フォーマットの英語マーカー（# Question / # Answer / # Evidence）で、
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

/**
 * 前置きを「現場から届いた問い」として組み直すための切り分け。本文は書き換えない。
 * 並べ替えと装飾の掛け先を決めるだけで、文言はすべて原本のブロックのまま渡す。
 *
 * 既定の描画では、📝「このページの背景」がアプリ既定のcallout（左の灰色バー）で出る。
 * 記事の中でここだけ意匠が揃わないうえ、プレミアムの売りである「現場の疑問に答える」
 * という出自が、3段落の説明文の2行目に埋もれる。そこで問いを引用として立て、
 * 出所を1行に、残りの背景を畳めるようにする。
 *
 * question    … 📝より前の段落（＝# Question の本文）。引用として大きく出す
 * sourceLine  … 📝の中の最初の本文段落（「〜に寄せられた、現場からの疑問です」）
 * background  … 📝の残り。既定は畳んでおく
 * rest        … 画像・📝より後ろのブロック。従来どおり共通レンダラに描かせる
 *
 * 📝が無い記事では question / sourceLine / background が空になり、rest に全部が残る。
 * 呼び出し側はそのとき従来の描画へ落ちればよい（fail-safe は「元のまま」の側）。
 */
export type PrefaceParts = {
  question: ReaderBlock[]
  sourceLine: ReaderBlock | null
  background: ReaderBlock[]
  rest: ReaderBlock[]
}

// callout の1行目に置かれる見出し段落（「このページの背景」等）。Notionでは太字だけの
// 段落として書かれるので、全インラインが太字の段落を見出しとみなす。ReaderBody が
// 表層への昇格を判定するのと同じ流儀で、ここでも文字列の一致では見ない。
function isCalloutHeadingParagraph(b: ReaderBlock): boolean {
  return b.kind === 'paragraph' && b.inlines.length > 0 && b.inlines.every((i) => i.bold)
}

export function splitPrefaceBlocks(preface: ReaderBlock[]): PrefaceParts {
  const at = preface.findIndex((b) => b.kind === 'callout' && calloutRole(b.icon) === 'note')
  if (at < 0) return { question: [], sourceLine: null, background: [], rest: preface }

  const note = preface[at] as ReaderBlock & { kind: 'callout' }
  const question: ReaderBlock[] = []
  const rest: ReaderBlock[] = []
  preface.forEach((b, i) => {
    if (i === at) return
    // 画像は問いの引用に混ぜない（挿絵が引用枠の中に落ちると意味が変わる）
    if (i < at && b.kind === 'paragraph') question.push(b)
    else rest.push(b)
  })

  const body = note.blocks.filter((b, i) => !(i === 0 && isCalloutHeadingParagraph(b)))
  return { question, sourceLine: body[0] ?? null, background: body.slice(1), rest }
}

// ⚡ボックスの見出しとして扱う既知のラベル行。原本の書式は「この問いへの答え」で、
// スプレッドの呼び名は「この記事の要点」（パイロットで確定）。既知のラベルのときだけ
// 見出し帯に昇格させる。既知でない先頭段落は本文（結論文そのもの等）の可能性が
// あるので body に残し、原本の順序・装飾・検索ハイライトのまま描く。
const LEAD_LABELS = new Set(['この問いへの答え', 'この記事の要点'])
const LEAD_LABEL_TO = 'この記事の要点'

/**
 * 🤖査読スタンプ（tail に入る）から、対象範囲の但し書きを取り出す。
 * パイロット版は【査読済み】の宣言を記事末に置かず、⚡ボックス直後に但し書きだけを出す
 * （宣言行は⚡ボックス末尾の「査読済み：YYYY-MM」と重複するためスプレッドでは出さない）。
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
 * 制作用の「PubMed検索キーワード例」（段落＋直後の箇条書き）はスプレッドでは出さない（パイロット準拠）。
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
 * スプレッドの文献一覧は「何の文献か」の一行案内に絞り、原文引用は原本（Notion・全文表示）に温存する。
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
  const { scope } = splitStampScope(tail)
  return { scope, rest: compressReferenceItems(tailBeforeRefCompression(tail)) }
}

// 参考文献の圧縮（compressReferenceItems）だけを掛けていない記事末。
// 文献行の一次資料リンクは「引用：」より後ろに置かれているので、圧縮した行にはリンクが
// 残らない。関門とタイトルのリンクは原本の行そのものを見る必要があるため、ここで分ける。
function tailBeforeRefCompression(tail: ReaderBlock[]): ReaderBlock[] {
  const { rest } = splitStampScope(tail)
  const cleaned = rest.filter((b) => !isStructuralHeading(b) && !isLegendParagraph(b))
  return dropPubmedExamples(cleaned)
}

/**
 * 記事末尾を、スプレッドが自前の枠で組む3つ（実践・文献・免責）とそれ以外に分ける表示専用の導出。
 * パイロット版は末尾を .practice / .refs / .disclaimer の3つで組んでおり、アプリ既定の
 * callout（薄い面と丸い絵文字アイコン）のままではスプレッドにならないため、描き分けの口だけを作る。
 *
 * 分類は既存の calloutRole だけで決める（キーワード一致や新しい判定規則は作らない）。
 * practice / refsHead は callout そのものを返す（見出し行はスプレッド側が中身の先頭から取る）。
 * disclaimer は callout の中身を返す（スプレッドは枠ではなく上罫線つきの段落として出すため）。
 * refsItems は文献の callout より後ろの箇条書き（compressReferenceItems と同じ範囲の取り方）。
 * どの口にも入らないブロックは必ず rest に残す（黙って消さない）。同じ役割の callout が
 * 複数あるときは最初のものだけを採り、2つ目以降は rest に残す。
 */
export type TailParts = {
  practice: ReaderBlock | null
  refsHead: ReaderBlock | null
  refsItems: ReaderBlock[]
  disclaimer: ReaderBlock[]
  rest: ReaderBlock[]
}

// リンク（またはURL文字列）だけでできた段落か。畳んでよいのはこれだけで、
// 説明文が1文字でも混じる段落は本文として扱う。
function isBareLinkParagraph(b: ReaderBlock): boolean {
  if (b.kind !== 'paragraph' || b.inlines.length === 0) return false
  return b.inlines.every((i) => {
    const text = i.text.trim()
    if (!text) return true
    return Boolean(i.href) || /^https?:\/\/\S+$/.test(text)
  })
}

export function splitTailBlocks(blocks: ReaderBlock[]): TailParts {
  let practice: ReaderBlock | null = null
  let refsHead: ReaderBlock | null = null
  let disclaimerTaken = false
  const disclaimer: ReaderBlock[] = []
  const refsItems: ReaderBlock[] = []
  const rest: ReaderBlock[] = []
  for (const b of blocks) {
    if (b.kind === 'callout') {
      const role = calloutRole(b.icon)
      if (role === 'signature' && !practice) {
        practice = b
        continue
      }
      if (role === 'evidence' && !refsHead) {
        refsHead = b
        continue
      }
      if (role === 'disclaimer' && !disclaimerTaken) {
        disclaimerTaken = true
        disclaimer.push(...b.blocks)
        continue
      }
    }
    // 一次資料のURLが文献行の中ではなく、その下の独立した段落に置かれている原本がある
    // （書き方が記事ごとに違う）。そのままだと文献行として拾えず rest に落ち、記事末に
    // 素のリンクチップが縦に並ぶうえ、圧縮行のリンク先（refHrefs）も1件も引けなくなる。
    // URLだけでできた段落は直前の文献行に畳んで、1つの文献行として扱う。
    // 文が混じる段落は畳まない（本文を文献行に吸い込むと、逐語検査の照合先がずれる）。
    if (b.kind === 'paragraph' && refsHead && refsItems.length > 0 && isBareLinkParagraph(b)) {
      const last = refsItems[refsItems.length - 1]
      if (last.kind === 'list_item') {
        refsItems[refsItems.length - 1] = { ...last, inlines: [...last.inlines, ...b.inlines] }
        continue
      }
    }
    if (b.kind === 'list_item' && refsHead) {
      refsItems.push(b)
      continue
    }
    rest.push(b)
  }
  return { practice, refsHead, refsItems, disclaimer, rest }
}

/**
 * スプレッドの文献一覧のもとになる、原本の文献行。
 * 関門（refLinkage）とタイトルのリンク（refHrefs）が同じ行を見るようにするための1本。
 * ここが割れると「関門を通ったのにリンクが付かない」といった食い違いが生まれる。
 * ブロックIDは落とさずそのまま返す（圧縮行の紐づけが指す先になるため）。
 *
 * 範囲の取り方は displayTail と同じ（スタンプ・構造見出し・凡例・PubMed検索例を除く）。
 * ただし「引用：」以降の圧縮は掛けない。一次資料へのリンクはそこより後ろにあるため。
 */
export function refItemsOf(tail: ReaderBlock[]): ReaderBlock[] {
  return splitTailBlocks(tailBeforeRefCompression(tail)).refsItems
}

// ---- 参考文献の圧縮行と原本の文献行の紐づけ ----
//
// 圧縮行（SpreadRef）は非公開のスプレッドノート由来で、原本の完全タイトルを縮めたもの。
// 実データ（酸素の記事の7行）では「Official ERS/ATS clinical practice guidelines:
// noninvasive ventilation for acute respiratory failure」に対する圧縮行が
// 「ERS/ATS clinical practice guidelines: NIV for acute respiratory failure」のように、
// 頭の語が落ちて途中が略語に置き換わる。文言から対応づけを推測すると、読者に別の文献の
// リンクを出しうる。そこで圧縮行は sourceId（原本の文献行のブロックID）で指す先を明示する。
//
// この紐づけには2つのものが乗っている。一次資料へのリンク先（refHrefs）と、
// 文献が減っていないかの関門（refLinkage）。どちらも同じ索引から引く。

// 文献行のインライン。文字を持たないブロック（画像など）は空を返す。
function refItemInlines(b: ReaderBlock): ReaderInline[] {
  return b.kind === 'list_item' || b.kind === 'paragraph' || b.kind === 'heading' ? b.inlines : []
}

/**
 * 圧縮行が指す原本の行のブロックID。保存形は JSON なので、キーが欠けていても
 * 文字列でなくても落ちないようにする（「JSONを直接編集」の窓口・APIへの直接PUT）。
 * 空文字はどの行にも当たらないので、そのまま fail-closed に落ちる。
 */
export function refSourceId(ref: SpreadRef | undefined): string {
  const id = ref?.sourceId
  return typeof id === 'string' ? id.trim() : ''
}

/**
 * 原本の文献行を、ブロックIDから引ける索引にする。
 * ブロックIDを持たない行（古い保存 doc 由来）は索引に載らない＝どの圧縮行も指せないので、
 * 関門が鳴って保存が止まる（推測で当てにいくより止めるほうを採る）。
 *
 * 関門（refLinkage）・リンク（refHrefs）・編集画面の「原本の N 行目」表示が、
 * 同じ索引を引くために公開している。画面側で組み直すと、関門は通るのに表示だけがずれる。
 */
export function refItemIndex(refsItems: ReaderBlock[]): Map<string, number> {
  const index = new Map<string, number>()
  refsItems.forEach((b, i) => {
    const id = b.blockId?.trim()
    if (id && !index.has(id)) index.set(id, i)
  })
  return index
}

/**
 * 圧縮行と原本の文献行の紐づけの検査結果。
 *
 * dropped … 原本の文献行のうち、どの圧縮行からも指されていないもの。
 *   逐語一致検査は「スプレッドに書いた文言が原本かノートにあるか」しか見ないので、
 *   圧縮行を1行書き忘れた（＝原本にある文献がスプレッドから消えた）ことは検出できない。
 * dangling … 指す先が原本に無い圧縮行（原本が書き換わって行が消えた・紐づけを持たない）。
 *   別の行に付け替えると読者に違う文献のリンクを出すので、当てにいかず止める。
 *
 * どちらかが空でなければ、投入も保存も止める。
 */
export type RefLinkage = { dropped: ReaderBlock[]; dangling: SpreadRef[] }

/**
 * 原本の文献行と圧縮行の紐づけを突き合わせる。
 *
 * refs が未指定・空のときは両方とも空配列を返す。圧縮行を供給していないスプレッドは原本の
 * 箇条書きをそのまま出すので、そもそも減りようがない（既存のスプレッドの保存を止めない fail-safe）。
 */
export function refLinkage(refsItems: ReaderBlock[], refs: SpreadRef[] | undefined): RefLinkage {
  if (!refs || refs.length === 0) return { dropped: [], dangling: [] }
  const index = refItemIndex(refsItems)
  const claimed = new Set<number>()
  const dangling: SpreadRef[] = []
  for (const r of refs) {
    const at = index.get(refSourceId(r))
    if (at === undefined) dangling.push(r)
    else claimed.add(at)
  }
  return { dropped: refsItems.filter((_, i) => !claimed.has(i)), dangling }
}

/**
 * 圧縮行それぞれに対応する、原本の文献行の一次資料リンク。並びは refs と同じ。
 * 指す先が原本に無い行・リンクを持たない行は null（リンクにしない）。
 *
 * href は必ず原本から引く。SpreadRef に href のキーは足さない（生成側にURLを書かせない
 * sanitizeOverlay の方針を保つため）。原本の行にリンクが複数あるときは最初のものを使う。
 */
export function refHrefs(refsItems: ReaderBlock[], refs: SpreadRef[] | undefined): (string | null)[] {
  if (!refs || refs.length === 0) return []
  const index = refItemIndex(refsItems)
  return refs.map((r) => {
    const at = index.get(refSourceId(r))
    if (at === undefined) return null
    return refItemInlines(refsItems[at]).find((n) => n.href)?.href ?? null
  })
}

// ---- 要点ボックス（⚡）の表示用導出 ----

export type DigestParts = { heading: string | null; body: ReaderBlock[]; foot: ReaderBlock[] }

/**
 * ⚡ボックスの中身を「見出し帯／本文（body）／査読済み行など（foot）」に分ける。
 * スプレッドはこの3つを自前の枠（緑ヘッダー帯つきのボックス）で組み直し、展開ボタンを枠内に置く。
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
 * 原本の赤マーカー強調は、スプレッドの要点ボックスでは太字＝ブランドグリーンの数値強調に
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
