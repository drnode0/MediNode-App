'use client'
import { createContext, useContext } from 'react'
import { CircleCheck } from 'lucide-react'
import {
  calloutRole,
  parseSectionHeading,
  sectionAnchor,
  isRecapText,
  type ReaderDoc,
  type ReaderBlock,
  type ReaderInline,
} from '@/lib/reader-doc'
import { CONFIDENCE_MARKS, isDimmed, type Confidence } from '@/lib/reader-confidence'
import { KnowledgeTitle, sectionHeadingParts } from '@/lib/title-display'
import { ConfidenceMark, MARK_COLOR } from './ConfidenceMark'
import { ReaderSearchCtx } from './reader-search-context'
import { findMatchRanges, inlineSegments } from '@/lib/reader-search'

// CONFIDENCE_MARKS からマーク文字を導出する（表記ゆれ防止：分割用正規表現と判定マップを同一ソースから作る）。
const MARK_OF: Record<string, Confidence> = Object.fromEntries(
  (Object.entries(CONFIDENCE_MARKS) as [Confidence, string][]).map(([c, mark]) => [mark, c]),
) as Record<string, Confidence>
const MARK_RE = new RegExp(`(${Object.values(CONFIDENCE_MARKS).join('|')})`)

// テキストを確信度マークで分割し、マーク位置に ConfidenceMark を差し込む。
function renderText(text: string, key: string) {
  const parts = text.split(MARK_RE)
  return parts.map((seg, i) =>
    MARK_OF[seg] ? (
      <ConfidenceMark key={`${key}-${i}`} kind={MARK_OF[seg]} className="mx-0.5 align-baseline" />
    ) : (
      <span key={`${key}-${i}`}>{seg}</span>
    ),
  )
}

// Notion annotations.color → 表示クラス。_background 系は蛍光マーカー、単色系は文字色。
// 折り返しでもマーカーが切れないよう box-decoration-clone を付ける。
const MARKER_BASE = 'px-0.5 rounded-[3px] [-webkit-box-decoration-break:clone] [box-decoration-break:clone]'
const INLINE_COLOR: Record<string, string> = {
  yellow_background: `bg-yellow-100 dark:bg-yellow-300/25 ${MARKER_BASE}`,
  orange_background: `bg-orange-100 dark:bg-orange-300/25 ${MARKER_BASE}`,
  red_background: `bg-red-100 dark:bg-red-400/25 ${MARKER_BASE}`,
  pink_background: `bg-pink-100 dark:bg-pink-400/25 ${MARKER_BASE}`,
  purple_background: `bg-purple-100 dark:bg-purple-400/25 ${MARKER_BASE}`,
  blue_background: `bg-blue-100 dark:bg-blue-400/25 ${MARKER_BASE}`,
  green_background: `bg-emerald-100 dark:bg-emerald-400/25 ${MARKER_BASE}`,
  brown_background: `bg-amber-100 dark:bg-amber-400/25 ${MARKER_BASE}`,
  gray_background: `bg-gray-100 dark:bg-gray-600/40 ${MARKER_BASE}`,
  red: 'text-red-600 dark:text-red-400',
  orange: 'text-orange-600 dark:text-orange-400',
  yellow: 'text-yellow-700 dark:text-yellow-400',
  green: 'text-emerald-700 dark:text-emerald-400',
  blue: 'text-blue-600 dark:text-blue-400',
  purple: 'text-purple-600 dark:text-purple-400',
  pink: 'text-pink-600 dark:text-pink-400',
  brown: 'text-amber-700 dark:text-amber-400',
  gray: 'text-gray-500 dark:text-gray-400',
}
// 太字だけの強調にも薄いマーカーを敷き、重要箇所が「面」で目に入るようにする
// （執筆側が色を付けている場合はそちらを優先）。
// 濃度は控えめに — 数値密なナレッジでは1画面に何箇所も出るため、濃いと「面の圧」になる。
const BOLD_MARKER = `bg-amber-100/40 dark:bg-amber-300/10 ${MARKER_BASE}`

// 既に背景色のある領域（結論・署名・査読スタンプなどのボックスやrecap）では、
// 自動マーカーを重ねると塗りだらけになる。そこでは太字は太字のままにする。
// Notionで明示的に付けた色（n.color）はボックス内でも尊重する。
const NoAutoMarkerCtx = createContext(false)

