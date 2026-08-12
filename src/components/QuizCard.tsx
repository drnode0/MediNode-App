'use client'
import { RotateCcw, Check, ExternalLink, BookOpen, Highlighter } from 'lucide-react'
import { useState } from 'react'
import { LEVEL_META, type Hit } from './ResultCard'
import type { ClozeData } from '@/lib/cloze'
import { recordQuizResult, getQuizStat, intervalLabelFor } from '@/lib/quiz-srs'
import { recordTowerEvent, recallKindFor, loadTowerState } from '@/lib/tower-steps'
import { isTowerEnabled } from '@/lib/tower-flags'
import { recordCqView } from '@/lib/cq-views'
import { stripLeadingEmoji } from '@/lib/labels'
import { KnowledgeTitle } from '@/lib/title-display'
import { isInAppReaderTarget } from '@/lib/subscription-open'
import { prefetchReaderDoc } from '@/lib/reader-prefetch'
import { useReader } from '@/components/reader/SubscriptionReader'

// 穴埋め本文。タップ前は伏せ字（設問）、開示後はNotionの赤マーカーと同じ見た目で開く。
// DailyQuestionCard（今日の1問）も同じ描画を使う。
export function ClozeBody({ cloze, revealed }: { cloze: ClozeData; revealed: boolean }) {
  return (
    <div className="mt-2.5 space-y-2">
      {cloze.blocks.map((block, bi) => (
        <div key={bi}>
          {/* 連続する同一見出しは最初の1回だけ出す */}
          {block.heading && block.heading !== cloze.blocks[bi - 1]?.heading && (
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-0.5">{block.heading}</p>
          )}
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-loose">
            {block.segments.map((seg, si) =>
              seg.hidden ? (
                revealed ? (
                  <span key={si} className="bg-red-100 dark:bg-red-900/40 text-red-900 dark:text-red-200 rounded px-1 font-semibold">
                    {seg.text}
                  </span>
                ) : (
                  <span key={si} className="inline-block min-w-[3.5rem] text-center border-b-2 border-red-400 dark:border-red-500 text-red-500 dark:text-red-300 font-semibold">
                    ？？？
                  </span>
                )
              ) : (
                <span key={si}>{seg.text}</span>
              ),
            )}
          </p>
        </div>
      ))}
      {cloze.truncated && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500">…続きのマークは本文で</p>
      )}
    </div>
  )
}

