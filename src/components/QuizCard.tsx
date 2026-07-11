'use client'
import { useState } from 'react'
import type { Hit } from './ResultCard'
import { recordQuizResult } from '@/lib/quiz-srs'

const LEVEL_STYLE: Record<string, string> = {
  '❓ クリニカルクエスチョン': 'bg-yellow-50 text-yellow-700',
  '💡 ナレッジ': 'bg-green-50 text-green-700',
  '📋 まとめ': 'bg-blue-50 text-blue-700',
}

export function QuizCard({ hit, index }: { hit: Hit; index: number }) {
  const [revealed, setRevealed] = useState(false)
  // 「覚えた／まだ」の自己申告（このカードで申告済みならその結果を保持して表示を変える）。
  const [answered, setAnswered] = useState<'ok' | 'ng' | null>(null)

  const answer = (ok: boolean) => {
    recordQuizResult(hit.objectID, ok)
    setAnswered(ok ? 'ok' : 'ng')
  }
  const isMedical = hit.source === 'medical'
  const borderColor = isMedical ? 'border-l-blue-400' : 'border-l-amber-400'
  const displaySummary = hit.aiSummary || hit.summary || null
  const levelStyle = hit.knowledgeLevel ? (LEVEL_STYLE[hit.knowledgeLevel] || 'bg-gray-50 text-gray-600') : ''

  return (
    <div className={`bg-white rounded-xl border border-gray-200 border-l-4 ${borderColor} overflow-hidden`}>
      {/* タイトル部分：常に表示 */}
      <button
        className="w-full text-left p-4"
        onClick={() => !revealed && setRevealed(true)}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <span className="text-xs text-gray-300 mr-2">#{index + 1}</span>
            <span className="font-semibold text-gray-900 text-base">{hit.title}</span>
          </div>
          {!revealed && (
            <span className="shrink-0 text-xs text-blue-500 font-medium border border-blue-200 rounded-full px-2 py-0.5">
              答えを見る
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {hit.knowledgeLevel && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${levelStyle}`}>
              {hit.knowledgeLevel}
            </span>
          )}
          {hit.genre && (
            <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
              {hit.genre}
            </span>
          )}
        </div>
      </button>

      {/* 要約：タップ後に展開 */}
      {revealed && (
        <div className="px-4 pb-4 border-t border-gray-100">
          <div className="pt-3">
            {displaySummary ? (
              <p className="text-sm text-gray-700 leading-relaxed">{displaySummary}</p>
            ) : (
              <p className="text-sm text-gray-400 italic">要約なし</p>
            )}
          </div>
          {/* 自己申告（簡易・間隔反復）: 記録すると次回の出題順で「まだ」が優先される */}
          {answered === null ? (
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => answer(false)}
                className="flex-1 text-sm font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg py-2 transition-colors"
              >
                🔁 まだ
              </button>
              <button
                onClick={() => answer(true)}
                className="flex-1 text-sm font-semibold text-green-700 bg-green-50 hover:bg-green-100 rounded-lg py-2 transition-colors"
              >
                ✅ 覚えた
              </button>
            </div>
          ) : (
            <p className="text-xs text-gray-400 mt-3 text-center">
              {answered === 'ok' ? '✅ 記録しました。次回は後ろの方に出ます' : '🔁 記録しました。次回は優先して出ます'}
            </p>
          )}
          <div className="flex items-center justify-between mt-3">
            <button
              onClick={() => setRevealed(false)}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              隠す
            </button>
            <a
              href={hit.notionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              Notionで開く
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