function Inlines({ items, k, plain }: { items: ReaderInline[]; k: string; plain?: boolean }) {
  const noAutoMarker = useContext(NoAutoMarkerCtx)
  const searchQuery = useContext(ReaderSearchCtx)
  // 検索中だけ、inlines連結テキスト上のヒットレンジを各inlineのセグメントに割り付ける。
  const segs = searchQuery
    ? inlineSegments(items, findMatchRanges(items.map((n) => n.text).join(''), searchQuery))
    : null

  // 1つのinlineのテキストを（検索セグメントを挟みつつ）描画する。
  // mark の中でも確信度マーク分割（renderText）は生かす。
  // anchor内（リンクテキスト）は非検索時のDOM・意味論を完全に保つため、renderTextによる分割や
  // span包みをかけない（生テキストのまま）。従来の <a>{n.text}</a> と完全一致させる。
  const renderInlineText = (n: ReaderInline, i: number, isAnchor?: boolean) => {
    if (isAnchor) {
      if (!segs) return n.text
      return segs[i].map((seg, j) =>
        seg.mark ? (
          <mark
            key={`${k}-${i}-${j}`}
            data-reader-search=""
            className="bg-yellow-200 dark:bg-yellow-500/40 text-inherit rounded-[2px]"
          >
            {seg.text}
          </mark>
        ) : (
          seg.text
        ),
      )
    }
    const body = (text: string, key: string) => (plain ? text : renderText(text, key))
    if (!segs) return body(n.text, `${k}-${i}`)
    return segs[i].map((seg, j) =>
      seg.mark ? (
        <mark
          key={`${k}-${i}-${j}`}
          data-reader-search=""
          className="bg-yellow-200 dark:bg-yellow-500/40 text-inherit rounded-[2px]"
        >
          {body(seg.text, `${k}-${i}-${j}`)}
        </mark>
      ) : (
        <span key={`${k}-${i}-${j}`}>{body(seg.text, `${k}-${i}-${j}`)}</span>
      ),
    )
  }

  return (
    <>
      {items.map((n, i) => {
        // 太字は本気で太く（老眼でも強調が拾えるように）。font-medium では地の文と区別がつかない。
        const color = n.color ? INLINE_COLOR[n.color] ?? '' : ''
        const autoMarker = !noAutoMarker && n.bold && !n.code ? BOLD_MARKER : ''
        const cls = [
          n.bold ? 'font-bold' : '',
          n.italic ? 'italic' : '',
          n.code ? 'font-mono text-[0.85em] bg-gray-100 dark:bg-gray-700 px-1 rounded' : '',
          plain ? '' : color || autoMarker,
        ].join(' ')
        if (n.href) {
          // 直前のノードが確信度マーク単体なら、リンクの下線色をマークの意味色へ寄せる。
          // ただし確信度の一次表現は ConfidenceMark（sr-only 語）に置く。
          const prevMark = MARK_OF[items[i - 1]?.text?.trim() ?? '']
          const linkColor = prevMark ? MARK_COLOR[prevMark] : 'text-brand-600 dark:text-brand-300'
          return (
            <a
              key={i}
              href={n.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`出典: ${n.text}`}
              className={`${cls} ${linkColor} underline underline-offset-2 break-words [overflow-wrap:anywhere]`}
            >
              {renderInlineText(n, i, true)}
            </a>
          )
        }
        return (
          <span key={i} className={cls}>
            {renderInlineText(n, i)}
          </span>
        )
      })}
    </>
  )
}

const CALLOUT_TONE: Record<string, string> = {
  yellow_background: 'bg-amber-50 dark:bg-amber-900/20 border-amber-400 dark:border-amber-500',
  green_background: 'bg-brand-50 dark:bg-brand-900/30 border-brand-500 dark:border-brand-400',
  gray_background: 'bg-gray-50 dark:bg-gray-700/40 border-gray-400 dark:border-gray-500',
  blue_background: 'bg-blue-50 dark:bg-blue-900/20 border-blue-400 dark:border-blue-500',
}

