'use client'
// 「今日の1問」カード。検索タブ最上部に出す、毎日開く理由になるエンジン。
// 想起型: 問いを見て頭の中で答える → タップで答え（要約）→「覚えた/まだ」。10〜20秒で完結。
// 出題はサーバー（/api/daily-question）が決定（全員同じ1問・段階公開フラグで出し分け）。
// 「覚えた/まだ」は既存quiz-srs（localStorage）に記録し、サーバーには回答日付だけを送る。
import { useContext, useEffect, useState, type ReactNode } from 'react'
import { BookOpen, Check, ChevronRight, ExternalLink, Sun } from 'lucide-react'
import { OpenSettingsContext } from '@/components/SearchErrors'
import { KnowledgeTitle } from '@/lib/title-display'
import { recordQuizResult, getQuizStat } from '@/lib/quiz-srs'
import { recordTowerEvent, recallKindFor, loadTowerState } from '@/lib/tower-steps'
import { isTowerEnabled } from '@/lib/tower-flags'
import { recordRecentView } from '@/lib/recent-views'
import { recordCqView } from '@/lib/cq-views'
import { stripLeadingEmoji } from '@/lib/labels'
import { hasSubscriptionConfig } from '@/lib/algolia'
import { prefetchReaderDoc } from '@/lib/reader-prefetch'
import { useReader } from '@/components/reader/SubscriptionReader'
import PushPrimer, { shouldShowPrimer, markPrimerSeen } from './PushPrimer'
import { ClozeBody } from './QuizCard'

type DailyQuestionPayload = {
  available: boolean
  date?: string
  question?: {
    objectID: string
    title: string
    genre?: string | string[]
    knowledgeLevel?: string
  }
  answer?: string
  // 赤マーカー穴埋め（あるページだけ）。表示時は要約（answer）の代わりにこちらを出す
  cloze?: import('@/lib/cloze').ClozeData
  notionUrl?: string
  premium?: boolean
}

// 当日の進み具合（開いた/答えた）だけを端末に覚えておくキー。日付が変わればリセット。
const STATE_KEY = 'medinode_daily_question_v1'
type LocalState = { date: string; revealed: boolean; done: boolean }

function loadState(date: string): LocalState {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY) || 'null') as LocalState | null
    if (raw && raw.date === date) return raw
  } catch {}
  return { date, revealed: false, done: false }
}

function saveState(state: LocalState) {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state))
  } catch {}
}

