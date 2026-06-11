'use client'
import { InstantSearch, Configure, useHits, useSearchBox } from 'react-instantsearch'
import { useState, useEffect, useCallback, useRef, createContext, useContext, useMemo } from 'react'
import {
  createSearchClient,
  getIndexName,
  createSubscriptionSearchClient,
  getSubscriptionIndexName,
  hasSubscriptionConfig,
} from '@/lib/algolia'
import { isSetupComplete, clearSettings, getSettings, saveSettings, extractNotionDbId } from '@/lib/settings'
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
// サブスクHits中継機構（Step 2: multi-index検索）
// ============================================================
// 別Algoliaアカウント（作者のサブスク用）の検索結果を、
// 個人用の<InstantSearch>と並列で取得し、Context経由で全タブに配布する。

type SubscriptionHitsContextValue = {
  hits: Hit[]
  setHits: (hits: Hit[]) => void
  // 個人側の検索クエリをサブスク側にも反映するための共有state
  query: string
  setQuery: (q: string) => void
  // タブごとに適用するフィルタ（owner=subscription固定、source絞り込み等を追加可能）
  subFilters: string
  setSubFilters: (f: string) => void
  // hitsPerPage（タブによって異なる）
  subHitsPerPage: number
  setSubHitsPerPage: (n: number) => void
}

const SubscriptionHitsContext = createContext<SubscriptionHitsContextValue | null>(null)

function useSubscriptionHits() {
  return useContext(SubscriptionHitsContext)
}

// サブスク側<InstantSearch>内で動作。useHits()で取得した結果をContextに流す。
function SubscriptionHitsRelay() {
  const { hits } = useHits()
  const ctx = useSubscriptionHits()
  useEffect(() => {
    if (!ctx) return
    ctx.setHits(hits as unknown as Hit[])
  }, [hits, ctx])
  return null
}

// 個人側<InstantSearch>内で動作。useSearchBox()のqueryをContextに流す。
function PersonalQueryRelay() {
  const { query } = useSearchBox()
  const ctx = useSubscriptionHits()
  useEffect(() => {
    if (!ctx) return
    if (ctx.query !== query) ctx.setQuery(query)
  }, [query, ctx])
  return null
}

// サブスク用Algoliaクライアントの<InstantSearch>ラッパ。
// Provider配下でのみ動作する。
function SubscriptionSearchProvider({ children, enableBridge }: { children: React.ReactNode; enableBridge: boolean }) {
  const [hits, setHits] = useState<Hit[]>([])
  const [query, setQuery] = useState('')
  const [subFilters, setSubFilters] = useState('')
  const [subHitsPerPage, setSubHitsPerPage] = useState(20)
  const value = useMemo<SubscriptionHitsContextValue>(
    () => ({ hits, setHits, query, setQuery, subFilters, setSubFilters, subHitsPerPage, setSubHitsPerPage }),
    [hits, query, subFilters, subHitsPerPage],
  )

  // サブスク設定がない場合はpassthrough（個人検索のみ）
  if (!hasSubscriptionConfig()) {
    return <>{children}</>
  }

  return (
    <SubscriptionHitsContext.Provider value={value}>
      {children}
      {enableBridge && <SubscriptionIndexBridge />}
    </SubscriptionHitsContext.Provider>
  )
}

// サブスクAlgoliaに対する裏側の<InstantSearch>。表示はしない。
function SubscriptionIndexBridge() {
  const ctx = useSubscriptionHits()
  // サブスク用クライアントとindex名はマウント時に固定（settingsはlocalStorageから）
  const subClient = useMemo(() => createSubscriptionSearchClient(), [])
  const subIndex = useMemo(() => getSubscriptionIndexName(), [])

  if (!ctx) return null

  return (
    <div style={{ display: 'none' }} aria-hidden>
      <InstantSearch searchClient={subClient} indexName={subIndex}>
        <Configure
          query={ctx.query}
          hitsPerPage={ctx.subHitsPerPage}
          filters={ctx.subFilters || undefined}
        />
        <SubscriptionHitsRelay />
      </InstantSearch>
    </div>
  )
}

// 個人hitsとサブスクhitsをマージするヘルパー
// owner='all' → 両方を出現順で交互マージ（Algoliaスコア順を擬似的に維持）
// owner='personal' → 個人のみ
// owner='subscription' → サブスクのみ
// owner='team' → 個人の中からteamのみ
function mergeHitsByOwnerFilter(
  personalHits: Hit[],
  subHits: Hit[],
  owner: OwnerFilter,
): Hit[] {
  if (owner === 'subscription') return subHits
  if (owner === 'personal') return personalHits.filter((h) => !h.owner || h.owner === 'personal')
  if (owner === 'team') return personalHits.filter((h) => h.owner === 'team')
  // 'all': 個人＋サブスクを「ラウンドロビン」で交互に混ぜる（関連度順の擬似マージ）
  const merged: Hit[] = []
  const max = Math.max(personalHits.length, subHits.length)
  const seen = new Set<string>()
  for (let i = 0; i < max; i++) {
    if (personalHits[i] && !seen.has(personalHits[i].objectID)) {
      merged.push(personalHits[i])
      seen.add(personalHits[i].objectID)
    }
    if (subHits[i] && !seen.has(subHits[i].objectID)) {
      merged.push(subHits[i])
      seen.add(subHits[i].objectID)
    }
  }
  return merged
}

// ジャンル並び替え用：番号付き(01.〜) → 番号なし(あいうえお順) → INBOX最後
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

// 番号プレフィックス（01.等）を除いた表示名
function displayGenreName(g: string): string {
  return g.replace(/^\d+\./, '')
}

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
    const summaryText = ((h.aiSummary || '') + (h.summary || '')).trim()
    const hasSummary = summaryText.length >= 10
    const lvl = h.knowledgeLevel || ''
    // ホワイトリスト：「💡 ナレッジ」のみ通す（CQ・まとめ・その他は全部除外）
    const isKnowledge = lvl.includes('💡') || lvl.includes('ナレッジ') || lvl.toLowerCase().includes('knowledge')
    // 念のためタイトルベースでもCQ除外
    const titleStr = (h.title || '').trim()
    const titleIsCQ = titleStr.startsWith('❓') || titleStr.includes('CQ：') || titleStr.includes('CQ:')
    return hasSummary && isKnowledge && !titleIsCQ
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

function ReferenceTab({ hasTeam, hasSubscription }: { hasTeam: boolean; hasSubscription: boolean }) {
  const [sort, setSort] = useState<RefSort>('year_desc')
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')
  const ctx = useSubscriptionHits()
  const [personalHits, setPersonalHits] = useState<Hit[]>([])

  const sortOptions: { value: RefSort; label: string }[] = [
    { value: 'year_desc', label: '年 (新しい順)' },
    { value: 'year_asc', label: '年 (古い順)' },
    { value: 'lastEdited', label: '更新日順' },
  ]

  // 個人側フィルタ: source:reference + ownerFilter
  const refOwnerFilter = ownerFilter === 'subscription'
    ? 'owner:__none__'
    : ownerFilter === 'all'
      ? ''
      : `owner:${ownerFilter}`
  const refPersonalFilter = refOwnerFilter
    ? `source:reference AND ${refOwnerFilter}`
    : 'source:reference'

  // サブスク側フィルタ: source:reference (プレミアム / all) or 無効化
  useEffect(() => {
    if (!ctx) return
    if (ownerFilter === 'personal' || ownerFilter === 'team') {
      ctx.setSubFilters('owner:__none__')
    } else {
      ctx.setSubFilters('source:reference')
    }
    ctx.setSubHitsPerPage(100)
  }, [ownerFilter, ctx])

  const subHits = ctx?.hits || []
  const mergedHits = useMemo(() => {
    if (ownerFilter === 'subscription') return subHits
    if (ownerFilter === 'personal') return personalHits.filter((h) => !h.owner || h.owner === 'personal')
    if (ownerFilter === 'team') return personalHits.filter((h) => h.owner === 'team')
    const seen = new Set<string>()
    const merged: Hit[] = []
    for (const h of personalHits) { if (!seen.has(h.objectID)) { merged.push(h); seen.add(h.objectID) } }
    for (const h of subHits) { if (!seen.has(h.objectID)) { merged.push(h); seen.add(h.objectID) } }
    return merged
  }, [ownerFilter, personalHits, subHits])

  const sorted = [...mergedHits].sort((a, b) => {
    if (sort === 'year_desc') return (b.year || '0') > (a.year || '0') ? 1 : -1
    if (sort === 'year_asc') return (a.year || '0') > (b.year || '0') ? 1 : -1
    return (b.lastEdited || '') > (a.lastEdited || '') ? 1 : -1
  })

  return (
    <>
      <Configure hitsPerPage={200} filters={refPersonalFilter} />
      <PersonalHitsCollector onHits={setPersonalHits} />
      <div className="sticky top-[88px] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-3 pt-1 -mx-4 px-4">
        <div className="flex items-center gap-2 mb-2">
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
        <OwnerFilterTabs owner={ownerFilter} onChange={setOwnerFilter} hasTeam={hasTeam} hasSubscription={hasSubscription} />
      </div>
      {ownerFilter === 'subscription' && !hasSubscription ? (
        <SubscriptionPromoPanel />
      ) : sorted.length === 0 ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          <p className="text-lg">該当なし</p>
          <p className="text-sm mt-1">別のキーワードで試してください</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((hit) => (
            <ResultCard key={hit.objectID} hit={hit} />
          ))}
        </div>
      )}
    </>
  )
}