// paragraph / list_item の淡色化・recap スタイルを決める共通ロジック。
function textColorClass(block: ReaderBlock, active: Set<Confidence>): string {
  const dim = isDimmed(block, active)
  if (dim) return 'text-gray-500 dark:text-gray-400'
  const text = block.kind === 'paragraph' || block.kind === 'list_item' ? block.inlines.map((x) => x.text).join('') : ''
  // recap（→だから…）は節の持ち帰りポイント。淡色で沈めず、teal の小箱で「面」として立てる。
  if (isRecapText(text))
    return 'text-gray-700 dark:text-gray-300 font-medium bg-teal-50/70 dark:bg-teal-900/20 border-l-[3px] border-teal-500 rounded-r-md px-3 py-2'
  return 'text-gray-900 dark:text-gray-100'
}

function CalloutBlock({
  block,
  index,
  onImageClick,
  active,
}: {
  block: ReaderBlock & { kind: 'callout' }
  index: number
  onImageClick: (u: string) => void
  active: Set<Confidence>
}) {
  const role = calloutRole(block.icon)

  if (role === 'conclusion') {
    return (
      <div
        data-tldr=""
        className="rounded-r-lg border-l-4 border-amber-400 bg-amber-50 dark:bg-amber-900/20 px-4 py-3.5 my-4"
      >
        <div className="flex gap-2">
          {block.icon && <span className="shrink-0 text-[1em] leading-[1.5]">{block.icon}</span>}
          <div className="min-w-0">
            <RenderedBlocks blocks={block.blocks} onImageClick={onImageClick} active={active} />
          </div>
        </div>
      </div>
    )
  }

  if (role === 'signature') {
    const [first, ...rest] = block.blocks
    // 先頭行が太字のときだけ見出しに昇格する（太字でなければ忠実描画のため本文フローに残す）。
    const hasHeadingText = first && first.kind === 'paragraph' && first.inlines.some((n) => n.bold)
    return (
      <div
        className="rounded-r-lg border-l-4 border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3.5 my-4"
      >
        <div className="flex gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/drnode-avatar.png" alt="" className="w-full h-full object-contain p-1" />
          </div>
          <div className="min-w-0">
            {hasHeadingText && (
              <p className="text-[1em] font-semibold text-gray-900 dark:text-gray-100 mb-1">
                <Inlines items={first.inlines} k={`sig-h-${index}`} />
              </p>
            )}
            <RenderedBlocks blocks={hasHeadingText ? rest : block.blocks} onImageClick={onImageClick} active={active} />
          </div>
        </div>
      </div>
    )
  }

  if (role === 'stamp') {
    return (
      <div className="border-t border-b border-teal-500/30 py-2.5 my-3">
        <div className="flex gap-2 items-start">
          <CircleCheck className="w-4 h-4 text-teal-600 dark:text-teal-400 shrink-0 mt-0.5" aria-hidden="true" />
          {/* サイズ指定なし＝本文サイズを継承（段落から text-base を外したため、
              ここに text-sm を残すと査読スタンプの本文だけ縮む）。 */}
          <div className="min-w-0 text-gray-600 dark:text-gray-300">
            <RenderedBlocks blocks={block.blocks} onImageClick={onImageClick} active={active} />
          </div>
        </div>
      </div>
    )
  }

  // evidence / disclaimer / plain: 既存 CALLOUT_TONE 準拠（disclaimer は常に gray）。
  const tone = role === 'disclaimer' ? CALLOUT_TONE.gray_background : (block.color && CALLOUT_TONE[block.color]) || CALLOUT_TONE.gray_background
  return (
    <div className={`border-l-4 rounded-r-lg px-4 py-3.5 my-4 ${tone}`}>
      <div className="flex gap-2">
        {block.icon && <span className="shrink-0 text-[1em] leading-[1.5]">{block.icon}</span>}
        <div className="min-w-0">
          <RenderedBlocks blocks={block.blocks} onImageClick={onImageClick} active={active} />
        </div>
      </div>
    </div>
  )
}

