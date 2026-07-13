'use client'
import { useSearchBox } from 'react-instantsearch'
import { useEffect, useRef, useState } from 'react'
import { track } from '@vercel/analytics'
import { Search } from 'lucide-react'

export function SearchBox({ onSubmit }: { onSubmit?: (q: string) => void } = {}) {
  const { query, refine } = useSearchBox()
  const inputRef = useRef<HTMLInputElement>(null)
  const [inputValue, setInputValue] = useState(query)
  const composingRef = useRef(false)
  const trackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 外部からのクエリ変更（0件画面の例示キーワードタップ等の refine）を入力欄へ反映する。
  // IME変換中は composingRef ガードで上書きしない（変換テキストが消えるのを防ぐ）。
  useEffect(() => {
    if (!composingRef.current) setInputValue(query)
  }, [query])

  // Algolia検索の実行計測。refineはキーストローク毎に走るため、
  // 入力が1.2秒止まったら「1回の検索」としてカウントする（キーワードは送らない）。
  const trackSearch = (value: string) => {
    if (trackTimerRef.current) clearTimeout(trackTimerRef.current)
    if (!value.trim()) return
    trackTimerRef.current = setTimeout(() => {
      track('search_exec', { engine: 'algolia' })
      // フィードバック促進バナーの表示条件（検索5回）用カウンタ。
      try {
        const n = Number(localStorage.getItem('medinode_search_count') || '0') + 1
        localStorage.setItem('medinode_search_count', String(n))
      } catch {}
    }, 1200)
  }

  return (
    <div className="relative">
      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
        <Search className="h-5 w-5 text-gray-400 dark:text-gray-500" />
      </div>
      <input
        ref={inputRef}
        type="search"
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value)
          if (!composingRef.current) {
            refine(e.target.value)
            trackSearch(e.target.value)
          }
        }}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={(e) => {
          composingRef.current = false
          refine((e.target as HTMLInputElement).value)
          trackSearch((e.target as HTMLInputElement).value)
        }}
        onKeyDown={(e) => {
          // 日本語変換確定中のEnterは検索確定としない
          if (e.key === 'Enter' && !composingRef.current && !e.nativeEvent.isComposing) {
            const v = inputValue.trim()
            if (v && onSubmit) onSubmit(v)
          }
        }}
        placeholder="疾患名・キーワードで検索..."
        className="w-full pl-12 pr-4 py-4 text-lg border-2 border-gray-200 dark:border-gray-600 rounded-2xl focus:outline-none focus:border-brand-500 dark:focus:border-brand-400 bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 shadow-sm"
        autoFocus
      />
    </div>
  )
}
