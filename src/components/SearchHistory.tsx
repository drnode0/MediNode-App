'use client'
import { useEffect, useState } from 'react'

const HISTORY_KEY = 'medical_search_history'
const MAX_HISTORY = 10

export function useSearchHistory() {
  const [history, setHistory] = useState<string[]>([])

  useEffect(() => {
    try {
      const stored = localStorage.getItem(HISTORY_KEY)
      if (stored) {
        // 壊れた値（配列でないJSON）が入っていても .map/.filter で落ちないよう検証する。
        const parsed = JSON.parse(stored)
        setHistory(Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [])
      }
    } catch {}
  }, [])

  const addHistory = (query: string) => {
    if (!query.trim()) return
    setHistory((prev) => {
      const next = [query, ...prev.filter((q) => q !== query)].slice(0, MAX_HISTORY)
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  const clearHistory = () => {
    setHistory([])
    try { localStorage.removeItem(HISTORY_KEY) } catch {}
  }

  return { history, addHistory, clearHistory }
}

export function SearchHistoryList({
  history,
  onSelect,
  onClear,
}: {
  history: string[]
  onSelect: (q: string) => void
  onClear: () => void
}) {
  if (history.length === 0) return null

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-gray-400 font-medium">最近の検索</p>
        <button onClick={onClear} className="text-xs text-gray-300 hover:text-gray-500 dark:text-gray-400">
          クリア
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {history.map((q) => (
          <button
            key={q}
            onClick={() => onSelect(q)}
            className="flex items-center gap-1 px-3 py-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-full text-sm text-gray-600 dark:text-gray-300 hover:border-brand-400 hover:text-brand-600 dark:text-brand-300 transition-colors"
          >
            <svg className="w-3 h-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {q}
          </button>
        ))}
      </div>
    </div>
  )
}
