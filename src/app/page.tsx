'use client'
import { InstantSearch, Configure, useHits, useSearchBox } from 'react-instantsearch'
import { useState, useEffect } from 'react'
import { createSearchClient, getIndexName } from '@/lib/algolia'
import { isSetupComplete, clearSettings, getSettings } from '@/lib/settings'
import { SearchBox } from '@/components/SearchBox'
import { SearchResults } from '@/components/SearchResults'
import { ResultCard, type Hit } from '@/components/ResultCard'
import { QuizCard } from '@/components/QuizCard'
import { useSearchHistory, SearchHistoryList } from '@/components/SearchHistory'
import { GenreBrowse } from '@/components/GenreBrowse'
import { SetupWizard } from '@/components/SetupWizard'
import { SyncPanel } from '@/components/SyncPanel'

type Tab = 'search' | 'recent' | 'browse' | 'quiz' | 'reference'

// 新着タブ：期間別に仕切り
function RecentHits() {
  const { hits } = useHits()
  const now = new Date()

  const groups: { label: string; hits: Hit[] }[] = [
    { label: '今日', hits: [] },
    { label: '今週', hits: [] },
    { label: '今月', hits: [] },
    { label: 'それ以前', hits: [] },
  ]

  for (const hit of hits as unknown as Hit[]) {
    const d = new Date(hit.createdAt || hit.lastEdited)
    const diffDays = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
    if (diffDays < 1) groups[0].hits.push(hit)
    else if (diffDays < 7) groups[1].hits.push(hit)
    else if (diffDays < 30) groups[2].hits.push(hit)
    else groups[3].hits.push(hit)
  }

  if (hits.length === 0) {
    return (
      <div className="text-center py-14 px-4">
        <div className="text-5xl mb-4">📭</div>
        <p className="text-gray-600 dark:text-gray-300 font-semibold text-base mb-1">データがありません</p>
        <p className="text-sm text-gray-400 dark:text-gray-500">
          画面下の「🔄 再同期」からデータを取り込んでください
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {groups.filter((g) => g.hits.length > 0).map((group) => (
        <div key={group.label}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">
              {group.label}
            </span>
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            <span className="text-xs text-gray-300 dark:text-gray-600">{group.hits.length}件</span>
          </div>
          <div className="space-y-3">
            {group.hits.map((hit) => (
              <ResultCard key={hit.objectID} hit={hit} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// クイズタブ：ランダムシャッフル
function QuizHits() {
  const { hits } = useHits()
  const [shuffled, setShuffled] = useState<Hit[]>([])

  useEffect(() => {
    const arr = [...hits] as unknown as Hit[]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]]
    }
    setShuffled(arr.slice(0, 20))
  }, [hits.length])

  if (hits.length === 0) {
    return (
      <div className="text-center py-14 px-4">
        <div className="text-5xl mb-4">🧠</div>
        <p className="text-gray-600 dark:text-gray-300 font-semibold text-base mb-1">クイズがありません</p>
        <p className="text-sm text-gray-400 dark:text-gray-500">
          「❓ クリニカルクエスチョン」または「💡 ナレッジ」の<br />知識レベルを持つデータが必要です
        </p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-400 dark:text-gray-500">タイトルを見て内容を思い出してみましょう</p>
        <button
          onClick={() => {
            const arr = [...hits] as unknown as Hit[]
            for (let i = arr.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [arr[i], arr[j]] = [arr[j], arr[i]]
            }
            setShuffled(arr.slice(0, 20))
          }}
          className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 font-medium"
        >
          シャッフル
        </button>
      </div>
      <div className="space-y-3">
        {shuffled.map((hit, i) => (
          <QuizCard key={hit.objectID} hit={hit} index={i} />
        ))}
      </div>
    </div>
  )
}

// 参考文献タブ：ソート機能付き
type RefSort = 'year_desc' | 'year_asc' | 'lastEdited'
function ReferenceHits({ sort }: { sort: RefSort }) {
  const { hits } = useHits()
  const sorted = [...hits as unknown as Hit[]].sort((a, b) => {
    if (sort === 'year_desc') return (b.year || '0') > (a.year || '0') ? 1 : -1
    if (sort === 'year_asc') return (a.year || '0') > (b.year || '0') ? 1 : -1
    return (b.lastEdited || '') > (a.lastEdited || '') ? 1 : -1
  })
  if (sorted.length === 0) {
    return (
      <div className="text-center py-12 text-gray-400 dark:text-gray-500">
        <p className="text-lg">該当なし</p>
        <p className="text-sm mt-1">別のキーワードで試してください</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      {sorted.map((hit) => (
        <ResultCard key={hit.objectID} hit={hit} />
      ))}
    </div>
  )
}

function ReferenceTab() {
  const [sort, setSort] = useState<RefSort>('year_desc')
  const sortOptions: { value: RefSort; label: string }[] = [
    { value: 'year_desc', label: '年 (新しい順)' },
    { value: 'year_asc', label: '年 (古い順)' },
    { value: 'lastEdited', label: '更新日順' },
  ]
  return (
    <>
      <Configure hitsPerPage={200} filters="source:reference" />
      <div className="sticky top-[88px] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-3 pt-1 -mx-4 px-4 flex items-center gap-2">
        <div className="flex-1">
          <SearchBox />
        </div>
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as RefSort)}
          className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-2 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 shrink-0"
        >
          {sortOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <ReferenceHits sort={sort} />
    </>
  )
}

// 検索タブの内部コンポーネント（useSearchBoxを使うため）
function SearchTab() {
  const { refine, query } = useSearchBox()
  const { history, addHistory, clearHistory } = useSearchHistory()
  const [hasSearched, setHasSearched] = useState(false)

  const handleSelect = (q: string) => {
    refine(q)
    setHasSearched(true)
  }

  return (
    <>
      <div className="sticky top-[88px] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-3 pt-1 -mx-4 px-4">
        <SearchBox />
      </div>
      {!query && !hasSearched ? (
        <SearchHistoryList
          history={history}
          onSelect={handleSelect}
          onClear={clearHistory}
        />
      ) : (
        <SearchResults onSearch={(q) => { if (q) addHistory(q) }} />
      )}
    </>
  )
}

export default function Home() {
  const [tab, setTab] = useState<Tab>('search')
  const [setupDone, setSetupDone] = useState<boolean | null>(null)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  useEffect(() => {
    setSetupDone(isSetupComplete())
  }, [])

  const handleReset = () => {
    clearSettings()
    setSetupDone(false)
    setShowResetConfirm(false)
  }

  if (setupDone === null) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-gray-50 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="text-gray-400 text-sm">読み込み中...</div>
      </div>
    )
  }

  if (!setupDone) {
    return <SetupWizard onComplete={() => setSetupDone(true)} />
  }

  const settings = getSettings()
  const dynamicSearchClient = createSearchClient()
  const dynamicIndexName = settings?.algoliaIndex || getIndexName()

  const tabs: { id: Tab; label: string }[] = [
    { id: 'search', label: '🔍 検索' },
    { id: 'recent', label: '🆕 新着' },
    { id: 'browse', label: '🗂 ジャンル' },
    { id: 'reference', label: '📖 文献' },
    { id: 'quiz', label: '🧠 クイズ' },
  ]

  return (
    <InstantSearch key={tab} searchClient={dynamicSearchClient} indexName={dynamicIndexName}>
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-gray-50 dark:from-gray-900 dark:to-gray-800">
        {/* 固定ヘッダー */}
        <div className="sticky top-0 z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-gray-100 dark:border-gray-700 shadow-sm">
          <div className="max-w-2xl mx-auto px-4 pt-3 pb-2">
            {/* ヘッダー */}
            <div className="flex items-center justify-between mb-3">
              <div className="w-16" />
              <h1 className="text-lg font-bold text-gray-900 dark:text-white">🏥 Medical Search</h1>
              <div className="w-16 flex justify-end">
                {showResetConfirm ? (
                  <div className="flex gap-1">
                    <button onClick={handleReset} className="text-xs text-red-500 font-medium">
                      リセット
                    </button>
                    <button onClick={() => setShowResetConfirm(false)} className="text-xs text-gray-400 dark:text-gray-500">
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowResetConfirm(true)}
                    className="text-xs text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400"
                    title="設定をリセット"
                  >
                    ⚙️
                  </button>
                )}
              </div>
            </div>

            {/* タブ */}
            <div className="flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1 gap-0.5 overflow-x-auto">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`shrink-0 flex-1 py-2 px-1 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                    tab === t.id
                      ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                      : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* コンテンツ */}
        <div className="max-w-2xl mx-auto px-4 py-4">
          {/* 検索タブ */}
          {tab === 'search' && (
            <>
              <Configure hitsPerPage={20} />
              <SearchTab />
            </>
          )}

          {/* 新着タブ */}
          {tab === 'recent' && (
            <>
              <Configure hitsPerPage={300} />
              <RecentHits />
            </>
          )}

          {/* ジャンル別タブ */}
          {tab === 'browse' && <GenreBrowse />}

          {/* 参考文献タブ */}
          {tab === 'reference' && <ReferenceTab />}

          {/* クイズタブ */}
          {tab === 'quiz' && (
            <>
              <Configure
                hitsPerPage={100}
                filters='source:medical AND (knowledgeLevel:"❓ クリニカルクエスチョン" OR knowledgeLevel:"💡 ナレッジ")'
              />
              <QuizHits />
            </>
          )}
        </div>

        {/* 再同期パネル（全タブ共通・画面下部） */}
        <div className="max-w-2xl mx-auto bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-t border-gray-100 dark:border-gray-700 mt-4">
          <SyncPanel />
        </div>
      </div>
    </InstantSearch>
  )
}
