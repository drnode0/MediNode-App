'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, MessageCircleQuestion, Sparkles, ChevronDown, Send } from 'lucide-react'
import { getSettings } from '@/lib/settings'
import {
  createSubscriptionSearchClient,
  getSubscriptionIndexName,
  hasSubscriptionConfig,
} from '@/lib/algolia'
import {
  countNewAnswers,
  pickFloating,
  placeFloating,
  gridFor,
  FLOAT_MAX,
  WIDE_GRID,
  type CqSeed,
  type Grid,
  type NewAnswerMap,
  type PlacedCq,
} from '@/lib/floating-cq'
import { loadUnresolvedCqs } from '@/lib/unresolved-cqs'
import {
  readSentCqs,
  buildDispatchStates,
  dispatchLabel,
  type DispatchState,
} from '@/lib/cq-dispatch'
import type { MyStage } from '@/lib/cq-mine'
import { CommunitySky } from '@/components/CommunityCqs'
import type { CommunityCqWithVote } from '@/lib/community-cqs'
import { setPendingQuery } from '@/lib/pending-query'
import { useCqCapture } from '@/components/CqCapture'
import { CqActionSheet } from '@/components/CqActionSheet'

// 未解決の問いが浮かぶ画面（/cq）の本体。
//
// 浮かぶのは自分の Medical DB の「知識レベル = ❓ CQ」だけ。💡ナレッジに育てば消える。
// 登録日より後にプレミアムへ入ったナレッジが見つかったものだけを、明るく大きく出す。
// この判定はプレミアムのみ。無料は全件が同じ薄さで静かに漂う。

type Loaded = { cqs: CqSeed[]; error: string } | null

