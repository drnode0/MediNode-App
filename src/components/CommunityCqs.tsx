'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Heart } from 'lucide-react'
import {
  createSubscriptionSearchClient,
  getSubscriptionIndexName,
  hasSubscriptionConfig,
} from '@/lib/algolia'
import { getSettings } from '@/lib/settings'
import { CQ_LEVELS, placeFloating, gridFor, skyHeight, WIDE_GRID, type Grid, type PlacedCq } from '@/lib/floating-cq'
import {
  toAuthorCqs,
  toReaderCqs,
  mergeCommunityCqs,
  communityVoteLabel,
  COMMUNITY_MAX,
  type CommunityCqWithVote,
} from '@/lib/community-cqs'
import { DriftingLeaves } from '@/components/DriftingLeaves'

// /cq の第2の空「みんなの臨床疑問」。
//
// 作者のCQ（プレミアム配信DBの ❓CQ）と読者投稿の板を1つの空にまとめ、
// どちらにも「気になる」を押せるようにする。押す場所を2つに割らないため、
// 設定の受付中タブはこの空への導線にした。
//
// 自分の未解決CQとは空を分ける。同じ空に混ぜると自分ごとが薄まる。

// プレミアムindexから引く作者CQの上限。並べ替えてから COMMUNITY_MAX に絞る。
const AUTHOR_FETCH = 40

type Loaded = { cqs: CommunityCqWithVote[]; canVote: boolean } | null

async function fetchAuthorCqs(): Promise<Array<Record<string, unknown>>> {
  if (!hasSubscriptionConfig()) return []
  const index = createSubscriptionSearchClient().initIndex(getSubscriptionIndexName())
  const levelFilter = CQ_LEVELS.map((l) => `knowledgeLevel:"${l}"`).join(' OR ')
  try {
    const res = await index.search('', { filters: `(${levelFilter})`, hitsPerPage: AUTHOR_FETCH })
    return res.hits as unknown as Array<Record<string, unknown>>
  } catch {
    // 知識レベルで絞れないインデックスなら作者CQは出さない。
    // 全件取ってJS側で絞ると、ナレッジ本文まで引いて重くなる。
    return []
  }
}