function RecentTabWithOwner({ hasTeam, hasSubscription }: { hasTeam: boolean; hasSubscription: boolean }) {
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')
  const ctx = useSubscriptionHits()
  const [personalHits, setPersonalHits] = useState<Hit[]>([])

  const personalFilter = ownerFilter === 'subscription'
    ? 'owner:__none__'
    : buildOwnerFilter(ownerFilter === 'all' ? 'all' : ownerFilter)

  useEffect(() => {
    if (!ctx) return
    if (ownerFilter === 'personal' || ownerFilter === 'team') {
      ctx.setSubFilters('owner:__none__')
    } else {
      ctx.setSubFilters('')
    }
    ctx.setSubHitsPerPage(100)
  }, [ownerFilter, ctx])

  const subHits = ctx?.hits || []
  const mergedHits = useMemo(() => mergeHitsByOwnerFilter(personalHits, subHits, ownerFilter), [ownerFilter, personalHits, subHits])
  const now = new Date()
  const groups: { label: string; hits: Hit[] }[] = [
    { label: '今日', hits: [] },
    { label: '今週', hits: [] },
    { label: '今月', hits: [] },
    { label: 'それ以前', hits: [] },
  ]
  for (const hit of mergedHits) {
    const d = new Date(hit.createdAt || hit.lastEdited)
    const diffDays = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
    if (diffDays < 1) groups[0].hits.push(hit)
    else if (diffDays < 7) groups[1].hits.push(hit)
    else if (diffDays < 30) groups[2].hits.push(hit)
    else groups[3].hits.push(hit)
  }

  return (
    <>
      <Configure hitsPerPage={300} filters={personalFilter || undefined} />
      <PersonalHitsCollector onHits={setPersonalHits} />
      <div className="sticky top-[88px] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-2 pt-1 -mx-4 px-4 mb-2">
        <OwnerFilterTabs owner={ownerFilter} onChange={setOwnerFilter} hasTeam={hasTeam} hasSubscription={hasSubscription} />
      </div>
      {ownerFilter === 'subscription' && !hasSubscription ? (
        <SubscriptionPromoPanel />
      ) : mergedHits.length === 0 ? (
        <div className="text-center py-14 px-4">
          <div className="text-5xl mb-4">📭</div>
          <p className="text-gray-600 dark:text-gray-300 font-semibold text-base mb-1">データがありません</p>
          <p className="text-sm text-gray-400 dark:text-gray-500">画面下の「🔄 再同期」からデータを取り込んでください</p>
        </div>
      ) : (
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
      )}
    </>
  )
}

