'use client'
import { useHits, Configure } from 'react-instantsearch'
import { useState, useMemo, useEffect } from 'react'
import {
  createSearchClient,
  getIndexName,
  createSubscriptionSearchClient,
  getSubscriptionIndexName,
  hasSubscriptionConfig,
} from '@/lib/algolia'
import { ResultCard, type Hit } from './ResultCard'

type OwnerFilter = 'all' | 'personal' | 'team' | 'subscription'

// ジャンルボタンの折りたたみ閾値（これを超えたら「すべて表示」で展開）
const GENRE_SHOW_LIMIT = 12

// 個人・部署・サブスクのファセットを別々に持つ
type FacetData = {
  personal: Record<string, number>
  team: Record<string, number>
  subscription: Record<string, number>
}

// ハイブリッドソート: 番号付き(01.〜) → 番号なし(あいうえお順) → INBOX最後
function hybridSort(a: string, b: string): number {
  if (a === 'INBOX') return 1
  if (b === 'INBOX') return -1
  const mA = a.match(/^(\d+)\./)
  const mB = b.match(/^(\d+)\./)
  if (mA && mB) {
    const diff = parseInt(mA[1], 10) - parseInt(mB[1], 10)
    if (diff !== 0) return diff
    return a.localeCompare(b, 'ja')
  }
  if (mA) return -1
  if (mB) return 1
  return a.localeCompare(b, 'ja')
}

// 番号プレフィックスを除いた表示名
function displayGenreName(g: string): string {
  return g.replace(/^\d+\./, '')
}

