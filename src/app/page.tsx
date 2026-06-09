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
import { OnboardingScreen } from '@/components/OnboardingScreen'

const ONBOARDING_DONE_KEY = 'medical_search_onboarding_done_v4'

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

  // 要約あり AND 知識レベルがCQ（調査中）でないものだけクイズ対象
  const quizCandidates = (hits as unknown as Hit[]).filter((h) => {
    const hasSummary = (h.aiSummary && h.aiSummary.trim()) || (h.summary && h.summary.trim())
    const isCQ = h.knowledgeLevel && (
      h.knowledgeLevel.includes('❓') ||
      h.knowledgeLevel.toLowerCase().includes('cq') ||
      h.knowledgeLevel.includes('クリニカルクエスチョン') ||
      h.knowledgeLevel.includes('クリニカルクエッション')
    )
    return hasSummary && !isCQ
  })

  useEffect(() => {
    const arr = [...quizCandidates]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]]
    }
    setShuffled(arr.slice(0, 20))
  }, [quizCandidates.length])

  // 知識レベルを1件も設定していないか確認
  const hasAnyKnowledgeLevel = (hits as unknown as Hit[]).some((h) => h.knowledgeLevel && h.knowledgeLevel.trim())

  if (quizCandidates.length === 0) {
    return (
      <div className="text-center py-14 px-4 space-y-4">
        <div className="text-5xl">🧠</div>
        <div>
          <p className="text-gray-600 dark:text-gray-300 font-semibold text-base mb-1">クイズがありません</p>
          <p className="text-sm text-gray-400 dark:text-gray-500">
            知識レベルを「💡 ナレッジ」に設定し、要約を入れるとここに出題されます
          </p>
        </div>
        {!hasAnyKnowledgeLevel && (
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 text-left max-w-sm mx-auto space-y-2">
            <p className="text-xs font-bold text-amber-700 dark:text-amber-300">💡 クイズの使い方</p>
            <ol className="text-xs text-amber-700 dark:text-amber-400 space-y-1 list-decimal list-inside">
              <li>Notionで確認済みの知識ページを開く</li>
              <li>「知識レベル」プロパティを <strong>💡 ナレッジ</strong> に設定</li>
              <li>「要約」プロパティに結論を入力</li>
              <li>アプリで再同期 → クイズに出題されます</li>
            </ol>
            <p className="text-xs text-amber-500 dark:text-amber-500 mt-1">❓ CQ（調査中）と 📋 まとめはクイズ除外されます</p>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-400 dark:text-gray-500">タイトルを見て内容を思い出してみましょう</p>
        <button
          onClick={() => {
            const arr = [...quizCandidates]
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
    if (mode === 'browse') fetch('', { mode: 'browse', pageSize: 200 })
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
    if (q) { setHasSearched(true) }
    search(q)
  }

  // Enterキーまたはデバウンス完了後（600ms）に履歴保存
  const handleKeyDown = (e: { key: string }) => {
    if (e.key === 'Enter' && query.trim()) {
      addHistory(query.trim())
    }
  }

  // デバウンス後に履歴保存（検索完了タイミングに合わせる）
  const debounceHistoryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleChangeWithHistory = (q: string) => {
    handleChange(q)
    if (debounceHistoryRef.current) clearTimeout(debounceHistoryRef.current)
    if (q.trim()) {
      debounceHistoryRef.current = setTimeout(() => {
        addHistory(q.trim())
      }, 800)
    }
  }

  return (
    <>
      <div className="sticky top-[88px] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-3 pt-1 -mx-4 px-4">
        <input
          type="search"
          value={query}
          onChange={(e) => handleChangeWithHistory(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="キーワードで検索..."
          className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
      </div>
      {loading && <div className="text-center py-12 text-gray-400"><span className="animate-spin inline-block mr-2">⟳</span>Notionを検索中...</div>}
      {error && <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-3 text-sm text-red-600 dark:text-red-400">{error}</div>}
      {!query && !hasSearched ? (
        <SearchHistoryList history={history} onSelect={(q) => { addHistory(q); handleChange(q) }} onClear={clearHistory} />
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
      <p className="text-sm text-gray-400 mt-1">知識レベルを「💡 ナレッジ」にして要約を入れるとクイズに出題されます</p>
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

// ジャンルグループ定義（GenreBrowse.tsx と同じ定義）
const NOTION_GENRE_GROUPS = [
  {
    label: '🫀 循環・血液',
    color: 'bg-red-50 border-red-200 text-red-700',
    activeColor: 'bg-red-600 text-white border-transparent',
    genres: ['05.循環', '11.血液凝固線溶系', '22.輸液・輸血・水電解質'],
  },
  {
    label: '🫁 呼吸器',
    color: 'bg-blue-50 border-blue-200 text-blue-700',
    activeColor: 'bg-blue-600 text-white border-transparent',
    genres: ['04.呼吸'],
  },
  {
    label: '🧠 神経・精神',
    color: 'bg-purple-50 border-purple-200 text-purple-700',
    activeColor: 'bg-purple-600 text-white border-transparent',
    genres: ['06.中枢神経'],
  },
  {
    label: '🫘 腎・泌尿器',
    color: 'bg-cyan-50 border-cyan-200 text-cyan-700',
    activeColor: 'bg-cyan-600 text-white border-transparent',
    genres: ['07.腎'],
  },
  {
    label: '🫃 消化器',
    color: 'bg-orange-50 border-orange-200 text-orange-700',
    activeColor: 'bg-orange-600 text-white border-transparent',
    genres: ['08.肝・胆道系', '09.膵', '10.消化管・その他腹部'],
  },
  {
    label: '🦠 感染症',
    color: 'bg-green-50 border-green-200 text-green-700',
    activeColor: 'bg-green-600 text-white border-transparent',
    genres: ['13.感染症'],
  },
  {
    label: '⚡ 救急・外傷',
    color: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    activeColor: 'bg-yellow-600 text-white border-transparent',
    genres: ['03.救急蘇生', '15.外傷・整形', '16.熱傷', '17.急性中毒', '18.体温異常', '28.災害'],
  },
  {
    label: '💊 薬剤・代謝',
    color: 'bg-indigo-50 border-indigo-200 text-indigo-700',
    activeColor: 'bg-indigo-600 text-white border-transparent',
    genres: ['12.代謝内分泌', '27.薬剤', '14.多臓器障害'],
  },
  {
    label: '🍼 特殊患者',
    color: 'bg-pink-50 border-pink-200 text-pink-700',
    activeColor: 'bg-pink-600 text-white border-transparent',
    genres: ['19.妊産婦', '20.小児', '21.移植'],
  },
  {
    label: '🔧 手技・栄養',
    color: 'bg-gray-50 border-gray-200 text-gray-700',
    activeColor: 'bg-gray-600 text-white border-transparent',
    genres: ['23.栄養', '24.画像診断', '26.手技'],
  },
  {
    label: '📚 総論・その他',
    color: 'bg-slate-50 border-slate-200 text-slate-700',
    activeColor: 'bg-slate-600 text-white border-transparent',
    genres: ['01.総論', '02.医療倫理', '25.集中治療医', '29.学会', '30.統計・研究', '31.マイナー'],
  },
  {
    label: '📥 INBOX',
    color: 'bg-gray-50 border-gray-200 text-gray-500',
    activeColor: 'bg-gray-500 text-white border-transparent',
    genres: ['INBOX'],
  },
]

const GENRE_BUTTON_COLORS = [
  { color: 'bg-red-50 border-red-200 text-red-700', activeColor: 'bg-red-600 text-white border-transparent' },
  { color: 'bg-blue-50 border-blue-200 text-blue-700', activeColor: 'bg-blue-600 text-white border-transparent' },
  { color: 'bg-purple-50 border-purple-200 text-purple-700', activeColor: 'bg-purple-600 text-white border-transparent' },
  { color: 'bg-green-50 border-green-200 text-green-700', activeColor: 'bg-green-600 text-white border-transparent' },
  { color: 'bg-orange-50 border-orange-200 text-orange-700', activeColor: 'bg-orange-600 text-white border-transparent' },
  { color: 'bg-cyan-50 border-cyan-200 text-cyan-700', activeColor: 'bg-cyan-600 text-white border-transparent' },
  { color: 'bg-yellow-50 border-yellow-200 text-yellow-700', activeColor: 'bg-yellow-600 text-white border-transparent' },
  { color: 'bg-indigo-50 border-indigo-200 text-indigo-700', activeColor: 'bg-indigo-600 text-white border-transparent' },
  { color: 'bg-pink-50 border-pink-200 text-pink-700', activeColor: 'bg-pink-600 text-white border-transparent' },
  { color: 'bg-teal-50 border-teal-200 text-teal-700', activeColor: 'bg-teal-600 text-white border-transparent' },
  { color: 'bg-slate-50 border-slate-200 text-slate-700', activeColor: 'bg-slate-600 text-white border-transparent' },
  { color: 'bg-gray-50 border-gray-200 text-gray-500', activeColor: 'bg-gray-500 text-white border-transparent' },
]

const GENRE_SHOW_LIMIT = 8

// Notionモード：ジャンル別タブ
function NotionBrowseTab() {
  const settings = getSettings()
  const [genres, setGenres] = useState<string[]>([])
  const [genresLoading, setGenresLoading] = useState(true)
  const [genresError, setGenresError] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null)
  const [genreRecords, setGenreRecords] = useState<Hit[]>([])
  const [genreLoading, setGenreLoading] = useState(false)
  const [genreError, setGenreError] = useState('')

  // 初回：ジャンル選択肢をAPIから取得
  useState(() => {
    if (!settings) { setGenresLoading(false); return }
    window.fetch('/api/notion/genres', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notionToken: settings.notionToken,
        notionMedicalDbId: settings.notionMedicalDbId,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.genres) setGenres(data.genres)
        else setGenresError(data.error || '取得に失敗しました')
      })
      .catch(() => setGenresError('取得に失敗しました'))
      .finally(() => setGenresLoading(false))
  })

  const handleGenreSelect = async (genre: string | null) => {
    if (!genre || selectedGenre === genre) {
      setSelectedGenre(null)
      setGenreRecords([])
      return
    }
    setSelectedGenre(genre)
    if (!settings) return
    setGenreLoading(true)
    setGenreError('')
    setGenreRecords([])
    try {
      const data = await window.fetch('/api/notion/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notionToken: settings.notionToken,
          notionMedicalDbId: settings.notionMedicalDbId,
          mode: 'browse',
          genre,
          pageSize: 100,
        }),
      }).then((r) => r.json())
      const records: Hit[] = Array.isArray(data.records) ? data.records : []
      records.sort((a, b) => (b.lastEdited > a.lastEdited ? 1 : -1))
      setGenreRecords(records)
    } catch (err) {
      console.error('ジャンル取得エラー:', err)
      setGenreError('取得に失敗しました')
    } finally {
      setGenreLoading(false)
    }
  }

  const visibleGenres = showAll ? genres : genres.slice(0, GENRE_SHOW_LIMIT)

  return (
    <div>
      {genresLoading ? (
        <div className="text-center py-8 text-gray-400"><span className="animate-spin inline-block mr-2">⟳</span>ジャンルを読み込み中...</div>
      ) : genresError ? (
        <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-3 text-sm text-red-600">{genresError}</div>
      ) : genres.length === 0 ? (
        <div className="text-center py-8 text-gray-400 dark:text-gray-500"><p className="text-sm">ジャンルが設定されていません</p></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 mb-2">
            {visibleGenres.map((genre, i) => {
              const c = GENRE_BUTTON_COLORS[i % GENRE_BUTTON_COLORS.length]
              return (
                <button
                  key={genre}
                  onClick={() => handleGenreSelect(genre)}
                  className={`text-left px-3 py-2 rounded-xl border text-sm font-medium transition-all ${
                    selectedGenre === genre ? c.activeColor + ' shadow-sm' : c.color + ' hover:shadow-sm'
                  }`}
                >
                  {genre}
                </button>
              )
            })}
          </div>
          {genres.length > GENRE_SHOW_LIMIT && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="w-full text-xs text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 py-2 transition-colors"
            >
              {showAll ? '▲ 折りたたむ' : `▼ すべて表示（残り ${genres.length - GENRE_SHOW_LIMIT} 件）`}
            </button>
          )}
        </>
      )}
      {selectedGenre && (
        <>
          <div className="flex items-center justify-between mb-3 mt-4">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{selectedGenre}</p>
            <button
              onClick={() => handleGenreSelect(null)}
              className="text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
            >
              ✕ 解除
            </button>
          </div>
          {genreLoading ? (
            <div className="text-center py-8 text-gray-400"><span className="animate-spin inline-block mr-2">⟳</span>取得中...</div>
          ) : genreError ? (
            <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-3 text-sm text-red-600">{genreError}</div>
          ) : genreRecords.length === 0 ? (
            <div className="text-center py-8 text-gray-400"><p>このジャンルにはまだエントリがありません</p></div>
          ) : (
            <div className="space-y-3">
              {genreRecords.map((hit) => <ResultCard key={hit.objectID} hit={hit} />)}
            </div>
          )}
        </>
      )}
      {!selectedGenre && !genresLoading && genres.length > 0 && (
        <div className="text-center py-6 text-gray-400 dark:text-gray-500">
          <p className="text-sm">ジャンルを選択してください</p>
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
  const [propCheck, setPropCheck] = useState<null | {
    medical: { found: string[]; missing: string[] }
    reference?: { found: string[]; missing: string[] }
  }>(null)
  const [propCheckLoading, setPropCheckLoading] = useState(false)
  const [propCheckError, setPropCheckError] = useState<string | null>(null)
  const [algoliaDebug, setAlgoliaDebug] = useState<null | {
    totalHits: number
    knowledgeLevelValues: string[]
    settings: { attributesForFaceting?: string[]; searchableAttributes?: string[] }
    samples: Array<{ objectID: string; source: unknown; knowledgeLevel: unknown; genre: unknown; title: unknown }>
  }>(null)
  const [algoliaDebugLoading, setAlgoliaDebugLoading] = useState(false)
  const [algoliaDebugError, setAlgoliaDebugError] = useState<string | null>(null)
  const [searchKeyCheck, setSearchKeyCheck] = useState<null | { ok: boolean; nbHits?: number; error?: string }>(null)
  const [searchKeyCheckLoading, setSearchKeyCheckLoading] = useState(false)

  const handleSearchKeyCheck = async () => {
    const s = getSettings()
    if (!s?.algoliaAppId || !s?.algoliaSearchKey) {
      setSearchKeyCheck({ ok: false, error: 'App IDまたはSearch Keyが未設定です' })
      return
    }
    setSearchKeyCheckLoading(true)
    setSearchKeyCheck(null)
    try {
      const res = await fetch('/api/verify-search-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          algoliaAppId: s.algoliaAppId,
          algoliaSearchKey: s.algoliaSearchKey,
          algoliaIndex: s.algoliaIndex,
        }),
      })
      const data = await res.json()
      if (data.error) {
        setSearchKeyCheck({ ok: false, error: data.error })
      } else {
        setSearchKeyCheck({ ok: true, nbHits: data.nbHits })
      }
    } catch (err) {
      setSearchKeyCheck({ ok: false, error: err instanceof Error ? err.message : 'エラー' })
    } finally {
      setSearchKeyCheckLoading(false)
    }
  }

  const handleAlgoliaDebug = async () => {
    const s = getSettings()
    if (!s?.algoliaAppId || !s?.algoliaAdminKey) {
      setAlgoliaDebugError('Algolia設定が見つかりません')
      return
    }
    setAlgoliaDebugLoading(true)
    setAlgoliaDebugError(null)
    setAlgoliaDebug(null)
    try {
      const res = await fetch('/api/debug-index', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          algoliaAppId: s.algoliaAppId,
          algoliaAdminKey: s.algoliaAdminKey,
          algoliaIndex: s.algoliaIndex,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setAlgoliaDebug(data)
    } catch (err) {
      setAlgoliaDebugError(err instanceof Error ? err.message : 'エラーが発生しました')
    } finally {
      setAlgoliaDebugLoading(false)
    }
  }

  const handlePropCheck = async () => {
    const s = getSettings()
    if (!s?.notionToken || !s?.notionMedicalDbId) {
      setPropCheckError('Notion設定が見つかりません')
      return
    }
    setPropCheckLoading(true)
    setPropCheckError(null)
    setPropCheck(null)
    try {
      const res = await fetch('/api/notion/check-props', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notionToken: s.notionToken,
          notionMedicalDbId: s.notionMedicalDbId,
          notionReferenceDbId: s.notionReferenceDbId || '',
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setPropCheck(data)
    } catch (err) {
      setPropCheckError(err instanceof Error ? err.message : 'エラーが発生しました')
    } finally {
      setPropCheckLoading(false)
    }
  }

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
                    <p>NotionDBのプロパティ名（「名前」「ジャンル」「要約」など）は<strong>変更しないでください</strong>。選択肢の追加・変更は自由です。</p>
                  </div>
                </section>
                <section>
                  <h3 className="font-bold text-gray-900 dark:text-white mb-2">🔍 DBプロパティ確認</h3>
                  <button
                    onClick={handlePropCheck}
                    disabled={propCheckLoading}
                    className="w-full text-sm bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl py-2.5 font-medium hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-50"
                  >
                    {propCheckLoading ? '確認中...' : '接続中のDBのプロパティを確認する'}
                  </button>
                  {propCheckError && (
                    <p className="text-xs text-red-500 mt-2">{propCheckError}</p>
                  )}
                  {propCheck && (
                    <div className="mt-3 space-y-3">
                      {(['medical', 'reference'] as const).map((db) => {
                        const r = propCheck[db]
                        if (!r) return null
                        const allOk = r.missing.length === 0
                        return (
                          <div key={db} className={`rounded-xl p-3 text-xs ${allOk ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
                            <p className={`font-semibold mb-1.5 ${allOk ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                              {db === 'medical' ? '🚑 Medical DB' : '📖 Reference DB'} — {allOk ? '✅ 全て一致' : '⚠️ 不一致あり'}
                            </p>
                            <div className="flex flex-wrap gap-1">
                              {r.found.map((p) => (
                                <span key={p} className="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full">✓ {p}</span>
                              ))}
                              {r.missing.map((p) => (
                                <span key={p} className="bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full">✗ {p}</span>
                              ))}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </section>
                {currentMode === 'algolia' && (
                  <section>
                    <h3 className="font-bold text-gray-900 dark:text-white mb-2">🔑 Search Key動作確認</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                      このデバイスのSearch Keyで実際に検索できるか確認します。データが表示されない場合はまずここを確認してください。
                    </p>
                    <button
                      onClick={handleSearchKeyCheck}
                      disabled={searchKeyCheckLoading}
                      className="w-full text-sm bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl py-2.5 font-medium hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-50"
                    >
                      {searchKeyCheckLoading ? '確認中...' : 'Search Keyを確認する'}
                    </button>
                    {searchKeyCheck && (
                      <div className={`mt-2 rounded-xl p-3 text-xs ${searchKeyCheck.ok ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
                        {searchKeyCheck.ok ? (
                          <p>✅ Search Key正常 — インデックスに <strong>{searchKeyCheck.nbHits}件</strong> のデータが見えています</p>
                        ) : (
                          <>
                            <p className="font-semibold mb-1">❌ Search Keyが機能していません</p>
                            <p className="mb-1">エラー: {searchKeyCheck.error}</p>
                            <p>【対処法】⚙️設定 → 「設定を変更する」から Search API Key を再入力してください。</p>
                            <p className="mt-1 text-xs opacity-75">Algolia Dashboard → Settings → API Keys → <strong>Search-Only API Key</strong> をコピーしてください（Admin Keyではありません）。</p>
                          </>
                        )}
                      </div>
                    )}
                  </section>
                )}
                {currentMode === 'algolia' && (
                  <section>
                    <h3 className="font-bold text-gray-900 dark:text-white mb-2">🔬 Algoliaインデックス診断</h3>
                    <button
                      onClick={handleAlgoliaDebug}
                      disabled={algoliaDebugLoading}
                      className="w-full text-sm bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-xl py-2.5 font-medium hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors disabled:opacity-50"
                    >
                      {algoliaDebugLoading ? '取得中...' : 'インデックスの状態を確認する'}
                    </button>
                    {algoliaDebugError && (
                      <p className="text-xs text-red-500 mt-2">{algoliaDebugError}</p>
                    )}
                    {algoliaDebug && (
                      <div className="mt-3 space-y-2 text-xs">
                        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                          <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">📊 総レコード数: {algoliaDebug.totalHits}件</p>
                          <p className="text-gray-500 dark:text-gray-400">attributesForFaceting: {algoliaDebug.settings.attributesForFaceting?.join(', ') || '未設定'}</p>
                        </div>
                        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3">
                          <p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">💡 知識レベルの実際の値</p>
                          {algoliaDebug.knowledgeLevelValues.length === 0 ? (
                            <p className="text-red-500">値なし（再同期が必要）</p>
                          ) : (
                            <div className="flex flex-wrap gap-1">
                              {algoliaDebug.knowledgeLevelValues.map((v) => (
                                <span key={v} className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">{v}</span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                          <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">📋 サンプルレコード</p>
                          {algoliaDebug.samples.slice(0, 3).map((s) => (
                            <div key={s.objectID} className="text-gray-500 dark:text-gray-400 mb-1 border-b border-gray-100 dark:border-gray-700 pb-1">
                              <p>タイトル: {String(s.title)}</p>
                              <p>source: {String(s.source)} / level: {String(s.knowledgeLevel || 'なし')}</p>
                              <p>genre: {JSON.stringify(s.genre)}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>
                )}
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
              <a
                href="https://app.notion.com/p/378fd756737081a2bc23f1acb5f3a4bc"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-left"
              >
                <span className="text-xl">📘</span>
                <div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">セットアップ＆運用ガイド</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">DBの作り方・AIオートフィル設定・クイズの使い方</p>
                </div>
                <span className="ml-auto text-gray-300 dark:text-gray-600">↗</span>
              </a>
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
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null)
  const [showSettings, setShowSettings] = useState(false)

  useEffect(() => {
    setSetupDone(isSetupComplete())
    const done = typeof window !== 'undefined' && !!localStorage.getItem(ONBOARDING_DONE_KEY)
    setOnboardingDone(done)
  }, [])

  const handleReset = () => {
    clearSettings()
    setSetupDone(false)
    setShowSettings(false)
  }

  const handleRedo = () => {
    setSetupDone(false)
  }

  const [showOnboardingFromSetup, setShowOnboardingFromSetup] = useState(false)

  const completeOnboarding = () => {
    localStorage.setItem(ONBOARDING_DONE_KEY, '1')
    setOnboardingDone(true)
    setShowOnboardingFromSetup(false)
  }

  if (setupDone === null || onboardingDone === null) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-gray-50 dark:from-gray-900 dark:to-gray-800 flex items-center justify-center">
        <div className="text-gray-400 text-sm">読み込み中...</div>
      </div>
    )
  }

  // 初回のみオンボーディング（setupが未完了の場合のみ表示）、またはSetupWizardから「使い方」ボタンで再表示
  if ((!onboardingDone && !setupDone) || showOnboardingFromSetup) {
    return (
      <OnboardingScreen
        onComplete={completeOnboarding}
        onSkip={completeOnboarding}
      />
    )
  }

  if (!setupDone) {
    return <SetupWizard onComplete={() => { setSetupDone(true); setShowSettings(false) }} onShowOnboarding={() => setShowOnboardingFromSetup(true)} />
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
          <h1 className="text-lg font-bold text-gray-900 dark:text-white">MediNode</h1>
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
  // Search KeyまたはApp IDが未設定の場合はエラー表示
  if (!settings?.algoliaSearchKey || !settings?.algoliaAppId) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-gray-50">
        {header}
        <div className="max-w-2xl mx-auto px-4 py-8 text-center">
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6">
            <p className="text-2xl mb-3">⚠️</p>
            <p className="font-bold text-amber-800 mb-2">Algoliaの設定が不完全です</p>
            <p className="text-sm text-amber-700 mb-4">
              Search API KeyまたはApp IDが設定されていません。<br />
              ⚙️設定 → 「設定を変更する」から再入力してください。
            </p>
            <button
              onClick={() => setShowSettings(true)}
              className="bg-amber-600 text-white rounded-xl px-5 py-2.5 text-sm font-semibold hover:bg-amber-700 transition-colors"
            >
              ⚙️ 設定を開く
            </button>
          </div>
        </div>
        {settingsModal}
      </div>
    )
  }

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
                hitsPerPage={200}
                filters='source:medical'
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
