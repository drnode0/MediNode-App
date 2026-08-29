'use client'
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { CircleCheck, ExternalLink, BookOpenText, Zap, BookText, TriangleAlert, NotebookPen, Info, type LucideIcon } from 'lucide-react'
import { digestSections, type DigestSection, type ReaderViewMode } from '@/lib/reader-digest'
import {
  calloutRole,
  parseSectionHeading,
  sectionAnchor,
  isRecapText,
  type CalloutRole,
  type ReaderDoc,
  type ReaderBlock,
  type ReaderInline,
} from '@/lib/reader-doc'
import { isDimmed, type Confidence } from '@/lib/reader-confidence'
import { KnowledgeTitle, sectionHeadingParts } from '@/lib/title-display'
import { ReaderSourceCtx } from './reader-source-context'
import { recordNotionEscape } from '@/lib/notion-escape'
import { Inlines, NoAutoMarkerCtx } from './Inlines'

// 色つきボックスの枠。左の太い柱で種別を示し、上下右の細い線で箱の端を定義する。
// 塗り（*-50 系）は白背景の上ではほとんど沈むので、柱だけだと右端・下端が消えて
// 「囲い」として成立しない（実機の見え方で確認）。
// かといって全周を太くすると、節ごとに出る recap（1ページに5〜8個）が結論ボックスと
// 同じ重さになり、「答え」と「節の持ち帰り」の段差が潰れる。だから太いのは左だけに留める。
const BOX_FRAME = 'border-l-4 border-y border-r rounded-r-lg'
const BOX_EDGE: Record<string, string> = {
  amber: 'border-l-amber-400 dark:border-l-amber-500 border-y-amber-300 border-r-amber-300 dark:border-y-amber-500/40 dark:border-r-amber-500/40',
  emerald: 'border-l-emerald-500 dark:border-l-emerald-400 border-y-emerald-300 border-r-emerald-300 dark:border-y-emerald-500/40 dark:border-r-emerald-500/40',
  brand: 'border-l-brand-500 dark:border-l-brand-400 border-y-brand-300 border-r-brand-300 dark:border-y-brand-500/40 dark:border-r-brand-500/40',
  gray: 'border-l-gray-400 dark:border-l-gray-500 border-y-gray-300 border-r-gray-300 dark:border-y-gray-500/40 dark:border-r-gray-500/40',
  blue: 'border-l-blue-400 dark:border-l-blue-500 border-y-blue-300 border-r-blue-300 dark:border-y-blue-500/40 dark:border-r-blue-500/40',
}

// 塗りと枠色の組。キーは Notion の callout color。
const CALLOUT_TONE: Record<string, string> = {
  yellow_background: `bg-amber-50 dark:bg-amber-900/20 ${BOX_EDGE.amber}`,
  green_background: `bg-brand-50 dark:bg-brand-900/30 ${BOX_EDGE.brand}`,
  gray_background: `bg-gray-50 dark:bg-gray-700/40 ${BOX_EDGE.gray}`,
  blue_background: `bg-blue-50 dark:bg-blue-900/20 ${BOX_EDGE.blue}`,
}

// paragraph / list_item の淡色化・recap スタイルを決める共通ロジック。
function textColorClass(block: ReaderBlock, active: Set<Confidence>): string {
  const dim = isDimmed(block, active)
  if (dim) return 'text-gray-500 dark:text-gray-400'
  const text = block.kind === 'paragraph' || block.kind === 'list_item' ? block.inlines.map((x) => x.text).join('') : ''
  // recap（→だから…）は節の持ち帰りポイント。淡色で沈めず、teal の小箱で「面」として立てる。
  // 柱は3px＝結論ボックス（4px）より一段軽い。数が多いのでここで段差をつける。
  if (isRecapText(text))
    return 'text-gray-700 dark:text-gray-300 font-medium bg-teal-50/70 dark:bg-teal-900/20 border-l-[3px] border-y border-r border-l-teal-500 border-y-teal-300 border-r-teal-300 dark:border-y-teal-500/40 dark:border-r-teal-500/40 rounded-r-md px-3 py-2'
  return 'text-gray-900 dark:text-gray-100'
}

// callout の先頭アイコンは lucide に寄せる（目次バーの⚡と同じ字にする）。
// 未知のアイコンも生の絵文字では出さず、中立の Info に倒す。
// 「知らない絵文字は残す」にしておくと、テンプレートに新しい絵文字が入るたびに
// 本文へ絵文字が漏れる（📝『このページの背景』で実際に起きた）。ここを既定で
// 塞いでおけば、マッピングの追加漏れは「見慣れないアイコン」で済み、事故にならない。
const CALLOUT_FALLBACK = { Icon: Info, color: 'text-gray-400 dark:text-gray-500' }
const CALLOUT_ICON: Partial<Record<CalloutRole, { Icon: LucideIcon; color: string }>> = {
  conclusion: { Icon: Zap, color: 'text-amber-500 dark:text-amber-400' },
  evidence: { Icon: BookText, color: 'text-amber-600 dark:text-amber-400' },
  disclaimer: { Icon: TriangleAlert, color: 'text-amber-600 dark:text-amber-400' },
  note: { Icon: NotebookPen, color: 'text-gray-500 dark:text-gray-400' },
}

