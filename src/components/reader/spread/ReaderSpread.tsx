'use client'
import { useContext, useMemo, useState } from 'react'
import { ReaderSearchCtx } from '../reader-search-context'
import { RenderedBlocks } from '../ReaderBody'
import { SpreadPartView } from './SpreadParts'
import type { Confidence } from '@/lib/reader-confidence'
import type { SpreadDoc } from '@/lib/reader-spread'

// 誌面の第1版は確信度フィルタを持たない。RenderedBlocks は active を必須で取るので、
// 描画のたびに new Set() を作らないよう定数を1つだけ置く。
const NO_FILTER: Set<Confidence> = new Set()

// 節ごとに index の起点をずらす幅。1つの節が持つブロック数の上限より十分大きく取り、
// 節をまたいで index（キーと番号なし見出しのアンカーに使う）が衝突しないようにする。
const SECTION_INDEX_STRIDE = 1000

/**
 * 誌面表示（TEXTBOOK LITE）。
 *
 * 二層構造: 表層＝情報の型に応じた部品（見て分かる）／深掘り＝現行の密な本文
 * （確かめられる）。深掘りは節ごとに開く。
 *
 * 本文（lead / preface / 各節の deep / tail）は必ず RenderedBlocks に描画を委ねる。
 * RenderedBlocks は ReaderBody 本体が本文全体・callout の子に対して使っているのと同じ
 * グルーピング単位（連続する list_item を ul/ol にまとめる等）で、callout の draft role
 * 処理も含む。自前で個別ブロックを描き直すと、箇条書きのグルーピングが失われたり、
 * 🎨制作メモを隠す draft role の処理が誌面だけ効かなくなったりする。
 *
 * 検索中は全節を開く。折りたたんだ本文は DOM に無く、ReaderOverlay の
 * 記事内検索（mark[data-reader-search] を数える）が拾えないため。
 */
export function ReaderSpread({
  spread,
  onImageClick,
}: {
  spread: SpreadDoc
  onImageClick: (url: string) => void
}) {
  const query = useContext(ReaderSearchCtx)
  const searching = query.trim().length > 0
  const [open, setOpen] = useState<Set<string>>(new Set())

  const toc = useMemo(
    () => spread.sections.map((s) => ({ anchor: s.anchor, label: s.shortLabel || s.title })),
    [spread.sections],
  )

  return (
    <div className="reader-prose">
      {spread.lead && (
        <div data-tldr="" className="mb-5">
          <RenderedBlocks blocks={[spread.lead]} onImageClick={onImageClick} active={NO_FILTER} />
        </div>
      )}

      {/* 最初のH2より前の本文。ここを描かないと、導入の段落が誌面から黙って消える。 */}
      <RenderedBlocks blocks={spread.preface} onImageClick={onImageClick} active={NO_FILTER} />

      {toc.length > 0 && (
        <nav className="flex flex-wrap gap-1.5 mb-6" aria-label="目次">
          {toc.map((s) => (
            <a
              key={s.anchor}
              href={`#${s.anchor}`}
              className="text-[0.8em] px-2.5 py-1 rounded-full bg-gray-100 dark:bg-white/[0.06] text-gray-700 dark:text-gray-200"
            >
              {s.label}
            </a>
          ))}
        </nav>
      )}

      {spread.sections.map((s, i) => {
        const isOpen = searching || open.has(s.anchor)
        return (
          <section key={s.anchor} className="mb-8">
            {/* data-section は横断検索の節ジャンプと ReaderNavBar が使う。値を変えないこと。 */}
            <h2
              id={s.anchor}
              data-section={s.anchor}
              className="flex items-start gap-2.5 rounded-lg bg-gray-50 dark:bg-white/[0.05] px-3 py-2.5 mb-3.5 text-[1.15em] font-bold text-gray-900 dark:text-gray-100"
            >
              <span className="shrink-0 w-7 h-7 rounded-full bg-brand-600 text-white text-sm grid place-items-center">
                {s.n ?? i + 1}
              </span>
              <span className="leading-snug pt-0.5">{s.title}</span>
            </h2>

            <SpreadPartView part={s.part} />

            <button
              type="button"
              onClick={() => setOpen((prev) => {
                const next = new Set(prev)
                if (next.has(s.anchor)) next.delete(s.anchor)
                else next.add(s.anchor)
                return next
              })}
              aria-expanded={isOpen}
              className="text-[0.85em] text-brand-700 dark:text-brand-300 underline min-h-[44px] px-1"
            >
              {isOpen ? 'この節の根拠を閉じる' : 'この節の根拠を見る'}
            </button>

            {isOpen && (
              <div className="mt-2">
                <RenderedBlocks
                  blocks={s.deep}
                  onImageClick={onImageClick}
                  active={NO_FILTER}
                  offset={(i + 1) * SECTION_INDEX_STRIDE}
                />
              </div>
            )}
          </section>
        )
      })}

      <RenderedBlocks
        blocks={spread.tail}
        onImageClick={onImageClick}
        active={NO_FILTER}
        offset={(spread.sections.length + 1) * SECTION_INDEX_STRIDE}
      />
    </div>
  )
}