function QuizTabWithOwner({ hasTeam, hasSubscription }: { hasTeam: boolean; hasSubscription: boolean }) {
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')
  const ctx = useSubscriptionHits()
  const [personalHits, setPersonalHits] = useState<Hit[]>([])
  const [shuffled, setShuffled] = useState<Hit[]>([])

  const quizOwnerFilter = ownerFilter === 'subscription'
    ? 'owner:__none__'
    : ownerFilter === 'all'
      ? ''
      : `owner:${ownerFilter}`
  const quizPersonalFilter = quizOwnerFilter
    ? `source:medical AND ${quizOwnerFilter}`
    : 'source:medical'

  useEffect(() => {
    if (!ctx) return
    if (ownerFilter === 'personal' || ownerFilter === 'team') {
      ctx.setSubFilters('owner:__none__')
    } else {
      ctx.setSubFilters('source:medical')
    }
    ctx.setSubHitsPerPage(100)
  }, [ownerFilter, ctx])

  const subHits = ctx?.hits || []
  const mergedHits = useMemo(() => mergeHitsByOwnerFilter(personalHits, subHits, ownerFilter), [ownerFilter, personalHits, subHits])

  const quizCandidates = useMemo(() => mergedHits.filter((h) => {
    const summaryText = ((h.aiSummary || '') + (h.summary || '')).trim()
    const hasSummary = summaryText.length >= 10
    const lvl = h.knowledgeLevel || ''
    const isKnowledge = lvl.includes('💡') || lvl.includes('ナレッジ') || lvl.toLowerCase().includes('knowledge')
    const titleStr = (h.title || '').trim()
    const titleIsCQ = titleStr.startsWith('❓') || titleStr.includes('CQ：') || titleStr.includes('CQ:')
    return hasSummary && isKnowledge && !titleIsCQ
  }), [mergedHits])

  useEffect(() => {
    const arr = [...quizCandidates]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]]
    }
    setShuffled(arr.slice(0, 20))
  }, [quizCandidates.length])

  const hasAnyKnowledgeLevel = mergedHits.some((h) => h.knowledgeLevel && h.knowledgeLevel.trim())

  return (
    <>
      <Configure hitsPerPage={200} filters={quizPersonalFilter} />
      <PersonalHitsCollector onHits={setPersonalHits} />
      <div className="sticky top-[88px] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-2 pt-1 -mx-4 px-4 mb-2">
        <OwnerFilterTabs owner={ownerFilter} onChange={setOwnerFilter} hasTeam={hasTeam} hasSubscription={hasSubscription} />
      </div>
      {ownerFilter === 'subscription' && !hasSubscription ? (
        <SubscriptionPromoPanel />
      ) : quizCandidates.length === 0 ? (
        <div className="text-center py-14 px-4 space-y-4">
          <div className="text-5xl">🧠</div>
          <div>
            <p className="text-gray-600 dark:text-gray-300 font-semibold text-base mb-1">クイズがありません</p>
            <p className="text-sm text-gray-400 dark:text-gray-500">知識レベルを「💡 ナレッジ」に設定し、要約を入れるとここに出題されます</p>
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
            </div>
          )}
        </div>
      ) : (
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
            {shuffled.map((hit, i) => <QuizCard key={hit.objectID} hit={hit} index={i} />)}
          </div>
        </div>
      )}
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
  // 部署タブ・プレミアムタブは常に表示（未接続は薄くグレーアウト）
  const options: { id: OwnerFilter; label: string; inactive?: boolean }[] = [
    { id: 'all', label: '全て' },
    { id: 'personal', label: '個人' },
    ...(hasTeam || true ? [{ id: 'team' as OwnerFilter, label: '部署', inactive: !hasTeam }] : []),
    { id: 'subscription' as OwnerFilter, label: hasSubscription ? '⭐ プレミアム' : '🔒 プレミアム', inactive: !hasSubscription },
  ]
  return (
    <div className="flex gap-1 mb-2 flex-wrap">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`text-xs font-medium px-3 py-1 rounded-full transition-colors ${
            owner === o.id
              ? o.id === 'subscription' && !hasSubscription
                ? 'bg-purple-500 text-white'
                : 'bg-blue-600 text-white'
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

// サブスク未設定時に「プレミアム」タブを選択した際の案内パネル
function SubscriptionPromoPanel() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleCheckout = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/premium/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()
      if (!res.ok || !data.url) {
        setError(data.error || '購入ページを開けませんでした')
        return
      }
      window.location.href = data.url
    } catch {
      setError('ネットワークエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="mt-4 bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-900/20 dark:to-indigo-900/20 border border-purple-200 dark:border-purple-700 rounded-2xl p-6 text-center space-y-4">
      <div className="text-5xl">⭐</div>
      <div>
        <p className="text-lg font-bold text-purple-700 dark:text-purple-300">プレミアム会員限定コンテンツ</p>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-2 leading-relaxed">
          現役集中治療医が定期的に更新する<br />
          医療ナレッジ＋参考文献を閲覧できます
        </p>
      </div>
      <div className="bg-white/60 dark:bg-gray-800/40 rounded-xl p-4 text-left text-xs text-gray-600 dark:text-gray-400 space-y-1.5">
        <p className="font-semibold text-gray-700 dark:text-gray-300 mb-2">✨ 含まれるコンテンツ</p>
        <p>• 救急・集中治療領域の臨床ナレッジ</p>
        <p>• エビデンスに基づく参考文献</p>
        <p>• 現役医師による定期アップデート</p>
      </div>
      {error && (
        <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</p>
      )}
      <button
        onClick={handleCheckout}
        disabled={loading}
        className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white font-semibold rounded-xl px-6 py-3 text-sm transition-colors flex items-center justify-center gap-2"
      >
        {loading ? <><span className="animate-spin">⟳</span>読み込み中...</> : '⭐ プレミアムに登録する →'}
      </button>
      <p className="text-xs text-gray-400 dark:text-gray-500">
        既に会員の方は設定画面から「プレミアムDB」セクションで登録を確認してください
      </p>
    </div>
  )
}

// シンプルモード（Notion直接検索）使用中に、パワーモードへの誘導を出すバナー
const POWER_BANNER_DISMISS_KEY = 'medinode_power_banner_dismissed_v1'
function PowerModeUpgradeBanner({ onOpenSettings }: { onOpenSettings: () => void }) {
  const [dismissed, setDismissed] = useState(true) // SSR時はちらつき防止のため初期true
  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(POWER_BANNER_DISMISS_KEY) === '1')
    } catch {
      setDismissed(false)
    }
  }, [])
  if (dismissed) return null
  return (
    <div className="mb-4 bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 border border-blue-200 dark:border-blue-700 rounded-xl p-3 flex items-start gap-3">
      <div className="text-2xl shrink-0">⚡</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">
          もっと速くしたい方はパワーモードへ
        </p>
        <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5 leading-relaxed">
          Algolia（無料）を使うと検索が<strong>0.1秒以下</strong>に。日本語の部分一致やジャンル絞り込みも快適です。
        </p>
        <div className="flex items-center gap-3 mt-2">
          <button
            onClick={onOpenSettings}
            className="text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors"
          >
            設定から切り替える
          </button>
          <button
            onClick={() => {
              try { localStorage.setItem(POWER_BANNER_DISMISS_KEY, '1') } catch {}
              setDismissed(true)
            }}
            className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            あとで
          </button>
        </div>
      </div>
    </div>
  )
}

// マージ済みhitsを表示する検索結果コンポーネント
function MergedSearchResults({ personalHits, ownerFilter, query, onSearch }: {
  personalHits: Hit[]
  ownerFilter: OwnerFilter
  query: string
  onSearch?: (q: string) => void
}) {
  const ctx = useSubscriptionHits()
  const subHits = ctx?.hits || []

  useEffect(() => {
    if (query && onSearch) onSearch(query)
  }, [query])

  const merged = mergeHitsByOwnerFilter(personalHits, subHits, ownerFilter)

  if (merged.length === 0) {
    if (!query) {
      return (
        <div className="text-center py-14 px-4">
          <div className="text-5xl mb-4">📭</div>
          <p className="text-gray-600 dark:text-gray-300 font-semibold text-base mb-1">データがありません</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mb-6">
            まず画面下の「🔄 データを再同期する」から同期を行ってください
          </p>
        </div>
      )
    }
    return (
      <div className="text-center py-14 px-4">
        <div className="text-5xl mb-4">🔍</div>
        <p className="text-gray-600 dark:text-gray-300 font-semibold text-base mb-1">
          「{query}」の検索結果がありません
        </p>
        <p className="text-sm text-gray-400 dark:text-gray-500 mb-6">
          別のキーワードで試してみてください
        </p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">{merged.length}件</p>
      <div className="space-y-3">
        {merged.map((hit) => (
          <ResultCard key={hit.objectID} hit={hit} />
        ))}
      </div>
    </div>
  )
}

// 個人側のhitsを親stateに渡すコンポーネント
function PersonalHitsCollector({ onHits }: { onHits: (hits: Hit[]) => void }) {
  const { hits } = useHits()
  useEffect(() => {
    onHits(hits as unknown as Hit[])
  }, [hits])
  return null
}

function SearchTab({ hasTeam, hasSubscription }: { hasTeam: boolean; hasSubscription: boolean }) {
  const { refine, query } = useSearchBox()
  const { history, addHistory, clearHistory } = useSearchHistory()
  const [hasSearched, setHasSearched] = useState(false)
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')
  const [personalHits, setPersonalHits] = useState<Hit[]>([])
  const ctx = useSubscriptionHits()

  const handleSelect = (q: string) => {
    refine(q)
    setHasSearched(true)
  }

  // 個人側のフィルタ：subscription専用タブの時は個人結果を空にする
  const personalFilter = ownerFilter === 'subscription'
    ? 'owner:__none__'
    : buildOwnerFilter(ownerFilter === 'all' ? 'all' : ownerFilter)

  // サブスク側のフィルタ：'personal'/'team'の時は空にする、それ以外は通常検索
  useEffect(() => {
    if (!ctx) return
    if (ownerFilter === 'personal' || ownerFilter === 'team') {
      ctx.setSubFilters('owner:__none__')
    } else {
      ctx.setSubFilters('')
    }
    ctx.setSubHitsPerPage(20)
  }, [ownerFilter, ctx])

  return (
    <>
      <Configure hitsPerPage={20} filters={personalFilter || undefined} />
      <PersonalQueryRelay />
      <PersonalHitsCollector onHits={setPersonalHits} />
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
      ) : ownerFilter === 'subscription' && !hasSubscription ? (
        <SubscriptionPromoPanel />
      ) : (
        <MergedSearchResults
          personalHits={personalHits}
          ownerFilter={ownerFilter}
          query={query}
          onSearch={(q) => { if (q) addHistory(q) }}
        />
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
          teamNotionToken: settings.teamNotionToken || undefined,
          teamNotionMedicalDbId: settings.teamNotionMedicalDbId || undefined,
          teamNotionReferenceDbId: settings.teamNotionReferenceDbId || undefined,
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
  }, [settings?.notionToken, settings?.notionMedicalDbId, settings?.teamNotionToken, settings?.teamNotionMedicalDbId])

  // 新着・クイズ・ジャンルは初回マウント時に自動取得（fetchはsettings変更時に再取得するため依存に含める）
  useEffect(() => {
    if (mode === 'recent') fetch('', { mode: 'recent' })
    if (mode === 'quiz') fetch('', { mode: 'quiz' })
    if (mode === 'browse') fetch('', { mode: 'browse', pageSize: 200 })
    if (mode === 'reference') fetch('', { mode: 'recent' }) // referenceはrecentと共用でフィルタ
  }, [mode, fetch])

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
function NotionSearchTab({ hasTeam, hasSubscription }: { hasTeam: boolean; hasSubscription: boolean }) {
  const { records, loading, error, search } = useNotionSearch('search')
  const { history, addHistory, clearHistory } = useSearchHistory()
  const [query, setQuery] = useState('')
  const [hasSearched, setHasSearched] = useState(false)
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')
  const ctx = useSubscriptionHits()

  // プレミアム側にクエリを反映し、source絞りなし
  useEffect(() => {
    if (!ctx) return
    ctx.setQuery(query)
    ctx.setSubFilters(ownerFilter === 'personal' || ownerFilter === 'team' ? 'owner:__none__' : '')
    ctx.setSubHitsPerPage(100)
  }, [query, ownerFilter, ctx])

  const subHits = ctx?.hits || []
  const merged = useMemo(
    () => mergeHitsByOwnerFilter(records, subHits, ownerFilter),
    [records, subHits, ownerFilter],
  )

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
          className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300 mb-2"
        />
        <OwnerFilterTabs owner={ownerFilter} onChange={setOwnerFilter} hasTeam={hasTeam} hasSubscription={hasSubscription} />
      </div>
      {loading && <div className="text-center py-12 text-gray-400"><span className="animate-spin inline-block mr-2">⟳</span>Notionを検索中...</div>}
      {error && <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-3 text-sm text-red-600 dark:text-red-400">{error}</div>}
      {ownerFilter === 'subscription' && !hasSubscription ? (
        <SubscriptionPromoPanel />
      ) : !query && !hasSearched ? (
        <SearchHistoryList history={history} onSelect={(q) => { addHistory(q); handleChange(q) }} onClear={clearHistory} />
      ) : !loading && merged.length === 0 && query ? (
        <div className="text-center py-12 text-gray-400 dark:text-gray-500">
          <p className="text-lg">該当なし</p>
          <p className="text-sm mt-1">別のキーワードで試してください</p>
        </div>
      ) : (
        <>
          {query && <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">{merged.length}件</p>}
          <div className="space-y-3">
            {merged.map((hit) => <ResultCard key={hit.objectID} hit={hit} />)}
          </div>
        </>
      )}
    </>
  )
}

// Notionモード：新着タブ
function NotionRecentTab({ hasTeam, hasSubscription }: { hasTeam: boolean; hasSubscription: boolean }) {
  const { records, loading, error } = useNotionSearch('recent')
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')
  const ctx = useSubscriptionHits()
  const now = new Date()

  useEffect(() => {
    if (!ctx) return
    ctx.setSubFilters(ownerFilter === 'personal' || ownerFilter === 'team' ? 'owner:__none__' : '')
    ctx.setSubHitsPerPage(100)
  }, [ownerFilter, ctx])

  const subHits = ctx?.hits || []
  const merged = useMemo(
    () => mergeHitsByOwnerFilter(records, subHits, ownerFilter),
    [records, subHits, ownerFilter],
  )

  const groups: { label: string; hits: Hit[] }[] = [
    { label: '今日', hits: [] },
    { label: '今週', hits: [] },
    { label: '今月', hits: [] },
    { label: 'それ以前', hits: [] },
  ]

  for (const hit of merged) {
    const d = new Date(hit.createdAt || hit.lastEdited)
    const diffDays = (now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)
    if (diffDays < 1) groups[0].hits.push(hit)
    else if (diffDays < 7) groups[1].hits.push(hit)
    else if (diffDays < 30) groups[2].hits.push(hit)
    else groups[3].hits.push(hit)
  }

  const ownerTabs = (
    <div className="sticky top-[88px] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-2 pt-1 -mx-4 px-4 mb-2">
      <OwnerFilterTabs owner={ownerFilter} onChange={setOwnerFilter} hasTeam={hasTeam} hasSubscription={hasSubscription} />
    </div>
  )

  if (ownerFilter === 'subscription' && !hasSubscription) return <>{ownerTabs}<SubscriptionPromoPanel /></>
  if (loading) return <>{ownerTabs}<div className="text-center py-12 text-gray-400"><span className="animate-spin inline-block mr-2">⟳</span>取得中...</div></>
  if (error) return <>{ownerTabs}<div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-3 text-sm text-red-600">{error}</div></>
  if (merged.length === 0) return (
    <>
      {ownerTabs}
      <div className="text-center py-14 px-4">
        <div className="text-5xl mb-4">📭</div>
        <p className="text-gray-600 dark:text-gray-300 font-semibold">データがありません</p>
        <p className="text-sm text-gray-400 mt-1">NotionのDBにデータを追加してください</p>
      </div>
    </>
  )

  return (
    <>
    {ownerTabs}
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
    </>
  )
}

// Notionモード：クイズタブ
function NotionQuizTab({ hasTeam, hasSubscription }: { hasTeam: boolean; hasSubscription: boolean }) {
  const { records, loading, error } = useNotionSearch('quiz')
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')
  const ctx = useSubscriptionHits()
  const [shuffled, setShuffled] = useState<Hit[]>([])

  useEffect(() => {
    if (!ctx) return
    ctx.setSubFilters(ownerFilter === 'personal' || ownerFilter === 'team' ? 'owner:__none__' : 'source:medical')
    ctx.setSubHitsPerPage(100)
  }, [ownerFilter, ctx])

  const subHits = ctx?.hits || []
  const merged = useMemo(
    () => mergeHitsByOwnerFilter(records, subHits, ownerFilter),
    [records, subHits, ownerFilter],
  )

  // 個人records はAPI側でクイズ条件済み。サブスクhitsはクライアント側でクイズ条件フィルタ
  const quizCandidates = useMemo(() => merged.filter((h) => {
    const summaryText = ((h.aiSummary || '') + (h.summary || '')).trim()
    const hasSummary = summaryText.length >= 10
    const lvl = h.knowledgeLevel || ''
    const isKnowledge = lvl.includes('💡') || lvl.includes('ナレッジ') || lvl.toLowerCase().includes('knowledge')
    const titleStr = (h.title || '').trim()
    const titleIsCQ = titleStr.startsWith('❓') || titleStr.includes('CQ：') || titleStr.includes('CQ:')
    return hasSummary && isKnowledge && !titleIsCQ
  }), [merged])

  useEffect(() => {
    const arr = [...quizCandidates]
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]]
    }
    setShuffled(arr.slice(0, 20))
  }, [quizCandidates.length])

  const ownerTabs = (
    <div className="sticky top-[88px] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-2 pt-1 -mx-4 px-4 mb-2">
      <OwnerFilterTabs owner={ownerFilter} onChange={setOwnerFilter} hasTeam={hasTeam} hasSubscription={hasSubscription} />
    </div>
  )

  if (ownerFilter === 'subscription' && !hasSubscription) return <>{ownerTabs}<SubscriptionPromoPanel /></>
  if (loading) return <>{ownerTabs}<div className="text-center py-12 text-gray-400"><span className="animate-spin inline-block mr-2">⟳</span>取得中...</div></>
  if (error) return <>{ownerTabs}<div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-3 text-sm text-red-600">{error}</div></>
  if (quizCandidates.length === 0) return (
    <>
      {ownerTabs}
      <div className="text-center py-14 px-4">
        <div className="text-5xl mb-4">🧠</div>
        <p className="text-gray-600 dark:text-gray-300 font-semibold">クイズがありません</p>
        <p className="text-sm text-gray-400 mt-1">知識レベルを「💡 ナレッジ」にして要約を入れるとクイズに出題されます</p>
      </div>
    </>
  )

  return (
    <>
    {ownerTabs}
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
          className="text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 font-medium"
        >
          シャッフル
        </button>
      </div>
      <div className="space-y-3">
        {shuffled.map((hit, i) => <QuizCard key={hit.objectID} hit={hit} index={i} />)}
      </div>
    </div>
    </>
  )
}

const GENRE_SHOW_LIMIT = 12

// Notionモード：ジャンル別タブ（パワーモードのGenreBrowseと同等。個人/部署はNotion由来、プレミアムは作者Algolia）
type GenreFacet = { personal: Record<string, number>; team: Record<string, number>; subscription: Record<string, number> }

function NotionBrowseTab({ hasTeam, hasSubscription }: { hasTeam: boolean; hasSubscription: boolean }) {
  const settings = getSettings()
  const [facets, setFacets] = useState<GenreFacet>({ personal: {}, team: {}, subscription: {} })
  const [genresLoading, setGenresLoading] = useState(true)
  const [genresError, setGenresError] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [selectedGenre, setSelectedGenre] = useState<string | null>(null)
  const [genreRecords, setGenreRecords] = useState<Hit[]>([])
  const [subGenreHits, setSubGenreHits] = useState<Hit[]>([])
  const [genreLoading, setGenreLoading] = useState(false)
  const [genreError, setGenreError] = useState('')
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')
  const subEnabled = hasSubscription

  // 初回：個人＋部署の全medicalレコードを取得してジャンル件数を集計、プレミアムはAlgoliaファセットから取得
  useEffect(() => {
    if (!settings) { setGenresLoading(false); return }
    let cancelled = false
    setGenresLoading(true)

    // 個人＋部署（Notion由来）：mode=browse + genre空 で全medicalを取得し集計
    const notionTask = window.fetch('/api/notion/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notionToken: settings.notionToken,
        notionMedicalDbId: settings.notionMedicalDbId,
        teamNotionToken: settings.teamNotionToken || undefined,
        teamNotionMedicalDbId: settings.teamNotionMedicalDbId || undefined,
        mode: 'browse',
        genre: '',
        pageSize: 100,
      }),
    })
      .then((r) => r.json())
      .then((data) => {
        const records: Hit[] = Array.isArray(data.records) ? data.records : []
        const personal: Record<string, number> = {}
        const team: Record<string, number> = {}
        for (const rec of records) {
          let list: string[]
          if (rec.genreList && rec.genreList.length) list = rec.genreList
          else if (Array.isArray(rec.genre)) list = rec.genre
          else if (rec.genre) list = [rec.genre]
          else list = ['INBOX']
          const bucket = rec.owner === 'team' ? team : personal
          for (const g of list) bucket[g] = (bucket[g] || 0) + 1
        }
        return { personal, team }
      })
      .catch(() => {
        setGenresError('取得に失敗しました')
        return { personal: {} as Record<string, number>, team: {} as Record<string, number> }
      })

    // プレミアム（作者Algolia）：ファセット取得
    const subTask: Promise<Record<string, number>> = subEnabled
      ? createSubscriptionSearchClient()
          .initIndex(getSubscriptionIndexName())
          .search('', { facets: ['genre'], hitsPerPage: 0, maxValuesPerFacet: 100 })
          .then((res) => (res as unknown as { facets?: { genre?: Record<string, number> } }).facets?.genre || {})
          .catch(() => ({}))
      : Promise.resolve({})

    Promise.all([notionTask, subTask]).then(([notionRes, subscription]) => {
      if (cancelled) return
      setFacets({ personal: notionRes.personal, team: notionRes.team, subscription })
      setGenresLoading(false)
    })

    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ownerFilterに応じたジャンル一覧（hybridSortで並べ替え）
  const sortedGenres = useMemo(() => {
    let set: Set<string>
    if (ownerFilter === 'subscription') set = new Set(Object.keys(facets.subscription))
    else if (ownerFilter === 'team') set = new Set(Object.keys(facets.team))
    else if (ownerFilter === 'personal') set = new Set(Object.keys(facets.personal))
    else set = new Set([
      ...Object.keys(facets.personal),
      ...Object.keys(facets.team),
      ...Object.keys(facets.subscription),
    ])
    return Array.from(set).sort(hybridSort)
  }, [facets, ownerFilter])

  // 選択ジャンルの表示用ヒット（個人/部署=Notion、プレミアム=Algolia）をownerFilterでマージ
  const displayRecords = useMemo(() => {
    if (ownerFilter === 'subscription') return subGenreHits
    if (ownerFilter === 'personal') return genreRecords.filter((h) => !h.owner || h.owner === 'personal')
    if (ownerFilter === 'team') return genreRecords.filter((h) => h.owner === 'team')
    // all: 個人/部署 → プレミアム の順（重複除去）
    const seen = new Set<string>()
    const merged: Hit[] = []
    for (const h of genreRecords) { if (!seen.has(h.objectID)) { merged.push(h); seen.add(h.objectID) } }
    for (const h of subGenreHits) { if (!seen.has(h.objectID)) { merged.push(h); seen.add(h.objectID) } }
    return merged
  }, [ownerFilter, genreRecords, subGenreHits])

  const handleGenreSelect = async (genre: string | null) => {
    if (!genre || selectedGenre === genre) {
      setSelectedGenre(null)
      setGenreRecords([])
      setSubGenreHits([])
      return
    }
    setSelectedGenre(genre)
    if (!settings) return
    setGenreLoading(true)
    setGenreError('')
    setGenreRecords([])
    setSubGenreHits([])

    // 個人/部署（Notion由来）
    const notionTask = ownerFilter === 'subscription'
      ? Promise.resolve([] as Hit[])
      : window.fetch('/api/notion/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            notionToken: settings.notionToken,
            notionMedicalDbId: settings.notionMedicalDbId,
            teamNotionToken: settings.teamNotionToken || undefined,
            teamNotionMedicalDbId: settings.teamNotionMedicalDbId || undefined,
            mode: 'browse',
            genre,
            pageSize: 100,
          }),
        })
          .then((r) => r.json())
          .then((data) => {
            const records: Hit[] = Array.isArray(data.records) ? data.records : []
            records.sort((a, b) => (b.lastEdited > a.lastEdited ? 1 : -1))
            return records
          })
          .catch(() => { setGenreError('取得に失敗しました'); return [] as Hit[] })

    // プレミアム（作者Algolia）
    const subTask: Promise<Hit[]> = subEnabled && ownerFilter !== 'personal' && ownerFilter !== 'team'
      ? createSubscriptionSearchClient()
          .initIndex(getSubscriptionIndexName())
          .search('', { filters: `genre:"${genre}"`, hitsPerPage: 50 })
          .then((res) => {
            const hits = (res as unknown as { hits: Hit[] }).hits || []
            return hits.map((h) => ({ ...h, owner: 'subscription' as const }))
          })
          .catch(() => [] as Hit[])
      : Promise.resolve([] as Hit[])

    try {
      const [notionRecords, subHits] = await Promise.all([notionTask, subTask])
      setGenreRecords(notionRecords)
      setSubGenreHits(subHits)
    } finally {
      setGenreLoading(false)
    }
  }

  const visibleGenres = showAll ? sortedGenres : sortedGenres.slice(0, GENRE_SHOW_LIMIT)

  return (
    <div>
      <div className="sticky top-[88px] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-2 pt-1 -mx-4 px-4 mb-2">
        <OwnerFilterTabs owner={ownerFilter} onChange={(v) => { setOwnerFilter(v); setSelectedGenre(null); setGenreRecords([]); setSubGenreHits([]) }} hasTeam={hasTeam} hasSubscription={hasSubscription} />
      </div>
      {ownerFilter === 'subscription' && !hasSubscription ? (
        <SubscriptionPromoPanel />
      ) : genresLoading ? (
        <div className="text-center py-8 text-gray-400"><span className="animate-spin inline-block mr-2">⟳</span>ジャンルを読み込み中...</div>
      ) : genresError ? (
        <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-3 text-sm text-red-600">{genresError}</div>
      ) : sortedGenres.length === 0 ? (
        <div className="text-center py-8 text-gray-400 dark:text-gray-500"><p className="text-sm">ジャンルが設定されていません</p></div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 mb-2">
            {visibleGenres.map((genre) => {
              const personalCount = facets.personal[genre] || 0
              const teamCount = facets.team[genre] || 0
              const subCount = facets.subscription[genre] || 0
              const total = ownerFilter === 'subscription'
                ? subCount
                : ownerFilter === 'team'
                  ? teamCount
                  : ownerFilter === 'personal'
                    ? personalCount
                    : personalCount + teamCount + subCount
              const hasSub = subCount > 0 && ownerFilter !== 'personal' && ownerFilter !== 'team'
              const isActive = selectedGenre === genre
              return (
                <button
                  key={genre}
                  onClick={() => handleGenreSelect(genre)}
                  className={`text-left px-3 py-2 rounded-xl border text-sm font-medium transition-all flex items-center justify-between gap-2 ${
                    isActive
                      ? 'bg-blue-600 text-white border-transparent shadow-sm'
                      : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:shadow-sm hover:border-blue-300'
                  }`}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{displayGenreName(genre)}</span>
                    {hasSub && (
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'bg-purple-200' : 'bg-purple-500'}`}
                        title="プレミアムにもあります"
                        aria-label="プレミアムにもあります"
                      />
                    )}
                  </span>
                  <span className={`text-xs shrink-0 ${isActive ? 'text-blue-100' : 'text-gray-400'}`}>{total}</span>
                </button>
              )
            })}
          </div>
          {sortedGenres.length > GENRE_SHOW_LIMIT && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="w-full text-xs text-gray-400 hover:text-blue-500 dark:text-gray-500 dark:hover:text-blue-400 py-2 transition-colors"
            >
              {showAll ? '▲ 折りたたむ' : `▼ すべて表示（残り ${sortedGenres.length - GENRE_SHOW_LIMIT} 件）`}
            </button>
          )}
        </>
      )}
      {!(ownerFilter === 'subscription' && !hasSubscription) && selectedGenre && (
        <>
          <div className="flex items-center justify-between mb-3 mt-4">
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{displayGenreName(selectedGenre)}</p>
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
          ) : displayRecords.length === 0 ? (
            <div className="text-center py-8 text-gray-400"><p>このジャンルにはまだエントリがありません</p></div>
          ) : (
            <div className="space-y-3">
              {displayRecords.map((hit) => <ResultCard key={hit.objectID} hit={hit} />)}
            </div>
          )}
        </>
      )}
      {!(ownerFilter === 'subscription' && !hasSubscription) && !selectedGenre && !genresLoading && sortedGenres.length > 0 && (
        <div className="text-center py-6 text-gray-400 dark:text-gray-500">
          <p className="text-sm">ジャンルを選択してください</p>
        </div>
      )}
    </div>
  )
}

