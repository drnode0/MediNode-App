'use client'
// 本文のインライン描画（太字・リンク・文字色・検索ハイライト）。
// ReaderBody から切り出した共有部品。スプレッド（components/reader/spread）も同じものを使う。
// mark[data-reader-search] の出し方は ReaderOverlay が DOM を数えて現在位置を
// 付け替える前提なので、属性と構造を変えないこと。
import { createContext, useContext } from 'react'
import { Bookmark } from 'lucide-react'
import { type ReaderInline } from '@/lib/reader-doc'
import { CONFIDENCE_MARKS, type Confidence } from '@/lib/reader-confidence'
import { ConfidenceMark, MARK_COLOR } from './ConfidenceMark'
import { ReaderSearchCtx } from './reader-search-context'
import { findMatchRanges, inlineSegments } from '@/lib/reader-search'
import { detachedCitationIndexes, scholarlySourceUrl } from '@/lib/reader-citations'
import { CitationNumber, useReaderCitations } from './ReaderCitations'

// CONFIDENCE_MARKS からマーク文字を導出する（表記ゆれ防止：分割用正規表現と判定マップを同一ソースから作る）。
const MARK_OF: Record<string, Confidence> = Object.fromEntries(
  (Object.entries(CONFIDENCE_MARKS) as [Confidence, string][]).map(([c, mark]) => [mark, c]),
) as Record<string, Confidence>
// 🔖 は参考文献の収録レベル印（この出典に文献カードがある目印。medinode-reference-note §5）。
// 原本の記法は絵文字のまま、表示時に線画へ変換する。✅⚠️❓→ConfidenceMark と同じ流儀で、
// スプレッドの「絵文字はアイコンに使わない」方針（2026-08-27・線画SVG）に本文表示を揃える。
const BOOKMARK = '🔖'
const MARK_RE = new RegExp(`(${[...Object.values(CONFIDENCE_MARKS), BOOKMARK].join('|')})`)

// テキストを確信度マーク・収録レベル印で分割し、マーク位置に線画アイコンを差し込む。
function renderText(text: string, key: string) {
  const parts = text.split(MARK_RE)
  return parts.map((seg, i) =>
    MARK_OF[seg] ? (
      <ConfidenceMark key={`${key}-${i}`} kind={MARK_OF[seg]} className="mx-0.5 align-baseline" />
    ) : seg === BOOKMARK ? (
      <span key={`${key}-${i}`} className="inline-flex items-baseline text-gray-400 dark:text-gray-500">
        <Bookmark className="w-[0.9em] h-[0.9em] shrink-0 self-center" aria-hidden="true" strokeWidth={2.2} />
        <span className="sr-only">（文献カードあり）</span>
      </span>
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
// 旧スプレッドからのimport互換。自動マーカーは廃止し、作者の明示色だけを描く。
export const NoAutoMarkerCtx = createContext(false)

export function Inlines({ items, k, plain }: { items: ReaderInline[]; k: string; plain?: boolean }) {
  const searchQuery = useContext(ReaderSearchCtx)
  const citations = useReaderCitations()
  const detached = !plain && !searchQuery && citations ? detachedCitationIndexes(items) : new Set<number>()
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
        const color = n.color ? INLINE_COLOR[n.color] ?? '' : ''
        const cls = [
          n.bold ? 'font-[650]' : '',
          n.italic ? 'italic' : '',
          n.code ? 'font-mono text-[0.85em] bg-gray-100 dark:bg-gray-700 px-1 rounded' : '',
          plain ? '' : color,
        ].join(' ')
        if (n.href) {
          // 直前のノードが確信度マーク単体なら、リンクの文字色をマークの意味色へ寄せる。
          // ただし確信度の一次表現は ConfidenceMark（sr-only 語）に置く。
          const prevMark = MARK_OF[items[i - 1]?.text?.trim() ?? '']
          const linkColor = prevMark ? MARK_COLOR[prevMark] : 'text-brand-600 dark:text-brand-300'
          const sourceUrl = scholarlySourceUrl(n.href)
          if (detached.has(i) && sourceUrl && citations?.has(sourceUrl)) {
            return <CitationNumber key={i} href={n.href} label={n.text} />
          }
          // 文中のリンクや出典と判定できないものは、文字を省略せず本文として読む。
          // 検索中も元の全文を出し、原本上のヒット位置とDOMのmarkを一致させる。
          return (
            <a
              key={i}
              href={n.href}
              target="_blank"
              rel="noopener noreferrer"
              className={`underline decoration-current/40 underline-offset-4 break-words ${linkColor} ${cls}`}
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