function GenreOwnerFilterTabs({ owner, onChange, hasTeam, hasSubscription }: {
  owner: OwnerFilter
  onChange: (v: OwnerFilter) => void
  hasTeam: boolean
  hasSubscription: boolean
}) {
  const options: { id: OwnerFilter; label: string; inactive?: boolean }[] = [
    { id: 'all', label: '全て' },
    { id: 'personal', label: '個人' },
    { id: 'team', label: '部署', inactive: !hasTeam },
    { id: 'subscription', label: hasSubscription ? '⭐ プレミアム' : '🔒 プレミアム', inactive: !hasSubscription },
  ]
  return (
    <div className="flex gap-1 mb-3 flex-wrap">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`text-xs font-medium px-3 py-1 rounded-full transition-colors ${
            owner === o.id
              ? 'bg-blue-600 text-white'
              : o.inactive
                ? 'bg-gray-50 dark:bg-gray-800 text-gray-300 dark:text-gray-600 border border-gray-200 dark:border-gray-700'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function GenreList({ onGenreSelect, selectedGenre, owner }: {
  onGenreSelect: (genre: string | null) => void
  selectedGenre: string | null
  owner: OwnerFilter
}) {
  const [facetData, setFacetData] = useState<FacetData>({ personal: {}, team: {}, subscription: {} })
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const subEnabled = hasSubscriptionConfig()

  useEffect(() => {
    let cancelled = false
    const idx = createSearchClient().initIndex(getIndexName())
    const tasks: Promise<{ source: 'personal' | 'team' | 'subscription'; facets: Record<string, number> }>[] = []

    // 個人（owner:personal または ownerなし）
    tasks.push(
      idx
        .search('', { facets: ['genre'], hitsPerPage: 0, maxValuesPerFacet: 100, filters: 'owner:personal' })
        .then((res) => {
          const f = (res as unknown as { facets?: { genre?: Record<string, number> } }).facets?.genre || {}
          return { source: 'personal' as const, facets: f }
        })
        .catch(() => ({ source: 'personal' as const, facets: {} })),
    )

    // 部署（owner:team）
    tasks.push(
      idx
        .search('', { facets: ['genre'], hitsPerPage: 0, maxValuesPerFacet: 100, filters: 'owner:team' })
        .then((res) => {
          const f = (res as unknown as { facets?: { genre?: Record<string, number> } }).facets?.genre || {}
          return { source: 'team' as const, facets: f }
        })
        .catch(() => ({ source: 'team' as const, facets: {} })),
    )

    // サブスク（設定あれば）
    if (subEnabled) {
      tasks.push(
        createSubscriptionSearchClient()
          .initIndex(getSubscriptionIndexName())
          .search('', { facets: ['genre'], hitsPerPage: 0, maxValuesPerFacet: 100 })
          .then((res) => {
            const f = (res as unknown as { facets?: { genre?: Record<string, number> } }).facets?.genre || {}
            return { source: 'subscription' as const, facets: f }
          })
          .catch(() => ({ source: 'subscription' as const, facets: {} })),
      )
    }

    Promise.all(tasks).then((results) => {
      if (cancelled) return
      const next: FacetData = { personal: {}, team: {}, subscription: {} }
      for (const r of results) {
        next[r.source] = r.facets
      }
      setFacetData(next)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [subEnabled])

  // ownerFilterに応じてジャンル一覧をフィルタ
  const sortedGenres = useMemo(() => {
    let genres: Set<string>
    if (owner === 'subscription') {
      genres = new Set(Object.keys(facetData.subscription))
    } else if (owner === 'team') {
      genres = new Set(Object.keys(facetData.team))
    } else if (owner === 'personal') {
      genres = new Set(Object.keys(facetData.personal))
    } else {
      // all: 個人・部署・サブスク全て
      genres = new Set([
        ...Object.keys(facetData.personal),
        ...Object.keys(facetData.team),
        ...Object.keys(facetData.subscription),
      ])
    }
    return Array.from(genres).sort(hybridSort)
  }, [facetData, owner])

  if (loading) {
    return (
      <div className="text-center py-8 text-gray-400">
        <p className="text-sm">読み込み中...</p>
      </div>
    )
  }

  if (sortedGenres.length === 0) {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800 leading-relaxed">
        <p className="font-medium mb-2">💡 ジャンルを使ってみよう</p>
        <p className="text-blue-700">
          Notion側の「ジャンル」プロパティにオプションを追加すると、ここに一覧表示されます。
        </p>
        <p className="text-blue-700 mt-2">
          オプション名の先頭を <span className="font-mono bg-white px-1.5 py-0.5 rounded">01.総論</span> <span className="font-mono bg-white px-1.5 py-0.5 rounded">05.循環</span> のように
          <strong className="font-semibold">2桁数字＋ピリオド</strong>で始めると、アプリ内でも同じ順番に並びます。
        </p>
      </div>
    )
  }

  const visibleGenres = showAll ? sortedGenres : sortedGenres.slice(0, GENRE_SHOW_LIMIT)
  const hiddenCount = sortedGenres.length - visibleGenres.length

  return (
    <>
    <div className="grid grid-cols-2 gap-2 mb-4">
      {visibleGenres.map((genre) => {
        const personalCount = facetData.personal[genre] || 0
        const teamCount = facetData.team[genre] || 0
        const subCount = facetData.subscription[genre] || 0
        const total = owner === 'subscription'
          ? subCount
          : owner === 'team'
            ? teamCount
            : owner === 'personal'
              ? personalCount
              : personalCount + teamCount + subCount
        const hasSub = subCount > 0 && owner !== 'personal' && owner !== 'team'
        const isActive = selectedGenre === genre
        return (
          <button
            key={genre}
            onClick={() => onGenreSelect(isActive ? null : genre)}
            className={`text-left px-3 py-2 rounded-xl border text-sm font-medium transition-all flex items-center justify-between gap-2 ${
              isActive
                ? 'bg-blue-600 text-white border-transparent shadow-sm'
                : 'bg-white border-gray-200 text-gray-700 hover:shadow-sm hover:border-blue-300'
            }`}
          >
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="truncate">{displayGenreName(genre)}</span>
              {hasSub && (
                <span
                  className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                    isActive ? 'bg-purple-200' : 'bg-purple-500'
                  }`}
                  title="プレミアムにもあります"
                  aria-label="プレミアムにもあります"
                />
              )}
            </span>
            <span className={`text-xs shrink-0 ${isActive ? 'text-blue-100' : 'text-gray-400'}`}>
              {total}
            </span>
          </button>
        )
      })}
    </div>
    {(hiddenCount > 0 || showAll) && sortedGenres.length > GENRE_SHOW_LIMIT && (
      <button
        onClick={() => setShowAll((v) => !v)}
        className="w-full text-center text-xs font-medium text-blue-600 hover:text-blue-700 py-2 mb-4"
      >
        {showAll ? '▲ 折りたたむ' : `▼ すべて表示（残り ${hiddenCount} 件）`}
      </button>
    )}
    </>
  )
}