export function CommunitySky({
  paused,
  fixture,
}: {
  paused: boolean
  // devハーネス専用。渡されたときは取りに行かない。
  fixture?: { cqs: CommunityCqWithVote[]; canVote: boolean }
}) {
  const [loaded, setLoaded] = useState<Loaded>(null)
  const [grid, setGrid] = useState<Grid>(WIDE_GRID)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    const sync = () => setGrid(gridFor(window.innerWidth))
    sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [])

  useEffect(() => {
    if (fixture) {
      setLoaded(fixture)
      return
    }
    let cancelled = false
    ;(async () => {
      const [authorHits, boardRes] = await Promise.all([
        fetchAuthorCqs().catch(() => []),
        fetch('/api/cq/board')
          .then((r) => (r.ok ? r.json() : { items: [], canVote: false }))
          .catch(() => ({ items: [], canVote: false })),
      ])
      if (cancelled) return

      const author = toAuthorCqs(authorHits)
      const reader = toReaderCqs((boardRes as { items?: [] }).items || [])
      const ids = [...reader, ...author].map((c) => c.id)
      if (ids.length === 0) {
        setLoaded({ cqs: [], canVote: false })
        return
      }

      const votes = await fetch(`/api/cq/votes?ids=${encodeURIComponent(ids.join(','))}`)
        .then((r) => (r.ok ? r.json() : { counts: {}, mine: [] }))
        .catch(() => ({ counts: {}, mine: [] }))
      if (cancelled) return

      setLoaded({
        cqs: mergeCommunityCqs(author, reader, {
          counts: (votes as { counts?: Record<string, number> }).counts || {},
          mine: (votes as { mine?: string[] }).mine || [],
        }),
        canVote: !!(boardRes as { canVote?: boolean }).canVote,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [fixture])

  // 押した瞬間に見た目を変え、サーバーの返した合計で確定させる（board と同じ作法）。
  const toggle = useCallback(
    async (cq: CommunityCqWithVote) => {
      if (!loaded?.canVote || busy) return
      const next = !cq.voted
      setBusy(cq.id)
      const patch = (voted: boolean, voteCount: number) =>
        setLoaded((prev) =>
          prev
            ? { ...prev, cqs: prev.cqs.map((c) => (c.id === cq.id ? { ...c, voted, voteCount } : c)) }
            : prev,
        )
      patch(next, cq.voteCount + (next ? 1 : -1))
      try {
        const res = await fetch('/api/cq/vote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cqId: cq.id, voted: next }),
        })
        const d = (await res.json()) as { voteCount?: number }
        if (res.ok && typeof d.voteCount === 'number') patch(next, d.voteCount)
        // 失敗したら見た目を戻す（押せたのに入っていない、を残さない）。
        else if (!res.ok) patch(cq.voted, cq.voteCount)
      } catch {
        patch(cq.voted, cq.voteCount)
      } finally {
        setBusy(null)
      }
    },
    [loaded, busy],
  )

  // 票数を重みに使う。多い問いが大きく、はっきり浮かぶ。
  const placed = useMemo(() => {
    const cqs = loaded?.cqs || []
    const seeds = cqs.map((c) => ({
      objectID: c.id,
      title: c.title,
      notionUrl: '',
      createdAt: c.createdAt,
      lastEdited: c.createdAt,
    }))
    const weights: Record<string, number> = {}
    for (const c of cqs) if (c.voteCount > 0) weights[c.id] = c.voteCount
    // 行頭のハートぶん、同じ題でも横を広く取る。
    return placeFloating(seeds, weights, grid, 0.1)
  }, [loaded, grid])

  const byId = useMemo(() => {
    const map = new Map<string, CommunityCqWithVote>()
    for (const c of loaded?.cqs || []) map.set(c.id, c)
    return map
  }, [loaded])

  if (loaded && loaded.cqs.length === 0) return null

  return (
    <section className="mt-8 pt-6 border-t border-brand-100 dark:border-gray-700">
      {/* 見出しは設定の「みんなの臨床疑問」と揃える。ここで新しい呼び名を作ると、
          同じものが画面ごとに違う名前で出てくる。上の「あなたの」と対にもなる。 */}
      <h2 className="text-sm font-bold text-gray-700 dark:text-gray-200">みんなの臨床疑問</h2>
      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
        {loaded?.canVote
          ? 'ほかの人が送った疑問のうち、専門医がまだ答えていないものです。気になる問いをタップすると印がつき、次に答えるものを決める参考になります。'
          : 'ほかの人が送った疑問のうち、専門医がまだ答えていないものです。印をつけられるのはプレミアムの方です。'}
      </p>

      {!loaded ? (
        <p className="py-16 text-center text-sm text-gray-400 dark:text-gray-500">読み込んでいます…</p>
      ) : (
        <div className="relative mt-2" style={{ height: skyHeight(placed.length, grid) }}>
          <DriftingLeaves paused={paused} />
          {placed.map((p) => {
            const cq = byId.get(p.objectID)
            if (!cq) return null
            return (
              <CommunityBubble
                key={cq.id}
                cq={cq}
                place={p}
                paused={paused}
                canVote={loaded.canVote}
                busy={busy === cq.id}
                onToggle={() => toggle(cq)}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

const SIZE_CLASS = {
  sm: 'text-[11px] px-3 py-1.5',
  md: 'text-xs px-3.5 py-2',
  lg: 'text-sm px-4 py-2.5',
} as const

function CommunityBubble({
  cq,
  place,
  paused,
  canVote,
  busy,
  onToggle,
}: {
  cq: CommunityCqWithVote
  place: PlacedCq
  paused: boolean
  canVote: boolean
  busy: boolean
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!canVote || busy}
      aria-pressed={cq.voted}
      style={{
        left: `${place.x}%`,
        top: `${place.y}%`,
        width: `${place.widthPercent}%`,
        opacity: place.opacity,
        animationDuration: `${place.driftSeconds}s`,
        animationDelay: `${place.delaySeconds}s`,
        animationPlayState: paused ? 'paused' : 'running',
        ['--cq-dx' as string]: `${place.driftX}px`,
        ['--cq-dy' as string]: `${place.driftY}px`,
        ['--cq-dx2' as string]: `${place.driftX2}px`,
        ['--cq-dy2' as string]: `${place.driftY2}px`,
        ['--cq-tilt' as string]: `${place.tiltDeg}deg`,
      }}
      // 上の空（自分の問い＝タップでパネルが開く）と押した結果が違うので、
      // 見た目でも別のものだと分かるようにする。角をぐっと丸めて、
      // 押せるときは行頭にハートを常に出す（印を「つけるもの」だと見せる）。
      className={`cq-bubble absolute text-left leading-snug rounded-[1.6rem] ring-1 ${SIZE_CLASS[place.size]} ${
        cq.voted
          ? 'bg-rose-50 dark:bg-rose-950 text-rose-950 dark:text-rose-100 font-bold ring-rose-200 dark:ring-rose-800 shadow-md shadow-rose-900/10'
          : canVote
            ? 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 ring-rose-100 dark:ring-rose-900/50 shadow-sm shadow-brand-900/10'
            : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 ring-brand-100 dark:ring-brand-800/60 shadow-sm shadow-brand-900/10'
      } ${canVote ? '' : 'cursor-default'}`}
    >
      <span className="flex items-start gap-1.5">
        {/* ハートは押せる人にだけ、行頭に。押せない人に押すものを見せない。
            塗りは印がついた合図で、押しているのは泡そのもの（面を大きく取るため）。 */}
        {canVote && (
          <Heart
            className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${
              cq.voted ? 'fill-rose-500 text-rose-500' : 'text-rose-300 dark:text-rose-500/60'
            }`}
          />
        )}
        <span className="min-w-0">{cq.title}</span>
      </span>
      {/* 名乗りと票数。0票の行は名乗りだけ（そこにハートを添えると人を推して見える）。 */}
      <span
        className={`mt-1 block text-[10px] ${
          cq.voted ? 'text-rose-700 dark:text-rose-300 font-bold' : 'text-gray-400 dark:text-gray-500'
        } ${canVote ? 'pl-5' : ''}`}
      >
        {communityVoteLabel(cq)}
      </span>
    </button>
  )
}
