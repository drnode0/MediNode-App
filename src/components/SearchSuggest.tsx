'use client'
// 入力中の検索語に部分一致する「最近の検索」候補をドロップダウンで出す。
// 候補は検索履歴のみ（結果一覧は入力に追従してライブ表示されるため、タイトル候補は出さない）。
import { Clock } from 'lucide-react'

const MAX_SUGGESTIONS = 5

export function matchSuggestions(value: string, history: string[]): string[] {
  const v = value.trim().toLowerCase()
  if (!v) return []
  return history
    .filter((h) => h.toLowerCase() !== v && h.toLowerCase().includes(v))
    .slice(0, MAX_SUGGESTIONS)
}

export function SearchSuggest({
  value,
  history,
  visible,
  onPick,
}: {
  value: string
  history: string[]
  visible: boolean
  onPick: (q: string) => void
}) {
  const matches = matchSuggestions(value, history)
  if (!visible || matches.length === 0) return null

  return (
    <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg overflow-hidden">
      {matches.map((q) => (
        <button
          key={q}
          type="button"
          // blurより先に発火させてタップを確定させる（onClickだと先に閉じて取りこぼす）
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(q)}
          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700"
        >
          <Clock className="w-3.5 h-3.5 text-gray-300 dark:text-gray-500 shrink-0" />
          <span className="truncate">{q}</span>
        </button>
      ))}
    </div>
  )
}