// Notionモード：参考文献タブ
function NotionReferenceTab({ hasTeam, hasSubscription }: { hasTeam: boolean; hasSubscription: boolean }) {
  const { records, loading, error } = useNotionSearch('reference')
  const [sort, setSort] = useState<RefSort>('year_desc')
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')
  const [query, setQuery] = useState('')
  const ctx = useSubscriptionHits()

  // 個人records は medical+reference 混在。reference のみ抽出
  const refRecords = records.filter((r) => r.source === 'reference')

  useEffect(() => {
    if (!ctx) return
    ctx.setSubFilters(ownerFilter === 'personal' || ownerFilter === 'team' ? 'owner:__none__' : 'source:reference')
    ctx.setSubHitsPerPage(100)
  }, [ownerFilter, ctx])

  const subHits = ctx?.hits || []
  const merged = useMemo(
    () => mergeHitsByOwnerFilter(refRecords, subHits, ownerFilter),
    [refRecords, subHits, ownerFilter],
  )

  // タイトル・著者・ジャーナル・キーワードで絞り込み（取得済みレコードに対するクライアント側フィルタ）
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return merged
    return merged.filter((h) =>
      [h.title, h.author, h.journal, h.aiKeywords]
        .filter(Boolean)
        .some((f) => (f as string).toLowerCase().includes(q)),
    )
  }, [merged, query])

  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'year_desc') return (b.year || '0') > (a.year || '0') ? 1 : -1
    if (sort === 'year_asc') return (a.year || '0') > (b.year || '0') ? 1 : -1
    return (b.lastEdited || '') > (a.lastEdited || '') ? 1 : -1
  })

  const sortOptions: { value: RefSort; label: string }[] = [
    { value: 'year_desc', label: '年 (新しい順)' },
    { value: 'year_asc', label: '年 (古い順)' },
    { value: 'lastEdited', label: '更新日順' },
  ]

  const ownerTabs = (
    <div className="sticky top-[88px] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-3 pt-1 -mx-4 px-4">
      <div className="flex items-center gap-2 mb-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="文献を絞り込み..."
          className="flex-1 border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300"
        />
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value as RefSort)}
          className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-2 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 shrink-0"
        >
          {sortOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <OwnerFilterTabs owner={ownerFilter} onChange={setOwnerFilter} hasTeam={hasTeam} hasSubscription={hasSubscription} />
    </div>
  )

  if (ownerFilter === 'subscription' && !hasSubscription) return <>{ownerTabs}<SubscriptionPromoPanel /></>
  if (loading) return <>{ownerTabs}<div className="text-center py-12 text-gray-400"><span className="animate-spin inline-block mr-2">⟳</span>取得中...</div></>
  if (error) return <>{ownerTabs}<div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-3 text-sm text-red-600">{error}</div></>

  return (
    <>
      {ownerTabs}
      {sorted.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          {query.trim()
            ? <><p className="text-lg">該当なし</p><p className="text-sm mt-1">別のキーワードで試してください</p></>
            : <p>参考文献DBが設定されていないか、データがありません</p>}
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">{sorted.length}件</p>
          <div className="space-y-3">
            {sorted.map((hit) => <ResultCard key={hit.objectID} hit={hit} />)}
          </div>
        </>
      )}
    </>
  )
}