export function QuizCard({ hit, index }: { hit: Hit; index: number }) {
  const { open: openReader } = useReader()
  const [revealed, setRevealed] = useState(false)
  // 穴埋めカードの三段階想起（2026-08-12オーナー裁定）:
  //   タイトルで自由想起 → タップで穴埋めを開く（clozeOpen）→ もう一度タップで答え合わせ（revealed）。
  // 折りたたみが既定なのは、場所の節約に加えて「最初にタイトルだけで思い出す」段を挟むため。
  const [clozeOpen, setClozeOpen] = useState(false)
  // 「覚えた／まだ」の自己申告（このカードで申告済みならその結果を保持して表示を変える）。
  const [answered, setAnswered] = useState<'ok' | 'ng' | null>(null)
  // 申告直後のメッセージで「次は◯◯ごろ」を出すための連続「覚えた」回数。
  const [answeredStreak, setAnsweredStreak] = useState(0)

  const answer = (ok: boolean) => {
    if (isTowerEnabled()) {
      if (ok) {
        // 知の塔: recordQuizResultより先に判定する（記録後だと「いま初めてok」が読めない）。
        // 台帳を見る版＝地下に沈んだ知識もクイズで思い出せば生まれ直す（正典§7）
        const kind = recallKindFor(loadTowerState(), hit.objectID, getQuizStat(hit.objectID), new Date().toISOString())
        if (kind) recordTowerEvent({ id: hit.objectID, kind, genre: Array.isArray(hit.genre) ? hit.genre[0] : hit.genre || '', title: hit.title })
      } else {
        // 知の蔓: 「まだ」は芽（高さなし・正典§9）。(id,'attempt')は一生に1回＝連打で増えない
        recordTowerEvent({ id: hit.objectID, kind: 'attempt', genre: Array.isArray(hit.genre) ? hit.genre[0] : hit.genre || '', title: hit.title })
      }
    }
    const stat = recordQuizResult(hit.objectID, ok)
    setAnsweredStreak(stat.streak || 0)
    setAnswered(ok ? 'ok' : 'ng')
  }
  const isMedical = hit.source === 'medical'
  const displaySummary = hit.aiSummary || hit.summary || null
  // 帯・バッジ・アイコンは ResultCard と同じ種別ルール（CQ/ナレッジ/まとめ）を共有する。
  const levelMeta = hit.knowledgeLevel ? LEVEL_META[hit.knowledgeLevel] : undefined
  const levelStyle = levelMeta?.badge || 'bg-gray-50 dark:bg-gray-700/40 text-gray-600 dark:text-gray-300'
  const borderColor = levelMeta?.band
    || (isMedical ? 'border-l-brand-400 dark:border-l-brand-400' : 'border-l-amber-400 dark:border-l-amber-400')

  return (
    <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 border-l-4 ${borderColor} overflow-hidden`}>
      {/* タイトル部分：常に表示 */}
      <button
        className="w-full text-left p-4"
        onClick={() => {
          if (revealed) return
          // 穴埋めカードは折りたたみ→穴埋め→答えの三段階。1回目のタップは穴埋めを開くだけ
          if (hit.cloze && !clozeOpen) {
            setClozeOpen(true)
            return
          }
          setRevealed(true)
          // 答えを見た＝本文へ進む前兆。先読みして「本文を読む」を待たせない。
          if (isInAppReaderTarget(hit.owner)) prefetchReaderDoc(hit.objectID)
        }}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <span className="text-xs text-gray-300 mr-2">#{index + 1}</span>
            <span className="font-semibold text-gray-900 dark:text-gray-100 text-base"><KnowledgeTitle title={hit.title} level={hit.knowledgeLevel || hit.recordingLevel} source={hit.source} /></span>
          </div>
          {!revealed && (
            <span className="shrink-0 text-xs text-brand-500 dark:text-brand-300 font-medium border border-brand-200 dark:border-brand-700 rounded-full px-2 py-0.5">
              {hit.cloze && !clozeOpen ? '穴埋めを開く' : '答えを見る'}
            </span>
          )}
        </div>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {hit.knowledgeLevel && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${levelStyle}`}>
              {levelMeta && <levelMeta.Icon className="h-3 w-3 shrink-0" strokeWidth={2.2} />}
              {levelMeta?.label ?? stripLeadingEmoji(hit.knowledgeLevel)}
            </span>
          )}
          {hit.genre && (
            <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-0.5 rounded-full">
              {hit.genre}
            </span>
          )}
          {hit.cloze && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full inline-flex items-center gap-1 bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300">
              <Highlighter className="h-3 w-3 shrink-0" strokeWidth={2.2} />
              穴埋め {hit.cloze.blankCount}問
            </span>
          )}
        </div>
        {/* 穴埋めの設問は1回目のタップで開く（折りたたみが既定。見分けは「穴埋めN問」チップ） */}
        {hit.cloze && clozeOpen && <ClozeBody cloze={hit.cloze} revealed={revealed} />}
      </button>

      {/* 要約：タップ後に展開 */}
      {revealed && (
        <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 animate-fade-in-up">
          {/* 穴埋めカードは答えが上のClozeBodyで開くため、要約は出さない（同内容の二重表示を避ける） */}
          {!hit.cloze && (
            <div className="pt-3">
              {displaySummary ? (
                <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{displaySummary}</p>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500 italic">要約なし</p>
              )}
            </div>
          )}
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
                  覚えた、と記録しました。次は{intervalLabelFor(answeredStreak)}ごろに出ます
                </>
              ) : (
                <>
                  <RotateCcw className="w-4 h-4" strokeWidth={2.5} />
                  まだ、と記録しました。忘れないうちに、またすぐ出します
                </>
              )}
            </div>
          )}
          <div className="flex items-center justify-between mt-3">
            <button
              onClick={() => { setRevealed(false); setClozeOpen(false) }}
              className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 dark:text-gray-300"
            >
              隠す
            </button>
            {isInAppReaderTarget(hit.owner) ? (
              <button
                type="button"
                onClick={() => { recordCqView(hit.objectID, hit.owner); openReader(hit) }}
                onPointerEnter={() => prefetchReaderDoc(hit.objectID)}
                onFocus={() => prefetchReaderDoc(hit.objectID)}
                className="text-xs font-medium text-brand-600 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200 flex items-center gap-1"
              >
                本文を読む
                <BookOpen className="w-3.5 h-3.5" />
              </button>
            ) : (
              <a
                href={hit.notionUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => recordCqView(hit.objectID, hit.owner)}
                className="text-xs font-medium text-brand-600 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200 flex items-center gap-1"
              >
                Notionで開く
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
