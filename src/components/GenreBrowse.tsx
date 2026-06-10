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

type Source = 'all' | 'personal' | 'subscription'

// 個人とサブスクのファセットを別々に持つ
type FacetData = {
  personal: Record<string, number>
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

function GenreList({ onGenreSelect, selectedGenre }: {
  onGenreSelect: (genre: string | null) => void
  selectedGenre: string | null
}) {
  const [facetData, setFacetData] = useState<FacetData>({ personal: {}, subscription: {} })
  const [loading, setLoading] = useState(true)
  const subEnabled = hasSubscriptionConfig()

  useEffect(() => {
    let cancelled = false
    const tasks: Promise<{ source: 'personal' | 'subscription'; facets: Record<string, number> }>[] = []

    // 個人
    tasks.push(
      createSearchClient()
        .initIndex(getIndexName())
        .search('', { facets: ['genre'], hitsPerPage: 0, maxValuesPerFacet: 100 })
        .then((res) => {
          const f = (res as unknown as { facets?: { genre?: Record<string, number> } }).facets?.genre || {}
          return { source: 'personal' as const, facets: f }
        })
        .catch(() => ({ source: 'personal' as const, facets: {} })),
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
      const next: FacetData = { personal: {}, subscription: {} }
      for (const r of results) {
        next[r.source] = r.facets
      }
      setFacetData(next)
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [subEnabled])

  // マージしたジャンル一覧
  const sortedGenres = useMemo(() => {
    const all = new Set<string>([
      ...Object.keys(facetData.personal),
      ...Object.keys(facetData.subscription),
    ])
    return Array.from(all).sort(hybridSort)
  }, [facetData])

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

  return (
    <div className="grid grid-cols-2 gap-2 mb-4">
      {sortedGenres.map((genre) => {
        const personalCount = facetData.personal[genre] || 0
        const subCount = facetData.subscription[genre] || 0
        const total = personalCount + subCount
        const hasSub = subCount > 0
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

function SelectedGenreView({ genre, onClear }: {
  genre: string
  onClear: () => void
}) {
  const subEnabled = hasSubscriptionConfig()
  const [source, setSource] = useState<Source>('all')
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

  const displayedHits = useMemo(() => {
    if (source === 'personal') return personalHits
    if (source === 'subscription') return subHits
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
  }, [source, personalHits, subHits])

  return (
    <>
      {/* 個人側はreact-instantsearch経由で取得 */}
      <Configure filters={`genre:"${genre}"`} hitsPerPage={50} />
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

      {/* ソース切替トグル（サブスク設定ありのときのみ） */}
      {subEnabled && (
        <div className="flex gap-1 mb-3 p-1 bg-gray-100 rounded-lg">
          {([
            { value: 'all' as Source, label: `全て (${personalHits.length + subHits.length})` },
            { value: 'personal' as Source, label: `個人 (${personalHits.length})` },
            { value: 'subscription' as Source, label: `プレミアム (${subHits.length})` },
          ]).map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSource(opt.value)}
              className={`flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-all ${
                source === opt.value
                  ? 'bg-white text-gray-800 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {subLoading && source !== 'personal' && (
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

export function GenreBrowse() {
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null)

  return (
    <div>
      {selectedGenre ? (
        <SelectedGenreView genre={selectedGenre} onClear={() => setSelectedGenre(null)} />
      ) : (
        <GenreList onGenreSelect={setSelectedGenre} selectedGenre={selectedGenre} />
      )}
    </div>
  )
}
