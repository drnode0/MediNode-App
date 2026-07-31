'use client'
// 「役に立った」ボタン（共通の見た目）。リーダー末尾と解決済みCQカードで使う。
// 見た目・トグルの作法は受付中の「私も気になる」ボタン（ResolvedCqs の OpenCqBoard）に合わせる。
import { ThumbsUp } from 'lucide-react'

export function HelpfulButton({ pressed, disabled, onClick }: {
  pressed: boolean
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1 border transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
        pressed
          ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-300 dark:border-brand-600 text-brand-700 dark:text-brand-200'
          : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'
      }`}
    >
      <ThumbsUp className="w-3.5 h-3.5 shrink-0" strokeWidth={2.2} />
      {pressed ? '役に立った（済）' : '役に立った'}
    </button>
  )
}