function CalloutIcon({ role, icon }: { role: CalloutRole; icon: string | null }) {
  // アイコン未設定の callout はアイコン欄そのものを出さない（枠だけで足りる）。
  if (!icon && !CALLOUT_ICON[role]) return null
  const { Icon, color } = CALLOUT_ICON[role] ?? CALLOUT_FALLBACK
  // 高さ 1.5em の箱＝絵文字が占めていた行送りと同じ。1行目の中心に揃う。
  return (
    <span className="shrink-0 inline-flex items-center h-[1.5em]">
      <Icon className={`h-[1.05em] w-[1.05em] ${color}`} aria-hidden="true" />
    </span>
  )
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

  // 制作メモ（🎨=draft）は読者向けの本文には出さない。
  if (role === 'draft') return null

  if (role === 'conclusion') {
    return (
      <div
        data-tldr=""
        className={`${BOX_FRAME} ${BOX_EDGE.amber} bg-amber-50 dark:bg-amber-900/20 px-4 py-3.5 my-4`}
      >
        <div className="flex gap-2">
          <CalloutIcon role={role} icon={block.icon} />
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
        className={`${BOX_FRAME} ${BOX_EDGE.emerald} bg-emerald-50 dark:bg-emerald-900/20 px-4 py-3.5 my-4`}
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
    <div className={`${BOX_FRAME} px-4 py-3.5 my-4 ${tone}`}>
      <div className="flex gap-2">
        <CalloutIcon role={role} icon={block.icon} />
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
  // 個人・部署リーダーのみ非null。未対応ブロックをNotionへの正直なリンクにする。
  const source = useContext(ReaderSourceCtx)
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
    case 'unsupported': {
      // 個人・部署リーダー: 描けないブロックは隠さず「Notionで表示」への正直な
      // プレースホルダにする（降格式の第1原則）。ブロックアンカー付きで該当箇所へ飛ぶ。
      if (source?.url) {
        const anchor = block.blockId ? `#${block.blockId.replace(/-/g, '')}` : ''
        return (
          <a
            href={`${source.url}${anchor}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => recordNotionEscape('reader', source.owner)}
            className="flex items-center gap-2 my-3 px-3 py-2.5 rounded-lg border border-dashed border-gray-300 dark:border-gray-600 text-[0.85em] text-gray-500 dark:text-gray-400 no-underline hover:border-gray-400 dark:hover:border-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
          >
            <ExternalLink className="w-[1em] h-[1em] shrink-0" aria-hidden="true" />
            <span className="min-w-0">このブロックはNotionで表示</span>
            {block.blockType && (
              <span className="ml-auto shrink-0 font-mono text-[0.8em] text-gray-400 dark:text-gray-500">{block.blockType}</span>
            )}
          </a>
        )
      }
      return (
        <p className="text-[0.75em] text-gray-400 dark:text-gray-500 my-1">
          {block.text}
        </p>
      )
    }
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

export function RenderedBlocks({
  blocks,
  onImageClick,
  active,
  offset = 0,
}: {
  blocks: ReaderBlock[]
  onImageClick: (u: string) => void
  active: Set<Confidence>
  // blocks が doc 全体の一部（節・epilogue）のときの元配列上の開始位置。
  // Block に渡す index が doc 全体と一致し、番号なしH2の data-section アンカー（i<index>）が
  // 目次バーの計算とズレなくなる。
  offset?: number
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
        return <Block key={i} block={g.block} index={offset + g.index} onImageClick={onImageClick} active={active} />
      })}
    </>
  )
}

// 要点モードの1節。折りたたみ時は要点行だけ、展開時はその節の全文だけを描く。
// 「差し替え」であって「追記」ではないので、要点行と全文が二重に出ることはない。
function DigestSectionView({
  section,
  blocks,
  onImageClick,
  active,
}: {
  section: DigestSection
  blocks: ReaderBlock[]
  onImageClick: (u: string) => void
  active: Set<Confidence>
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  // 閉じると上の余白が一気に縮み、読んでいた位置が画面外へ飛ぶ。節の頭へ戻して着地させる。
  // スクロールは effect で行う（rAF だと React のコミット前に走り、まだ展開されたままの
  // レイアウトを測って空振りする — ReaderOverlay が以前に踏んだのと同じ罠）。
  const closingRef = useRef(false)
  useEffect(() => {
    if (open || !closingRef.current) return
    closingRef.current = false
    ref.current?.scrollIntoView({ block: 'start' })
  }, [open])

  const toggle = () => {
    if (open) closingRef.current = true
    setOpen((v) => !v)
  }

  return (
    <div ref={ref}>
      {open ? (
        <RenderedBlocks
          blocks={blocks.slice(section.start, section.end)}
          offset={section.start}
          onImageClick={onImageClick}
          active={active}
        />
      ) : (
        section.items.map((p) => (
          <Block key={p.index} block={p.block} index={p.index} onImageClick={onImageClick} active={active} />
        ))
      )}
      <p className="my-3">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 min-h-[44px] text-[0.9em] text-brand-600 dark:text-brand-300 hover:text-brand-700 dark:hover:text-brand-200"
        >
          <BookOpenText className="w-[1.1em] h-[1.1em] shrink-0" aria-hidden="true" />
          {open ? 'この節を閉じる' : 'この節を全文で読む'}
        </button>
      </p>
    </div>
  )
}

// 要点モードの本文。⚡結論・節見出し・recap・図解・末尾の署名／査読スタンプだけを出し、
// 全文は節ごとにその場で開く（文書全体は要点のまま＝いつでも同じボタンで戻れる）。
// Block を使い回すことで全文モードと見た目（アンカー・スタイル）を完全に揃える。
function DigestBlocks({
  blocks,
  onImageClick,
  active,
}: {
  blocks: ReaderDoc['blocks']
  onImageClick: (u: string) => void
  active: Set<Confidence>
}) {
  const { preamble, sections, epilogue } = useMemo(() => digestSections(blocks), [blocks])
  return (
    <>
      {preamble.map((p) => (
        <Block key={p.index} block={p.block} index={p.index} onImageClick={onImageClick} active={active} />
      ))}
      {sections.map((s) => (
        <DigestSectionView
          key={s.anchor}
          section={s}
          blocks={blocks}
          onImageClick={onImageClick}
          active={active}
        />
      ))}
      {epilogue.length > 0 && (
        <RenderedBlocks
          blocks={epilogue}
          offset={blocks.length - epilogue.length}
          onImageClick={onImageClick}
          active={active}
        />
      )}
    </>
  )
}

export function ReaderBody({
  doc,
  onImageClick,
  active = new Set(),
  scaleEm,
  mode = 'full',
  owner,
}: {
  doc: ReaderDoc
  onImageClick: (url: string) => void
  active?: Set<Confidence>
  // Aaボタンの文字サイズ（SCALE_EM の値）。em なので iOS Dynamic Type と乗算で合成される。
  scaleEm?: string
  // 全文｜要点（ReaderOverlay の切替から渡る）。既定は従来どおり全文。
  mode?: ReaderViewMode
  // 開いているアイテムのowner（個人・部署リーダーの離脱計測用。サブスクは未指定でよい）。
  owner?: string
}) {
  // doc.sourceUrl は個人・部署リーダーのみ（サブスク配信は本文防衛のため常に無し）。
  const source = useMemo(() => (doc.sourceUrl ? { url: doc.sourceUrl, owner } : null), [doc.sourceUrl, owner])
  return (
    // 本文の組版。バッジを足す代わりに、読む時間そのものの質を上げる。
    // ・palt は見出し限定（地の文は自然な字幅＋微字間 — globals.css の .reader-prose 参照）
    // ・pretty: 行末で1語だけ落ちる不揃いを避ける
    // ・tabular-nums は数値の並ぶ医療本文で桁が揃い、読み比べやすくなる
    // いずれも要素も文字も増やさない。説明されないが毎回効く。
    //
    // サイズの流れ: .reader-prose（基準サイズ・iOSはDynamic Type）→ 内側ラッパー（Aa倍率）
    // → 本文/見出し/表は em 系サイズで連動拡大。更新日はメタ情報なので固定のまま。
    <ReaderSourceCtx.Provider value={source}>
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
        {/* ページアイコンは生の絵文字で出さず、種別ヒントとして KnowledgeTitle に渡す
            （タイトル先頭の絵文字は剥がされ lucide アイコンに置き換わる＝二重に出ない）。
            iconForLevel は includes 判定なので、画像アイコン（URL）は渡さない。 */}
        <h2 className="text-[1.42em] font-bold leading-snug text-gray-900 dark:text-gray-100 mb-4">
          <KnowledgeTitle title={doc.title} level={doc.icon?.startsWith('http') ? null : doc.icon} />
        </h2>
        {mode === 'digest' ? (
          <DigestBlocks blocks={doc.blocks} onImageClick={onImageClick} active={active} />
        ) : (
          <RenderedBlocks blocks={doc.blocks} onImageClick={onImageClick} active={active} />
        )}
      </div>
    </div>
    </ReaderSourceCtx.Provider>
  )
}