function Block({
  block,
  index,
  onImageClick,
  active,
}: {
  block: ReaderBlock
  index: number
  onImageClick: (u: string) => void
  active: Set<Confidence>
}) {
  switch (block.kind) {
    case 'heading': {
      if (block.level === 2) {
        const p = parseSectionHeading(block.inlines)
        const anchor = sectionAnchor(p ? p.n : null, index)
        if (p) {
          return (
            <div data-section={anchor} className="flex items-start gap-2.5 mt-10 mb-3.5 pb-2 border-b border-gray-200 dark:border-gray-700">
              <span className="text-[0.95em] font-bold tabular-nums text-teal-700 dark:text-teal-300 bg-teal-500/12 w-7 h-7 rounded-md inline-flex items-center justify-center shrink-0 mt-0.5">
                {p.n}
              </span>
              <h3 className="text-[1.3em] font-bold text-gray-900 dark:text-gray-100 leading-snug">{p.rest}</h3>
            </div>
          )
        }
        // 番号なしH2＝テンプレ固定セクション（📄要約/🎯PICO等）。既知セクション絵文字だけ
        // lucideアイコンに置換し、それ以外の見出しは忠実描画のまま（絵文字も残す）。
        const { Icon: SecIcon, color: secColor, text: secText } = sectionHeadingParts(block.inlines.map((n) => n.text).join(''))
        if (SecIcon) {
          return (
            <h3 data-section={anchor} className="flex items-center gap-2 text-[1.3em] font-bold text-gray-900 dark:text-gray-100 mt-9 mb-3.5 pb-2 border-b border-gray-200 dark:border-gray-700">
              <SecIcon className={`h-[1.05em] w-[1.05em] shrink-0 ${secColor}`} aria-hidden />
              <span className="min-w-0">{secText}</span>
            </h3>
          )
        }
        return (
          <h3 data-section={anchor} className="text-[1.3em] font-bold text-gray-900 dark:text-gray-100 mt-9 mb-3.5 pb-2 border-b border-gray-200 dark:border-gray-700">
            <Inlines items={block.inlines} k={`h-${index}`} plain />
          </h3>
        )
      }
      const size = block.level === 1 ? 'text-[1.35em] font-bold' : 'text-[1.12em] font-bold'
      // H1/H3 の見出しも同様に、既知テンプレ絵文字ならアイコン化（未知は忠実描画のまま）。
      const h13 = sectionHeadingParts(block.inlines.map((n) => n.text).join(''))
      if (h13.Icon) {
        const H13Icon = h13.Icon
        return (
          <h3 className={`flex items-center gap-2 ${size} text-gray-900 dark:text-gray-100 mt-7 mb-2`}>
            <H13Icon className={`h-[1.05em] w-[1.05em] shrink-0 ${h13.color}`} aria-hidden />
            <span className="min-w-0">{h13.text}</span>
          </h3>
        )
      }
      return (
        <h3 className={`${size} text-gray-900 dark:text-gray-100 mt-7 mb-2`}>
          <Inlines items={block.inlines} k={`h-${index}`} plain />
        </h3>
      )
    }
    case 'paragraph': {
      const color = textColorClass(block, active)
      const recap = isRecapText(block.inlines.map((x) => x.text).join(''))
      const body = <Inlines items={block.inlines} k={`p-${index}`} />
      return (
        <p
          className={`leading-[1.9] my-7 whitespace-pre-line break-words transition-colors duration-150 motion-reduce:transition-none ${color}`}
        >
          {recap ? <NoAutoMarkerCtx.Provider value={true}>{body}</NoAutoMarkerCtx.Provider> : body}
        </p>
      )
    }
    case 'callout':
      return (
        <NoAutoMarkerCtx.Provider value={true}>
          <CalloutBlock block={block} index={index} onImageClick={onImageClick} active={active} />
        </NoAutoMarkerCtx.Provider>
      )
    case 'image':
      return (
        <button type="button" onClick={() => onImageClick(block.url)} className="block w-full my-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={block.url} alt={block.caption ?? ''} className="w-full rounded-lg border border-gray-200 dark:border-gray-700" />
          {block.caption && <span className="block text-[0.75em] text-gray-500 dark:text-gray-400 mt-1">{block.caption}</span>}
        </button>
      )
    case 'divider':
      return <hr className="my-4 border-gray-200 dark:border-gray-700" />
    case 'table':
      // セルは文字色を明示する。未指定だとダークモードで地の既定色（黒寄り）を継承し、
      // 暗い背景に沈んで読めなくなる（段落・見出しは dark:text-gray-100 を明示済み）。
      // 枠線も gray-700 では背景 gray-800 とほぼ同色で構造が追えないため一段強める。
      return (
        <div className="overflow-x-auto my-3">
          <table className="text-[0.875em] border-collapse text-gray-800 dark:text-gray-100">
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r} className="dark:even:bg-white/[0.03]">
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      className="border border-gray-300 dark:border-gray-600 px-2.5 py-1.5 align-top leading-relaxed"
                    >
                      <Inlines items={cell} k={`t-${index}-${r}-${c}`} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'unsupported':
      return (
        <p className="text-[0.75em] text-gray-400 dark:text-gray-500 my-1">
          {block.text}
        </p>
      )
    default:
      return null
  }
}

