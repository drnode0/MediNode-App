'use client'
import { useEffect, useId, useMemo, useState, type MouseEvent, type RefObject } from 'react'
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
    }
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [scrollRef])

  if (!tldr && sections.length < 2) return null
  // ⚡ がまだ画面内にある間はバー本体を DOM に一切出さない（opacity-0 のみだと
  // min-h-[44px] 分の空きが常に残ってしまうため）。可視性の判定自体は上の
  // useEffect が常に走らせ続ける。
  if (!visible) return null

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
    <div className="sticky top-0 z-20">
      <div className="relative w-full flex items-stretch bg-purple-500/10 dark:bg-purple-400/10 backdrop-blur border-b border-purple-500/20">
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
      {open && (
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
  )
}