// fixture は development のdevハーネス（/dev/floating-cq）専用の注入口。
// 渡されたときは取得も新しい答えの判定も行わない（本物のNotion・Algoliaに触れない）。
export function UnresolvedCqScreen({
  fixture,
}: {
  fixture?: {
    cqs: CqSeed[]
    newAnswers: NewAnswerMap
    dispatch?: Record<string, DispatchState>
    community?: { cqs: CommunityCqWithVote[]; canVote: boolean }
  }
} = {}) {
  const router = useRouter()
  const openCapture = useCqCapture()
  const [loaded, setLoaded] = useState<Loaded>(null)
  const [newAnswers, setNewAnswers] = useState<NewAnswerMap>({})
  const [selected, setSelected] = useState<PlacedCq | null>(null)
  const [showRest, setShowRest] = useState(false)
  // 裏に回っている間はアニメーションを止める（見えない泡を動かし続けない）。
  const [paused, setPaused] = useState(false)
  // 初期値は広い方。マウント直後の effect で実際の画面幅に合わせる。
  const [grid, setGrid] = useState<Grid>(WIDE_GRID)
  // 作者に投げた問いのその後（objectID → 送った日時と票数）。
  const [dispatch, setDispatch] = useState<Record<string, DispatchState>>({})

  const settings = getSettings()

  useEffect(() => {
    const sync = () => setPaused(document.hidden)
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])

  // 列数は画面幅で決める（狭い画面で3列にすると泡が1文字ずつ折り返す）。
  // 回転・分割ビューでも追従させるため resize を見る。
  useEffect(() => {
    const sync = () => setGrid(gridFor(window.innerWidth))
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  useEffect(() => {
    if (fixture) {
      setLoaded({ cqs: fixture.cqs, error: '' })
      setNewAnswers(fixture.newAnswers)
      setDispatch(fixture.dispatch || {})
      return
    }
    let cancelled = false
    loadUnresolvedCqs()
      .then((cqs) => {
        if (!cancelled) setLoaded({ cqs, error: '' })
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setLoaded({ cqs: [], error: e instanceof Error ? e.message : '取得に失敗しました' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [fixture])

  // 新しい答え: 各CQの文言でプレミアムを引き、登録日より後に入ったヒットを数える。
  // マルチクエリなので件数によらず1往復で済む。
  useEffect(() => {
    const cqs = loaded?.cqs
    if (fixture || !cqs || !cqs.length || !hasSubscriptionConfig()) return
    let cancelled = false
    const targets = cqs.slice(0, FLOAT_MAX * 2)
    const indexName = getSubscriptionIndexName()
    createSubscriptionSearchClient()
      .multipleQueries(
        targets.map((c) => ({
          indexName,
          query: c.title,
          params: { hitsPerPage: 20 },
        })),
      )
      .then(({ results }) => {
        if (cancelled) return
        const map: NewAnswerMap = {}
        results.forEach((r, i) => {
          const hits = ((r as { hits?: Array<{ objectID?: string; createdAt?: string }> }).hits || []).map(
            (h) => ({ objectID: String(h.objectID || ''), createdAt: h.createdAt }),
          )
          const count = countNewAnswers(targets[i].createdAt, hits)
          if (count > 0) map[targets[i].objectID] = count
        })
        setNewAnswers(map)
      })
      .catch(() => {
        // 新しい答えを数えられないだけ。画面そのものは成立する。
      })
    return () => {
      cancelled = true
    }
  }, [loaded, fixture])

  // 作者に投げた問いのその後。サーバー（通知に同意した投稿）と端末の記録を重ねる。
  useEffect(() => {
    const cqs = loaded?.cqs
    if (fixture || !cqs || !cqs.length) return
    let cancelled = false
    const sent = readSentCqs()
    fetch('/api/cq/mine')
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items?: Array<{ question?: string; stage?: string; voteCount?: number; createdAt?: string }> }) => {
        if (cancelled) return
        const submissions = (d.items || []).map((i) => ({
          question: String(i.question || ''),
          stage: (i.stage as MyStage) || 'received',
          voteCount: Number(i.voteCount || 0),
          createdAt: String(i.createdAt || ''),
        }))
        setDispatch(buildDispatchStates(cqs, sent, submissions))
      })
      .catch(() => {
        // サーバーが引けなくても、この端末で送った分までは記録から出せる。
        if (!cancelled) setDispatch(buildDispatchStates(cqs, sent, []))
      })
    return () => {
      cancelled = true
    }
  }, [loaded, fixture])

  const { floating, rest } = useMemo(
    () => pickFloating(loaded?.cqs || [], newAnswers, grid.cols * grid.rows),
    [loaded, newAnswers, grid],
  )
  const placed = useMemo(() => placeFloating(floating, newAnswers, grid), [floating, newAnswers, grid])
  const withNewAnswers = placed.filter((p) => p.newAnswerCount > 0).length

  const handleSearch = useCallback(
    (cq: PlacedCq) => {
      setPendingQuery(cq.title)
      router.push('/')
    },
    [router],
  )

  return (
    <div className="min-h-[100dvh] bg-gray-50 dark:bg-gray-900">
      <header className="sticky top-0 z-20 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => router.push('/')}
            aria-label="戻る"
            className="p-1.5 -ml-1.5 rounded-lg text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-base font-bold text-gray-900 dark:text-white">未解決の問い</h1>
            {loaded && loaded.cqs.length > 0 && (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {loaded.cqs.length}件
                {withNewAnswers > 0 && (
                  <span className="ml-1.5 text-amber-700 dark:text-amber-300 font-bold">
                    うち{withNewAnswers}件に新しい答え
                  </span>
                )}
              </p>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 pb-24">
        {!loaded ? (
          <p className="py-24 text-center text-sm text-gray-400 dark:text-gray-500">読み込んでいます…</p>
        ) : loaded.error && !loaded.cqs.length ? (
          <p className="py-24 text-center text-sm text-red-600 dark:text-red-400">{loaded.error}</p>
        ) : !loaded.cqs.length ? (
          <EmptyState onCapture={openCapture ? () => openCapture() : null} />
        ) : (
          <>
            {/* 書き込みに失敗したときの知らせ。裸の赤文字だと英語のまま出て何をすれば
                いいか分からないので、枠に入れて手当ての一文まで含める。 */}
            {loaded.error && (
              <div className="mt-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-4 py-3">
                <p className="text-xs text-red-700 dark:text-red-300 leading-relaxed">{loaded.error}</p>
                <button
                  type="button"
                  onClick={() => setLoaded((prev) => (prev ? { ...prev, error: '' } : prev))}
                  className="mt-2 text-[11px] font-bold text-red-700 dark:text-red-300 underline underline-offset-2"
                >
                  閉じる
                </button>
              </div>
            )}
            <div className="relative h-[68vh] min-h-[420px] mt-2">
              {placed.map((cq) => (
                <Bubble
                  key={cq.objectID}
                  cq={cq}
                  paused={paused}
                  dispatch={dispatch[cq.objectID]}
                  onSelect={() => setSelected(cq)}
                />
              ))}
            </div>

            {rest.length > 0 && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setShowRest((v) => !v)}
                  className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                >
                  <ChevronDown className={`w-4 h-4 transition-transform ${showRest ? 'rotate-180' : ''}`} />
                  ほかに{rest.length}件
                </button>
                {showRest && (
                  <ul className="mt-2 divide-y divide-gray-200 dark:divide-gray-700 rounded-xl bg-white dark:bg-gray-800 ring-1 ring-black/5 dark:ring-white/10">
                    {rest.map((cq) => (
                      <li key={cq.objectID}>
                        <button
                          type="button"
                          onClick={() =>
                            setSelected({
                              ...cq,
                              newAnswerCount: newAnswers[cq.objectID] || 0,
                              x: 0,
                              y: 0,
                              widthPercent: 0,
                              size: 'md',
                              opacity: 1,
                              driftSeconds: 0,
                              delaySeconds: 0,
                            })
                          }
                          className="w-full text-left px-4 py-3 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700/60"
                        >
                          {cq.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </>
        )}

        {/* 第2の空。自分の未解決が0件でも出す（他人の問いは自分の在庫と関係ない）。
            設定で消せる——自分の問いだけを静かに眺めたい人向け。 */}
        {!settings?.hideCommunityCqs && <CommunitySky paused={paused} fixture={fixture?.community} />}
      </main>

      {selected && (
        <CqActionSheet
          cq={selected}
          dispatch={dispatch[selected.objectID]}
          onClose={() => setSelected(null)}
          onSearch={() => handleSearch(selected)}
          onAsk={
            openCapture
              ? () => {
                  openCapture(
                    selected.title,
                    { title: selected.title, url: selected.notionUrl, cqObjectID: selected.objectID },
                    'settings',
                  )
                  setSelected(null)
                }
              : null
          }
        />
      )}
    </div>
  )
}

// 幅は widthPercent（区画に対する割合）で与えるので、ここは字の大きさと余白だけ。
const SIZE_CLASS = {
  sm: 'text-[11px] px-3 py-1.5',
  md: 'text-xs px-3.5 py-2',
  lg: 'text-sm px-4 py-2.5',
} as const

function Bubble({
  cq,
  paused,
  dispatch,
  onSelect,
}: {
  cq: PlacedCq
  paused: boolean
  // 作者に投げた問いのその後（投げていなければ undefined）。
  dispatch?: DispatchState
  onSelect: () => void
}) {
  const lit = cq.newAnswerCount > 0
  const answered = dispatch?.stage === 'answered'
  const sent = dispatchLabel(dispatch)
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        left: `${cq.x}%`,
        top: `${cq.y}%`,
        width: `${cq.widthPercent}%`,
        opacity: cq.opacity,
        animationDuration: `${cq.driftSeconds}s`,
        animationDelay: `${cq.delaySeconds}s`,
        animationPlayState: paused ? 'paused' : 'running',
      }}
      className={`cq-bubble absolute rounded-2xl text-left leading-snug ring-1 transition-shadow ${SIZE_CLASS[cq.size]} ${
        lit
          ? 'bg-amber-50 dark:bg-amber-900/40 text-amber-950 dark:text-amber-100 ring-amber-300 dark:ring-amber-500/50 font-bold shadow-md'
          : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 ring-black/5 dark:ring-white/10'
      }`}
    >
      {cq.title}
      {lit && (
        <span className="mt-1 flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-300">
          <Sparkles className="w-3 h-3" />
          新しい答えが{cq.newAnswerCount}件
        </span>
      )}
      {/* 投げた問いのその後。新しい答えの琥珀とは色を分ける（別の出来事なので）。
          答えが出たときだけは、新しい答えが並んでいても必ず出す（これが投げた甲斐）。 */}
      {sent && (answered || !lit) && (
        <span
          className={`mt-1 flex items-center gap-1 text-[10px] text-teal-700 dark:text-teal-300 ${answered ? 'font-bold' : ''}`}
        >
          <Send className="w-3 h-3" />
          {sent}
        </span>
      )}
    </button>
  )
}

function EmptyState({ onCapture }: { onCapture: (() => void) | null }) {
  return (
    <div className="py-24 text-center">
      <div className="mb-4 flex justify-center text-gray-300 dark:text-gray-600">
        <MessageCircleQuestion className="h-12 w-12" />
      </div>
      <p className="text-gray-600 dark:text-gray-300 font-bold text-base mb-1">
        いま浮かんでいる問いはありません
      </p>
      <p className="text-sm text-gray-400 dark:text-gray-500">
        現場で引っかかった疑問をCQとして残すと、ここに浮かびます
      </p>
      {onCapture && (
        <button
          type="button"
          onClick={onCapture}
          className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-amber-400 hover:bg-amber-300 text-amber-950 px-4 py-2 text-sm font-bold"
        >
          <MessageCircleQuestion className="w-4 h-4" />
          疑問を残す
        </button>
      )}
    </div>
  )
}
