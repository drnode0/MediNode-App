'use client'
import { useSearchBox } from 'react-instantsearch'
import { useRef, useState } from 'react'

export function SearchBox({ onSubmit }: { onSubmit?: (q: string) => void } = {}) {
  const { query, refine } = useSearchBox()
  const inputRef = useRef<HTMLInputElement>(null)
  const [inputValue, setInputValue] = useState(query)
  const composingRef = useRef(false)

  return (
    <div className="relative">
      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
        <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <input
        ref={inputRef}
        type="search"
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value)
          if (!composingRef.current) {
            refine(e.target.value)
          }
        }}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={(e) => {
          composingRef.current = false
          refine((e.target as HTMLInputElement).value)
        }}
        onKeyDown={(e) => {
          // 日本語変換確定中のEnterは検索確定としない
          if (e.key === 'Enter' && !composingRef.current && !e.nativeEvent.isComposing) {
            const v = inputValue.trim()
            if (v && onSubmit) onSubmit(v)
          }
        }}
        placeholder="疾患名・キーワードで検索..."
        className="w-full pl-12 pr-4 py-4 text-lg border-2 border-gray-200 rounded-2xl focus:outline-none focus:border-blue-500 bg-white shadow-sm"
        autoFocus
      />
    </div>
  )
}