export function DailyQuestionCard() {
  const { open: openReader } = useReader()
  const openSettings = useContext(OpenSettingsContext)
  const [data, setData] = useState<DailyQuestionPayload | null>(null)
  const [state, setState] = useState<LocalState | null>(null)
  // 回答した「今このセッション」だけ完了メッセージを見せるためのフラグ。
  // リロード後（既にdone）は false のまま＝最初から何も出さない。
  const [justAnswered, setJustAnswered] = useState(false)
  const [fading, setFading] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [primerOpen, setPrimerOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/daily-question', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: DailyQuestionPayload) => {
        if (cancelled) return
        setData(d)
        if (d.available && d.date) setState(loadState(d.date))
      })
      .catch(() => {
        if (!cancelled) setData({ available: false })
      })
    return () => {
      cancelled = true
    }
  }, [])

  // 回答直後だけ「おつかれさま」を数秒見せて、すっと消す
  // （回答済みカードが居座って検索の邪魔にならないように）。
  useEffect(() => {
    if (!justAnswered) return
    const fade = setTimeout(() => setFading(true), 1800)
    const remove = setTimeout(() => setDismissed(true), 2400)
    return () => {
      clearTimeout(fade)
      clearTimeout(remove)
    }
  }, [justAnswered])

  if (!data?.available || !data.question || !state) return null
  const q = data.question

  const update = (next: Partial<LocalState>) => {
    setState((prev) => {
      if (!prev) return prev
      const merged = { ...prev, ...next }
      saveState(merged)
      return merged
    })
  }

  const answer = (ok: boolean) => {
    if (isTowerEnabled()) {
      if (ok) {
        // 台帳を見る版＝地下に沈んだ知識もクイズで思い出せば生まれ直す（正典§7）
        const kind = recallKindFor(loadTowerState(), q.objectID, getQuizStat(q.objectID), new Date().toISOString())
        if (kind) recordTowerEvent({ id: q.objectID, kind, genre: Array.isArray(q.genre) ? q.genre[0] : q.genre || '', title: q.title })
      } else {
        // 知の蔓: 「まだ」は芽（高さなし・正典§9）。(id,'attempt')は一生に1回＝連打で増えない
        recordTowerEvent({ id: q.objectID, kind: 'attempt', genre: Array.isArray(q.genre) ? q.genre[0] : q.genre || '', title: q.title })
      }
    }
    recordQuizResult(q.objectID, ok)
    // 回答した日付だけをサーバーへ（未ログイン・失敗は黙って流す）。
    void fetch('/api/daily-question/answered', { method: 'POST' }).catch(() => {})
    if (shouldShowPrimer()) {
      // push は stage/preview対象外のユーザーには見せない（オーナー限定preview姿勢が漏れないように）。
      // 未対象なら markPrimerSeen を焼かない＝オーナーが後でpreview/onへ切り替えたら再提示できる。
      void fetch('/api/push', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d: { enabled?: boolean }) => {
          if (d?.enabled) {
            markPrimerSeen()
            setPrimerOpen(true)
          }
        })
        .catch(() => {})
    }
    update({ done: true })
    setJustAnswered(true)
  }

  const genreLabel = Array.isArray(q.genre) ? q.genre[0] : q.genre

  // 回答済み: 「おつかれさま」を一瞬だけ見せて、すっと消す。
  // リロード後（justAnswered=false）やフェード完了後は最初から出さない
  // ＝回答済みカードが居座らない。
  // ※ PushPrimer はこのカード本体の表示/非表示に連動させない
  //   （dismissed で本体が消えても、通知プライマーはユーザーが操作するまで残す）。
  let body: ReactNode = null
  if (state.done) {
    if (justAnswered && !dismissed) {
      body = (
        <div className={`mb-3 flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-2.5 transition-opacity duration-500 ${fading ? 'opacity-0' : 'opacity-100'}`}>
          <Check className="h-4 w-4 shrink-0 text-brand-500" />
          <p className="text-xs text-gray-500 dark:text-gray-400">おつかれさまでした。また明日。</p>
        </div>
      )
    }
  } else {
    body = (
      <div className="mb-3 overflow-hidden rounded-2xl border border-brand-200 dark:border-brand-800 bg-white dark:bg-gray-800">
        <div className="p-4">
          <div className="mb-2 flex items-center gap-2">
            <Sun className="h-4 w-4 shrink-0 text-brand-500" strokeWidth={2.2} />
            <p className="text-xs font-semibold text-brand-600 dark:text-brand-300">今日の1問</p>
            {genreLabel && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700/40 text-gray-500 dark:text-gray-400">
                {stripLeadingEmoji(genreLabel)}
              </span>
            )}
          </div>
          <p className="text-base font-semibold leading-snug text-gray-900 dark:text-gray-100"><KnowledgeTitle title={q.title} level={q.knowledgeLevel} /></p>

          {/* 穴埋めの設問はタップ前から見せる（伏せ字が問題文そのもの） */}
          {data.cloze && <ClozeBody cloze={data.cloze} revealed={state.revealed} />}

          {!state.revealed ? (
            <button
              type="button"
              onClick={() => {
                update({ revealed: true })
                // 答えを見た＝続きを読む前兆。先読みして「続きを読む」を待たせない。
                if (data.notionUrl && hasSubscriptionConfig()) prefetchReaderDoc(q.objectID)
              }}
              className="mt-3 inline-flex items-center gap-1 rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
            >
              答えを見る
              <ChevronRight className="h-4 w-4" />
            </button>
          ) : (
            <div className="animate-fade-in-up">
              {/* 穴埋めカードは答えが上のClozeBodyで開くため、要約は出さない（二重表示を避ける） */}
              {!data.cloze && (
                <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                  {data.answer}
                </p>
              )}
              <div className="mt-3 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => answer(true)}
                  className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-700"
                >
                  覚えた
                </button>
                <button
                  type="button"
                  onClick={() => answer(false)}
                  className="rounded-xl border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-600 dark:text-gray-300 transition hover:border-brand-400"
                >
                  まだ
                </button>
              </div>
              {data.notionUrl ? (
                hasSubscriptionConfig() ? (
                  <button
                    type="button"
                    onClick={() => {
                      openReader({ objectID: q.objectID, title: q.title, notionUrl: data.notionUrl!, knowledgeLevel: q.knowledgeLevel, owner: 'subscription' })
                      recordCqView(q.objectID, 'subscription')
                    }}
                    onPointerEnter={() => prefetchReaderDoc(q.objectID)}
                    onFocus={() => prefetchReaderDoc(q.objectID)}
                    className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200"
                  >
                    続きを読む
                    <BookOpen className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <a
                    href={data.notionUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => { recordRecentView({ objectID: q.objectID, title: q.title, notionUrl: data.notionUrl!, knowledgeLevel: q.knowledgeLevel, owner: 'subscription' }); recordCqView(q.objectID, 'subscription') }}
                    className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200"
                  >
                    監修ページで続きを読む
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )
              ) : (
                <div className="mt-3">
                  <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                    答えまではどなたでもご覧になれます。専門医のプレミアムナレッジで続きが読めます。
                  </p>
                  {openSettings && (
                    <button
                      type="button"
                      onClick={() => openSettings('subscription')}
                      className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-brand-600 dark:text-brand-300 hover:text-brand-800 dark:hover:text-brand-200"
                    >
                      プレミアムを見る
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      {body}
      <PushPrimer open={primerOpen} onClose={() => setPrimerOpen(false)} />
    </>
  )
}
