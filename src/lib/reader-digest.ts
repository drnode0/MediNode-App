// 要点モード（リーダーの「全文｜要点」切替）の抽出ロジック。
// 高密度ナレッジを「一度に見せる量」で軽くする：⚡結論・節見出し・各節の recap（→だから…）・
// 図解・末尾の署名／査読スタンプ／免責だけを残し、節ごとにその場で全文へ開けるようにする。
//
// 表示（JSX）は ReaderBody 側。ここは純関数に留めてテスト可能にする。
import {
  calloutRole,
  isRecapText,
  parseSectionHeading,
  sectionAnchor,
  type CalloutRole,
  type ReaderBlock,
} from './reader-doc'

export type ReaderViewMode = 'full' | 'digest'

export const READER_VIEW_MODE_KEY = 'medinode-reader-view-mode'

// テーマ・文字サイズと同じ端末ごとの設定（サーバー同期しない・個人データ扱いでもない）。
export function getReaderViewMode(): ReaderViewMode {
  if (typeof window === 'undefined') return 'full'
  try {
    const v = window.localStorage.getItem(READER_VIEW_MODE_KEY)
    if (v === 'full' || v === 'digest') return v
  } catch {
    /* localStorage 不可は全文既定へ */
  }
  return 'full'
}

export function setReaderViewMode(m: ReaderViewMode): void {
  try {
    window.localStorage.setItem(READER_VIEW_MODE_KEY, m)
  } catch {
    /* 保存できない環境ではセッション内のみ有効 */
  }
}

// 要点に残す callout の役割。⚡結論は骨格、署名・スタンプ・免責は「誰が・いつ確かめたか」で、
// どれも要点だけ読む人にこそ届く必要がある。役割のない callout（任意の絵文字）は落とす。
const DIGEST_CALLOUT: CalloutRole[] = ['conclusion', 'signature', 'stamp', 'disclaimer']
// 末尾に固まって出る「文書の締め」。最終節の展開範囲に巻き込まないよう epilogue へ分ける。
// 📚Evidence を含めるのは、後に本文が続かない位置にある📚は締めの一部だから。
// 外すと、署名と査読スタンプの間に📚が挟まっただけで後方走査がそこで止まり、
// 署名が最終節の中に取り残される（「この節を閉じる」が署名の後に出てしまう）。
const TAIL_CALLOUT: CalloutRole[] = ['signature', 'stamp', 'disclaimer', 'evidence']

// 元の blocks 配列上の位置つきのブロック。index は Block の描画キー・アンカー計算と一致させるために保持する。
export type DigestPick = { block: ReaderBlock; index: number }

export type DigestSection = {
  anchor: string
  // 展開時に丸ごと描く範囲 [start, end)。start は節のH2見出しの位置。
  start: number
  end: number
  // 折りたたみ時に描く要点行（見出しを含む）。
  items: DigestPick[]
}

export type DigestLayout = {
  // 最初のH2より前（⚡結論など）。展開の対象にはしない。
  preamble: DigestPick[]
  sections: DigestSection[]
  // 末尾に連続する署名・査読スタンプ・免責・区切り線。常に全文で描く。
  epilogue: ReaderBlock[]
}

function isDigestBlock(b: ReaderBlock): boolean {
  if (b.kind === 'callout') return DIGEST_CALLOUT.includes(calloutRole(b.icon))
  if (b.kind === 'image') return true
  if (b.kind === 'heading') return b.level === 2
  if (b.kind === 'paragraph') return isRecapText(b.inlines.map((x) => x.text).join(''))
  return false
}

// 要点モードで見せるものだけを document 順に抽出する。
export function digestItems(blocks: ReaderBlock[]): DigestPick[] {
  return blocks.map((block, index) => ({ block, index })).filter((p) => isDigestBlock(p.block))
}

// 末尾から後方走査して epilogue の開始位置を返す（無ければ blocks.length）。
function epilogueStart(blocks: ReaderBlock[]): number {
  let i = blocks.length
  while (i > 0) {
    const b = blocks[i - 1]
    const tail = b.kind === 'divider' || (b.kind === 'callout' && TAIL_CALLOUT.includes(calloutRole(b.icon)))
    if (!tail) break
    i--
  }
  return i
}

// このページで要点モードが成立するか（個人・部署リーダー用）。
// 要点はH2節・⚡結論・recap行というテンプレート構造から抽出するため、構造のない
// ページでは表示するものがほぼ残らず、ほぼ白紙になる。成立条件は
// 「H2節がある ＋ 見出し以外の要点（⚡結論・recap行・図解）が実際に1つ以上ある」
// —— 見出しだけのページを要点にすると空のアコーディオンになるため。
// 不成立のページでは切替ボタンごと出さない（「あなたの書き方が悪い」というシグナルを
// 出さないため、判定は自動・無言。サブスク配信は常に成立扱いで従来どおり）。
export function digestUsable(blocks: ReaderBlock[]): boolean {
  const { preamble, sections } = digestSections(blocks)
  if (sections.length === 0) return false
  return [...preamble, ...sections.flatMap((s) => s.items)].some((p) => p.block.kind !== 'heading')
}

// blocks を preamble / 節 / epilogue に割る。節は「その場で全文へ開く」単位。
export function digestSections(blocks: ReaderBlock[]): DigestLayout {
  const tailAt = epilogueStart(blocks)
  // 要点行の抽出は epilogue より前だけを対象にする（epilogue は別に全文で描くため、
  // 両方に入れると署名が二重に出る）。body は blocks の接頭辞なので index はそのまま通用する。
  const body = blocks.slice(0, tailAt)
  const picks = digestItems(body)

  const headings: number[] = []
  body.forEach((b, i) => {
    if (b.kind === 'heading' && b.level === 2) headings.push(i)
  })

  const firstHeading = headings[0] ?? tailAt
  const preamble = picks.filter((p) => p.index < firstHeading)

  const sections: DigestSection[] = headings.map((start, k) => {
    const end = headings[k + 1] ?? tailAt
    const h = body[start]
    const parsed = h.kind === 'heading' ? parseSectionHeading(h.inlines) : null
    return {
      anchor: sectionAnchor(parsed ? parsed.n : null, start),
      start,
      end,
      items: picks.filter((p) => p.index >= start && p.index < end),
    }
  })

  return { preamble, sections, epilogue: blocks.slice(tailAt) }
}
