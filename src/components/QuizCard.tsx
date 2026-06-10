'use client'
import { useState } from 'react'
import type { Hit } from './ResultCard'

const LEVEL_STYLE: Record<string, string> = {
  '❓ クリニカルクエスチョン': 'bg-yellow-50 text-yellow-700',
  '💡 ナレッジ': 'bg-green-50 text-green-700',
  '📋 まとめ': 'bg-blue-50 text-blue-700',
}

export function QuizCard({ hit, index }: { hit: Hit; index: number }) {
  const [revealed, setRevealed] = useState(false)
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
