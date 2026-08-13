'use client'
import { useEffect, useId, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react'
import { ChevronDown, Zap, List } from 'lucide-react'
import { findTldr, tocSections, type ReaderDoc, type ReaderBlock } from '@/lib/reader-doc'
import { docConfidenceMarks, CONFIDENCE_LABEL, type Confidence } from '@/lib/reader-confidence'
import { ConfidenceMark } from './ConfidenceMark'
import { sectionHeadingParts } from '@/lib/title-display'

// ⚡結論 callout の子ブロックを読める平文へ畳み込む（表・画像・区切り線は無視）。
function blockPlainText(b: ReaderBlock): string {
  if (b.kind === 'paragraph' || b.kind === 'list_item' || b.kind === 'heading') {
    return b.inlines.map((i) => i.text).join('')
  }
  if (b.kind === 'callout') return b.blocks.map(blockPlainText).filter(Boolean).join(' ')
  return ''
}

export function ReaderNavBar({
  doc,
  scrollRef,
  active,
}: {
  doc: ReaderDoc
  scrollRef: RefObject<HTMLDivElement>
  active: Set<Confidence>
}) {
  const tldr = findTldr(doc)
  const sections = useMemo(() => tocSections(doc), [doc])
  const marks = useMemo(() => docConfidenceMarks(doc.blocks), [doc])
  const barId = useId()
  const dropdownId = `${barId}-dropdown`

  const [visible, setVisible] = useState(false)
  const [open, setOpen] = useState(false)
  const [progress, setProgress] = useState(0)
  // sticky が実際に上端へ貼り付いているか。貼り付く前（＝スクロール上端付近）は
  // h-0 のラッパーがフロー位置に居るため、バーを描くとタイトルの上に重なる。
  const [pinned, setPinned] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const stickyRef = useRef<HTMLDivElement>(null)

  // ⚡ callout（無ければ最初のセクション見出し）の可視性を監視し、画面外に出たらバーを表示する。
  // IO 非対応環境では常に非表示のまま。
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const root = scrollRef.current
    const target = tldr
      ? (root?.querySelector('[data-tldr]') ?? null)
      : (root?.querySelector('[data-section]') ?? null)
    if (!root || !target) return

    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry) setVisible(!entry.isIntersecting)
      },
      { root, rootMargin: '-8px 0px 0px 0px' },
    )
    io.observe(target)
    return () => io.disconnect()
  }, [tldr, scrollRef])

  // スクロール容器の scroll イベントで読了インクを更新し、ドロップダウンを自動収納する。
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const onScroll = () => {
      const denom = el.scrollHeight - el.clientHeight
      const pct = denom > 0 ? Math.min(100, Math.max(0, (el.scrollTop / denom) * 100)) : 0
      setProgress(pct)
      setOpen(false)
      // sticky が貼り付くと、ラッパーはフロー位置（＝sentinel の位置）から離れて上端に留まる。
      // その差が出ている間だけバーを描く。両方 h-0 なのでこの判定自体はレイアウトを動かさない。
      const s = sentinelRef.current
      const w = stickyRef.current
      if (s && w) setPinned(w.getBoundingClientRect().top - s.getBoundingClientRect().top > 0.5)
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [scrollRef])

  if (!tldr && sections.length < 2) return null
  // ⚡ がまだ画面内にある間はバー本体を DOM に一切出さない（opacity-0 のみだと
  // min-h-[44px] 分の空きが常に残ってしまうため）。可視性の判定自体は上の
  // useEffect が常に走らせ続ける。
  // sentinel と sticky ラッパーは常にマウントする（どちらも h-0 ＝レイアウトに一切影響しない）。
  // 貼り付き判定に実測が要るうえ、マウント/アンマウント自体を条件にすると
  // 判定材料が消えてしまうため。
  const shown = visible && pinned

  const jumpToSection = (anchor: string) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-section="${anchor}"]`)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      el.setAttribute('tabindex', '-1')
      el.focus()
    }
    setOpen(false)
  }

  const scrollToChips = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const answerParagraphs = tldr ? tldr.blocks.map(blockPlainText).filter(Boolean) : []

  return (
    <>
      {/* 貼り付き判定の基準点（フロー位置）。h-0 なのでレイアウトには影響しない。 */}
      <div ref={sentinelRef} className="h-0" aria-hidden="true" />
      {/* h-0: バー・ドロップダウンを文書フローから外す（オーバーレイ描画）。
          高さを持たせると、バーの出現/消滅やパネルの開閉が本文を押し下げ、
          IntersectionObserverの監視対象（⚡/最初の節見出し）が画面内外を往復して
          表示⇄非表示が毎フレーム発振する（実機で「細かい揺れ」として観測・2026-08-12）。
          高さ0ならマウントしてもレイアウトが1pxも動かず、フィードバック経路が存在しない。
          -top-4: sticky は既定でスクロール容器の pt-4 の下に貼り付くため、バーの上に
          16px の隙間が残り、そこを本文が通り抜けて見える。容器の上端まで詰める。 */}
      <div ref={stickyRef} className="sticky -top-4 z-20 h-0">
        {shown && (
          // 背景は不透明にする。bg-purple-500/10 だけだと下を通る本文が透けて
          // 「タイトルや本文とバーが重なって見える」（2026-08-13 実機報告）。
          // backdrop-blur はにじませるだけで隠せない。
          <div className="relative w-full flex items-stretch bg-purple-50 dark:bg-gray-700 border-b border-purple-500/20">
            <button
              type="button"
              id={barId}
              aria-expanded={open}
              aria-controls={dropdownId}
              onClick={() => setOpen((o) => !o)}
              className="flex-1 min-w-0 min-h-[44px] flex items-center gap-1.5 px-3 text-sm font-medium text-purple-700 dark:text-purple-200 cursor-pointer"
            >
              <ChevronDown
                className={`w-4 h-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none ${open ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
              {tldr ? (
                <Zap className="w-4 h-4 shrink-0" aria-hidden="true" />
              ) : (
                <List className="w-4 h-4 shrink-0" aria-hidden="true" />
              )}
              <span className="truncate">{tldr ? 'この問いへの答え・目次' : '目次'}</span>
            </button>
            {active.size > 0 && (
              <button
                type="button"
                onClick={scrollToChips}
                aria-label="表示中の確信度フィルタへ戻る"
                className="flex items-center gap-1 shrink-0 min-h-[44px] min-w-[44px] justify-center px-3"
              >
                {[...active].map((c) => (
                  <ConfidenceMark key={c} kind={c} />
                ))}
              </button>
            )}
            <span
              className="absolute left-0 bottom-0 h-[2px] bg-purple-500 dark:bg-purple-400 transition-[width] duration-150 motion-reduce:transition-none motion-reduce:duration-0"
              style={{ width: `${Math.round(progress)}%` }}
              aria-hidden="true"
            />
          </div>
        )}
        {shown && open && (
          <div
            id={dropdownId}
            role="region"
            aria-labelledby={barId}
            className="max-h-[60vh] overflow-y-auto bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 shadow-sm px-3 py-3"
          >
            {answerParagraphs.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-medium text-amber-700 dark:text-amber-300 mb-1">答え</p>
                {answerParagraphs.map((t, i) => (
                  <p key={i} className="text-sm leading-relaxed text-gray-800 dark:text-gray-200 my-1">
                    {t}
                  </p>
                ))}
              </div>
            )}

            {sections.length > 0 && (
              <div className="mb-3">
                <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">セクション</p>
                <ul>
                  {sections.map((s) => (
                    <li key={s.anchor}>
                      <button
                        type="button"
                        onClick={() => jumpToSection(s.anchor)}
                        className="w-full min-h-[44px] flex items-center gap-2 text-left text-sm text-gray-800 dark:text-gray-200 hover:text-brand-600 dark:hover:text-brand-300"
                      >
                        {s.n != null && (
                          <span className="text-[13px] font-bold tabular-nums text-teal-700 dark:text-teal-300 bg-teal-500/12 w-[22px] h-[22px] rounded-md inline-flex items-center justify-center shrink-0">
                            {s.n}
                          </span>
                        )}
                        {s.n != null ? (
                          <span className="truncate">{`${s.n}. ${s.title}`}</span>
                        ) : (() => {
                          const { Icon: SecIcon, color: secColor, text: secText } = sectionHeadingParts(s.title)
                          return (
                            <span className="truncate">
                              {SecIcon && <SecIcon className={`inline-block align-[-0.125em] mr-1 h-3.5 w-3.5 ${secColor}`} aria-hidden />}
                              {secText}
                            </span>
                          )
                        })()}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {marks.length > 0 && (
              <div className="flex flex-wrap gap-x-3 gap-y-1 pt-2 border-t border-gray-200 dark:border-gray-700">
                {marks.map((m) => (
                  <span key={m} className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                    <ConfidenceMark kind={m} />
                    {CONFIDENCE_LABEL[m]}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  )
}