// ============================================================
// 設定パネル
// ============================================================

function PremiumCheckoutButtonInline() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  return (
    <div className="space-y-2">
      <button
        onClick={async () => {
          setLoading(true); setError('')
          try {
            const res = await fetch('/api/premium/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
            const data = await res.json()
            if (!res.ok || !data.url) { setError(data.error || '購入ページを開けませんでした'); return }
            window.location.href = data.url
          } catch { setError('ネットワークエラーが発生しました') }
          finally { setLoading(false) }
        }}
        disabled={loading}
        className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white font-semibold rounded-xl px-4 py-2.5 text-sm transition-colors flex items-center justify-center gap-2"
      >
        {loading ? <><span className="animate-spin">⟳</span>読み込み中...</> : '⭐ プレミアムに登録する →'}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

type SettingsPanelProps = {
  onClose: () => void
  onReset: () => void
  onRedo: () => void
  onRedoFromNotion: () => void
  currentMode: string
}
function SettingsPanel({ onClose, onReset, onRedo, onRedoFromNotion, currentMode }: SettingsPanelProps) {
  type Section = null | 'notion' | 'team' | 'subscription' | 'help' | 'redo-confirm' | 'reset-confirm' | 'mode-confirm' | 'db-setup-confirm'
  const [section, setSection] = useState<Section>(null)

  // セクション別編集フォーム
  const s0 = getSettings()
  const [notionForm, setNotionForm] = useState({
    notionToken: s0?.notionToken || '',
    notionMedicalDbId: s0?.notionMedicalDbId || '',
    notionReferenceDbId: s0?.notionReferenceDbId || '',
    algoliaAppId: s0?.algoliaAppId || '',
    algoliaSearchKey: s0?.algoliaSearchKey || '',
    algoliaAdminKey: s0?.algoliaAdminKey || '',
    algoliaIndex: s0?.algoliaIndex || '',
  })
  const [teamForm, setTeamForm] = useState({
    teamLabel: s0?.teamLabel || '',
    teamNotionToken: s0?.teamNotionToken || '',
    teamNotionMedicalDbId: s0?.teamNotionMedicalDbId || '',
    teamNotionReferenceDbId: s0?.teamNotionReferenceDbId || '',
  })
  const [saveMsg, setSaveMsg] = useState('')

  const saveSection = (patch: Partial<ReturnType<typeof getSettings>>) => {
    const cur = getSettings()
    if (!cur) return
    saveSettings({ ...cur, ...patch } as Parameters<typeof saveSettings>[0])
    setSaveMsg('保存しました')
    setTimeout(() => setSaveMsg(''), 2000)
  }

  // ヘルプ用state
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

  const inputCls = 'w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300'
  const labelCls = 'block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1'

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 rounded-t-2xl shadow-xl max-w-2xl mx-auto max-h-[90vh] flex flex-col">
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-200 dark:bg-gray-700" />
        </div>

        <div className="px-5 pb-8 pt-2 overflow-y-auto">
          {/* ヘッダー */}
          <div className="flex items-center justify-between mb-4">
            {section ? (
              <button onClick={() => { setSection(null); setSaveMsg('') }} className="text-sm text-blue-500 hover:text-blue-700 dark:text-blue-400 flex items-center gap-1">← 戻る</button>
            ) : (
              <h2 className="text-base font-bold text-gray-900 dark:text-white">⚙️ 設定</h2>
            )}
            <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-full">
              {currentMode === 'notion' ? '📋 シンプルモード' : '⚡ パワーモード'}
            </span>
          </div>

          {/* ── メインメニュー ── */}
          {section === null && (
            <div className="space-y-1">
              {/* プレミアム会員バナー */}
              {(() => {
                const s = getSettings()
                const isPremium = !!(s?.subscriptionSearchKey && s?.subscriptionAppId)
                if (!isPremium) return null
                return (
                  <div className="bg-gradient-to-r from-purple-50 to-indigo-50 dark:from-purple-900/30 dark:to-indigo-900/30 border border-purple-200 dark:border-purple-700 rounded-xl px-4 py-3 flex items-center gap-3 mb-2">
                    <span className="text-2xl">⭐</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-purple-700 dark:text-purple-300">プレミアム会員</p>
                      <p className="text-xs text-purple-500 dark:text-purple-400">プレミアムコンテンツにアクセス中</p>
                    </div>
                  </div>
                )
              })()}

              {/* ── 接続設定 ── */}
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-1 pt-2 pb-1">接続設定</p>
              <button onClick={() => setSection('notion')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                <span className="text-xl">🔗</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">Notion・Algolia接続設定</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">APIキー・DBのURLを変更</p>
                </div>
                <span className="text-gray-300 dark:text-gray-600">›</span>
              </button>
              <button onClick={() => setSection('team')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                <span className="text-xl">🏥</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">部署DB設定</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">チームで共有するNotionDBを接続</p>
                </div>
                <span className="text-gray-300 dark:text-gray-600">›</span>
              </button>
              <button onClick={() => setSection('subscription')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                <span className="text-xl">⭐</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">プレミアムDB設定</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">作者提供のナレッジ・参考文献を追加</p>
                </div>
                <span className="text-gray-300 dark:text-gray-600">›</span>
              </button>
              <button onClick={() => setSection('mode-confirm')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                <span className="text-xl">🔀</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">モードを変更する</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">シンプル↔パワーモードの切替・APIキーの再設定</p>
                </div>
                <span className="text-gray-300 dark:text-gray-600">›</span>
              </button>
              <button onClick={() => setSection('db-setup-confirm')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                <span className="text-xl">📋</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">NotionDBをセットアップする</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">既存DBの接続・テンプレートの複製</p>
                </div>
                <span className="text-gray-300 dark:text-gray-600">›</span>
              </button>

              {/* ── サポート ── */}
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-1 pt-3 pb-1">サポート</p>
              <a
                href="https://app.notion.com/p/378fd756737081a2bc23f1acb5f3a4bc"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors text-left"
              >
                <span className="text-xl">📘</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">セットアップ＆運用ガイド</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">困ったときはこちらを参照</p>
                </div>
                <span className="text-gray-300 dark:text-gray-600">↗</span>
              </a>
              <button onClick={() => setSection('help')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                <span className="text-xl">📖</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">ヘルプ・よくあるエラー</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">エラーの対処法・診断ツール</p>
                </div>
                <span className="text-gray-300 dark:text-gray-600">›</span>
              </button>

              {/* ── 危険ゾーン ── */}
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-1 pt-3 pb-1">その他</p>
              <button onClick={() => setSection('redo-confirm')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors text-left">
                <span className="text-xl">🔄</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">セットアップをやり直す</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">現在の設定値を保持したまま再設定</p>
                </div>
                <span className="text-gray-300 dark:text-gray-600">›</span>
              </button>
              <button onClick={() => setSection('reset-confirm')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left">
                <span className="text-xl">🗑</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-red-500 dark:text-red-400">設定を完全に削除する</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">全データを消去してゼロから再設定</p>
                </div>
                <span className="text-gray-300 dark:text-gray-600">›</span>
              </button>
            </div>
          )}

          {/* ── Notion・Algolia接続設定 ── */}
          {section === 'notion' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">変更後は「保存」してから再同期してください。</p>
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>Notion コネクトToken</label>
                  <input type="password" value={notionForm.notionToken} onChange={(e) => setNotionForm(f => ({ ...f, notionToken: e.target.value }))} placeholder="ntn_xxxxxxxxxxxx" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Medical DB（URLまたはID）</label>
                  <input type="text" value={notionForm.notionMedicalDbId} onChange={(e) => setNotionForm(f => ({ ...f, notionMedicalDbId: e.target.value }))} placeholder="https://www.notion.so/... またはID32桁" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Reference DB（URLまたはID・任意）</label>
                  <input type="text" value={notionForm.notionReferenceDbId} onChange={(e) => setNotionForm(f => ({ ...f, notionReferenceDbId: e.target.value }))} placeholder="https://www.notion.so/... またはID32桁" className={inputCls} />
                </div>
                {currentMode === 'algolia' && (
                  <>
                    <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
                      <label className={labelCls}>Algolia App ID</label>
                      <input type="text" value={notionForm.algoliaAppId} onChange={(e) => setNotionForm(f => ({ ...f, algoliaAppId: e.target.value }))} placeholder="XXXXXXXXXX" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Algolia Search-Only API Key</label>
                      <input type="password" value={notionForm.algoliaSearchKey} onChange={(e) => setNotionForm(f => ({ ...f, algoliaSearchKey: e.target.value }))} placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>Algolia Admin API Key</label>
                      <input type="password" value={notionForm.algoliaAdminKey} onChange={(e) => setNotionForm(f => ({ ...f, algoliaAdminKey: e.target.value }))} placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className={inputCls} />
                    </div>
                    <div>
                      <label className={labelCls}>インデックス名</label>
                      <input type="text" value={notionForm.algoliaIndex} onChange={(e) => setNotionForm(f => ({ ...f, algoliaIndex: e.target.value }))} placeholder="medical_knowledge" className={inputCls} />
                    </div>
                  </>
                )}
              </div>
              {saveMsg && <p className="text-xs text-green-600 dark:text-green-400 text-center">{saveMsg}</p>}
              <button
                onClick={() => saveSection({
                  ...notionForm,
                  notionMedicalDbId: extractNotionDbId(notionForm.notionMedicalDbId),
                  notionReferenceDbId: notionForm.notionReferenceDbId ? extractNotionDbId(notionForm.notionReferenceDbId) : '',
                })}
                className="w-full bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-blue-700 transition-colors"
              >
                保存する
              </button>
            </div>
          )}

          {/* ── 部署DB設定 ── */}
          {section === 'team' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">部署共有のNotionDBを接続すると、ジャンル・文献タブに「部署」フィルタが表示されます。</p>
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>部署名（表示ラベル）</label>
                  <input type="text" value={teamForm.teamLabel} onChange={(e) => setTeamForm(f => ({ ...f, teamLabel: e.target.value }))} placeholder="例：ICU、外科チーム、3病棟" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>部署用 コネクトToken</label>
                  <input type="password" value={teamForm.teamNotionToken} onChange={(e) => setTeamForm(f => ({ ...f, teamNotionToken: e.target.value }))} placeholder="ntn_xxxxxxxxxxxx" className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>部署用 Medical DB（URLまたはID）</label>
                  <input type="text" value={teamForm.teamNotionMedicalDbId} onChange={(e) => setTeamForm(f => ({ ...f, teamNotionMedicalDbId: e.target.value }))} placeholder="https://www.notion.so/... またはID32桁" className={inputCls} />
                  {teamForm.teamNotionMedicalDbId.length === 32 && <p className="text-xs text-green-600 mt-1">✓ DB IDを認識しました</p>}
                </div>
                <div>
                  <label className={labelCls}>部署用 Reference DB（URLまたはID・任意）</label>
                  <input type="text" value={teamForm.teamNotionReferenceDbId} onChange={(e) => setTeamForm(f => ({ ...f, teamNotionReferenceDbId: e.target.value }))} placeholder="https://www.notion.so/... またはID32桁" className={inputCls} />
                  {teamForm.teamNotionReferenceDbId.length === 32 && <p className="text-xs text-green-600 mt-1">✓ DB IDを認識しました</p>}
                </div>
              </div>
              {saveMsg && <p className="text-xs text-green-600 dark:text-green-400 text-center">{saveMsg}</p>}
              <button
                onClick={() => saveSection({
                  ...teamForm,
                  teamNotionMedicalDbId: teamForm.teamNotionMedicalDbId ? extractNotionDbId(teamForm.teamNotionMedicalDbId) : '',
                  teamNotionReferenceDbId: teamForm.teamNotionReferenceDbId ? extractNotionDbId(teamForm.teamNotionReferenceDbId) : '',
                })}
                className="w-full bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-blue-700 transition-colors"
              >
                保存する
              </button>
              {(teamForm.teamNotionToken || teamForm.teamNotionMedicalDbId) && (
                <button
                  onClick={() => {
                    setTeamForm({ teamLabel: '', teamNotionToken: '', teamNotionMedicalDbId: '', teamNotionReferenceDbId: '' })
                    saveSection({ teamLabel: '', teamNotionToken: '', teamNotionMedicalDbId: '', teamNotionReferenceDbId: '' })
                  }}
                  className="w-full text-xs text-gray-400 hover:text-red-500 dark:text-gray-500 dark:hover:text-red-400 py-1 transition-colors"
                >
                  部署DB接続を解除する
                </button>
              )}
            </div>
          )}

          {/* ── プレミアムDB設定 ── */}
          {section === 'subscription' && (
            <div className="space-y-4">
              {(() => {
                const s = getSettings()
                const isPremium = !!(s?.subscriptionSearchKey && s?.subscriptionAppId)
                if (isPremium) {
                  return (
                    <div className="space-y-3">
                      <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl p-4 text-center">
                        <p className="text-sm font-bold text-green-700 dark:text-green-400">✅ プレミアム登録済み</p>
                        <p className="text-xs text-green-600 dark:text-green-500 mt-1">プレミアムコンテンツにアクセスできます</p>
                      </div>
                      <div className="border-t border-gray-100 dark:border-gray-700 pt-3 space-y-1.5">
                        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">解約するには</p>
                        <p className="text-xs text-gray-400 dark:text-gray-500">解約後も次回請求日まで利用できます。</p>
                        <a
                          href="https://billing.stripe.com/p/login/00000000"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block text-xs text-blue-500 hover:text-blue-700 dark:text-blue-400 underline"
                        >
                          Stripeカスタマーポータルで解約する →
                        </a>
                      </div>
                    </div>
                  )
                }
                return (
                  <div className="space-y-3">
                    <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                      現役集中治療医が定期的に更新する医療ナレッジ＋参考文献を閲覧できます。
                    </p>
                    <PremiumCheckoutButtonInline />
                    <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
                      <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">既に購入済みの方（手動入力）：</p>
                      <div className="space-y-2">
                        <div>
                          <label className={labelCls}>Search-Only APIキー</label>
                          <input type="password" defaultValue={s?.subscriptionSearchKey || ''} onChange={(e) => saveSection({ subscriptionSearchKey: e.target.value })} placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className={inputCls} />
                        </div>
                        <div>
                          <label className={labelCls}>App ID</label>
                          <input type="text" defaultValue={s?.subscriptionAppId || ''} onChange={(e) => saveSection({ subscriptionAppId: e.target.value })} placeholder="XXXXXXXXXX" className={inputCls} />
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })()}
            </div>
          )}

          {/* ── ヘルプ ── */}
          {section === 'help' && (
            <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300 max-h-[60vh] overflow-y-auto pr-1">
              <section>
                <h3 className="font-bold text-gray-900 dark:text-white mb-2">🔄 同期エラーが出たときは</h3>
                <div className="space-y-2 text-xs bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                  <p><strong>「API token is invalid」</strong></p>
                  <p>→ コネクトのTokenが間違っています。notion.so/my-integrations で再コピーし「Notion・Algolia接続設定」から更新してください。</p>
                  <p className="mt-2"><strong>「restricted_resource / 403」</strong></p>
                  <p>→ DBにコネクトが接続されていません。NotionのDBページ右上「…」→「コネクトを追加」→ 作成したコネクトを選択してください。</p>
                  {currentMode === 'algolia' && (
                    <>
                      <p className="mt-2"><strong>「Admin API Key エラー」</strong></p>
                      <p>→ Search API KeyではなくAdmin API Keyを使用してください。</p>
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
                  onClick={async () => {
                    const s = getSettings()
                    if (!s?.notionToken || !s?.notionMedicalDbId) { setPropCheckError('Notion設定が見つかりません'); return }
                    setPropCheckLoading(true); setPropCheckError(null); setPropCheck(null)
                    try {
                      const res = await fetch('/api/notion/check-props', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notionToken: s.notionToken, notionMedicalDbId: s.notionMedicalDbId, notionReferenceDbId: s.notionReferenceDbId || '' }) })
                      const data = await res.json()
                      if (data.error) throw new Error(data.error)
                      setPropCheck(data)
                    } catch (err) { setPropCheckError(err instanceof Error ? err.message : 'エラーが発生しました') }
                    finally { setPropCheckLoading(false) }
                  }}
                  disabled={propCheckLoading}
                  className="w-full text-sm bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl py-2.5 font-medium hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-50"
                >
                  {propCheckLoading ? '確認中...' : '接続中のDBのプロパティを確認する'}
                </button>
                {propCheckError && <p className="text-xs text-red-500 mt-2">{propCheckError}</p>}
                {propCheck && (
                  <div className="mt-3 space-y-3">
                    {(['medical', 'reference'] as const).map((db) => {
                      const r = propCheck[db]; if (!r) return null
                      const allOk = r.missing.length === 0
                      return (
                        <div key={db} className={`rounded-xl p-3 text-xs ${allOk ? 'bg-green-50 dark:bg-green-900/20' : 'bg-red-50 dark:bg-red-900/20'}`}>
                          <p className={`font-semibold mb-1.5 ${allOk ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                            {db === 'medical' ? '🚑 Medical DB' : '📖 Reference DB'} — {allOk ? '✅ 全て一致' : '⚠️ 不一致あり'}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {r.found.map((p) => <span key={p} className="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full">✓ {p}</span>)}
                            {r.missing.map((p) => <span key={p} className="bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full">✗ {p}</span>)}
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
                  <button
                    onClick={async () => {
                      const s = getSettings()
                      if (!s?.algoliaAppId || !s?.algoliaSearchKey) { setSearchKeyCheck({ ok: false, error: 'App IDまたはSearch Keyが未設定です' }); return }
                      setSearchKeyCheckLoading(true); setSearchKeyCheck(null)
                      try {
                        const res = await fetch('/api/verify-search-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ algoliaAppId: s.algoliaAppId, algoliaSearchKey: s.algoliaSearchKey, algoliaIndex: s.algoliaIndex }) })
                        const data = await res.json()
                        setSearchKeyCheck(data.error ? { ok: false, error: data.error } : { ok: true, nbHits: data.nbHits })
                      } catch (err) { setSearchKeyCheck({ ok: false, error: err instanceof Error ? err.message : 'エラー' }) }
                      finally { setSearchKeyCheckLoading(false) }
                    }}
                    disabled={searchKeyCheckLoading}
                    className="w-full text-sm bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-xl py-2.5 font-medium hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-50"
                  >
                    {searchKeyCheckLoading ? '確認中...' : 'Search Keyを確認する'}
                  </button>
                  {searchKeyCheck && (
                    <div className={`mt-2 rounded-xl p-3 text-xs ${searchKeyCheck.ok ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
                      {searchKeyCheck.ok ? <p>✅ Search Key正常 — インデックスに <strong>{searchKeyCheck.nbHits}件</strong> のデータが見えています</p> : (
                        <><p className="font-semibold mb-1">❌ Search Keyが機能していません</p><p className="mb-1">エラー: {searchKeyCheck.error}</p><p>「Notion・Algolia接続設定」からSearch API Keyを再入力してください。</p></>
                      )}
                    </div>
                  )}
                </section>
              )}
              {currentMode === 'algolia' && (
                <section>
                  <h3 className="font-bold text-gray-900 dark:text-white mb-2">🔬 Algoliaインデックス診断</h3>
                  <button
                    onClick={async () => {
                      const s = getSettings()
                      if (!s?.algoliaAppId || !s?.algoliaAdminKey) { setAlgoliaDebugError('Algolia設定が見つかりません'); return }
                      setAlgoliaDebugLoading(true); setAlgoliaDebugError(null); setAlgoliaDebug(null)
                      try {
                        const res = await fetch('/api/debug-index', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ algoliaAppId: s.algoliaAppId, algoliaAdminKey: s.algoliaAdminKey, algoliaIndex: s.algoliaIndex }) })
                        const data = await res.json()
                        if (data.error) throw new Error(data.error)
                        setAlgoliaDebug(data)
                      } catch (err) { setAlgoliaDebugError(err instanceof Error ? err.message : 'エラーが発生しました') }
                      finally { setAlgoliaDebugLoading(false) }
                    }}
                    disabled={algoliaDebugLoading}
                    className="w-full text-sm bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 rounded-xl py-2.5 font-medium hover:bg-purple-100 dark:hover:bg-purple-900/50 transition-colors disabled:opacity-50"
                  >
                    {algoliaDebugLoading ? '取得中...' : 'インデックスの状態を確認する'}
                  </button>
                  {algoliaDebugError && <p className="text-xs text-red-500 mt-2">{algoliaDebugError}</p>}
                  {algoliaDebug && (
                    <div className="mt-3 space-y-2 text-xs">
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                        <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1">📊 総レコード数: {algoliaDebug.totalHits}件</p>
                        <p className="text-gray-500 dark:text-gray-400">attributesForFaceting: {algoliaDebug.settings.attributesForFaceting?.join(', ') || '未設定'}</p>
                      </div>
                      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3">
                        <p className="font-semibold text-blue-700 dark:text-blue-300 mb-1">💡 知識レベルの実際の値</p>
                        {algoliaDebug.knowledgeLevelValues.length === 0 ? <p className="text-red-500">値なし（再同期が必要）</p> : (
                          <div className="flex flex-wrap gap-1">{algoliaDebug.knowledgeLevelValues.map((v) => <span key={v} className="bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">{v}</span>)}</div>
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
          )}

          {/* ── セットアップをやり直す確認 ── */}
          {section === 'redo-confirm' && (
            <div className="space-y-4">
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 text-sm text-amber-700 dark:text-amber-300 space-y-1">
                <p className="font-bold">🔄 セットアップをやり直しますか？</p>
                <p className="text-xs">現在入力しているAPIキーやDB設定は保持されます。モードの変更や入力し直しができます。</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setSection(null)} className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">キャンセル</button>
                <button onClick={() => { onClose(); onRedo() }} className="flex-1 bg-amber-500 text-white rounded-xl py-3 text-sm font-semibold hover:bg-amber-600 transition-colors">やり直す</button>
              </div>
            </div>
          )}

          {/* ── 完全削除確認 ── */}
          {section === 'reset-confirm' && (
            <div className="space-y-4">
              <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-4 text-sm text-red-700 dark:text-red-300 space-y-1">
                <p className="font-bold">⚠️ 本当に全て削除しますか？</p>
                <p className="text-xs">入力したAPIキー・DB設定が全て消去されます。元に戻すことはできません。</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setSection(null)} className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">キャンセル</button>
                <button onClick={onReset} className="flex-1 bg-red-500 text-white rounded-xl py-3 text-sm font-semibold hover:bg-red-600 transition-colors">削除する</button>
              </div>
            </div>
          )}

          {/* ── モード変更確認 ── */}
          {section === 'mode-confirm' && (
            <div className="space-y-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-300 space-y-1.5">
                <p className="font-bold">🔀 モードを変更しますか？</p>
                <p className="text-xs">セットアップ画面の最初に戻ります。現在のAPIキー・DB設定は保持されるので、必要な箇所だけ変更できます。</p>
                <p className="text-xs">現在: <span className="font-semibold">{currentMode === 'notion' ? '📋 シンプルモード' : '⚡ パワーモード'}</span></p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setSection(null)} className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">キャンセル</button>
                <button onClick={() => { onClose(); onRedo() }} className="flex-1 bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-blue-700 transition-colors">モード選択へ</button>
              </div>
            </div>
          )}

          {/* ── DBセットアップ確認 ── */}
          {section === 'db-setup-confirm' && (
            <div className="space-y-4">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-300 space-y-1.5">
                <p className="font-bold">📋 NotionDBをセットアップしますか？</p>
                <p className="text-xs">DB選択画面に移動します。既存のNotionDBを接続するか、テンプレートを複製して新しくDBを作成できます。</p>
                <p className="text-xs">現在のAPIキー設定は保持されます。</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setSection(null)} className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">キャンセル</button>
                <button onClick={() => { onClose(); onRedoFromNotion() }} className="flex-1 bg-blue-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-blue-700 transition-colors">DB選択へ</button>
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
  const [premiumActivating, setPremiumActivating] = useState(false)
  const [premiumMessage, setPremiumMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // Stripe決済完了後の ?premium_session= パラメータを処理してキーを自動取得
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const sessionId = params.get('premium_session')
    if (!sessionId) return

    // URLからパラメータを消す（リロードで再処理されないよう）
    const cleanUrl = window.location.pathname
    window.history.replaceState({}, '', cleanUrl)

    setPremiumActivating(true)
    fetch('/api/premium/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.algolia) {
          // LocalStorageの設定にAlgoliaキーを書き込む
          const defaultSettings = {
            searchMode: 'algolia' as const,
            notionToken: '', notionMedicalDbId: '', notionReferenceDbId: '',
            algoliaAppId: '', algoliaSearchKey: '', algoliaAdminKey: '', algoliaIndex: 'medical_knowledge',
            teamLabel: '', teamNotionToken: '', teamNotionMedicalDbId: '', teamNotionReferenceDbId: '',
            subscriptionSearchKey: '', subscriptionAppId: '', subscriptionIndex: '',
            propSummary: '', propKeywords: '', propKnowledgeLevel: '', propGenre: '',
          }
          const current = getSettings() || defaultSettings
          saveSettings({
            ...current,
            subscriptionAppId: data.algolia.appId,
            subscriptionSearchKey: data.algolia.searchKey,
            subscriptionIndex: data.algolia.index,
          })
          setPremiumMessage({ type: 'success', text: 'プレミアム登録が完了しました！プレミアムコンテンツにアクセスできるようになりました。' })
          // ページをリロードして新しい設定を反映
          setTimeout(() => window.location.reload(), 2000)
        } else {
          setPremiumMessage({ type: 'error', text: data.error || 'プレミアム認証に失敗しました。サポートにお問い合わせください。' })
        }
      })
      .catch(() => {
        setPremiumMessage({ type: 'error', text: 'ネットワークエラーが発生しました。再度お試しください。' })
      })
      .finally(() => {
        setPremiumActivating(false)
      })
  }, [])

  useEffect(() => {
    setSetupDone(isSetupComplete())
    const done = typeof window !== 'undefined' && !!localStorage.getItem(ONBOARDING_DONE_KEY)
    setOnboardingDone(done)
  }, [])

  const [setupInitialStep, setSetupInitialStep] = useState<'mode' | 'notion' | 'options'>('mode')

  const handleReset = () => {
    clearSettings()
    setSetupDone(false)
    setShowSettings(false)
    setSetupInitialStep('mode')
  }

  const handleRedo = () => {
    setSetupInitialStep('mode')
    setSetupDone(false)
  }

  const handleRedoFromNotion = () => {
    setSetupInitialStep('notion')
    setSetupDone(false)
  }

  const [showOnboardingFromSetup, setShowOnboardingFromSetup] = useState(false)

  const completeOnboarding = () => {
    localStorage.setItem(ONBOARDING_DONE_KEY, '1')
    setOnboardingDone(true)
    setShowOnboardingFromSetup(false)
  }

  // プレミアム認証処理中のオーバーレイ
  if (premiumActivating) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-purple-50 to-white dark:from-gray-900 dark:to-gray-800 flex items-center justify-center px-4">
        <div className="text-center space-y-4">
          <div className="text-5xl animate-bounce">⭐</div>
          <p className="text-lg font-bold text-purple-700 dark:text-purple-300">プレミアム登録を確認中...</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">しばらくお待ちください</p>
        </div>
      </div>
    )
  }

  // プレミアム認証完了メッセージ（成功/失敗）
  if (premiumMessage) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white dark:from-gray-900 dark:to-gray-800 flex items-center justify-center px-4">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="text-5xl">{premiumMessage.type === 'success' ? '✅' : '⚠️'}</div>
          <p className={`text-base font-semibold ${premiumMessage.type === 'success' ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {premiumMessage.text}
          </p>
          {premiumMessage.type === 'error' && (
            <button
              onClick={() => setPremiumMessage(null)}
              className="text-sm text-blue-500 hover:text-blue-700 dark:text-blue-400"
            >
              閉じる
            </button>
          )}
          {premiumMessage.type === 'success' && (
            <p className="text-xs text-gray-400">自動的に画面を更新します...</p>
          )}
        </div>
      </div>
    )
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
    return <SetupWizard onComplete={() => { setSetupDone(true); setShowSettings(false); setSetupInitialStep('mode') }} onShowOnboarding={() => setShowOnboardingFromSetup(true)} initialStep={setupInitialStep} />
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
      onRedoFromNotion={handleRedoFromNotion}
      currentMode={searchMode}
    />
  )

  // ========== Notionモード ==========
  if (searchMode === 'notion') {
    return (
      <SubscriptionSearchProvider enableBridge={true}>
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-gray-50 dark:from-gray-900 dark:to-gray-800">
        {header}
        <div className="max-w-2xl mx-auto px-4 py-4">
          <PowerModeUpgradeBanner onOpenSettings={() => setShowSettings(true)} />
          {tab === 'search' && <NotionSearchTab hasTeam={hasTeam} hasSubscription={hasSubscription} />}
          {tab === 'recent' && <NotionRecentTab hasTeam={hasTeam} hasSubscription={hasSubscription} />}
          {tab === 'browse' && <NotionBrowseTab hasTeam={hasTeam} hasSubscription={hasSubscription} />}
          {tab === 'reference' && <NotionReferenceTab hasTeam={hasTeam} hasSubscription={hasSubscription} />}
          {tab === 'quiz' && <NotionQuizTab hasTeam={hasTeam} hasSubscription={hasSubscription} />}
        </div>
        {settingsModal}
      </div>
      </SubscriptionSearchProvider>
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
    <SubscriptionSearchProvider enableBridge={true}>
    <InstantSearch searchClient={dynamicSearchClient} indexName={dynamicIndexName} future={{ preserveSharedStateOnUnmount: false }}>
      <div className="min-h-screen bg-gradient-to-b from-blue-50 to-gray-50 dark:from-gray-900 dark:to-gray-800">
        {header}
        <div className="max-w-2xl mx-auto px-4 py-4">
          {tab === 'search' && <SearchTab hasTeam={hasTeam} hasSubscription={hasSubscription} />}
          {tab === 'recent' && (
            <RecentTabWithOwner hasTeam={hasTeam} hasSubscription={hasSubscription} />
          )}
          {tab === 'browse' && <GenreBrowse hasTeam={hasTeam} hasSubscription={hasSubscription} />}
          {tab === 'reference' && <ReferenceTab hasTeam={hasTeam} hasSubscription={hasSubscription} />}
          {tab === 'quiz' && (
            <QuizTabWithOwner hasTeam={hasTeam} hasSubscription={hasSubscription} />
          )}
        </div>
        <div className="max-w-2xl mx-auto bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-t border-gray-100 dark:border-gray-700 mt-4">
          <SyncPanel />
        </div>
      </div>
      {settingsModal}
    </InstantSearch>
    </SubscriptionSearchProvider>
  )
}
