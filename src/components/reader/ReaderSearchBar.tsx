'use client'
// リーダー内検索バー。IME確定（compositionend）までクエリを適用しない。
// 件数・prev/next はDOM上の mark[data-reader-search] を親（ReaderOverlay）が数えて渡す。
import { useEffect, useRef, useState } from 'react'
import { ChevronUp, ChevronDown, X } from 'lucide-react'

export function ReaderSearchBar({
  onQuery,
  total,
  pos,
  onPrev,
  onNext,
  onClose,
  initialValue = '',
}: {
  onQuery: (q: string) => void
  total: number
  pos: number
  onPrev: () => void
  onNext: () => void
  onClose: () => void
  initialValue?: string
}) {
  const [value, setValue] = useState(initialValue)
  const composingRef = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const apply = (v: string) => {
    if (!composingRef.current) onQuery(v)
  }

  return (
    <div className="flex items-center gap-1 px-4 py-2 border-b border-gray-200 dark:border-gray-700">
      <input
        ref={inputRef}
        type="search"
        value={value}
        placeholder="この記事の中を検索"
        aria-label="この記事の中を検索"
        onChange={(e) => { setValue(e.target.value); apply(e.target.value) }}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={(e) => { composingRef.current = false; onQuery(e.currentTarget.value) }}
        className="flex-1 min-w-0 text-sm bg-gray-100 dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-brand-300"
      />
      <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400 min-w-[3.5rem] text-center" aria-live="polite">
        {value.trim() === '' ? '' : total === 0 ? '見つかりません' : `${pos + 1}/${total}`}
      </span>
      <button type="button" onClick={onPrev} disabled={total === 0} aria-label="前のヒットへ"
        className="min-h-[44px] min-w-[36px] inline-flex items-center justify-center text-gray-500 dark:text-gray-400 disabled:opacity-40">
        <ChevronUp className="w-4 h-4" />
      </button>
      <button type="button" onClick={onNext} disabled={total === 0} aria-label="次のヒットへ"
        className="min-h-[44px] min-w-[36px] inline-flex items-center justify-center text-gray-500 dark:text-gray-400 disabled:opacity-40">
        <ChevronDown className="w-4 h-4" />
      </button>
      <button type="button" onClick={onClose} aria-label="検索を閉じる"
        className="min-h-[44px] min-w-[36px] inline-flex items-center justify-center text-gray-500 dark:text-gray-400">
        <X className="w-4 h-4" />
      </button>
    </div>
  )
}
