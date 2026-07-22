'use client'
import { CircleCheck } from 'lucide-react'
import {
  calloutRole,
  parseSectionHeading,
  isRecapText,
  type ReaderDoc,
  type ReaderBlock,
  type ReaderInline,
} from '@/lib/reader-doc'
import { CONFIDENCE_MARKS, isDimmed, type Confidence } from '@/lib/reader-confidence'
import { ConfidenceMark, MARK_COLOR } from './ConfidenceMark'

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

function Inlines({ items, k }: { items: ReaderInline[]; k: string }) {
  return (
    <>
      {items.map((n, i) => {
        const cls = [
          n.bold ? 'font-medium' : '',
          n.italic ? 'italic' : '',
          n.code ? 'font-mono text-[0.85em] bg-gray-100 dark:bg-gray-700 px-1 rounded' : '',
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
              className={`${cls} ${linkColor} underline underline-offset-2`}
            >
              {n.text}
            </a>
          )
        }
        return (
          <span key={i} className={cls}>
            {renderText(n.text, `${k}-${i}`)}
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
  if (isRecapText(text)) return 'text-gray-500 dark:text-gray-400 border-l-2 border-teal-500/30 pl-2.5'
  return 'text-gray-800 dark:text-gray-200'
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
        className="rounded-r-lg border-l-4 border-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2.5 my-3"
      >
        <div className="flex gap-2">
          {block.icon && <span className="shrink-0 text-base leading-6">{block.icon}</span>}
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
        className="rounded-r-lg border-l-4 border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20 px-3 py-2.5 my-3"
      >
        <div className="flex gap-3">
          <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center shrink-0 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/drnode-avatar.png" alt="" className="w-full h-full object-contain p-1" />
          </div>
          <div className="min-w-0">
            {hasHeadingText && (
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 mb-1">
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
          <div className="min-w-0 text-sm text-gray-600 dark:text-gray-300">
            <RenderedBlocks blocks={block.blocks} onImageClick={onImageClick} active={active} />
          </div>
        </div>
      </div>
    )
  }

  // evidence / disclaimer / plain: 既存 CALLOUT_TONE 準拠（disclaimer は常に gray）。
  const tone = role === 'disclaimer' ? CALLOUT_TONE.gray_background : (block.color && CALLOUT_TONE[block.color]) || CALLOUT_TONE.gray_background
  return (
    <div className={`border-l-4 rounded-r-lg px-3 py-2.5 my-3 ${tone}`}>
      <div className="flex gap-2">
        {block.icon && <span className="shrink-0 text-base leading-6">{block.icon}</span>}
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
        if (p) {
          return (
            <div data-section={p.n} className="flex items-start gap-2 mt-6 mb-2">
              <span className="text-[13px] font-bold tabular-nums text-teal-700 dark:text-teal-300 bg-teal-500/12 w-[22px] h-[22px] rounded-md inline-flex items-center justify-center shrink-0 mt-0.5">
                {p.n}
              </span>
              <h3 className="text-base font-medium text-gray-900 dark:text-gray-100 leading-snug">{p.rest}</h3>
            </div>
          )
        }
      }
      const size = block.level === 1 ? 'text-lg' : block.level === 2 ? 'text-base' : 'text-sm'
      return (
        <h3 className={`${size} font-medium text-gray-900 dark:text-gray-100 mt-5 mb-1.5`}>
          <Inlines items={block.inlines} k={`h-${index}`} />
        </h3>
      )
    }
    case 'paragraph': {
      const color = textColorClass(block, active)
      return (
        <p
          className={`text-sm leading-relaxed my-2 transition-colors duration-150 motion-reduce:transition-none ${color}`}
        >
          <Inlines items={block.inlines} k={`p-${index}`} />
        </p>
      )
    }
    case 'callout':
      return <CalloutBlock block={block} index={index} onImageClick={onImageClick} active={active} />
    case 'image':
      return (
        <button type="button" onClick={() => onImageClick(block.url)} className="block w-full my-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={block.url} alt={block.caption ?? ''} className="w-full rounded-lg border border-gray-200 dark:border-gray-700" />
          {block.caption && <span className="block text-xs text-gray-500 dark:text-gray-400 mt-1">{block.caption}</span>}
        </button>
      )
    case 'divider':
      return <hr className="my-4 border-gray-200 dark:border-gray-700" />
    case 'table':
      return (
        <div className="overflow-x-auto my-3">
          <table className="text-xs border-collapse">
            <tbody>
              {block.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td key={c} className="border border-gray-200 dark:border-gray-700 px-2 py-1">
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
        <p className="text-xs text-gray-400 dark:text-gray-500 my-1">
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
              className={`${g.ordered ? 'list-decimal' : 'list-disc'} pl-5 my-2 space-y-1 text-sm`}
            >
              {g.items.map((it, j) => {
                const pseudo: ReaderBlock = { kind: 'list_item', ordered: g.ordered, inlines: it }
                const color = textColorClass(pseudo, active)
                return (
                  <li
                    key={j}
                    className={`leading-relaxed transition-colors duration-150 motion-reduce:transition-none ${color}`}
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
}: {
  doc: ReaderDoc
  onImageClick: (url: string) => void
  active?: Set<Confidence>
}) {
  return (
    <div>
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
      <h2 className="text-lg font-medium text-gray-900 dark:text-gray-100 mb-3">
        {doc.icon && !doc.icon.startsWith('http') && <span className="mr-1">{doc.icon}</span>}
        {doc.title}
      </h2>
      <RenderedBlocks blocks={doc.blocks} onImageClick={onImageClick} active={active} />
    </div>
  )
}