// 選択後の個人側ヒット取得（react-instantsearch経由）
function PersonalHitsCollector({ onLoaded }: { onLoaded: (hits: Hit[]) => void }) {
  const { hits } = useHits()
  useEffect(() => {
    onLoaded(hits as unknown as Hit[])
  }, [hits, onLoaded])
  return null
}

function SelectedGenreView({ genre, onClear, owner }: {
  genre: string
  onClear: () => void
  owner: OwnerFilter
}) {
  const subEnabled = hasSubscriptionConfig()
  const [personalHits, setPersonalHits] = useState<Hit[]>([])
  const [subHits, setSubHits] = useState<Hit[]>([])
  const [subLoading, setSubLoading] = useState(subEnabled)

  // サブスクは直接Algoliaから取得
  useEffect(() => {
    if (!subEnabled) {
      setSubHits([])
      setSubLoading(false)
      return
    }
    let cancelled = false
    setSubLoading(true)
    createSubscriptionSearchClient()
      .initIndex(getSubscriptionIndexName())
      .search('', { filters: `genre:"${genre}"`, hitsPerPage: 50 })
      .then((res) => {
        if (cancelled) return
        const hits = (res as unknown as { hits: Hit[] }).hits || []
        setSubHits(hits.map((h) => ({ ...h, owner: 'subscription' as const })))
        setSubLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setSubLoading(false)
      })
    return () => { cancelled = true }
  }, [genre, subEnabled])

  // ownerFilterに基づいてヒットをマージ
  const displayedHits = useMemo(() => {
    if (owner === 'subscription') return subHits
    if (owner === 'personal') return personalHits.filter((h) => !h.owner || h.owner === 'personal')
    if (owner === 'team') return personalHits.filter((h) => h.owner === 'team')
    // all: 個人 → サブスクの順に並べる（個人優先）
    const seen = new Set<string>()
    const merged: Hit[] = []
    for (const h of personalHits) {
      if (!seen.has(h.objectID)) { merged.push(h); seen.add(h.objectID) }
    }
    for (const h of subHits) {
      if (!seen.has(h.objectID)) { merged.push(h); seen.add(h.objectID) }
    }
    return merged
  }, [owner, personalHits, subHits])

  // 個人側フィルタ: ownerに応じて絞る
  const personalFilter = owner === 'subscription'
    ? 'owner:__none__'
    : owner === 'personal'
      ? `genre:"${genre}" AND (owner:personal OR NOT _exists_:owner)`
      : owner === 'team'
        ? `genre:"${genre}" AND owner:team`
        : `genre:"${genre}"`

  return (
    <>
      {/* 個人側はreact-instantsearch経由で取得 */}
      <Configure filters={personalFilter} hitsPerPage={50} />
      <PersonalHitsCollector onLoaded={setPersonalHits} />

      <div className="flex items-center justify-between mb-3 gap-2">
        <p className="text-sm font-medium text-gray-700 truncate">{displayGenreName(genre)}</p>
        <button
          onClick={onClear}
          className="text-xs text-gray-400 hover:text-gray-600 shrink-0"
        >
          ✕ 解除
        </button>
      </div>

      {subLoading && owner !== 'personal' && owner !== 'team' && (
        <p className="text-xs text-gray-400 mb-2">プレミアム読み込み中...</p>
      )}

      {displayedHits.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <p>このジャンルにはまだエントリがありません</p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayedHits.map((hit) => (
            <ResultCard key={hit.objectID} hit={hit} />
          ))}
        </div>
      )}
    </>
  )
}

export function GenreBrowse({ hasTeam = false, hasSubscription = false }: { hasTeam?: boolean; hasSubscription?: boolean }) {
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null)
  const [owner, setOwner] = useState<OwnerFilter>('all')

  return (
    <div>
      <div className="sticky top-[88px] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-2 pt-1 -mx-4 px-4 mb-1">
        <GenreOwnerFilterTabs owner={owner} onChange={(v) => { setOwner(v); setSelectedGenre(null) }} hasTeam={hasTeam} hasSubscription={hasSubscription} />
      </div>
      {selectedGenre ? (
        <SelectedGenreView genre={selectedGenre} onClear={() => setSelectedGenre(null)} owner={owner} />
      ) : (
        <GenreList onGenreSelect={setSelectedGenre} selectedGenre={selectedGenre} owner={owner} />
      )}
    </div>
  )
}
