'use client'
import { useHits, useStats, useRefinementList, useSearchBox } from 'react-instantsearch'
import { useEffect } from 'react'
import { ResultCard, type Hit } from './ResultCard'

function GenreFilter() {
  const { items, refine } = useRefinementList({ attribute: 'genre', limit: 20, sortBy: ['count:desc'] })
  if (items.length === 0) return null
  return (
    <div className="flex gap-1.5 flex-wrap">
      {items.map((item) => (
        <button
          key={item.value}
          onClick={() => refine(item.value)}
          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
            item.isRefined
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {item.value}
          <span className="ml-1 opacity-60">({item.count})</span>
        </button>
      ))}
    </div>
  )
}

function LevelFilter() {
  const { items, refine } = useRefinementList({ attribute: 'knowledgeLevel', limit: 10 })
  if (items.length === 0) return null
  return (
    <div className="flex gap-1.5 flex-wrap">
      {items.map((item) => (
        <button
          key={item.value}
          onClick={() => refine(item.value)}
          className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
            item.isRefined
              ? 'bg-indigo-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          {item.value}
          <span className="ml-1 opacity-60">({item.count})</span>
        </button>
      ))}
    </div>
  )
}

export function SearchResults({ showFilters, onSearch }: { showFilters?: boolean; onSearch?: (q: string) => void }) {
  const { hits } = useHits()
  const { nbHits, processingTimeMS } = useStats()
  const { query } = useSearchBox()

  useEffect(() => {
    if (query && onSearch) onSearch(query)
  }, [query])

  return (
    <div>
      {showFilters && (
        <div className="space-y-2 mb-4">
          <div>
            <p className="text-xs text-gray-400 mb-1.5 font-medium">ジャンル</p>
            <GenreFilter />
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-1.5 font-medium">知識レベル</p>
            <LevelFilter />
          </div>
        </div>
      )}

      {hits.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p className="text-lg">該当なし</p>
          <p className="text-sm mt-1">別のキーワードで試してください</p>
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-400 mb-3">{nbHits}件 · {processingTimeMS}ms</p>
          <div className="space-y-3">
            {hits.map((hit) => (
              <ResultCard key={hit.objectID} hit={hit as unknown as Hit} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