type ListGroup = { kind: 'list'; ordered: boolean; items: ReaderInline[][]; index: number }
type ItemGroup = { kind: 'item'; block: ReaderBlock; index: number }
type Grouped = ItemGroup | ListGroup

// 連続する list_item を ul/ol にまとめる。index はキー生成用にグループ先頭の元インデックスを保持する。
function groupBlocks(blocks: ReaderBlock[]): Grouped[] {
  const out: Grouped[] = []
  blocks.forEach((b, idx) => {
    if (b.kind === 'list_item') {
      const last = out[out.length - 1]
      if (last && last.kind === 'list' && last.ordered === b.ordered) {
        last.items.push(b.inlines)
      } else {
        out.push({ kind: 'list', ordered: b.ordered, items: [b.inlines], index: idx })
      }
    } else {
      out.push({ kind: 'item', block: b, index: idx })
    }
  })
  return out
}

function RenderedBlocks({
  blocks,
  onImageClick,
  active,
}: {
  blocks: ReaderBlock[]
  onImageClick: (u: string) => void
  active: Set<Confidence>
}) {
  const grouped = groupBlocks(blocks)
  return (
    <>
      {grouped.map((g, i) => {
        if (g.kind === 'list') {
          const Tag = g.ordered ? 'ol' : 'ul'
          return (
            <Tag
              key={i}
              className={`${g.ordered ? 'list-decimal' : 'list-disc'} pl-5 my-4 space-y-2.5`}
            >
              {g.items.map((it, j) => {
                const pseudo: ReaderBlock = { kind: 'list_item', ordered: g.ordered, inlines: it }
                const color = textColorClass(pseudo, active)
                return (
                  <li
                    key={j}
                    className={`leading-[1.9] whitespace-pre-line break-words transition-colors duration-150 motion-reduce:transition-none ${color}`}
                  >
                    <Inlines items={it} k={`li-${i}-${j}`} />
                  </li>
                )
              })}
            </Tag>
          )
        }
        return <Block key={i} block={g.block} index={g.index} onImageClick={onImageClick} active={active} />
      })}
    </>
  )
}

export function ReaderBody({
  doc,
  onImageClick,
  active = new Set(),
  scaleEm,
}: {
  doc: ReaderDoc
  onImageClick: (url: string) => void
  active?: Set<Confidence>
  // Aaボタンの文字サイズ（SCALE_EM の値）。em なので iOS Dynamic Type と乗算で合成される。
  scaleEm?: string
}) {
  return (
    // 本文の組版。バッジを足す代わりに、読む時間そのものの質を上げる。
    // ・palt は見出し限定（地の文は自然な字幅＋微字間 — globals.css の .reader-prose 参照）
    // ・pretty: 行末で1語だけ落ちる不揃いを避ける
    // ・tabular-nums は数値の並ぶ医療本文で桁が揃い、読み比べやすくなる
    // いずれも要素も文字も増やさない。説明されないが毎回効く。
    //
    // サイズの流れ: .reader-prose（基準サイズ・iOSはDynamic Type）→ 内側ラッパー（Aa倍率）
    // → 本文/見出し/表は em 系サイズで連動拡大。更新日はメタ情報なので固定のまま。
    <div className="reader-prose">
      <div style={scaleEm && scaleEm !== '1em' ? { fontSize: scaleEm } : undefined}>
        {doc.lastEdited && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
            更新 {new Date(doc.lastEdited).toLocaleDateString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit' })}
          </p>
        )}
        {doc.cover && (
          <button type="button" onClick={() => onImageClick(doc.cover!)} className="block w-full mb-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={doc.cover} alt="" className="w-full rounded-lg" />
          </button>
        )}
        <h2 className="text-[1.42em] font-bold leading-snug text-gray-900 dark:text-gray-100 mb-4">
          {doc.icon && !doc.icon.startsWith('http') && <span className="mr-1">{doc.icon}</span>}
          <KnowledgeTitle title={doc.title} />
        </h2>
        <RenderedBlocks blocks={doc.blocks} onImageClick={onImageClick} active={active} />
      </div>
    </div>
  )
}
