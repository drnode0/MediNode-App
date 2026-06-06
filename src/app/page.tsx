'use client'
import { InstantSearch, Configure, useHits, useSearchBox } from 'react-instantsearch'
import { useState, useEffect, useCallback, useRef } from 'react'
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
type OwnerFilter = 'all' | 'personal' | 'team' | 'subscription'

// ============================================================
// Algoliaモード用コンポーネント（既存）
// ============================================================

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

function buildOwnerFilter(owner: OwnerFilter): string {
  if (owner === 'all') return ''
  return `owner:${owner}`
}

function OwnerFilterTabs({ owner, onChange, hasTeam, hasSubscription }: {
  owner: OwnerFilter
  onChange: (v: OwnerFilter) => void
  hasTeam: boolean
  hasSubscription: boolean
}) {
  const options: { id: OwnerFilter; label: string }[] = [
    { id: 'all', label: '全て' },
    { id: 'personal', label: '個人' },
    ...(hasTeam ? [{ id: 'team' as OwnerFilter, label: '部署' }] : []),
    ...(hasSubscription ? [{ id: 'subscription' as OwnerFilter, label: 'サブスク' }] : []),
  ]
  if (options.length <= 2) return null
  return (
    <div className="flex gap-1 mb-2">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`text-xs font-medium px-3 py-1 rounded-full transition-colors ${
            owner === o.id
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function SearchTab({ hasTeam, hasSubscription }: { hasTeam: boolean; hasSubscription: boolean }) {
  const { refine, query } = useSearchBox()
  const { history, addHistory, clearHistory } = useSearchHistory()
  const [hasSearched, setHasSearched] = useState(false)
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')

  const handleSelect = (q: string) => {
    refine(q)
    setHasSearched(true)
  }

  const filterStr = buildOwnerFilter(ownerFilter)

  return (
    <>
      <Configure hitsPerPage={20} filters={filterStr || undefined} />
      <div className="sticky top-[88px] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-3 pt-1 -mx-4 px-4">
        <SearchBox />
        <OwnerFilterTabs
          owner={ownerFilter}
          onChange={setOwnerFilter}
          hasTeam={hasTeam}
          hasSubscription={hasSubscription}
        />
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

// ============================================================
// Notionモード用コンポーネント（新規）
// ============================================================

function useNotionSearch(mode: Tab) {
  const settings = getSettings()
  const [records, setRecords] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetch = useCallback(async (keyword = '', extra: Record<string, unknown> = {}) => {
    if (!settings) return
    setLoading(true)
    setError('')
    try {
      const res = await window.fetch('/api/notion/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notionToken: settings.notionToken,
          notionMedicalDbId: settings.notionMedicalDbId,
          notionReferenceDbId: settings.notionReferenceDbId || undefined,
          keyword,
          ...extra,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '検索に失敗しました')
      setRecords(data.records as Hit[])
    } catch (err) {
      setError(err instanceof Error ? err.message : '検索エラー')
    } finally {
      setLoading(false)
    }
  }, [settings?.notionToken, settings?.notionMedicalDbId])

  // 新着・クイズ・ジャンルは初回マウント時に自動取得
  useEffect(() => {
    if (mode === 'recent') fetch('', { mode: 'recent' })
    if (mode === 'quiz') fetch('', { mode: 'quiz' })
    if (mode === 'browse') fetch('', { mode: 'browse' })
    if (mode === 'reference') fetch('', { mode: 'recent' }) // referenceはrecentと共用でフィルタ
  }, [mode])

  const search = useCallback((keyword: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!keyword.trim()) { setRecords([]); return }
    debounceRef.current = setTimeout(() => {
      fetch(keyword, { mode: 'search' })
    }, 600)
  }, [fetch])

  return { records, loading, error, search, refetch: fetch }
}

// Notionモード：検索タブ
function NotionSearchTab() {
  const { records, loading, error, search } = useNotionSearch('search')
  const { history, addHistory, clearHistory } = useSearchHistory()
  const [query, setQuery] = useState('')
  const [hasSearched, setHasSearched] = useState(false)

  const handleChange = (q: string) => {
    setQuery(q)
    if (q) { setHasSearched(true); addHistory(q) }
    search(q)
  }

  return (
    <>
      <div className="sticky top-[88px] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-3 pt-1 -mx-4 px-4">
        <input
          type="search"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          placeholder="キーワードで検索..."
          className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      </div>
      {loading && <div className="text-center py-12 text-gray-400"><span className="animate-spin inline-block mr-2">⟳</span>Notionを検索中...</div>}
      {error && <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-3 text-sm text-red-600 dark:text-red-400">{error}</div>}
      {!query && !hasSearched ? (
        <SearchHistoryList history={history} onSelect={handleChange} onClear={clearHistory} />
      ) : !loading && records.length === 0 && query ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          <p className="text-lg">該当なし</p>
          <p className="text-sm mt-1">別のキーワードで試してください</p>
        </div>
      ) : (
        <div className="space-y-3">
          {records.map((hit) => <ResultCard key={hit.objectID} hit={hit} />)}
        </div>
      )}
    </>
  )
}

// Notionモード：新着タブ
function NotionRecentTab() {
  const { records, loading, error } = useNotionSearch('recent')
  const now = new Date()

  const groups: { label: string; hits: Hit[] }[] = [
    { label: '今日', hits: [] },
    { label: '今週', hits: [] },
    { label: '今月', hits: [] },
    { label: 'それ以前', hits: [] },
  ]

  for (const hit of records) {
    const d = new Date(hit.createdAt || hit.lastEdited)
    const diffDays = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
    if (diffDays < 1) groups[0].hits.push(hit)
    else if (diffDays < 7) groups[1].hits.push(hit)
    else if (diffDays < 30) groups[2].hits.push(hit)
    else groups[3].hits.push(hit)
  }

  if (loading) return <div className="text-center py-12 text-gray-400"><span className="animate-spin inline-block mr-2">⟳</span>取得中...</div>
  if (error) return <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-3 text-sm text-red-600">{error}</div>
  if (records.length === 0) return (
    <div className="text-center py-14 px-4">
      <div className="text-5xl mb-4">📭</div>
      <p className="text-gray-600 dark:text-gray-300 font-semibold">データがありません</p>
      <p className="text-sm text-gray-400 mt-1">NotionのDBにデータを追加してください</p>
    </div>
  )

  return (
    <div className="space-y-6">
      {groups.filter((g) => g.hits.length > 0).map((group) => (
        <div key={group.label}>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{group.label}</span>
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            <span className="text-xs text-gray-300 dark:text-gray-600">{group.hits.length}件</span>
          </div>
          <div className="space-y-3">
            {group.hits.map((hit) => <ResultCard key={hit.objectID} hit={hit} />)}
          </div>
        </div>
      ))}
    </div>
  )
}

// Notionモード：クイズタブ
function NotionQuizTab() {
  const { records, loading, error } = useNotionSearch('quiz')
  const [shuffled, setShuffled] = useState<Hit[]>([])

  useEffect(() => {
    if (records.length > 0) {
      const arr = [...records]
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]]
      }
      setShuffled(arr.slice(0, 20))
    }
  }, [records])

  if (loading) return <div className="text-center py-12 text-gray-400"><span className="animate-spin inline-block mr-2">⟳</span>取得中...</div>
  if (error) return <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-3 text-sm text-red-600">{error}</div>
  if (records.length === 0) return (
    <div className="text-center py-14 px-4">
      <div className="text-5xl mb-4">🧠</div>
      <p className="text-gray-600 dark:text-gray-300 font-semibold">クイズがありません</p>
      <p className="text-sm text-gray-400 mt-1">「❓ クリニカルクエスチョン」または「💡 ナレッジ」の知識レベルが必要です</p>
    </div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-400 dark:text-gray-500">タイトルを見て内容を思い出してみましょう</p>
        <button
          onClick={() => {
            const arr = [...records]
            for (let i = arr.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [arr[i], arr[j]] = [arr[j], arr[i]]
            }
            setShuffled(arr.slice(0, 20))
          }}
          className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 font-medium"
        >
          シャッフル
        </button>
      </div>
      <div className="space-y-3">
        {shuffled.map((hit, i) => <QuizCard key={hit.objectID} hit={hit} index={i} />)}
      </div>
    </div>
  )
}

// Notionモード：ジャンル別タブ（GenreBrowseはAlgolia依存なので簡易版）
function NotionBrowseTab() {
  const { records, loading, error, refetch } = useNotionSearch('browse')
  const [genres, setGenres] = useState<string[]>([])
  const [selectedGenre, setSelectedGenre] = useState('')
  const [genreRecords, setGenreRecords] = useState<Hit[]>([])
  const [genreLoading, setGenreLoading] = useState(false)
  const settings = getSettings()

  // 全件取得してジャンル一覧を生成
  useEffect(() => {
    if (records.length > 0) {
      const genreSet = new Set<string>()
      for (const r of records) { if (r.genre) genreSet.add(r.genre) }
      setGenres(Array.from(genreSet).sort())
    }
  }, [records])

  const handleGenreSelect = async (genre: string) => {
    setSelectedGenre(genre)
    if (!settings) return
    setGenreLoading(true)
    try {
      const res = await window.fetch('/api/notion/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notionToken: settings.notionToken,
          notionMedicalDbId: settings.notionMedicalDbId,
          mode: 'browse',
          genre,
          pageSize: 50,
        }),
      })
      const data = await res.json()
      setGenreRecords(data.records as Hit[])
    } finally {
      setGenreLoading(false)
    }
  }

  if (loading) return <div className="text-center py-12 text-gray-400"><span className="animate-spin inline-block mr-2">⟳</span>ジャンル取得中...</div>
  if (error) return <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-3 text-sm text-red-600">{error}</div>

  if (!selectedGenre) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">ジャンルを選択</p>
        {genres.length === 0 ? (
          <p className="text-sm text-gray-400">ジャンルが設定されたデータがありません</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {genres.map((g) => (
              <button
                key={g}
                onClick={() => handleGenreSelect(g)}
                className="text-left border border-gray-200 dark:border-gray-600 rounded-xl px-4 py-3 text-sm text-gray-700 dark:text-gray-200 hover:bg-blue-50 dark:hover:bg-blue-900/30 hover:border-blue-300 dark:hover:border-blue-700 transition-colors"
              >
                {g}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <button
          onClick={() => { setSelectedGenre(''); setGenreRecords([]) }}
          className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400"
        >
          ← ジャンル一覧
        </button>
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-200">{selectedGenre}</span>
      </div>
      {genreLoading ? (
        <div className="text-center py-8 text-gray-400"><span className="animate-spin inline-block mr-2">⟳</span>取得中...</div>
      ) : (
        <div className="space-y-3">
          {genreRecords.map((hit) => <ResultCard key={hit.objectID} hit={hit} />)}
        </div>
      )}
    </div>
  )
}

// Notionモード：参考文献タブ
function NotionReferenceTab() {
  const { records, loading, error } = useNotionSearch('reference')
  const refRecords = records.filter((r) => r.source === 'reference')
  const [sort, setSort] = useState<RefSort>('year_desc')

  const sorted = [...refRecords].sort((a, b) => {
    if (sort === 'year_desc') return (b.year || '0') > (a.year || '0') ? 1 : -1
    if (sort === 'year_asc') return (a.year || '0') > (b.year || '0') ? 1 : -1
    return (b.lastEdited || '') > (a.lastEdited || '') ? 1 : -1
  })

  const sortOptions: { value: RefSort; label: string }[] = [
    { value: 'year_desc', label: '年 (新しい順)' },
    { value: 'year_asc', label: '年 (古い順)' },
    { value: 'lastEdited', label: '更新日順' },
  ]

  if (loading) return <div className="text-center py-12 text-gray-400"><span className="animate-spin inline-block mr-2">⟳</span>取得中...</div>
  if (error) return <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-3 text-sm text-red-600">{error}</div>

  return (
    <>
      <div className="sticky top-[88px] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-3 pt-1 -mx-4 px-4 flex justify-end">
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as RefSort)}
          className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-2 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300"
        >
          {sortOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      {sorted.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          <p>参考文献DBが設定されていないか、データがありません</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((hit) => <ResultCard key={hit.objectID} hit={hit} />)}
        </div>
      )}
    </>
  )
}

// ============================================================
// 設定パネル
// ============================================================

type SettingsPanelProps = {
  onClose: () => void
  onReset: () => void
  onRedo: () => void
  currentMode: string
}
function SettingsPanel({ onClose, onReset, onRedo, currentMode }: SettingsPanelProps) {
  const [showResetConfirm, setShowResetConfirm] = useState(false)
  const [showHelp, setShowHelp] = useState(false)

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 rounded-t-2xl shadow-xl max-w-2xl mx-auto">
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-200 dark:bg-gray-700" />
        </div>

        <div className="px-5 pb-8 pt-2">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-bold text-gray-900 dark:text-white">⚙️ 設定</h2>
            <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-full">
              {currentMode === 'notion' ? '📋 シンプルモード' : '⚡ パワーモード'}
            </span>
          </div>

          {showHelp ? (
            <div className="space-y-4">
              <button onClick={() => setShowHelp(false)} className="text-sm text-blue-500 hover:text-blue-700 dark:text-blue-400 flex items-center gap-1">← 戻る</button>
              <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300 max-h-[60vh] overflow-y-auto pr-1">
                <section>
                  <h3 className="font-bold text-gray-900 dark:text-white mb-2">🔄 同期エラーが出たときは</h3>
                  <div className="space-y-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                    <p><strong>「API token is invalid」</strong></p>
                    <p>→ Notion Integration Tokenが間違っています。notion.so/my-integrations で「シークレット」を再コピーし、設定をやり直してください。</p>
                    <p className="mt-2"><strong>「restricted_resource / 403」</strong></p>
                    <p>→ DBにIntegrationが接続されていません。NotionのDBページ右上「…」→「接続先に追加」→ Integrationを選択してください。</p>
                    {currentMode === 'algolia' && (
                      <>
                        <p className="mt-2"><strong>「Admin API Key エラー」</strong></p>
                        <p>→ AlgoliaのAdmin API Keyが間違っています。Search API KeyではなくAdmin API Keyを使用してください。</p>
                      </>
                    )}
                  </div>
                </section>
                <section>
                  <h3 className="font-bold text-gray-900 dark:text-white mb-2">⚠️ プロパティ名について</h3>
                  <div className="text-xs bg-amber-50 dark:bg-amber-900/30 rounded-xl p-3 text-amber-700 dark:text-amber-300">
                    <p>NotionDBのプロパティ名（「名前」「ジャンル」「AI要約」など）は<strong>変更しないでください</strong>。選択肢の追加・変更は自由です。</p>
                  </div>
                </section>
                <section>
                  <h3 className="font-bold text-gray-900 dark:text-white mb-2">📱 別のデバイスで使うには</h3>
                  <div className="text-xs bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                    <p>設定はこのブラウザのみに保存されています。別のデバイスで使う場合は同じURLを開いて再入力してください。</p>
                  </div>
                </section>
              </div>
            </div>
          ) : showResetConfirm ? (
            <div className="space-y-4">
              <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-4 text-sm text-red-700 dark:text-red-300">
                <p className="font-bold mb-1">⚠️ 本当にリセットしますか？</p>
                <p>入力した設定が全て削除されます。再度セットアップが必要になります。</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowResetConfirm(false)} className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">キャンセル</button>
                <button onClick={onReset} className="flex-1 bg-red-500 text-white rounded-xl py-3 text-sm font-semibold hover:bg-red-600 transition-colors">リセットする</button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <button onClick={() => setShowHelp(true)} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                <span className="text-xl">📖</span>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">ヘルプ・よくあるエラー</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">エラーの対処法・設定のヒント</p>
                </div>
                <span className="ml-auto text-gray-300 dark:text-gray-600">›</span>
              </button>
              <button onClick={() => { onClose(); onRedo() }} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                <span className="text-xl">🔑</span>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">設定を変更する</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">モード変更・APIキーの入力し直し</p>
                </div>
                <span className="ml-auto text-gray-300 dark:text-gray-600">›</span>
              </button>
              <div className="border-t border-gray-100 dark:border-gray-700 pt-2 mt-2">
                <button onClick={() => setShowResetConfirm(true)} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left">
                  <span className="text-xl">🗑</span>
                  <div>
                    <p className="text-sm font-semibold text-red-500 dark:text-red-400">設定をリセット</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">全ての設定を削除してセットアップをやり直す</p>
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

// ============================================================
// メインページ
// ============================================================

export default function Home() {
  const [tab, setTab] = useState<Tab>('search')
  const [setupDone, setSetupDone] = useState<boolean | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    setSetupDone(isSetupComplete())
  }, [])

  const handleReset = () => {
    clearSettings()
    setSetupDone(false)
    setShowSettings(false)
  }

  const handleRedo = () => {
    setSetupDone(false)
  }

  if (setupDone === null) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-gray-50 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="text-gray-400 text-sm">読み込み中...</div>
      </div>
    )
  }

  if (!setupDone) {
    return <SetupWizard onComplete={() => { setSetupDone(true); setShowSettings(false) }} />
  }

  const settings = getSettings()
  const searchMode = settings?.searchMode || 'algolia'
  const hasTeam = !!(settings?.teamNotionToken && settings?.teamNotionMedicalDbId)
  const hasSubscription = !!(settings?.subscriptionSearchKey && settings?.subscriptionAppId)

  const tabs: { id: Tab; label: string }[] = [
    { id: 'search', label: '🔍 検索' },
    { id: 'recent', label: '🆕 新着' },
    { id: 'browse', label: '🗂 ジャンル' },
    { id: 'reference', label: '📖 文献' },
    { id: 'quiz', label: '🧠 クイズ' },
  ]

  const header = (
    <div className="sticky top-0 z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-gray-100 dark:border-gray-700 shadow-sm">
      <div className="max-w-2xl mx-auto px-4 pt-3 pb-2">
        <div className="flex items-center justify-between mb-3">
          <div className="w-16" />
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">🏥 Medical Search</h1>
          <div className="w-16 flex justify-end">
            <button
              onClick={() => setShowSettings(true)}
              className="text-xl text-gray-300 dark:text-gray-600 hover:text-gray-500 dark:hover:text-gray-400 transition-colors"
              title="設定"
            >
              ⚙️
            </button>
          </div>
        </div>
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
  )

  const settingsModal = showSettings && (
    <SettingsPanel
      onClose={() => setShowSettings(false)}
      onReset={handleReset}
      onRedo={handleRedo}
      currentMode={searchMode}
    />
  )

  // ========== Notionモード ==========
  if (searchMode === 'notion') {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-gray-50 dark:from-gray-900 dark:to-gray-800">
        {header}
        <div className="max-w-2xl mx-auto px-4 py-4">
          {tab === 'search' && <NotionSearchTab />}
          {tab === 'recent' && <NotionRecentTab />}
          {tab === 'browse' && <NotionBrowseTab />}
          {tab === 'reference' && <NotionReferenceTab />}
          {tab === 'quiz' && <NotionQuizTab />}
        </div>
        {settingsModal}
      </div>
    )
  }

  // ========== Algoliaモード ==========
  const dynamicSearchClient = createSearchClient()
  const dynamicIndexName = settings?.algoliaIndex || getIndexName()

  return (
    <InstantSearch key={tab} searchClient={dynamicSearchClient} indexName={dynamicIndexName}>
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-gray-50 dark:from-gray-900 dark:to-gray-800">
        {header}
        <div className="max-w-2xl mx-auto px-4 py-4">
          {tab === 'search' && <SearchTab hasTeam={hasTeam} hasSubscription={hasSubscription} />}
          {tab === 'recent' && (
            <>
              <Configure hitsPerPage={300} />
              <RecentHits />
            </>
          )}
          {tab === 'browse' && <GenreBrowse />}
          {tab === 'reference' && <ReferenceTab />}
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
        <div className="max-w-2xl mx-auto bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-t border-gray-100 dark:border-gray-700 mt-4">
          <SyncPanel />
        </div>
      </div>
      {settingsModal}
    </InstantSearch>
  )
}
