'use client'
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react'
import { List, X } from 'lucide-react'
import { findTldr, tocSections, type ReaderDoc, type ReaderBlock } from '@/lib/reader-doc'
import { docConfidenceMarks, type Confidence } from '@/lib/reader-confidence'
import { ConfidenceLegend } from './ConfidenceMark'
import { sectionHeadingParts } from '@/lib/title-display'

function blockPlainText(b: ReaderBlock): string {
  if (b.kind === 'paragraph' || b.kind === 'list_item' || b.kind === 'heading') return b.inlines.map((i) => i.text).join('')
  if (b.kind === 'callout') return b.blocks.map(blockPlainText).filter(Boolean).join(' ')
  return ''
}

// 目次は操作バーから必要なときに開く。本文上に追従バーを重ねない。
export function ReaderNavBar({ doc, scrollRef, active }: {
  doc: ReaderDoc
  scrollRef: RefObject<HTMLDivElement | null>
  active: Set<Confidence>
}) {
  const tldr = findTldr(doc)
  const sections = useMemo(() => tocSections(doc), [doc])
  const marks = useMemo(() => docConfidenceMarks(doc.blocks), [doc])
  const barId = useId()
  const dropdownId = `${barId}-dropdown`
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [open])
  if (!tldr && sections.length === 0) return null
  const jumpToSection = (anchor: string) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-section="${anchor}"]`)
    setOpen(false)
    if (el) {
      el.setAttribute('tabindex', '-1')
      el.focus({ preventScroll: true })
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }
  const answerParagraphs = tldr ? tldr.blocks.map(blockPlainText).filter(Boolean) : []
  return (
    <div ref={rootRef} onKeyDown={(event) => {
      if (event.key === 'Escape' && open) {
        event.preventDefault(); event.stopPropagation(); setOpen(false); buttonRef.current?.focus()
      }
    }}>
      <button ref={buttonRef} type="button" id={barId} aria-expanded={open} aria-controls={dropdownId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex items-center justify-center gap-1 min-h-[44px] px-2 text-sm text-brand-700 dark:text-brand-300">
        <List className="h-4 w-4" aria-hidden="true" /><span>目次</span>
        {active.size > 0 && <span className="h-1.5 w-1.5 rounded-full bg-brand-500" aria-label="確信度の強調中" />}
      </button>
      {open && <div id={dropdownId} role="region" aria-labelledby={barId}
        className="absolute top-full left-3 right-3 z-30 max-h-[65vh] overflow-y-auto rounded-xl bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 shadow-lg px-4 py-3">
        <div className="flex items-center justify-between border-b border-gray-200 dark:border-gray-700 mb-2">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-100">この記事の目次</span>
          <button type="button" aria-label="目次を閉じる" className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center text-gray-500"
            onClick={() => { setOpen(false); buttonRef.current?.focus() }}><X className="w-4 h-4" /></button>
        </div>
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
                <ConfidenceLegend marks={marks} itemClassName="text-xs text-gray-500 dark:text-gray-400" />
              </div>
            )}
        {active.size > 0 && <button type="button" className="min-h-[44px] text-sm text-brand-700 dark:text-brand-300"
          onClick={() => { setOpen(false); scrollRef.current?.scrollTo({top: 0, behavior: 'smooth'}); buttonRef.current?.focus() }}>確信度の強調を変更</button>}
      </div>}
    </div>
  )
}
