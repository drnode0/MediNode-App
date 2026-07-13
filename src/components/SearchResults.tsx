'use client'
import { useHits, useStats, useRefinementList, useSearchBox } from 'react-instantsearch'
import { Inbox, Search, ClipboardList, RefreshCw } from 'lucide-react'
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
              ? 'bg-brand-600 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
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
              ? 'bg-brand-600 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          {item.value}
          <span className="ml-1 opacity-60">({item.count})</span>
        </button>
      ))}
    </div>
  )
}

function EmptyState({ query }: { query: string }) {
  const suggestions = ['疾患名', '薬剤名', '検査値', '治療', 'ガイドライン']

  if (!query) {
    // データが0件の場合（まだ同期していない）
    return (
      <div className="text-center py-14 px-4">
        <div className="mb-4 flex justify-center text-gray-300 dark:text-gray-600"><Inbox className="h-12 w-12" /></div>
        <p className="text-gray-600 dark:text-gray-300 font-semibold text-base mb-1">データがありません</p>
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-6">
          まず画面下の「データを再同期する」から同期を行ってください
        </p>
        <div className="bg-brand-50 dark:bg-brand-900/30 rounded-xl p-4 text-left text-sm text-brand-700 dark:text-brand-300 max-w-xs mx-auto">
          <p className="font-semibold mb-2"><ClipboardList className="inline-block h-3.5 w-3.5 align-text-bottom mr-1" />手順</p>
          <ol className="space-y-1 list-decimal list-inside text-xs">
            <li>NotionのDBにデータを入力</li>
            <li>画面下の「再同期」をタップ</li>
            <li>「同期開始」ボタンをクリック</li>
          </ol>
        </div>
      </div>
    )
  }

  return (
    <div className="text-center py-14 px-4">
      <div className="mb-4 flex justify-center text-gray-300 dark:text-gray-600"><Search className="h-12 w-12" /></div>
      <p className="text-gray-600 dark:text-gray-300 font-semibold text-base mb-1">
        「{query}」の検索結果がありません
      </p>
      <p className="text-sm text-gray-400 dark:text-gray-500 mb-6">
        別のキーワードで試してみてください
      </p>

      <div className="space-y-3">
        <p className="text-xs text-gray-400 dark:text-gray-500 font-medium">検索のヒント</p>
        <ul className="text-xs text-gray-500 dark:text-gray-400 space-y-1 text-left inline-block">
          <li>• 漢字・かな・英語のいずれでも検索できます</li>
          <li>• より短いキーワードで試してみてください</li>
          <li>• 同義語や略語で試してみてください</li>
        </ul>

        <div className="mt-4">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">例えばこんな言葉で</p>
          <div className="flex gap-2 flex-wrap justify-center">
            {suggestions.map((s) => (
              <span
                key={s}
                className="px-3 py-1 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-full text-xs"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-8 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-xl text-xs text-amber-700 dark:text-amber-400">
        <p className="font-semibold mb-1"><RefreshCw className="inline-block h-3.5 w-3.5 align-text-bottom mr-1" />データが少ない場合</p>
        <p>Notionに新しいデータを追加した後は、画面下の「再同期」が必要です</p>
      </div>
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
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5 font-medium">ジャンル</p>
            <GenreFilter />
          </div>
          <div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5 font-medium">知識レベル</p>
            <LevelFilter />
          </div>
        </div>
      )}

      {hits.length === 0 ? (
        <EmptyState query={query} />
      ) : (
        <>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">{nbHits}件 · {processingTimeMS}ms</p>
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
