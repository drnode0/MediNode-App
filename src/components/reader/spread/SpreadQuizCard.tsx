'use client'
import { useState } from 'react'
import type { SpreadQuiz } from '@/lib/reader-spread'

// 節末の理解チェック。採点は端末の中だけで完結し、サーバーには何も送らない
// （既存のクイズ・SRSと同じ方針）。正誤を出したあと、根拠の逐語をそのまま見せる。
export function SpreadQuizCard({ quiz }: { quiz: SpreadQuiz }) {
  const [picked, setPicked] = useState<number | null>(null)
  const answered = picked !== null
  return (
    <div className="my-4 rounded-lg bg-soft-light dark:bg-soft-dark px-4 py-3.5">
      <div className="text-[0.8em] font-bold text-gray-500 dark:text-gray-400 mb-1.5">理解チェック</div>
      <p className="font-bold leading-relaxed mb-2.5">{quiz.question}</p>
      <div className="space-y-1.5">
        {quiz.choices.map((c, i) => {
          const correct = i === quiz.answerIndex
          const tone = !answered
            ? 'bg-card-light dark:bg-card-dark'
            : correct
              ? 'bg-brand-50 dark:bg-brand-900/30 font-bold'
              : i === picked
                ? 'bg-gray-100 dark:bg-white/[0.08] line-through text-gray-500 dark:text-gray-400'
                : 'bg-card-light dark:bg-card-dark opacity-60'
          return (
            <button
              key={i}
              type="button"
              disabled={answered}
              onClick={() => setPicked(i)}
              className={`block w-full text-left px-3 py-2.5 rounded-lg min-h-[44px] leading-relaxed ${tone}`}
            >
              {c}
            </button>
          )
        })}
      </div>
      {answered && (
        <p className="text-[0.85em] text-gray-600 dark:text-gray-300 mt-2.5 leading-relaxed">
          {quiz.evidence}
        </p>
      )}
    </div>
  )
}
