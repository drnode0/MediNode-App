'use client'
import { RotateCcw, Check, ExternalLink } from 'lucide-react'
import { useState } from 'react'
import type { Hit } from './ResultCard'
import { recordQuizResult } from '@/lib/quiz-srs'
import { stripLeadingEmoji } from '@/lib/labels'

const LEVEL_STYLE: Record<string, string> = {
  '❓ クリニカルクエスチョン': 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300',
  '💡 ナレッジ': 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300',
  '📋 まとめ': 'bg-brand-50 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300',
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
  const borderColor = isMedical ? 'border-l-brand-400' : 'border-l-amber-400'
  const displaySummary = hit.aiSummary || hit.summary || null
  const levelStyle = hit.knowledgeLevel ? (LEVEL_STYLE[hit.knowledgeLevel] || 'bg-gray-50 dark:bg-gray-700/40 text-gray-600 dark:text-gray-300') : ''

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 border-l-4 ${borderColor} overflow-hidden`}>
      {/* タイトル部分：常に表示 */}
      <button
        className="w-full text-left p-4"
        onClick={() => !revealed && setRevealed(true)}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <span className="text-xs text-gray-300 mr-2">#{index + 1}</span>
            <span className="font-semibold text-gray-900 dark:text-gray-100 text-base">{hit.title}</span>
          </div>
          {!revealed && (
            <span className="shrink-0 text-xs text-brand-500 dark:text-brand-300 font-medium border border-brand-200 dark:border-brand-700 rounded-full px-2 py-0.5">
              答えを見る
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {hit.knowledgeLevel && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${levelStyle}`}>
              {stripLeadingEmoji(hit.knowledgeLevel)}
            </span>
          )}
          {hit.genre && (
            <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">
              {hit.genre}
            </span>
          )}
        </div>
      </button>

      {/* 要約：タップ後に展開 */}
      {revealed && (
        <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 animate-fade-in-up">
          <div className="pt-3">
            {displaySummary ? (
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{displaySummary}</p>
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500 italic">要約なし</p>
            )}
          </div>
          {/* 自己申告（簡易・間隔反復）: 記録すると次回の出題順で「まだ」が優先される */}
          {answered === null ? (
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => answer(false)}
                className="flex-1 text-sm font-semibold text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/30 hover:bg-amber-100 dark:hover:bg-amber-900/50 rounded-lg py-2 transition-colors"
              >
                <RotateCcw className="w-4 h-4 inline -mt-0.5 mr-1" />まだ
              </button>
              <button
                onClick={() => answer(true)}
                className="flex-1 text-sm font-semibold text-green-700 dark:text-green-300 bg-green-50 dark:bg-green-900/30 hover:bg-green-100 dark:hover:bg-green-900/50 rounded-lg py-2 transition-colors"
              >
                <Check className="w-4 h-4 inline -mt-0.5 mr-1" />覚えた
              </button>
            </div>
          ) : (
            // 記録の小さな祝福。押した直後に弾んで表示され、学習の手応えを返す。
            <div
              className={`mt-3 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-semibold animate-pop ${
                answered === 'ok'
                  ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                  : 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
              }`}
            >
              {answered === 'ok' ? (
                <>
                  <Check className="w-4 h-4" strokeWidth={2.5} />
                  覚えた！次回は後ろの方に出ます
                </>
              ) : (
                <>
                  <RotateCcw className="w-4 h-4" strokeWidth={2.5} />
                  記録しました。次回は優先して出ます
                </>
              )}
            </div>
          )}
          <div className="flex items-center justify-between mt-3">
            <button
              onClick={() => setRevealed(false)}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 dark:text-gray-300"
            >
              隠す
            </button>
            <a
              href={hit.notionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium text-brand-600 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200 flex items-center gap-1"
            >
              Notionで開く
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
