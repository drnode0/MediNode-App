'use client'

import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ExternalLink, X } from 'lucide-react'
import type { ReaderBlock } from '@/lib/reader-doc'
import { buildReaderCitations, scholarlySourceUrl, type ReaderCitation } from '@/lib/reader-citations'

const CitationContext = createContext<{
  citations: Map<string, ReaderCitation>
  open: (citation: ReaderCitation, label: string) => void
} | null>(null)

export function ReaderCitationProvider({ blocks, children }: { blocks: ReaderBlock[]; children: ReactNode }) {
  const citations = useMemo(() => buildReaderCitations(blocks), [blocks])
  const [selected, setSelected] = useState<(ReaderCitation & { clickedLabel: string }) | null>(null)
  const value = useMemo(() => ({
    citations,
    open: (citation: ReaderCitation, label: string) => setSelected({ ...citation, clickedLabel: label }),
  }), [citations])
  return (
    <CitationContext.Provider value={value}>
      {children}
      {selected && <CitationDialog citation={selected} onClose={() => setSelected(null)} />}
    </CitationContext.Provider>
  )
}

function CitationDialog({ citation, onClose }: {
  citation: ReaderCitation & { clickedLabel: string }
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()
  useEffect(() => {
    const dialog = ref.current
    if (!returnFocusRef.current) returnFocusRef.current = document.activeElement as HTMLElement | null
    if (dialog && !dialog.open) dialog.showModal()
    return () => {
      // StrictMode replays effects while leaving this DOM node mounted. Closing
      // here queues a native close event that can dismiss the reopened dialog.
      // A real unmount removes the dialog from the top layer without close().
      if (dialog && !dialog.isConnected) returnFocusRef.current?.focus({ preventScroll: true })
    }
  }, [])
  return createPortal(
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={(event) => { if (!event.currentTarget.open) onClose() }}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose() }}
      className="m-auto w-[calc(100%_-_2rem)] max-w-lg rounded-2xl border border-gray-200 bg-white p-0 text-gray-900 shadow-xl backdrop:bg-black/35 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
    >
      <div className="p-5">
        <div className="mb-3 flex items-center justify-between gap-4">
          <h2 id={titleId} className="text-sm font-semibold text-gray-500 dark:text-gray-400">出典 {citation.number}</h2>
          <button type="button" onClick={onClose} aria-label="出典を閉じる" className="-mr-2 -mt-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full hover:bg-gray-100 dark:hover:bg-gray-800">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <p className="break-words text-base font-semibold leading-relaxed">{citation.clickedLabel}</p>
        {citation.bibliography && <p className="mt-3 break-words text-sm leading-relaxed text-gray-600 dark:text-gray-300">{citation.bibliography}</p>}
        <a href={citation.href} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-[44px] items-center gap-2 text-sm font-semibold text-brand-600 underline underline-offset-4 dark:text-brand-300">
          原典を開く<ExternalLink size={15} aria-hidden="true" />
        </a>
      </div>
    </dialog>,
    document.body,
  )
}

export function CitationNumber({ href, label }: { href: string; label: string }) {
  const context = useContext(CitationContext)
  const normalized = scholarlySourceUrl(href)
  const citation = normalized ? context?.citations.get(normalized) : undefined
  if (!citation || !context) return null
  return (
    <button
      type="button"
      onClick={(event) => { event.stopPropagation(); context.open(citation, label) }}
      aria-label={`出典 ${citation.number}: ${label}`}
      aria-haspopup="dialog"
      title={label}
      className="mx-0.5 inline-flex min-h-[24px] min-w-[24px] items-center justify-center rounded px-0.5 align-baseline text-[0.78em] font-medium leading-none text-brand-600 hover:bg-brand-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 dark:text-brand-300 dark:hover:bg-brand-950"
    >
      [{citation.number}]
    </button>
  )
}

export function useReaderCitations() {
  return useContext(CitationContext)?.citations
}
