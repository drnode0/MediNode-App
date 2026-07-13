'use client'
import { InstantSearch, Configure, useHits, useSearchBox } from 'react-instantsearch'
import { useState, useEffect, useCallback, useRef, createContext, useContext, useMemo } from 'react'
import { track } from '@vercel/analytics'
import { weightedQuizOrder } from '@/lib/quiz-srs'
import { stripLeadingEmoji } from '@/lib/labels'
import {
  Search, Clock, FolderOpen, BookOpen, Lightbulb, ClipboardList, SlidersHorizontal,
  Link2, Building2, Star, Wrench, Megaphone, Send, HelpCircle, Trash2, Shuffle, BookMarked,
  Gift, CheckCircle2, AlarmClock, ArrowRight,
  Inbox, Brain, X, FlaskConical, Zap, CreditCard, RefreshCw, AlertTriangle, Book, Check,
  KeyRound, XCircle, Microscope, BarChart3, Smartphone, FileText, Ambulance, Lock,
  ExternalLink, ChevronRight, ChevronUp, ChevronDown,
  type LucideIcon,
} from 'lucide-react'
import {
  createSearchClient,
  getIndexName,
  createSubscriptionSearchClient,
  getSubscriptionIndexName,
  hasSubscriptionConfig,
} from '@/lib/algolia'
import { isSetupComplete, clearSettings, getSettings, saveSettings, extractNotionDbId, markTrialUsed, hasUsedTrial, type AppSettings } from '@/lib/settings'
import { SearchBox } from '@/components/SearchBox'
import { Spinner } from '@/components/Spinner'
import { SkeletonCards } from '@/components/SkeletonCards'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
import { SearchResults } from '@/components/SearchResults'
import { ResultCard, type Hit } from '@/components/ResultCard'
import { QuizCard } from '@/components/QuizCard'
import { useSearchHistory, SearchHistoryList } from '@/components/SearchHistory'
import { GenreBrowse, genreChipTone, GenreHitsList } from '@/components/GenreBrowse'

import { SyncPanel } from '@/components/SyncPanel'

import { PremiumValueProps } from '@/components/PremiumValueProps'
import { AccountButton } from '@/components/auth/AccountButton'
import { useAuth } from '@/components/auth/AuthProvider'
import dynamicImport from 'next/dynamic'
import { AppSkeleton } from '@/components/AppSkeleton'

// セットアップ・オンボーディングは「初回とやり直し時」しか使わないため、
// 初期バンドルから分離して必要時にだけ読み込む（既存ユーザーの起動を軽くする）。
const SetupWizard = dynamicImport(
  () => import('@/components/SetupWizard').then((m) => m.SetupWizard),
  { ssr: false, loading: () => <AppSkeleton /> },
)
const OnboardingScreen = dynamicImport(
  () => import('@/components/OnboardingScreen').then((m) => m.OnboardingScreen),
  { ssr: false, loading: () => <AppSkeleton /> },
)
import { MANUAL_GUIDE_URL, MANUAL_TEMPLATE_URL, FEEDBACK_FORM_URL, CLINICAL_QUESTION_FORM_URL } from '@/lib/app-links'
import { ANNOUNCEMENTS, UpdateBanner, FeedbackNudgeBanner, PowerModeUpgradeBanner, bumpSearchCount } from '@/components/AppBanners'
import { OpenSettingsContext, SearchErrorNotice, AlgoliaSearchErrorNotice, type SettingsPanelSection } from '@/components/SearchErrors'
import { OwnerFilterTabs, buildOwnerFilter, type OwnerFilter } from '@/components/OwnerFilterTabs'
import { CqCaptureProvider, useCqCapture } from '@/components/CqCapture'

const ONBOARDING_DONE_KEY = 'medical_search_onboarding_done_v4'

type Tab = 'search' | 'recent' | 'browse' | 'quiz' | 'reference' | 'manual'

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
// クイズ用ジャンルフィルター（両モード共通）
// ============================================================

// ジャンルチップの初期表示件数（ジャンルタブと共用）
const GENRE_SHOW_LIMIT = 12

// Hit からジャンル配列を正規化して取り出す（genreList → genre(配列) → genre(単体)）
function getHitGenres(h: Hit): string[] {
  let list: string[] = []
  if (h.genreList && h.genreList.length) list = h.genreList
  else if (Array.isArray(h.genre)) list = h.genre
  else if (h.genre) list = [h.genre]
  return Array.from(new Set(list.map((g) => g.trim()).filter(Boolean)))
}

// クイズ候補からジャンル一覧を集計（hybridSort 済み）
function collectQuizGenres(candidates: Hit[]): string[] {
  const set = new Set<string>()
  for (const h of candidates) for (const g of getHitGenres(h)) set.add(g)
  return Array.from(set).sort(hybridSort)
}

// 選択ジャンル（OR）でクイズ候補を絞り込む。空配列なら全件。
function filterByGenres(candidates: Hit[], selected: string[]): Hit[] {
  if (selected.length === 0) return candidates
  const sel = new Set(selected)
  return candidates.filter((h) => getHitGenres(h).some((g) => sel.has(g)))
}

// クイズのジャンルフィルター選択状態の永続化（AppSettingsとは独立）
const QUIZ_GENRE_FILTER_KEY = 'medinode_quiz_genre_filter_v1'

function loadQuizGenreFilter(): string[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(QUIZ_GENRE_FILTER_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === 'string') : []
  } catch {
    return []
  }
}

function saveQuizGenreFilter(genres: string[]): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(QUIZ_GENRE_FILTER_KEY, JSON.stringify(genres))
  } catch {
    /* localStorage 不可環境では無視 */
  }
}

// クイズのジャンル絞り込みチップUI（両モード共用）
function QuizGenreFilter({
  allGenres,
  selected,
  onChange,
}: {
  allGenres: string[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const [showAll, setShowAll] = useState(false)
  // 候補が0〜1ジャンルしかなければ絞り込む意味がないので非表示
  if (allGenres.length <= 1) return null

  const toggle = (g: string) => {
    onChange(selected.includes(g) ? selected.filter((x) => x !== g) : [...selected, g])
  }
  const visible = showAll ? allGenres : allGenres.slice(0, GENRE_SHOW_LIMIT)

  return (
    <div className="mb-3">
      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => onChange([])}
          className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
            selected.length === 0
              ? 'bg-brand-600 text-white border-brand-600'
              : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 border-gray-200 dark:border-gray-700'
          }`}
        >
          すべて
        </button>
        {visible.map((g) => {
          const isActive = selected.includes(g)
          return (
            <button
              key={g}
              onClick={() => toggle(g)}
              className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                isActive
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700'
              }`}
            >
              {displayGenreName(g)}
            </button>
          )
        })}
      </div>
      {allGenres.length > GENRE_SHOW_LIMIT && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-xs text-brand-500 hover:text-brand-700 dark:text-brand-400 mt-1.5 inline-flex items-center gap-1"
        >
          {showAll
            ? <><ChevronUp className="w-3.5 h-3.5" />折りたたむ</>
            : <><ChevronDown className="w-3.5 h-3.5" />すべてのジャンル（残り {allGenres.length - GENRE_SHOW_LIMIT} 件）</>}
        </button>
      )}
    </div>
  )
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
        <div className="mb-4 flex justify-center text-gray-300 dark:text-gray-600"><Inbox className="h-12 w-12" /></div>
        <p className="text-gray-600 dark:text-gray-300 font-semibold text-base mb-1">データがありません</p>
        <p className="text-sm text-gray-400 dark:text-gray-500">
          画面下の「再同期」からデータを取り込んでください
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
    // SRS順（まだ→未学習→覚えた）。各グループ内はシャッフル。
    setShuffled(weightedQuizOrder(quizCandidates).slice(0, 20))
  }, [quizCandidates.length])

  // 知識レベルを1件も設定していないか確認
  const hasAnyKnowledgeLevel = (hits as unknown as Hit[]).some((h) => h.knowledgeLevel && h.knowledgeLevel.trim())

  if (quizCandidates.length === 0) {
    return (
      <div className="text-center py-14 px-4 space-y-4">
        <div className="flex justify-center text-gray-300 dark:text-gray-600"><Brain className="h-12 w-12" /></div>
        <div>
          <p className="text-gray-600 dark:text-gray-300 font-semibold text-base mb-1">クイズがありません</p>
          <p className="text-sm text-gray-400 dark:text-gray-500">
            知識レベルを「💡 ナレッジ」に設定し、要約を入れるとここに出題されます
          </p>
        </div>
        {!hasAnyKnowledgeLevel && (
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 text-left max-w-sm mx-auto space-y-2">
            <p className="text-xs font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1.5"><Lightbulb className="h-4 w-4 shrink-0" />クイズの使い方</p>
            <ol className="text-xs text-amber-700 dark:text-amber-400 space-y-1 list-decimal list-inside">
              <li>Notionで確認済みの知識ページを開く</li>
              <li>「知識レベル」プロパティを <strong>💡 ナレッジ</strong> に設定</li>
              <li>「要約」プロパティに結論を入力</li>
              <li>アプリで再同期 → クイズに出題されます</li>
            </ol>
            <p className="text-xs text-amber-500 dark:text-amber-500 mt-1">❓ CQ（まだ答えの出ていない疑問）と 📋 まとめは、クイズには出ません</p>
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
          className="text-xs text-brand-500 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 font-medium"
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

// 検索・絞り込みの空状態（0件）表示。タブごとにバラバラだった「該当なし」の
// 一言表示を、アイコン＋見出し＋寄り添う一行に統一する。
function EmptyNotice({ Icon, title, hint, children }: { Icon: LucideIcon; title: string; hint?: string; children?: React.ReactNode }) {
  return (
    <div className="text-center py-12 px-4 text-gray-400 dark:text-gray-500">
      <div className="mb-3 flex justify-center text-gray-300 dark:text-gray-600"><Icon className="h-10 w-10" /></div>
      <p className="text-base font-semibold text-gray-600 dark:text-gray-300">{title}</p>
      {hint && <p className="text-sm mt-1">{hint}</p>}
      {children}
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
    return <EmptyNotice Icon={BookMarked} title="文献が見つかりませんでした" hint="別のキーワードで試してください" />
  }
  return (
    <div className="space-y-3">
      {sorted.map((hit) => (
        <ResultCard key={hit.objectID} hit={hit} />
      ))}
    </div>
  )
}

// 文献タブの「棚を眺める」ための絞り込みチップ（年代＋ジャンル）。
// 検索窓に何も打たなくても、タップだけで拾い読みできるようにする。
// 年代は文献の発行年から、ジャンルは文献に付いたタグから動的に生成。
function RefBrowseChips({
  hits, year, onYear, genre, onGenre,
}: {
  hits: Hit[]
  year: string | null
  onYear: (y: string | null) => void
  genre: string | null
  onGenre: (g: string | null) => void
}) {
  const years = useMemo(() => {
    const set = new Set<string>()
    for (const h of hits) {
      const y = String(h.year || '').slice(0, 4)
      if (/^\d{4}$/.test(y)) set.add(y)
    }
    return [...set].sort().reverse()
  }, [hits])
  const genres = useMemo(() => {
    const set = new Set<string>()
    for (const h of hits) for (const g of getHitGenres(h)) set.add(g)
    return [...set].sort()
  }, [hits])

  if (years.length === 0 && genres.length < 2) return null
  // 下マージンは付けない（sticky制御バー内に置くため。バーのpbで間隔を持つ）。
  return (
    <div className="space-y-1.5">
      {years.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
          <button
            onClick={() => onYear(null)}
            className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
              !year
                ? 'bg-gray-700 dark:bg-gray-200 text-white dark:text-gray-900 border-transparent'
                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
            }`}
          >
            全期間
          </button>
          {years.map((y) => (
            <button
              key={y}
              onClick={() => onYear(year === y ? null : y)}
              className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                year === y
                  ? 'bg-gray-700 dark:bg-gray-200 text-white dark:text-gray-900 border-transparent'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      )}
      {genres.length >= 2 && (
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 [-webkit-overflow-scrolling:touch]">
          {genres.map((g) => {
            const tone = genreChipTone(g)
            return (
              <button
                key={g}
                onClick={() => onGenre(genre === g ? null : g)}
                className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                  genre === g ? tone.active : tone.idle
                }`}
              >
                {displayGenreName(g)}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// 文献のクライアント側絞り込み（キーワード・年・ジャンル）。両モード共通。
function filterRefHits(hits: Hit[], query: string, year: string | null, genre: string | null): Hit[] {
  const q = query.trim().toLowerCase()
  return hits.filter((h) => {
    if (year && String(h.year || '').slice(0, 4) !== year) return false
    if (genre && !getHitGenres(h).includes(genre)) return false
    if (q) {
      const match = [h.title, h.author, h.journal, h.aiKeywords, h.summary]
        .filter(Boolean)
        .some((f) => (f as string).toLowerCase().includes(q))
      if (!match) return false
    }
    return true
  })
}

function ReferenceTab({ hasTeam, hasSubscription }: { hasTeam: boolean; hasSubscription: boolean }) {
  const [sort, setSort] = useState<RefSort>('year_desc')
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')
  // 文献タブ専用の絞り込み。検索タブのキーワードとは独立させる
  // （以前は検索タブのクエリが残ったまま文献に効いて「該当なし」に見えるバグ的挙動があった）。
  const [query, setQuery] = useState('')
  const [refYear, setRefYear] = useState<string | null>(null)
  const [refGenre, setRefGenre] = useState<string | null>(null)
  const ctx = useSubscriptionHits()
  const [personalHits, setPersonalHits] = useState<Hit[]>([])
  // 部署(team)はAlgoliaに無いためNotionから直読み（文献のみ採用）
  const { teamHits: teamAll } = useTeamNotionHits('reference', hasTeam)
  const teamHits = useMemo(() => teamAll.filter((h) => h.source === 'reference'), [teamAll])

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
  const personalAndTeam = useMemo(() => {
    const seen = new Set<string>()
    const out: Hit[] = []
    for (const h of personalHits) { if (!seen.has(h.objectID)) { out.push(h); seen.add(h.objectID) } }
    for (const h of teamHits) { if (!seen.has(h.objectID)) { out.push(h); seen.add(h.objectID) } }
    return out
  }, [personalHits, teamHits])
  const mergedHits = useMemo(() => {
    if (ownerFilter === 'subscription') return subHits
    if (ownerFilter === 'personal') return personalAndTeam.filter((h) => !h.owner || h.owner === 'personal')
    if (ownerFilter === 'team') return personalAndTeam.filter((h) => h.owner === 'team')
    const seen = new Set<string>()
    const merged: Hit[] = []
    for (const h of personalAndTeam) { if (!seen.has(h.objectID)) { merged.push(h); seen.add(h.objectID) } }
    for (const h of subHits) { if (!seen.has(h.objectID)) { merged.push(h); seen.add(h.objectID) } }
    return merged
  }, [ownerFilter, personalAndTeam, subHits])

  const filtered = useMemo(
    () => filterRefHits(mergedHits, query, refYear, refGenre),
    [mergedHits, query, refYear, refGenre],
  )
  const sorted = [...filtered].sort((a, b) => {
    if (sort === 'year_desc') return (b.year || '0') > (a.year || '0') ? 1 : -1
    if (sort === 'year_asc') return (a.year || '0') > (b.year || '0') ? 1 : -1
    return (b.lastEdited || '') > (a.lastEdited || '') ? 1 : -1
  })
  const isFiltering = !!(query.trim() || refYear || refGenre)

  return (
    <>
      {/* query="" : 検索タブで入力したキーワードをこのタブに持ち込まない（常に全文献から始める） */}
      <Configure hitsPerPage={200} filters={refPersonalFilter} query="" />
      <PersonalHitsCollector onHits={setPersonalHits} />
      <div className="sticky top-[calc(120px+env(safe-area-inset-top))] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-3 pt-1 -mx-4 px-4">
        <div className="flex items-center gap-2 mb-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="文献を絞り込み..."
            className="flex-1 border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
          />
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
        {/* 年代・ジャンルチップはsticky制御バーの中に置く。一覧の途中に非stickyで
            挟むと、データ読み込み後にチップ2行が現れて一覧が下にズレる（文献タブ
            だけで起きていた挙動）。バー内に畳めば一覧の起点が動かず、スクロール中も
            絞り込みが手元に残る。 */}
        {!(ownerFilter === 'subscription' && !hasSubscription) && (
          <div className="mt-2">
            <RefBrowseChips hits={mergedHits} year={refYear} onYear={setRefYear} genre={refGenre} onGenre={setRefGenre} />
          </div>
        )}
      </div>
      {ownerFilter === 'subscription' && !hasSubscription ? (
        <SubscriptionPromoPanel />
      ) : sorted.length === 0 ? (
        isFiltering ? (
          <EmptyNotice Icon={BookMarked} title="この条件の文献はありません" hint="絞り込みを変えて試してください" />
        ) : (
          <EmptyNotice Icon={BookMarked} title="参考文献DBが設定されていないか、データがありません" />
        )
      ) : (
        <>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">{sorted.length}件</p>
          <div className="space-y-3">
            {sorted.map((hit) => (
              <ResultCard key={hit.objectID} hit={hit} />
            ))}
          </div>
        </>
      )}
    </>
  )
}

function RecentTabWithOwner({ hasTeam, hasSubscription }: { hasTeam: boolean; hasSubscription: boolean }) {
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')
  const ctx = useSubscriptionHits()
  const [personalHits, setPersonalHits] = useState<Hit[]>([])
  // 部署(team)はAlgoliaに無いためNotionから直読み
  const { teamHits } = useTeamNotionHits('recent', hasTeam)

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
  const personalAndTeam = useMemo(() => {
    const seen = new Set<string>()
    const out: Hit[] = []
    for (const h of personalHits) { if (!seen.has(h.objectID)) { out.push(h); seen.add(h.objectID) } }
    for (const h of teamHits) { if (!seen.has(h.objectID)) { out.push(h); seen.add(h.objectID) } }
    return out
  }, [personalHits, teamHits])
  const mergedHits = useMemo(() => mergeHitsByOwnerFilter(personalAndTeam, subHits, ownerFilter), [ownerFilter, personalAndTeam, subHits])
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
      {/* query="" : 検索タブのキーワードを新着に持ち込まない（常に全件の時系列で表示） */}
      <Configure hitsPerPage={300} filters={personalFilter || undefined} query="" />
      <PersonalHitsCollector onHits={setPersonalHits} />
      <div className="sticky top-[calc(120px+env(safe-area-inset-top))] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-2 pt-1 -mx-4 px-4 mb-2">
        <OwnerFilterTabs owner={ownerFilter} onChange={setOwnerFilter} hasTeam={hasTeam} hasSubscription={hasSubscription} />
      </div>
      {ownerFilter === 'subscription' && !hasSubscription ? (
        <SubscriptionPromoPanel />
      ) : mergedHits.length === 0 ? (
        <div className="text-center py-14 px-4">
          <div className="mb-4 flex justify-center text-gray-300 dark:text-gray-600"><Inbox className="h-12 w-12" /></div>
          <p className="text-gray-600 dark:text-gray-300 font-semibold text-base mb-1">データがありません</p>
          <p className="text-sm text-gray-400 dark:text-gray-500">画面下の「再同期」からデータを取り込んでください</p>
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
  const [genreFilter, setGenreFilter] = useState<string[]>(loadQuizGenreFilter)
  // 部署(team)はAlgoliaに無いためNotionから直読み
  const { teamHits } = useTeamNotionHits('quiz', hasTeam)

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
  // Algolia由来の個人hits + Notion由来の部署hits を結合（objectIDで重複排除）
  const personalAndTeam = useMemo(() => {
    const seen = new Set<string>()
    const out: Hit[] = []
    for (const h of personalHits) { if (!seen.has(h.objectID)) { out.push(h); seen.add(h.objectID) } }
    for (const h of teamHits) { if (!seen.has(h.objectID)) { out.push(h); seen.add(h.objectID) } }
    return out
  }, [personalHits, teamHits])
  const mergedHits = useMemo(() => mergeHitsByOwnerFilter(personalAndTeam, subHits, ownerFilter), [ownerFilter, personalAndTeam, subHits])

  const quizCandidates = useMemo(() => mergedHits.filter((h) => {
    const summaryText = ((h.aiSummary || '') + (h.summary || '')).trim()
    const hasSummary = summaryText.length >= 10
    const lvl = h.knowledgeLevel || ''
    const isKnowledge = lvl.includes('💡') || lvl.includes('ナレッジ') || lvl.toLowerCase().includes('knowledge')
    const titleStr = (h.title || '').trim()
    const titleIsCQ = titleStr.startsWith('❓') || titleStr.includes('CQ：') || titleStr.includes('CQ:')
    return hasSummary && isKnowledge && !titleIsCQ
  }), [mergedHits])

  // クイズ候補から選べるジャンル一覧（ownerFilterに追従）
  const availableGenres = useMemo(() => collectQuizGenres(quizCandidates), [quizCandidates])
  // 選択ジャンル（OR）で絞り込んだ出題候補
  const filteredCandidates = useMemo(() => filterByGenres(quizCandidates, genreFilter), [quizCandidates, genreFilter])

  const updateGenreFilter = (next: string[]) => {
    setGenreFilter(next)
    saveQuizGenreFilter(next)
  }

  const reshuffle = (source: Hit[]) => {
    // SRS順（まだ→未学習→覚えた）。各グループ内はシャッフル。
    setShuffled(weightedQuizOrder(source).slice(0, 20))
  }

  useEffect(() => {
    reshuffle(filteredCandidates)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredCandidates.length, genreFilter.join('|')])

  const hasAnyKnowledgeLevel = mergedHits.some((h) => h.knowledgeLevel && h.knowledgeLevel.trim())

  return (
    <>
      <Configure hitsPerPage={200} filters={quizPersonalFilter} />
      <PersonalHitsCollector onHits={setPersonalHits} />
      <div className="sticky top-[calc(120px+env(safe-area-inset-top))] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-2 pt-1 -mx-4 px-4 mb-2">
        <OwnerFilterTabs owner={ownerFilter} onChange={setOwnerFilter} hasTeam={hasTeam} hasSubscription={hasSubscription} />
      </div>
      {ownerFilter === 'subscription' && !hasSubscription ? (
        <SubscriptionPromoPanel />
      ) : quizCandidates.length === 0 ? (
        <div className="text-center py-14 px-4 space-y-4">
          <div className="flex justify-center text-gray-300 dark:text-gray-600"><Brain className="h-12 w-12" /></div>
          <div>
            <p className="text-gray-600 dark:text-gray-300 font-semibold text-base mb-1">クイズがありません</p>
            <p className="text-sm text-gray-400 dark:text-gray-500">知識レベルを「💡 ナレッジ」に設定し、要約を入れるとここに出題されます</p>
          </div>
          {!hasAnyKnowledgeLevel && (
            <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 text-left max-w-sm mx-auto space-y-2">
              <p className="text-xs font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1.5"><Lightbulb className="h-4 w-4 shrink-0" />クイズの使い方</p>
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
        <>
          <QuizGenreFilter allGenres={availableGenres} selected={genreFilter} onChange={updateGenreFilter} />
          {filteredCandidates.length === 0 ? (
            <div className="text-center py-12 px-4 space-y-3">
              <div className="flex justify-center text-gray-300 dark:text-gray-600"><Search className="h-10 w-10" /></div>
              <p className="text-sm text-gray-500 dark:text-gray-400">選択中のジャンルに出題できる問題がありません</p>
              <button
                onClick={() => updateGenreFilter([])}
                className="text-xs text-brand-500 hover:text-brand-700 dark:text-brand-400 font-medium border border-brand-200 dark:border-brand-800 rounded-full px-3 py-1"
              >
                ジャンルフィルターを解除
              </button>
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-gray-400 dark:text-gray-500">タイトルを見て内容を思い出してみましょう</p>
                <button
                  onClick={() => reshuffle(filteredCandidates)}
                  className="text-xs text-brand-500 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 font-medium"
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
      )}
    </>
  )
}

// サブスク未設定時に「プレミアム」タブを選択した際の案内パネル
function SubscriptionPromoPanel() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const mode = usePremiumPaymentMode()
  const { user } = useAuth()

  const handleCheckout = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/premium/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // ログイン中なら user_id を渡して契約をアカウントに紐付ける（端末またぎ解決）。
        body: JSON.stringify({ userId: user?.id }),
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
    <div className="mt-4 bg-gradient-to-br from-purple-50 to-brand-50 dark:from-purple-900/20 dark:to-brand-900/20 border border-purple-200 dark:border-purple-700 rounded-2xl p-6 text-center space-y-4">
      <PremiumValueProps />

      {error && (
        <p className="text-xs text-red-500 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">{error}</p>
      )}

      {/* 価格 */}
      <div className="space-y-0.5">
        <p className="inline-flex items-center gap-1 text-xs font-bold text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/40 rounded-full px-2.5 py-0.5 mb-1">
          <Gift className="h-3 w-3 shrink-0" />最初の1週間は無料
        </p>
        <p className="text-2xl font-bold text-purple-700 dark:text-purple-300">
          月額980円<span className="text-sm font-medium text-gray-500 dark:text-gray-400">（税込）</span>
        </p>
        <p className="text-xs text-gray-400 dark:text-gray-500">無料トライアル後に課金開始・いつでも解約できます</p>
      </div>

      {mode?.testMode && <div className="text-left"><TestModeNotice /></div>}

      <button
        onClick={handleCheckout}
        disabled={loading}
        className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white font-semibold rounded-xl px-6 py-3 text-sm transition-colors flex items-center justify-center gap-2"
      >
        {loading ? <><Spinner className="h-4 w-4" />読み込み中...</> : <><Star className="h-4 w-4" />1週間無料で試す<ArrowRight className="h-4 w-4" /></>}
      </button>
      <p className="text-[11px] text-gray-400 dark:text-gray-500">
        トライアル期間中は無料。終了後に月額料金980円（税込）が課金されます。いつでも解約できます。
      </p>
      <p className="text-xs text-gray-400 dark:text-gray-500">
        既に会員の方は設定画面から「プレミアムDB」セクションで登録を確認してください
      </p>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed border-t border-gray-100 dark:border-gray-700 pt-2 mt-1">
        ※ 掲載内容は学習・参考を目的とした情報で、正確性・完全性・最新性を保証するものではありません。エビデンスは時期や状況により変化します。臨床判断は必ず最新の一次資料・ガイドライン等をご確認のうえ、ご自身の責任で行ってください。詳しくは
        <a href="/terms" className="text-brand-600 dark:text-brand-400 hover:underline">免責事項・利用規約</a>
        をご覧ください。
      </p>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 flex flex-wrap gap-x-3 gap-y-1 justify-center">
        <a href="/legal" className="text-brand-600 dark:text-brand-400 hover:underline">特定商取引法に基づく表記</a>
        <a href="/privacy" className="text-brand-600 dark:text-brand-400 hover:underline">プライバシーポリシー</a>
      </p>
    </div>
  )
}

// 検索ゼロ件のとき、その疑問をそのままCQとして残す静かな導線。
// 「検索したのに無かった」＝疑問が生まれた瞬間なので、ここが最短の入口になる。
function CqCaptureSuggestion({ query }: { query: string }) {
  const openCq = useCqCapture()
  if (!openCq || !query.trim()) return null
  return (
    <button
      type="button"
      onClick={() => openCq(query.trim())}
      className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl border border-brand-200 dark:border-brand-700 bg-brand-50 dark:bg-brand-900/30 text-sm font-semibold text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors"
    >
      この疑問をCQとして残す
    </button>
  )
}

// マージ済みhitsを表示する検索結果コンポーネント
function MergedSearchResults({ personalHits, ownerFilter, query }: {
  personalHits: Hit[]
  ownerFilter: OwnerFilter
  query: string
}) {
  const ctx = useSubscriptionHits()
  const subHits = ctx?.hits || []

  const merged = mergeHitsByOwnerFilter(personalHits, subHits, ownerFilter)

  if (merged.length === 0) {
    if (!query) {
      return (
        <div className="text-center py-14 px-4">
          <div className="mb-4 flex justify-center text-gray-300 dark:text-gray-600"><Inbox className="h-12 w-12" /></div>
          <p className="text-gray-600 dark:text-gray-300 font-semibold text-base mb-1">データがありません</p>
          <p className="text-sm text-gray-400 dark:text-gray-500 mb-6">
            まず画面下の「データを再同期する」から同期を行ってください
          </p>
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
        <CqCaptureSuggestion query={query} />
      </div>
    )
  }

  return (
    <div>
      <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">{merged.length}件</p>
      <div className="space-y-3">
        {merged.map((hit, i) => (
          // 先頭数件だけ時間差で登場（検索が「返ってきた」手応え。以降は遅延なし）
          <div key={hit.objectID} className="animate-fade-in-up" style={{ animationDelay: `${Math.min(i, 6) * 45}ms` }}>
            <ResultCard hit={hit} />
          </div>
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

// 履歴ゼロ時の白紙防止＋「何を検索できるか」の提示。両モード（Algolia/Notion）で共有。
const EXAMPLE_KEYWORDS = ['敗血症', '人工呼吸', '抗菌薬', '電解質', '鎮静']
function ExampleKeywords({ onPick }: { onPick: (kw: string) => void }) {
  return (
    <div className="text-center py-10">
      <p className="text-sm text-gray-400 dark:text-gray-500 mb-3">例えばこんなキーワードで検索できます</p>
      <div className="flex flex-wrap justify-center gap-2">
        {EXAMPLE_KEYWORDS.map((kw) => (
          <button
            key={kw}
            onClick={() => onPick(kw)}
            className="px-3 py-1.5 rounded-full bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 text-sm text-gray-600 dark:text-gray-300 hover:ring-brand-300 hover:text-brand-600 dark:hover:text-brand-400 transition-colors"
          >
            {kw}
          </button>
        ))}
      </div>
      <p className="text-xs text-gray-300 dark:text-gray-600 mt-4">タイトルだけでなく要約・キーワードからもヒットします</p>
    </div>
  )
}

function SearchTab({ hasTeam, hasSubscription }: { hasTeam: boolean; hasSubscription: boolean }) {
  const { refine, query } = useSearchBox()
  const { history, addHistory, clearHistory } = useSearchHistory()
  const [hasSearched, setHasSearched] = useState(false)
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')
  const [personalHits, setPersonalHits] = useState<Hit[]>([])
  const ctx = useSubscriptionHits()
  // 部署(team)はAlgoliaに無いためNotionから直読み（キーワードに追従）
  const { teamHits, searchTeam } = useTeamNotionHits('search', hasTeam)

  // Algolia検索クエリに合わせて部署もNotion検索
  useEffect(() => {
    searchTeam(query)
  }, [query, searchTeam])

  // Algolia個人hits + Notion部署hits を結合（objectIDで重複排除）
  const personalAndTeam = useMemo(() => {
    const seen = new Set<string>()
    const out: Hit[] = []
    for (const h of personalHits) { if (!seen.has(h.objectID)) { out.push(h); seen.add(h.objectID) } }
    for (const h of teamHits) { if (!seen.has(h.objectID)) { out.push(h); seen.add(h.objectID) } }
    return out
  }, [personalHits, teamHits])

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
      <div className="sticky top-[calc(120px+env(safe-area-inset-top))] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-3 pt-1 -mx-4 px-4">
        <SearchBox onSubmit={(q) => { addHistory(q); setHasSearched(true) }} />
        <OwnerFilterTabs
          owner={ownerFilter}
          onChange={setOwnerFilter}
          hasTeam={hasTeam}
          hasSubscription={hasSubscription}
        />
      </div>
      {!query && !hasSearched ? (
        <>
          <SearchHistoryList
            history={history}
            onSelect={handleSelect}
            onClear={clearHistory}
          />
          {/* 履歴ゼロ（初回）の白紙防止。パワーモードでも例示キーワードを出す
              （以前はNotionモードだけにあり、パワーモードでは何も出なかった）。 */}
          {history.length === 0 && (
            <ExampleKeywords onPick={(kw) => { addHistory(kw); handleSelect(kw) }} />
          )}
        </>
      ) : ownerFilter === 'subscription' && !hasSubscription ? (
        <SubscriptionPromoPanel />
      ) : (
        <MergedSearchResults
          personalHits={personalAndTeam}
          ownerFilter={ownerFilter}
          query={query}
        />
      )}
    </>
  )
}

// ============================================================
// Notionモード用コンポーネント（新規）
// ============================================================

// シンプルモードの体感ラグ対策: 同じ問い合わせの結果をセッション内でメモリ保持し、
// タブ再訪・再検索のときは即座に前回結果を出す（stale-while-revalidate）。
// 表示後に裏で最新を取り直して差し替えるので、鮮度も保たれる。
// localStorageではなくメモリなので、セッションをまたいだ古いデータの残留は無い。
const notionResultCache = new Map<string, Hit[]>()
const NOTION_CACHE_MAX = 40
function setNotionCache(key: string, records: Hit[]) {
  notionResultCache.delete(key)
  notionResultCache.set(key, records)
  // 上限超過は古いものから捨てる（挿入順＝Mapの反復順）。
  while (notionResultCache.size > NOTION_CACHE_MAX) {
    const oldest = notionResultCache.keys().next().value
    if (oldest === undefined) break
    notionResultCache.delete(oldest)
  }
}

function useNotionSearch(mode: Tab) {
  const settings = getSettings()
  const [records, setRecords] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  // キャッシュを表示しつつ裏で最新取得中（大きなスピナーは出さず、控えめな表示に使える）
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 最新リクエストのみ反映するための世代カウンタ（古いレスポンスの上書きを防ぐ）
  const reqIdRef = useRef(0)

  const fetch = useCallback(async (keyword = '', extra: Record<string, unknown> = {}) => {
    if (!settings) return
    // プレミアム専用ユーザー（個人Notion DB未設定）では個人検索をスキップする。
    // 個人Notionが無いことを致命的エラーにすると、新着/文献/クイズが
    // 「notionToken と notionMedicalDbId が必要です」で埋まり、サブスク結果まで隠れてしまう。
    // ここでは個人records=0・error無しで正常終了させ、サブスク結果のみ表示できるようにする
    // （ジャンルタブと同じ耐性に統一）。
    if (!settings.notionToken || !settings.notionMedicalDbId) {
      reqIdRef.current++
      setRecords([])
      setError('')
      setLoading(false)
      return
    }
    const reqId = ++reqIdRef.current
    setError('')

    // 問い合わせを一意化するキー（DB・チーム・キーワード・モード等が同じなら同一結果）。
    const cacheKey = JSON.stringify({
      m: settings.notionMedicalDbId,
      r: settings.notionReferenceDbId || '',
      man: settings.notionManualDbId || '',
      t: settings.teamNotionMedicalDbId || '',
      tr: settings.teamNotionReferenceDbId || '',
      tm: settings.teamNotionManualDbId || '',
      keyword,
      ...extra,
    })
    // キャッシュがあれば即表示（大きなスピナーは出さず裏で更新）。無ければ通常のローディング。
    const cached = notionResultCache.get(cacheKey)
    if (cached) {
      setRecords(cached)
      setLoading(false)
      setRefreshing(true)
    } else {
      setLoading(true)
      setRefreshing(false)
    }

    try {
      const res = await window.fetch('/api/notion/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notionToken: settings.notionToken,
          notionMedicalDbId: settings.notionMedicalDbId,
          notionReferenceDbId: settings.notionReferenceDbId || undefined,
          notionManualDbId: settings.notionManualDbId || undefined,
          teamNotionToken: settings.teamNotionToken || undefined,
          teamNotionMedicalDbId: settings.teamNotionMedicalDbId || undefined,
          teamNotionReferenceDbId: settings.teamNotionReferenceDbId || undefined,
          teamNotionManualDbId: settings.teamNotionManualDbId || undefined,
          teamLabel: settings.teamLabel || undefined,
          keyword,
          ...extra,
        }),
      })
      const data = await res.json()
      // このレスポンスが最新リクエストでなければ破棄（race condition対策）
      if (reqId !== reqIdRef.current) return
      if (!res.ok) throw new Error(data.error || '検索に失敗しました')
      const fresh = data.records as Hit[]
      setNotionCache(cacheKey, fresh)
      setRecords(fresh)
    } catch (err) {
      // キャッシュ表示中の裏更新が失敗しても、既に出ている結果は消さない（エラーも出さない）。
      if (reqId === reqIdRef.current && !cached) setError(err instanceof Error ? err.message : '検索エラー')
    } finally {
      if (reqId === reqIdRef.current) { setLoading(false); setRefreshing(false) }
    }
  }, [settings?.notionToken, settings?.notionMedicalDbId, settings?.notionManualDbId, settings?.teamNotionToken, settings?.teamNotionMedicalDbId, settings?.teamNotionManualDbId])

  // 新着・クイズ・ジャンルは初回マウント時に自動取得（fetchはsettings変更時に再取得するため依存に含める）
  useEffect(() => {
    if (mode === 'recent') fetch('', { mode: 'recent' })
    if (mode === 'quiz') fetch('', { mode: 'quiz' })
    if (mode === 'browse') fetch('', { mode: 'browse', pageSize: 200 })
    if (mode === 'reference') fetch('', { mode: 'recent' }) // referenceはrecentと共用でフィルタ
    if (mode === 'manual') fetch('', { mode: 'manual', pageSize: 100 }) // マニュアル：新着（最終更新日時順）を初期表示
  }, [mode, fetch])

  const search = useCallback((keyword: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!keyword.trim()) {
      // マニュアルタブはキーワード未入力時に新着一覧を表示する（検索タブと違い一覧が主役）
      if (mode === 'manual') {
        reqIdRef.current++
        fetch('', { mode: 'manual', pageSize: 100 })
        return
      }
      // 入力クリア時は進行中レスポンスを無効化して即空に
      reqIdRef.current++
      setRecords([])
      return
    }
    debounceRef.current = setTimeout(() => {
      // 検索実行の計測（デバウンス後＝実際にAPIへ飛ぶ回数と一致）。
      track('search_exec', { engine: 'notion', mode })
      bumpSearchCount()
      fetch(keyword, { mode: mode === 'manual' ? 'manual' : 'search' })
    }, 600)
  }, [fetch, mode])

  return { records, loading, refreshing, error, search, refetch: fetch }
}

// ============================================================
// パワーモード用：部署(team)データをNotionから直接取得するフック
// ------------------------------------------------------------
// 部署DBはAlgoliaで管理しない方針のため、パワーモードでも部署分だけは
// /api/notion/search からNotion直読みする。返却recordsのうち owner==='team'
// だけを採用（個人/サブスクはAlgolia側で取得するため破棄）。
// ============================================================
function useTeamNotionHits(mode: Tab, enabled: boolean) {
  const settings = getSettings()
  const [teamHits, setTeamHits] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 最新リクエストのみ反映するための世代カウンタ（古いレスポンスの上書きを防ぐ）
  const reqIdRef = useRef(0)

  const fetchTeam = useCallback(async (keyword = '', extra: Record<string, unknown> = {}) => {
    if (!settings) return
    if (!settings.teamNotionToken || !settings.teamNotionMedicalDbId) { setTeamHits([]); return }
    const reqId = ++reqIdRef.current
    setLoading(true)
    try {
      const res = await window.fetch('/api/notion/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // 部署DBのみを取得（teamOnly）。primaryは必須項目なので部署クレデンシャルを流用するが、
          // teamOnly=true によりサーバは個人(primary)側をクエリせず、部署DBの二重クエリを避ける。
          notionToken: settings.teamNotionToken,
          notionMedicalDbId: settings.teamNotionMedicalDbId,
          teamNotionToken: settings.teamNotionToken,
          teamNotionMedicalDbId: settings.teamNotionMedicalDbId,
          teamNotionReferenceDbId: settings.teamNotionReferenceDbId || undefined,
          teamLabel: settings.teamLabel || undefined,
          teamOnly: true,
          keyword,
          ...extra,
        }),
      })
      const data = await res.json()
      // このレスポンスが最新リクエストでなければ破棄（race condition対策）
      if (reqId !== reqIdRef.current) return
      if (!res.ok) { setTeamHits([]); return }
      const all = (data.records as Hit[]) || []
      setTeamHits(all.filter((h) => h.owner === 'team'))
    } catch {
      if (reqId === reqIdRef.current) setTeamHits([])
    } finally {
      if (reqId === reqIdRef.current) setLoading(false)
    }
  }, [settings?.teamNotionToken, settings?.teamNotionMedicalDbId, settings?.teamNotionReferenceDbId])

  // 検索以外は初回マウント時に自動取得
  useEffect(() => {
    if (!enabled) { setTeamHits([]); return }
    if (mode === 'recent') fetchTeam('', { mode: 'recent' })
    if (mode === 'reference') fetchTeam('', { mode: 'recent' })
    if (mode === 'quiz') fetchTeam('', { mode: 'quiz' })
    if (mode === 'browse') fetchTeam('', { mode: 'browse', pageSize: 200 })
  }, [mode, enabled, fetchTeam])

  // 検索タブ用：キーワードでデバウンス検索
  const searchTeam = useCallback((keyword: string) => {
    if (!enabled) return
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!keyword.trim()) {
      // 入力クリア時は進行中レスポンスを無効化して即空に
      reqIdRef.current++
      setTeamHits([])
      return
    }
    debounceRef.current = setTimeout(() => {
      fetchTeam(keyword, { mode: 'search' })
    }, 600)
  }, [fetchTeam, enabled])

  return { teamHits, loading, searchTeam }
}

// Notionモード：検索タブ
function NotionSearchTab({ hasTeam, hasSubscription }: { hasTeam: boolean; hasSubscription: boolean }) {
  const { records, loading, refreshing, error, search } = useNotionSearch('search')
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

  // 履歴保存はEnterで検索を確定したときのみ（入力途中の文字列は残さない）
  const composingRef = useRef(false)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !composingRef.current && !e.nativeEvent.isComposing && query.trim()) {
      addHistory(query.trim())
    }
  }

  return (
    <>
      <div className="sticky top-[calc(120px+env(safe-area-inset-top))] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-3 pt-1 -mx-4 px-4">
        <input
          type="search"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          placeholder="キーワードで検索..."
          className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 mb-2"
        />
        <OwnerFilterTabs owner={ownerFilter} onChange={setOwnerFilter} hasTeam={hasTeam} hasSubscription={hasSubscription} />
      </div>
      {loading && <SkeletonCards label="Notionを検索中..." />}
      {/* キャッシュ結果を表示中に裏で最新取得しているときの控えめな表示（一覧は消さない） */}
      {refreshing && !loading && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 text-center -mt-1 mb-2"><Spinner className="w-3.5 h-3.5 mr-1" />最新の内容を確認中...</p>
      )}
      {error && <SearchErrorNotice error={error} />}
      {ownerFilter === 'subscription' && !hasSubscription ? (
        <SubscriptionPromoPanel />
      ) : !query && !hasSearched ? (
        <>
          <SearchHistoryList history={history} onSelect={(q) => { addHistory(q); handleChange(q) }} onClear={clearHistory} />
          {/* 履歴ゼロ（初回）の白紙画面を防ぐ: 例示キーワードをタップで即検索できるようにする */}
          {history.length === 0 && (
            <ExampleKeywords onPick={(kw) => { addHistory(kw); handleChange(kw) }} />
          )}
        </>
      ) : !loading && !error && merged.length === 0 && query ? (
        <EmptyNotice Icon={Search} title={`「${query}」が見つかりませんでした`} hint="別のキーワードで試してください">
          <div className="mt-5"><CqCaptureSuggestion query={query} /></div>
        </EmptyNotice>
      ) : (
        <>
          {query && !error && <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">{merged.length}件</p>}
          <div className="space-y-3">
            {merged.map((hit, i) => (
              <div key={hit.objectID} className="animate-fade-in-up" style={{ animationDelay: `${Math.min(i, 6) * 45}ms` }}>
                <ResultCard hit={hit} />
              </div>
            ))}
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
    <div className="sticky top-[calc(120px+env(safe-area-inset-top))] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-2 pt-1 -mx-4 px-4 mb-2">
      <OwnerFilterTabs owner={ownerFilter} onChange={setOwnerFilter} hasTeam={hasTeam} hasSubscription={hasSubscription} />
    </div>
  )

  if (ownerFilter === 'subscription' && !hasSubscription) return <>{ownerTabs}<SubscriptionPromoPanel /></>
  if (loading) return <>{ownerTabs}<SkeletonCards /></>
  if (error) return <>{ownerTabs}<div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-3 text-sm text-red-600">{error}</div></>
  if (merged.length === 0) return (
    <>
      {ownerTabs}
      <div className="text-center py-14 px-4">
        <div className="mb-4 flex justify-center text-gray-300 dark:text-gray-600"><Inbox className="h-12 w-12" /></div>
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
  const [genreFilter, setGenreFilter] = useState<string[]>(loadQuizGenreFilter)

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

  // クイズ候補から選べるジャンル一覧（ownerFilterに追従）
  const availableGenres = useMemo(() => collectQuizGenres(quizCandidates), [quizCandidates])
  // 選択ジャンル（OR）で絞り込んだ出題候補
  const filteredCandidates = useMemo(() => filterByGenres(quizCandidates, genreFilter), [quizCandidates, genreFilter])

  const updateGenreFilter = (next: string[]) => {
    setGenreFilter(next)
    saveQuizGenreFilter(next)
  }

  const reshuffle = (source: Hit[]) => {
    // SRS順（まだ→未学習→覚えた）。各グループ内はシャッフル。
    setShuffled(weightedQuizOrder(source).slice(0, 20))
  }

  useEffect(() => {
    reshuffle(filteredCandidates)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredCandidates.length, genreFilter.join('|')])

  const ownerTabs = (
    <div className="sticky top-[calc(120px+env(safe-area-inset-top))] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-2 pt-1 -mx-4 px-4 mb-2">
      <OwnerFilterTabs owner={ownerFilter} onChange={setOwnerFilter} hasTeam={hasTeam} hasSubscription={hasSubscription} />
    </div>
  )

  const genreChips = (
    <QuizGenreFilter allGenres={availableGenres} selected={genreFilter} onChange={updateGenreFilter} />
  )

  if (ownerFilter === 'subscription' && !hasSubscription) return <>{ownerTabs}<SubscriptionPromoPanel /></>
  if (loading) return <>{ownerTabs}<SkeletonCards /></>
  if (error) return <>{ownerTabs}<div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-3 text-sm text-red-600">{error}</div></>
  if (quizCandidates.length === 0) return (
    <>
      {ownerTabs}
      <div className="text-center py-14 px-4">
        <div className="mb-4 flex justify-center text-gray-300 dark:text-gray-600"><Brain className="h-12 w-12" /></div>
        <p className="text-gray-600 dark:text-gray-300 font-semibold">クイズがありません</p>
        <p className="text-sm text-gray-400 mt-1">知識レベルを「💡 ナレッジ」にして要約を入れるとクイズに出題されます</p>
      </div>
    </>
  )

  return (
    <>
    {ownerTabs}
    {genreChips}
    {filteredCandidates.length === 0 ? (
      <div className="text-center py-12 px-4 space-y-3">
        <div className="flex justify-center text-gray-300 dark:text-gray-600"><Search className="h-10 w-10" /></div>
        <p className="text-sm text-gray-500 dark:text-gray-400">選択中のジャンルに出題できる問題がありません</p>
        <button
          onClick={() => updateGenreFilter([])}
          className="text-xs text-brand-500 hover:text-brand-700 dark:text-brand-400 font-medium border border-brand-200 dark:border-brand-800 rounded-full px-3 py-1"
        >
          ジャンルフィルターを解除
        </button>
      </div>
    ) : (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-gray-400 dark:text-gray-500">タイトルを見て内容を思い出してみましょう</p>
        <button
          onClick={() => reshuffle(filteredCandidates)}
          className="text-xs text-brand-500 hover:text-brand-700 dark:text-brand-400 font-medium"
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
        // 参考文献のジャンルもボタン一覧に集計するため Reference DB も渡す。
        notionReferenceDbId: settings.notionReferenceDbId || undefined,
        teamNotionToken: settings.teamNotionToken || undefined,
        teamNotionMedicalDbId: settings.teamNotionMedicalDbId || undefined,
        teamNotionReferenceDbId: settings.teamNotionReferenceDbId || undefined,
        teamLabel: settings.teamLabel || undefined,
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
            // 参考文献もジャンルタブに表示するため Reference DB も渡す。
            notionReferenceDbId: settings.notionReferenceDbId || undefined,
            teamNotionToken: settings.teamNotionToken || undefined,
            teamNotionMedicalDbId: settings.teamNotionMedicalDbId || undefined,
            teamNotionReferenceDbId: settings.teamNotionReferenceDbId || undefined,
            teamLabel: settings.teamLabel || undefined,
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
      <div className="sticky top-[calc(120px+env(safe-area-inset-top))] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-2 pt-1 -mx-4 px-4 mb-2">
        <OwnerFilterTabs owner={ownerFilter} onChange={(v) => { setOwnerFilter(v); setSelectedGenre(null); setGenreRecords([]); setSubGenreHits([]) }} hasTeam={hasTeam} hasSubscription={hasSubscription} />
      </div>
      {ownerFilter === 'subscription' && !hasSubscription ? (
        <SubscriptionPromoPanel />
      ) : genresLoading ? (
        <div className="text-center py-8 text-gray-400"><Spinner className="w-4 h-4 mr-1.5" />ジャンルを読み込み中...</div>
      ) : genresError ? (
        <SearchErrorNotice error={genresError} />
      ) : sortedGenres.length === 0 ? (
        <div className="text-center py-14 px-4 space-y-4">
          <div className="flex justify-center text-gray-300 dark:text-gray-600"><FolderOpen className="h-12 w-12" /></div>
          <div>
            <p className="text-gray-600 dark:text-gray-300 font-semibold text-base mb-1">ジャンルがまだありません</p>
            <p className="text-sm text-gray-400 dark:text-gray-500">NotionのMedical DBで「ジャンル」プロパティにタグを付けると、ここに一覧が表示されます</p>
          </div>
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-4 text-left max-w-sm mx-auto space-y-2">
            <p className="text-xs font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1.5"><Lightbulb className="h-4 w-4 shrink-0" />ジャンルの付け方</p>
            <ol className="text-xs text-amber-700 dark:text-amber-400 space-y-1 list-decimal list-inside">
              <li>Notionで知識ページを開く</li>
              <li>「ジャンル」プロパティにタグを追加（例: 循環・呼吸・感染）</li>
              <li>アプリを開き直すと、ここにジャンル一覧が並びます</li>
            </ol>
          </div>
        </div>
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
              // 部署（チーム）にもこのジャンルがある場合の緑ドット。
              // 個人のみ／プレミアムのみ表示中は出さない（プレミアムの紫ドットと同じ思想）。
              const hasTeamDot = teamCount > 0 && ownerFilter !== 'personal' && ownerFilter !== 'subscription'
              const isActive = selectedGenre === genre
              const tone = genreChipTone(genre)
              return (
                <button
                  key={genre}
                  onClick={() => handleGenreSelect(genre)}
                  className={`text-left px-3 py-2 rounded-xl border text-sm font-medium transition-all flex items-center justify-between gap-2 hover:shadow-sm ${
                    isActive ? tone.active : tone.idle
                  }`}
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <span className="truncate">{displayGenreName(genre)}</span>
                    {hasTeamDot && (
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'bg-green-200' : 'bg-green-500'}`}
                        title="部署にもあります"
                        aria-label="部署にもあります"
                      />
                    )}
                    {hasSub && (
                      <span
                        className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${isActive ? 'bg-purple-200' : 'bg-purple-500'}`}
                        title="プレミアムにもあります"
                        aria-label="プレミアムにもあります"
                      />
                    )}
                  </span>
                  <span className={`text-xs shrink-0 ${isActive ? 'text-white/70' : 'opacity-50'}`}>{total}</span>
                </button>
              )
            })}
          </div>
          {sortedGenres.length > GENRE_SHOW_LIMIT && (
            <button
              onClick={() => setShowAll((v) => !v)}
              className="w-full text-xs text-gray-400 hover:text-brand-500 dark:text-gray-500 dark:hover:text-brand-400 py-2 transition-colors inline-flex items-center justify-center gap-1"
            >
              {showAll
                ? <><ChevronUp className="w-3.5 h-3.5" />折りたたむ</>
                : <><ChevronDown className="w-3.5 h-3.5" />すべて表示（残り {sortedGenres.length - GENRE_SHOW_LIMIT} 件）</>}
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
              解除
            </button>
          </div>
          {genreLoading ? (
            <SkeletonCards count={3} />
          ) : genreError ? (
            <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-3 text-sm text-red-600">{genreError}</div>
          ) : displayRecords.length === 0 ? (
            <div className="text-center py-8 text-gray-400"><p>このジャンルにはまだエントリがありません</p></div>
          ) : (
            <GenreHitsList hits={displayRecords} />
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

// マニュアルカード：種別バッジ・掲載日付きの軽量カード（ResultCardは医療/文献用なので別実装）
const MANUAL_TYPE_STYLE: Record<string, string> = {
  '📕 マニュアル': 'bg-brand-50 text-brand-700 dark:bg-brand-900/30 dark:text-brand-300',
  '📢 お知らせ': 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  '🔧 業務改善': 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
}
function ManualCard({ hit }: { hit: Hit }) {
  const [expanded, setExpanded] = useState(false)
  const displaySummary = hit.aiSummary || hit.summary || null
  const hasExpandable = !!displaySummary
  const typeStyle = hit.manualType ? (MANUAL_TYPE_STYLE[hit.manualType] || 'bg-gray-50 text-gray-600') : ''
  const ownerLabel = hit.owner === 'team' ? (hit.teamLabel || '部署') : null
  const publishedLabel = hit.publishedAt
    ? new Date(hit.publishedAt).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' })
    : ''
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 border-l-4 border-l-brand-400 overflow-hidden">
      <div className={`p-4 ${hasExpandable ? 'cursor-pointer' : ''}`} onClick={() => hasExpandable && setExpanded((v) => !v)}>
        <div className="flex items-start justify-between gap-2 mb-1">
          <h3 className="font-semibold text-gray-900 dark:text-white text-base leading-snug flex-1">{hit.title}</h3>
          <div className="flex items-center gap-1 shrink-0">
            {ownerLabel && (
              <span className="text-xs font-medium px-2 py-1 rounded-full bg-teal-50 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300">{ownerLabel}</span>
            )}
            {hit.manualType && (
              <span className={`text-xs font-medium px-2 py-1 rounded-full ${typeStyle}`}>{stripLeadingEmoji(hit.manualType)}</span>
            )}
            {hasExpandable && <span className="text-gray-300">{expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}</span>}
          </div>
        </div>
        {!expanded && (
          displaySummary
            ? <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2">{displaySummary}</p>
            : <p className="text-xs text-gray-400 dark:text-gray-500 italic">要約なし</p>
        )}
        {publishedLabel && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">掲載: {publishedLabel}</p>
        )}
      </div>
      {expanded && displaySummary && (
        <div className="px-4 pb-4 border-t border-gray-100 dark:border-gray-700 animate-fade-in-up">
          <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed pt-3 whitespace-pre-wrap">{displaySummary}</p>
          {hit.aiKeywords && <p className="text-xs text-gray-300 mt-3 leading-relaxed">{hit.aiKeywords}</p>}
          <div className="flex justify-end mt-3">
            <a href={hit.notionUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-800">
              Notionで開く
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}
      {!hasExpandable && (
        <a href={hit.notionUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 px-4 pb-3 text-xs text-brand-500 hover:text-brand-700">Notionで開く<ExternalLink className="w-3.5 h-3.5" /></a>
      )}
    </div>
  )
}

// Notionモード：📋マニュアルタブ（マニュアル・お知らせ・業務改善）
// 検索＋新着一覧（最終更新日時順＝改訂が上に来る）＋種別フィルタ。
function NotionManualTab() {
  const { records, loading, error, search } = useNotionSearch('manual')
  const [query, setQuery] = useState('')
  // 種別フィルタ：''=すべて / 各種別名
  const [typeFilter, setTypeFilter] = useState('')

  const filtered = useMemo(() => {
    if (!typeFilter) return records
    return records.filter((r) => (r.manualType || '') === typeFilter)
  }, [records, typeFilter])

  const TYPE_TABS = ['', '📕 マニュアル', '📢 お知らせ', '🔧 業務改善']
  const composingRef = useRef(false)

  return (
    <>
      <div className="sticky top-[calc(120px+env(safe-area-inset-top))] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-3 pt-1 -mx-4 px-4">
        <input
          type="search"
          value={query}
          onChange={(e) => { setQuery(e.target.value); search(e.target.value) }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => { composingRef.current = false }}
          placeholder="マニュアル・お知らせを検索..."
          className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 mb-2"
        />
        <div className="flex gap-1 overflow-x-auto">
          {TYPE_TABS.map((t) => (
            <button
              key={t || 'all'}
              onClick={() => setTypeFilter(t)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all whitespace-nowrap ${
                typeFilter === t
                  ? 'bg-brand-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {t ? stripLeadingEmoji(t) : 'すべて'}
            </button>
          ))}
        </div>
      </div>
      {loading && <SkeletonCards />}
      {error && <SearchErrorNotice error={error} />}
      {!loading && !error && filtered.length === 0 ? (
        <EmptyNotice
          Icon={ClipboardList}
          title={query ? `「${query}」が見つかりませんでした` : 'マニュアルがありません'}
          hint={query ? '別のキーワードで試してください' : 'マニュアルDBにデータを追加してください'}
        />
      ) : (
        <>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">{filtered.length}件{query ? '' : '（新着順）'}</p>
          <div className="space-y-3">
            {filtered.map((hit) => <ManualCard key={hit.objectID} hit={hit} />)}
          </div>
        </>
      )}
    </>
  )
}

// Notionモード：参考文献タブ
function NotionReferenceTab({ hasTeam, hasSubscription }: { hasTeam: boolean; hasSubscription: boolean }) {
  const { records, loading, error } = useNotionSearch('reference')
  const [sort, setSort] = useState<RefSort>('year_desc')
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')
  const [query, setQuery] = useState('')
  const [refYear, setRefYear] = useState<string | null>(null)
  const [refGenre, setRefGenre] = useState<string | null>(null)
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

  // キーワード・年・ジャンルで絞り込み（取得済みレコードに対するクライアント側フィルタ）
  const filtered = useMemo(
    () => filterRefHits(merged, query, refYear, refGenre),
    [merged, query, refYear, refGenre],
  )

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
    <div className="sticky top-[calc(120px+env(safe-area-inset-top))] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-3 pt-1 -mx-4 px-4">
      <div className="flex items-center gap-2 mb-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="文献を絞り込み..."
          className="flex-1 border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
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
      {/* 年代・ジャンルチップはsticky制御バー内に置く（一覧の途中に非stickyで挟むと
          読み込み後にチップ2行が現れて一覧が下にズレるため。バー内なら起点が動かない）。 */}
      {!(ownerFilter === 'subscription' && !hasSubscription) && (
        <div className="mt-2">
          <RefBrowseChips hits={merged} year={refYear} onYear={setRefYear} genre={refGenre} onGenre={setRefGenre} />
        </div>
      )}
    </div>
  )

  const isFiltering = !!(query.trim() || refYear || refGenre)

  if (ownerFilter === 'subscription' && !hasSubscription) return <>{ownerTabs}<SubscriptionPromoPanel /></>
  if (loading) return <>{ownerTabs}<SkeletonCards /></>
  if (error) return <>{ownerTabs}<div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-3 text-sm text-red-600">{error}</div></>

  return (
    <>
      {ownerTabs}
      {sorted.length === 0 ? (
        isFiltering
          ? <EmptyNotice Icon={BookMarked} title="この条件の文献はありません" hint="絞り込みを変えて試してください" />
          : <EmptyNotice Icon={BookMarked} title="参考文献DBが設定されていないか、データがありません" />
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

// 決済環境の状態（テストモードか）を取得する共通フック。
// Stripe Secret Key が sk_test_ のときだけ testMode=true。ライブ化すると自動で false。
function usePremiumPaymentMode() {
  const [mode, setMode] = useState<{ enabled: boolean; testMode: boolean; portalUrl: string } | null>(null)
  useEffect(() => {
    let active = true
    fetch('/api/premium/checkout')
      .then((r) => r.json())
      .then((d) => { if (active) setMode({ enabled: !!d.enabled, testMode: !!d.testMode, portalUrl: typeof d.portalUrl === 'string' ? d.portalUrl : '' }) })
      .catch(() => { if (active) setMode(null) })
    return () => { active = false }
  }, [])
  return mode
}

// 登録済みユーザー向けの解約案内。
// STRIPE_PORTAL_URL があれば Stripe カスタマーポータルへのリンク、
// なければメール問い合わせにフォールバックする（壊れたリンクを出さない）。
function PremiumCancelInfo({ trial = false }: { trial?: boolean }) {
  const mode = usePremiumPaymentMode()
  const portalUrl = mode?.portalUrl || ''
  // 衝動的な解約を防ぐため、ボタン → 確認ダイアログ（ワンクッション）→ ポータル の順にする。
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="border-t border-gray-100 dark:border-gray-700 pt-3 space-y-1.5">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
        {trial ? '解約・契約を管理するには' : '解約するには'}
      </p>
      <p className="text-xs text-gray-400 dark:text-gray-500">
        {trial
          ? 'トライアル期間中に解約すれば料金はかかりません。カード未登録（コード）でのお試しは、期限が来れば自動で終了します。'
          : '解約後も次回請求日まで利用できます。'}
      </p>
      {portalUrl ? (
        !confirming ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-block text-xs text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 underline"
          >
            解約手続きへ進む
          </button>
        ) : (
          <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-3 space-y-2">
            <p className="text-xs font-medium text-gray-700 dark:text-gray-200">本当に解約しますか？</p>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
              解約すると、現役集中治療医が更新するプレミアムのナレッジ・参考文献が
              <strong>次回請求日以降は閲覧できなくなります</strong>。
              次回請求日までは引き続きご利用いただけます。
            </p>
            <div className="flex items-center gap-2 pt-0.5">
              <a
                href={portalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-red-500 hover:text-red-600 dark:text-red-400 underline"
              >
                解約手続きを続ける（Stripe） →
              </a>
              <button
                type="button"
                onClick={() => setConfirming(false)}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                やめる
              </button>
            </div>
          </div>
        )
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          解約をご希望の場合は{' '}
          <a href="mailto:drnode0@gmail.com?subject=プレミアム解約のご依頼" className="text-brand-500 hover:text-brand-700 dark:text-brand-400 underline">
            drnode0@gmail.com
          </a>{' '}
          までご連絡ください。
        </p>
      )}
      {mode?.testMode && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          体験用のテストモードです。実際の課金・解約は発生しません。
        </p>
      )}
    </div>
  )
}

// note等に記載したクーポンコードを入力して、カード不要でトライアルを開始するUI。
// サーバー(/api/premium/trial)がコードを検証し、正しければ Search-Only キーと期限を返す。
function PremiumTrialRedeem({ onActivated }: { onActivated?: () => void }) {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleRedeem = async () => {
    if (!code.trim()) { setError('コードを入力してください'); return }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/premium/trial', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      })
      const data = await res.json()
      if (!res.ok || !data.ok || !data.algolia) {
        // 招待コード（無期限comp）はログイン必須。未ログインなら案内する。
        if (res.status === 401 || data.error === 'login_required') {
          setError('このコードのご利用にはログインが必要です。右上のアカウントからログインのうえ、もう一度お試しください。')
          return
        }
        setError(data.error || 'コードを確認できませんでした')
        return
      }
      // 既存設定にトライアルのキー＋期限を書き込む（決済フローと同じ書き込み方）。
      const defaultSettings = {
        searchMode: 'algolia' as const,
        notionToken: '', notionMedicalDbId: '', notionReferenceDbId: '', notionManualDbId: '',
        algoliaAppId: '', algoliaSearchKey: '', algoliaAdminKey: '', algoliaIndex: 'medical_knowledge',
        teamLabel: '', teamNotionToken: '', teamNotionMedicalDbId: '', teamNotionReferenceDbId: '', teamNotionManualDbId: '',
        subscriptionSearchKey: '', subscriptionAppId: '', subscriptionIndex: '',
        propSummary: '', propKeywords: '', propKnowledgeLevel: '', propGenre: '',
      }
      const current = getSettings() || defaultSettings
      saveSettings({
        ...current,
        subscriptionAppId: data.algolia.appId,
        subscriptionSearchKey: data.algolia.searchKey,
        subscriptionIndex: data.algolia.index,
        // comp（招待コード・無期限）は期限を書かない＝期限切れ扱いされない。
        // 期限付きトライアル（trial）/ 通常トライアルは期限を保存し、この端末でも失効させる。
        subscriptionTrialEndsAt: data.trialEndsAt ?? undefined,
      })
      // 「使用済み」記録は端末ローカル保存の通常トライアル(A)のみ（同端末での再入力をカジュアルに防ぐ）。
      // comp（無期限招待）・期限付きトライアル(C)はサーバー管理＝端末またぎ復元されるため記録しない。
      if (!data.comp && !data.trial) markTrialUsed()
      if (onActivated) onActivated()
      setTimeout(() => window.location.reload(), 1200)
    } catch {
      setError('ネットワークエラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  // この端末で既にトライアルを使った場合は、再入力欄を出さず有料登録へ誘導する
  if (hasUsedTrial()) {
    return (
      <div className="bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-3 space-y-1">
        <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 flex items-center gap-1.5"><Gift className="h-4 w-4 shrink-0 text-purple-500" />トライアルコードによる無料トライアルは利用済みです</p>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
          この端末ではトライアルコードによる無料トライアルをご利用済みです。引き続きご利用いただくには、下の有料登録（月額980円・税込／最初の1週間無料）へお進みください。
        </p>
      </div>
    )
  }

  return (
    <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-xl p-3 space-y-2">
      <p className="text-xs font-bold text-purple-700 dark:text-purple-300 flex items-center gap-1.5"><Gift className="h-4 w-4 shrink-0" />無料トライアルコードをお持ちの方（カード登録不要）</p>
      <p className="text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
        <a href="https://note.com/gifted_arnica594/n/n4d3997dad16e" target="_blank" rel="noopener noreferrer" className="font-medium text-purple-600 dark:text-purple-300 underline underline-offset-2 hover:text-purple-700 dark:hover:text-purple-200">note記事</a>などに記載のコードを入力すると、<strong>カード登録なし</strong>でプレミアムをお試しいただけます（期間はコードにより異なります）。
        期間終了後は自動で通常表示に戻り、<strong>勝手に課金されることはありません</strong>。気に入った場合のみ、下の有料登録（1週間無料）で継続できます。
      </p>
      {/* 入力欄と「無料で試す」を items-stretch で同じ高さに揃え、min-w-0 で
          input が横にはみ出してボタンを押し出す（＝ズレる）のを防ぐ。 */}
      <div className="flex items-stretch gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="トライアルコード"
          className="min-w-0 flex-1 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
        />
        <button
          type="button"
          onClick={handleRedeem}
          disabled={loading}
          className="shrink-0 whitespace-nowrap bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
        >
          {loading ? '確認中...' : '無料で試す'}
        </button>
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

// テスト決済中であることをモニター向けに明示するバナー。
function TestModeNotice() {
  return (
    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3">
      <p className="text-xs font-bold text-amber-700 dark:text-amber-300 flex items-center gap-1.5"><FlaskConical className="h-4 w-4 shrink-0" />これはテスト決済です</p>
      <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed mt-0.5">
        現在は体験用のテストモードのため、<strong>実際の課金は発生しません</strong>。
        決済画面ではテストカード番号「4242 4242 4242 4242」（有効期限は任意の未来日付・CVCは任意の3桁）をご利用ください。
      </p>
    </div>
  )
}

function PremiumCheckoutButtonInline() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const mode = usePremiumPaymentMode()
  const { user } = useAuth()
  return (
    <div className="space-y-2">
      {mode?.testMode && <TestModeNotice />}
      <button
        onClick={async () => {
          setLoading(true); setError('')
          try {
            const res = await fetch('/api/premium/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: user?.id }) })
            const data = await res.json()
            if (!res.ok || !data.url) { setError(data.error || '購入ページを開けませんでした'); return }
            window.location.href = data.url
          } catch { setError('ネットワークエラーが発生しました') }
          finally { setLoading(false) }
        }}
        disabled={loading}
        className="w-full bg-purple-600 hover:bg-purple-700 disabled:opacity-60 text-white font-semibold rounded-xl px-4 py-2.5 text-sm transition-colors flex items-center justify-center gap-2"
      >
        {loading ? <><Spinner className="h-4 w-4" />読み込み中...</> : <><Star className="h-4 w-4" />プレミアムに登録する<ArrowRight className="h-4 w-4" /></>}
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
  // 開いたとき最初に表示するセクション（例: アカウントメニューから「プレミアム設定」を開く）。
  initialSection?: SettingsPanelSection
}
function SettingsPanel({ onClose, onReset, onRedo, onRedoFromNotion, currentMode, initialSection = null }: SettingsPanelProps) {
  type Section = SettingsPanelSection
  const [section, setSection] = useState<Section>(initialSection)

  // シート表示中は背景スクロールをロック（LoginModalと同じ挙動に統一）。
  useBodyScrollLock()

  // Escapeキーで閉じる（背景タップと同等の脱出手段をキーボードにも）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // セクション別編集フォーム
  const s0 = getSettings()
  const [notionForm, setNotionForm] = useState({
    notionToken: s0?.notionToken || '',
    notionMedicalDbId: s0?.notionMedicalDbId || '',
    notionReferenceDbId: s0?.notionReferenceDbId || '',
    notionManualDbId: s0?.notionManualDbId || '',
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
    teamNotionManualDbId: s0?.teamNotionManualDbId || '',
  })
  const [saveMsg, setSaveMsg] = useState('')
  // 表示のカスタマイズ（トグルは保存ボタンなしで即保存する）。
  const [displayForm, setDisplayForm] = useState({
    hideQuizTab: !!s0?.hideQuizTab,
    hideCqButton: !!s0?.hideCqButton,
  })

  // iOSのキーボード対策: この設定パネルは fixed bottom-0 のボトムシートなので、
  // キーボードが立つと下端（保存ボタン）がキーボードの裏に隠れて押せなくなる。
  // visualViewport でキーボードの高さを測り、スクロール領域の下余白として確保して、
  // 保存ボタンをキーボードの上まで送り出せるようにする。
  const [kbInset, setKbInset] = useState(0)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      setKbInset(inset)
    }
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onResize)
    onResize()
    return () => {
      vv.removeEventListener('resize', onResize)
      vv.removeEventListener('scroll', onResize)
    }
  }, [])

  const saveSection = (patch: Partial<ReturnType<typeof getSettings>>) => {
    // 既存設定が無くても保存できるようにする（以前は !cur で早期returnしており、
    // 空状態だと保存ボタンが無反応になっていた）。欠けは既定値で補う。
    const cur = getSettings()
    const base: AppSettings = cur ?? {
      searchMode: currentMode === 'notion' ? 'notion' : 'algolia',
      notionToken: '', notionMedicalDbId: '', notionReferenceDbId: '', notionManualDbId: '',
      algoliaAppId: '', algoliaSearchKey: '', algoliaAdminKey: '', algoliaIndex: 'medical_knowledge',
      teamLabel: '', teamNotionToken: '', teamNotionMedicalDbId: '', teamNotionReferenceDbId: '', teamNotionManualDbId: '',
      subscriptionSearchKey: '', subscriptionAppId: '', subscriptionIndex: '',
      propSummary: '', propKeywords: '', propKnowledgeLevel: '', propGenre: '',
    }
    saveSettings({ ...base, ...patch } as Parameters<typeof saveSettings>[0])
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

  const inputCls = 'w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300'
  const labelCls = 'block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1'

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="設定" className="fixed bottom-0 left-0 right-0 z-50 bg-white dark:bg-gray-900 rounded-t-2xl shadow-xl max-w-2xl mx-auto max-h-[90vh] flex flex-col">
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-200 dark:bg-gray-700" />
        </div>

        <div
          className="px-5 pt-2 overflow-y-auto"
          // キーボード表示中はその高さぶん下余白を足し、保存ボタンをキーボードの上へ。
          style={{ paddingBottom: `calc(2rem + ${kbInset}px)` }}
        >
          {/* ヘッダー */}
          <div className="flex items-center justify-between mb-4">
            {section ? (
              <button onClick={() => { setSection(null); setSaveMsg('') }} className="text-sm text-brand-500 hover:text-brand-700 dark:text-brand-400 flex items-center gap-1">← 戻る</button>
            ) : (
              <h2 className="text-base font-bold text-gray-900 dark:text-white">設定</h2>
            )}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded-full">
                {currentMode === 'notion' ? 'シンプルモード' : 'パワーモード'}
              </span>
              <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-2 -m-1" aria-label="設定を閉じる">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* ── メインメニュー ── */}
          {section === null && (
            <div className="space-y-1">
              {/* プレミアム会員バナー */}
              {(() => {
                // キーの有無だけでなくトライアル期限も考慮（期限切れはバナーを出さない）。
                const isPremium = hasSubscriptionConfig()
                if (!isPremium) return null
                return (
                  <div className="bg-gradient-to-r from-purple-50 to-brand-50 dark:from-purple-900/30 dark:to-brand-900/30 border border-purple-200 dark:border-purple-700 rounded-xl px-4 py-3 flex items-center gap-3 mb-2">
                    <Star className="h-6 w-6 text-purple-500" />
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
                <Link2 className="w-5 h-5 text-gray-400 dark:text-gray-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">Notion・Algolia接続設定</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">いま使っているAPIキー・DBのURLをその場で修正</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </button>
              <button onClick={() => setSection('team')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                <Building2 className="w-5 h-5 text-gray-400 dark:text-gray-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">部署DB設定</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">チームで共有するNotionDBを接続</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </button>
              <button onClick={() => setSection('subscription')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                <Star className="w-5 h-5 text-gray-400 dark:text-gray-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">プレミアムDB設定</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">作者提供のナレッジ・参考文献を追加</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </button>
              <button onClick={() => setSection('setup-redo')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                <Wrench className="w-5 h-5 text-gray-400 dark:text-gray-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">セットアップをやり直す</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">モード切替・DBの新規作成／接続（今の設定は保持）</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </button>

              {/* ── 表示 ── */}
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-1 pt-3 pb-1">表示</p>
              <button onClick={() => setSection('display')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                <SlidersHorizontal className="w-5 h-5 text-gray-400 dark:text-gray-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">表示のカスタマイズ</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">クイズタブ・CQボタンの表示/非表示</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </button>

              {/* ── サポート ── */}
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-1 pt-3 pb-1">サポート</p>
              <button onClick={() => setSection('announcements')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                <Megaphone className="w-5 h-5 text-gray-400 dark:text-gray-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">お知らせ・更新履歴</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">アプリの新機能・アップデート情報</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </button>
              <a
                href="https://foregoing-feta-45b.notion.site/MediNode-378fd756737081a2bc23f1acb5f3a4bc"
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors text-left"
              >
                <BookOpen className="w-5 h-5 text-gray-400 dark:text-gray-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">セットアップ＆運用ガイド</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">困ったときはこちらを参照</p>
                </div>
                <ExternalLink className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </a>
              <a
                href={FEEDBACK_FORM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-brand-50 dark:hover:bg-brand-900/20 transition-colors text-left"
              >
                <Send className="w-5 h-5 text-gray-400 dark:text-gray-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">フィードバックを送る</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">バグ報告・ご要望・使用感（2〜3分）</p>
                </div>
                <ExternalLink className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </a>
              {hasSubscriptionConfig() && (
                <a
                  href={CLINICAL_QUESTION_FORM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors text-left"
                >
                  <HelpCircle className="w-5 h-5 text-purple-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white">臨床疑問を投稿する <Star className="inline-block h-3.5 w-3.5 text-purple-500 align-text-top" /></p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">専門医が回答し、プレミアムナレッジに反映されます</p>
                  </div>
                  <ExternalLink className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
                </a>
              )}
              <button onClick={() => setSection('help')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-left">
                <HelpCircle className="w-5 h-5 text-gray-400 dark:text-gray-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">ヘルプ・よくあるエラー</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">エラーの対処法・診断ツール</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </button>

              {/* ── 危険ゾーン ── */}
              {/* 「🔄 セットアップをやり直す」は削除。動作が「🔀 モードを変更する」と
                  完全に同一（どちらも onRedo＝SetupWizard先頭へ）で重複していたため。
                  DB接続の変更は上の「Notion・Algolia接続設定」または
                  「📋 NotionDBをセットアップする」で完結する（ログイン不要）。 */}
              <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider px-1 pt-3 pb-1">その他</p>
              <button onClick={() => setSection('reset-confirm')} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors text-left">
                <Trash2 className="w-5 h-5 text-red-400 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-red-500 dark:text-red-400">設定を完全に削除する</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">全データを消去してゼロから再設定</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </button>
            </div>
          )}

          {/* ── Notion・Algolia接続設定 ── */}
          {section === 'notion' && (
            <div className="space-y-4">
              {/* 手入力の前に: ログインで復元できることを最初に案内（再インストール後の
                  「また入れ直し」を防ぐ。実機で最も多い詰まりどころ）。 */}
              <div className="bg-brand-50 dark:bg-brand-900/25 border border-brand-100 dark:border-brand-800 rounded-xl p-3 text-xs text-brand-800 dark:text-brand-200 leading-relaxed">
                <Lightbulb className="inline-block h-3.5 w-3.5 shrink-0 align-text-bottom mr-1" /><strong>入れ直す前に：</strong>一度ログインしていれば、再インストールや別端末でも<strong>ログインするだけで設定が戻ります</strong>（手入力は不要）。ヘッダー左上の「ログイン」から。復元されない項目だけ、下の各欄を埋めてください。
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">変更後は「保存」してから再同期してください。各項目の取得先は下のリンクから。</p>
              <div className="space-y-3">
                <div>
                  <label className={labelCls}>Notion コネクトToken</label>
                  <input type="password" value={notionForm.notionToken} onChange={(e) => setNotionForm(f => ({ ...f, notionToken: e.target.value }))} placeholder="ntn_xxxxxxxxxxxx" className={inputCls} />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 leading-relaxed">
                    取得先 <a href="https://www.notion.so/my-integrations" target="_blank" rel="noopener noreferrer" className="text-brand-600 dark:text-brand-400 underline">notion.so/my-integrations</a> → 対象のコネクトを開き「アクセストークン」をコピー（<code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">ntn_</code> または <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">secret_</code> で始まる文字列）
                  </p>
                </div>
                <div>
                  <label className={labelCls}>Medical DB（URLまたはID）</label>
                  <input type="text" value={notionForm.notionMedicalDbId} onChange={(e) => setNotionForm(f => ({ ...f, notionMedicalDbId: e.target.value }))} placeholder="https://www.notion.so/... またはID32桁" className={inputCls} />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">NotionでDBページを開き、右上「共有」→「リンクをコピー」で貼り付け（<code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">?v=</code> 以降は自動で除去されます）</p>
                </div>
                <div>
                  <label className={labelCls}>Reference DB（URLまたはID・任意）</label>
                  <input type="text" value={notionForm.notionReferenceDbId} onChange={(e) => setNotionForm(f => ({ ...f, notionReferenceDbId: e.target.value }))} placeholder="https://www.notion.so/... またはID32桁" className={inputCls} />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">論文・文献DB。使わなければ空でOK</p>
                </div>
                <div>
                  <label className={labelCls}>Manual DB（マニュアル・お知らせ・URLまたはID・任意）</label>
                  <input type="text" value={notionForm.notionManualDbId} onChange={(e) => setNotionForm(f => ({ ...f, notionManualDbId: e.target.value }))} placeholder="https://www.notion.so/... またはID32桁" className={inputCls} />
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">設定するとマニュアルタブが表示されます</p>
                </div>
                {currentMode === 'algolia' && (
                  <>
                    <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
                      <div className="bg-gray-50 dark:bg-gray-700/40 rounded-lg p-2.5 text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-3">
                        取得先 <a href="https://dashboard.algolia.com/account/api-keys/" target="_blank" rel="noopener noreferrer" className="text-brand-600 dark:text-brand-400 underline">Algolia → Settings → API Keys</a>。3つの値をコピーします。<strong className="text-amber-600 dark:text-amber-400">Search-Only と Admin は別物</strong>なので取り違えに注意。
                      </div>
                      <label className={labelCls}>Algolia App ID</label>
                      <input type="text" value={notionForm.algoliaAppId} onChange={(e) => setNotionForm(f => ({ ...f, algoliaAppId: e.target.value }))} placeholder="XXXXXXXXXX" className={inputCls} />
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">アプリの識別子（10文字程度の英大文字＋数字）。公開されても問題ない値です</p>
                    </div>
                    <div>
                      <label className={labelCls}>Algolia Search-Only API Key <span className="font-normal text-gray-400">＝検索用</span></label>
                      <input type="password" value={notionForm.algoliaSearchKey} onChange={(e) => setNotionForm(f => ({ ...f, algoliaSearchKey: e.target.value }))} placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className={inputCls} />
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">検索専用（読み取りのみ）。API Keys一覧にそのまま表示されています</p>
                    </div>
                    <div>
                      <label className={labelCls}>Algolia Admin API Key <span className="font-normal text-gray-400">＝同期用</span></label>
                      <input type="password" value={notionForm.algoliaAdminKey} onChange={(e) => setNotionForm(f => ({ ...f, algoliaAdminKey: e.target.value }))} placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className={inputCls} />
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-1 flex items-start gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /><span>「鍵アイコン」を押して表示してからコピー。Search-Only ではなく <strong>Admin</strong> の方です</span></p>
                    </div>
                    <div>
                      <label className={labelCls}>インデックス名</label>
                      <input type="text" value={notionForm.algoliaIndex} onChange={(e) => setNotionForm(f => ({ ...f, algoliaIndex: e.target.value }))} placeholder="medical_knowledge" className={inputCls} />
                      <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">初期値のままでOK。初回同期時にAlgolia側で自動作成されます</p>
                    </div>
                  </>
                )}
              </div>
              <a
                href="https://foregoing-feta-45b.notion.site/MediNode-378fd756737081a2bc23f1acb5f3a4bc"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-brand-600 dark:hover:text-brand-400 py-1"
              >
                取得手順を詳しく見る（ガイド）
              </a>
              {saveMsg && <p className="text-xs text-green-600 dark:text-green-400 text-center">{saveMsg}</p>}
              <button
                onClick={() => saveSection({
                  ...notionForm,
                  notionMedicalDbId: extractNotionDbId(notionForm.notionMedicalDbId),
                  notionReferenceDbId: notionForm.notionReferenceDbId ? extractNotionDbId(notionForm.notionReferenceDbId) : '',
                  notionManualDbId: notionForm.notionManualDbId ? extractNotionDbId(notionForm.notionManualDbId) : '',
                })}
                className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-brand-700 transition-colors"
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
                  {teamForm.teamNotionMedicalDbId.length === 32 && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><Check className="h-3 w-3 shrink-0" />DB IDを認識しました</p>}
                </div>
                <div>
                  <label className={labelCls}>部署用 Reference DB（URLまたはID・任意）</label>
                  <input type="text" value={teamForm.teamNotionReferenceDbId} onChange={(e) => setTeamForm(f => ({ ...f, teamNotionReferenceDbId: e.target.value }))} placeholder="https://www.notion.so/... またはID32桁" className={inputCls} />
                  {teamForm.teamNotionReferenceDbId.length === 32 && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><Check className="h-3 w-3 shrink-0" />DB IDを認識しました</p>}
                </div>
                <div>
                  <label className={labelCls}>部署用 Manual DB（マニュアル・お知らせ・URLまたはID・任意）</label>
                  <input type="text" value={teamForm.teamNotionManualDbId} onChange={(e) => setTeamForm(f => ({ ...f, teamNotionManualDbId: e.target.value }))} placeholder="https://www.notion.so/... またはID32桁" className={inputCls} />
                  {teamForm.teamNotionManualDbId.length === 32 && <p className="text-xs text-green-600 mt-1 flex items-center gap-1"><Check className="h-3 w-3 shrink-0" />DB IDを認識しました</p>}
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">設定するとマニュアルタブが表示されます</p>
                </div>
              </div>
              {saveMsg && <p className="text-xs text-green-600 dark:text-green-400 text-center">{saveMsg}</p>}
              <button
                onClick={() => saveSection({
                  ...teamForm,
                  teamNotionMedicalDbId: teamForm.teamNotionMedicalDbId ? extractNotionDbId(teamForm.teamNotionMedicalDbId) : '',
                  teamNotionReferenceDbId: teamForm.teamNotionReferenceDbId ? extractNotionDbId(teamForm.teamNotionReferenceDbId) : '',
                  teamNotionManualDbId: teamForm.teamNotionManualDbId ? extractNotionDbId(teamForm.teamNotionManualDbId) : '',
                })}
                className="w-full bg-brand-600 text-white rounded-xl py-3 text-sm font-semibold hover:bg-brand-700 transition-colors"
              >
                保存する
              </button>
              {(teamForm.teamNotionToken || teamForm.teamNotionMedicalDbId) && (
                <button
                  onClick={() => {
                    setTeamForm({ teamLabel: '', teamNotionToken: '', teamNotionMedicalDbId: '', teamNotionReferenceDbId: '', teamNotionManualDbId: '' })
                    saveSection({ teamLabel: '', teamNotionToken: '', teamNotionMedicalDbId: '', teamNotionReferenceDbId: '', teamNotionManualDbId: '' })
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
                const hasKeys = !!(s?.subscriptionSearchKey && s?.subscriptionAppId)
                // トライアル期限の判定
                const trialEndsAt = s?.subscriptionTrialEndsAt
                const trialEnd = trialEndsAt ? new Date(trialEndsAt).getTime() : null
                const trialExpired = trialEnd != null && !Number.isNaN(trialEnd) && Date.now() > trialEnd
                const isTrial = trialEnd != null && !Number.isNaN(trialEnd) && !trialExpired
                const daysLeft = isTrial ? Math.ceil((trialEnd! - Date.now()) / (24 * 60 * 60 * 1000)) : 0
                // 期限切れトライアルはプレミアム無効として未登録画面（＝継続登録の誘導）を出す
                const isPremium = hasKeys && !trialExpired
                if (isPremium) {
                  return (
                    <div className="space-y-3">
                      {isTrial ? (
                        <>
                          <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-xl p-4 text-center space-y-1">
                            <p className="text-sm font-bold text-purple-700 dark:text-purple-300 flex items-center justify-center gap-1.5"><Gift className="h-4 w-4 shrink-0" />無料トライアル中</p>
                            <p className="text-xs text-purple-600 dark:text-purple-400">残り <strong>{daysLeft}日</strong>（{new Date(trialEnd!).toLocaleDateString('ja-JP')}まで）</p>
                            <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed pt-1">期間終了後も使い続けるには、下のボタンから正式登録（月額980円・税込）へお進みください。</p>
                            <div className="pt-2"><PremiumCheckoutButtonInline /></div>
                          </div>
                          {/* トライアル中でも「やめたい/管理したい」人の導線を確保。
                              カード登録済み（Checkout経由）ならポータルで解約でき、
                              ポータル未設定やコード式トライアルはメール問い合わせにフォールバックする。 */}
                          <PremiumCancelInfo trial />
                        </>
                      ) : (
                        <>
                          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl p-4 text-center">
                            <p className="text-sm font-bold text-green-700 dark:text-green-400 flex items-center justify-center gap-1.5"><CheckCircle2 className="h-4 w-4 shrink-0" />プレミアム登録済み</p>
                            <p className="text-xs text-green-600 dark:text-green-500 mt-1">プレミアムコンテンツにアクセスできます</p>
                          </div>
                          <PremiumCancelInfo />
                        </>
                      )}
                    </div>
                  )
                }
                return (
                  <div className="space-y-3">
                    {trialExpired && (
                      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 text-center space-y-0.5">
                        <p className="text-xs font-bold text-amber-700 dark:text-amber-300 flex items-center justify-center gap-1.5"><AlarmClock className="h-3.5 w-3.5 shrink-0" />無料トライアルが終了しました</p>
                        <p className="text-[11px] text-amber-600 dark:text-amber-400 leading-relaxed">引き続きプレミアムをご利用いただくには、下記から正式登録（月額980円・税込）へお進みください。</p>
                      </div>
                    )}
                    {/* プレミアムタブと共通の充実した訴求（串刺し検索・含まれるコンテンツ・こんな方におすすめ） */}
                    <PremiumValueProps showHeader={false} />
                    <div className="space-y-0.5">
                      <p className="inline-flex items-center gap-1 text-[11px] font-bold text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-900/40 rounded-full px-2 py-0.5"><Gift className="h-3 w-3 shrink-0" />最初の1週間は無料</p>
                      <p className="text-lg font-bold text-purple-700 dark:text-purple-300">月額980円<span className="text-xs font-medium text-gray-500 dark:text-gray-400">（税込）・1週間の無料トライアル後に課金開始・いつでも解約可能</span></p>
                    </div>
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 leading-relaxed">
                      ※ 掲載内容は学習・参考を目的とした情報で、正確性・完全性・最新性を保証するものではありません。エビデンスは時期や状況により変化します。臨床判断は必ず最新の一次資料・ガイドライン等をご確認のうえ、ご自身の責任で行ってください。詳しくは
                      <a href="/terms" className="text-brand-600 dark:text-brand-400 hover:underline">免責事項・利用規約</a>
                      をご覧ください。登録手続きに進むことで、これらの内容に同意したものとみなされます。
                    </p>
                    {/* note購入者向け: コード入力でカード不要トライアル */}
                    <PremiumTrialRedeem />
                    <div className="flex items-center gap-2 py-1">
                      <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
                      <p className="text-[11px] text-gray-400 dark:text-gray-500">そのまま続けたい方は</p>
                      <div className="flex-1 border-t border-gray-200 dark:border-gray-700" />
                    </div>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 leading-relaxed">
                      <strong>有料登録（月額980円・税込）</strong>：こちらは<strong>最初の1週間は無料</strong>ですが、登録時にカード情報が必要です。トライアル終了後はそのまま自動で課金が始まり、解約しない限り継続利用できます。より長く試したい方は、上のトライアルコード（note特典・14日間・カード不要）がお得です。
                    </p>
                    <PremiumCheckoutButtonInline />
                    <p className="text-[11px] text-gray-400 dark:text-gray-500 flex flex-wrap gap-x-3 gap-y-1 justify-center">
                      <a href="/terms" className="text-brand-600 dark:text-brand-400 hover:underline">免責事項・利用規約</a>
                      <a href="/legal" className="text-brand-600 dark:text-brand-400 hover:underline">特定商取引法に基づく表記</a>
                      <a href="/privacy" className="text-brand-600 dark:text-brand-400 hover:underline">プライバシーポリシー</a>
                    </p>
                  </div>
                )
              })()}
            </div>
          )}

          {/* ── お知らせ・更新履歴 ── */}
          {section === 'announcements' && (
            <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
              <p className="text-xs text-gray-500 dark:text-gray-400 px-1">アプリの新機能・アップデート情報です（新しい順）。</p>
              {ANNOUNCEMENTS.map((a) => (
                <div key={a.id} className="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                  <div className="flex items-start gap-2">
                    <span className="shrink-0 text-brand-600 dark:text-brand-300"><a.Icon className="h-5 w-5" /></span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-bold text-gray-900 dark:text-white">{a.title}</p>
                        <span className="text-[11px] text-gray-400 dark:text-gray-500 shrink-0">{a.date}</span>
                      </div>
                      <p className="text-xs text-gray-600 dark:text-gray-300 mt-1 leading-relaxed">{a.body}</p>
                      {a.links && a.links.length > 0 && (
                        <div className="flex flex-wrap gap-2 mt-2">
                          {a.links.map((lk) => (
                            <a
                              key={lk.url}
                              href={lk.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-semibold text-brand-600 dark:text-brand-300 bg-brand-50 dark:bg-brand-900/30 border border-brand-200 dark:border-brand-700 rounded-full px-3 py-1 hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors"
                            >
                              {lk.label}
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── ヘルプ ── */}
          {section === 'help' && (
            <div className="space-y-4 text-sm text-gray-700 dark:text-gray-300 max-h-[60vh] overflow-y-auto pr-1">
              <section>
                <h3 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-1.5"><Star className="h-4 w-4 shrink-0" />プレミアムとは？</h3>
                <div className="text-xs bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-xl p-3 text-gray-700 dark:text-gray-300 space-y-1.5 leading-relaxed">
                  <p><strong>現役集中治療医が定期的に更新する医療ナレッジ＋参考文献</strong>を、あなた自身のNotionと同じ検索ボックスで横断検索できる機能です。</p>
                  <p>ツールを切り替えず、自分のメモと専門医の公開ナレッジをまとめて検索。元の共有Notionページにもジャンプできます。</p>
                  <p className="pt-1"><strong>試し方は2通り：</strong></p>
                  <p><strong>トライアルコード</strong>（note購入者向け）… カード登録なしで14日間お試し。期間終了後は自動で通常表示に戻り、勝手に課金されません。</p>
                  <p><strong>有料登録（月額980円・税込）</strong>… 最初の1週間は無料、その後カードへ自動課金。解約しない限り継続。いつでも解約可。</p>
                  <p className="pt-1 text-purple-700 dark:text-purple-300">登録・コード入力は「設定 → プレミアムDB設定」から行えます。</p>
                </div>
              </section>
              <section>
                <h3 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-1.5"><RefreshCw className="h-4 w-4 shrink-0" />同期エラーが出たときは</h3>
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
                <h3 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 shrink-0" />プロパティ名について</h3>
                <div className="text-xs bg-amber-50 dark:bg-amber-900/30 rounded-xl p-3 text-amber-700 dark:text-amber-300 space-y-1.5">
                  <p>NotionDBのプロパティ名（「名前」「ジャンル」「要約」など）は<strong>変更しないでください</strong>。選択肢の追加・変更は自由です。</p>
                  <p><Lightbulb className="inline-block h-3.5 w-3.5 shrink-0 align-text-bottom mr-1" />ジャンルタブで医療知識と参考文献をまとめて表示するには、Medical DB と Reference DB の「ジャンル」の<strong>選択肢名を完全に一致</strong>させてください（例: 両方とも「07.腎」）。名前が違うと別ジャンルとして表示されます。</p>
                </div>
              </section>
              <section>
                <h3 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-1.5"><Search className="h-4 w-4 shrink-0" />DBプロパティ確認</h3>
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
                  className="w-full text-sm bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 rounded-xl py-2.5 font-medium hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors disabled:opacity-50"
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
                            {db === 'medical' ? 'Medical DB' : 'Reference DB'} — {allOk ? '全て一致' : '不一致あり'}
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {r.found.map((p) => <span key={p} className="inline-flex items-center gap-1 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full"><Check className="h-3 w-3 shrink-0" />{p}</span>)}
                            {r.missing.map((p) => <span key={p} className="inline-flex items-center gap-1 bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400 px-2 py-0.5 rounded-full"><X className="h-3 w-3 shrink-0" />{p}</span>)}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </section>
              {currentMode === 'algolia' && (
                <section>
                  <h3 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-1.5"><KeyRound className="h-4 w-4 shrink-0" />Search Key動作確認</h3>
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
                    className="w-full text-sm bg-brand-50 dark:bg-brand-900/30 text-brand-600 dark:text-brand-400 rounded-xl py-2.5 font-medium hover:bg-brand-100 dark:hover:bg-brand-900/50 transition-colors disabled:opacity-50"
                  >
                    {searchKeyCheckLoading ? '確認中...' : 'Search Keyを確認する'}
                  </button>
                  {searchKeyCheck && (
                    <div className={`mt-2 rounded-xl p-3 text-xs ${searchKeyCheck.ok ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'}`}>
                      {searchKeyCheck.ok ? <p>Search Key正常 — インデックスに <strong>{searchKeyCheck.nbHits}件</strong> のデータが見えています</p> : (
                        <><p className="font-semibold mb-1 flex items-center gap-1.5"><XCircle className="h-4 w-4 shrink-0" />Search Keyが機能していません</p><p className="mb-1">エラー: {searchKeyCheck.error}</p><p>「Notion・Algolia接続設定」からSearch API Keyを再入力してください。</p></>
                      )}
                    </div>
                  )}
                </section>
              )}
              {currentMode === 'algolia' && (
                <section>
                  <h3 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-1.5"><Microscope className="h-4 w-4 shrink-0" />Algoliaインデックス診断</h3>
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
                        <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1 flex items-center gap-1.5"><BarChart3 className="h-4 w-4 shrink-0" />総レコード数: {algoliaDebug.totalHits}件</p>
                        <p className="text-gray-500 dark:text-gray-400">attributesForFaceting: {algoliaDebug.settings.attributesForFaceting?.join(', ') || '未設定'}</p>
                      </div>
                      <div className="bg-brand-50 dark:bg-brand-900/20 rounded-xl p-3">
                        <p className="font-semibold text-brand-700 dark:text-brand-300 mb-1 flex items-center gap-1.5"><Lightbulb className="h-4 w-4 shrink-0" />知識レベルの実際の値</p>
                        {algoliaDebug.knowledgeLevelValues.length === 0 ? <p className="text-red-500">値なし（再同期が必要）</p> : (
                          <div className="flex flex-wrap gap-1">{algoliaDebug.knowledgeLevelValues.map((v) => <span key={v} className="bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 px-2 py-0.5 rounded-full">{v}</span>)}</div>
                        )}
                      </div>
                      <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                        <p className="font-semibold text-gray-700 dark:text-gray-200 mb-1 flex items-center gap-1.5"><ClipboardList className="h-4 w-4 shrink-0" />サンプルレコード</p>
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
                <h3 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-1.5"><KeyRound className="h-4 w-4 shrink-0" />ログインとは（プレミアムの引き継ぎ）</h3>
                <div className="text-xs bg-brand-50 dark:bg-brand-900/20 rounded-xl p-3 space-y-1.5 text-gray-700 dark:text-gray-300">
                  <p><span className="font-semibold">ログインは、プレミアム契約をあなたのアカウントに紐づけて、スマホ・PCなど複数の端末で同じプレミアムを使えるようにするためのものです。</span></p>
                  <p>・メールアドレスだけでログインできます（パスワード不要）。届いたメールのリンクをタップするか、6桁コードを入力するだけ。</p>
                  <p>・検索など基本機能は、ログインしなくても今まで通り使えます（ログインは必須ではありません）。</p>
                  <p>・集めるのはメールアドレスのみで、あなたのNotionの中身を運営が見ることはありません。</p>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400">※ セキュリティ上、メール受信箱を開ける人＝本人とみなされます。共有のPCでメールを開いたままにしないでください。</p>
                </div>
              </section>
              <section>
                <h3 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-1.5"><Smartphone className="h-4 w-4 shrink-0" />別のデバイスで使うには</h3>
                <div className="text-xs bg-gray-50 dark:bg-gray-800 rounded-xl p-3 space-y-1.5">
                  <p>Notionの接続設定（トークン等）はこの端末に保存され、ログイン後は暗号化のうえサーバーに保存して他の端末と同期します。別の端末ではログインするだけで設定が引き継がれます。</p>
                  <p>プレミアム契約についても、<span className="font-semibold">ログインすると端末をまたいで引き継げます</span>（上の「ログインとは」を参照）。</p>
                </div>
              </section>
              <section>
                <h3 className="font-bold text-gray-900 dark:text-white mb-2 flex items-center gap-1.5"><FileText className="h-4 w-4 shrink-0" />規約・法的情報</h3>
                <div className="text-xs bg-gray-50 dark:bg-gray-800 rounded-xl p-3 flex flex-col gap-2">
                  <a href="/terms" className="text-brand-600 dark:text-brand-400 hover:underline">免責事項・利用規約</a>
                  <a href="/legal" className="text-brand-600 dark:text-brand-400 hover:underline">特定商取引法に基づく表記</a>
                  <a href="/privacy" className="text-brand-600 dark:text-brand-400 hover:underline">プライバシーポリシー</a>
                </div>
              </section>
            </div>
          )}

          {/* 「redo-confirm」確認画面は削除（上記「🔄 セットアップをやり直す」ボタン廃止に伴う）。
              同等機能は「🔀 モードを変更する」(mode-confirm) が担う。 */}

          {/* ── 完全削除確認 ── */}
          {section === 'reset-confirm' && (
            <div className="space-y-4">
              <div className="bg-red-50 dark:bg-red-900/30 rounded-xl p-4 text-sm text-red-700 dark:text-red-300 space-y-1">
                <p className="font-bold flex items-center justify-center gap-1.5"><AlertTriangle className="h-4 w-4 shrink-0" />本当に全て削除しますか？</p>
                <p className="text-xs">入力したAPIキー・DB設定が全て消去されます。元に戻すことはできません。</p>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setSection(null)} className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">キャンセル</button>
                <button onClick={onReset} className="flex-1 bg-red-500 text-white rounded-xl py-3 text-sm font-semibold hover:bg-red-600 transition-colors">削除する</button>
              </div>
            </div>
          )}

          {/* ── 表示のカスタマイズ ── */}
          {section === 'display' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                使わない機能を画面から外せます。切り替えは即保存され、いつでも戻せます。
              </p>
              {([
                {
                  key: 'hideQuizTab' as const,
                  label: 'クイズタブ',
                  desc: '登録したナレッジからの出題。検索・まとめ用途だけで使う場合はオフに。',
                },
                {
                  key: 'hideCqButton' as const,
                  label: 'CQ登録ボタン（右下の浮きボタン）',
                  desc: '疑問を自分のNotionに残す機能。個人のNotion接続を使わない場合はオフに。',
                },
              ]).map(({ key, label, desc }) => {
                const visible = !displayForm[key]
                return (
                  <button
                    key={key}
                    role="switch"
                    aria-checked={visible}
                    onClick={() => {
                      const next = { ...displayForm, [key]: !displayForm[key] }
                      setDisplayForm(next)
                      saveSection(next)
                    }}
                    className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{label}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 leading-relaxed">{desc}</p>
                    </div>
                    <span
                      className={`shrink-0 w-11 h-6 rounded-full p-0.5 transition-colors ${visible ? 'bg-brand-600' : 'bg-gray-300 dark:bg-gray-600'}`}
                    >
                      <span
                        className={`block w-5 h-5 rounded-full bg-white shadow transition-transform ${visible ? 'translate-x-5' : 'translate-x-0'}`}
                      />
                    </span>
                  </button>
                )
              })}
              {saveMsg && <p className="text-xs text-green-600 dark:text-green-400 text-center">{saveMsg}</p>}
              <p className="text-xs text-gray-400 dark:text-gray-500 text-center">変更は設定を閉じたときに画面へ反映されます</p>
            </div>
          )}

          {/* ── セットアップやり直し（モード変更・DBセットアップの統合入口） ── */}
          {section === 'setup-redo' && (
            <div className="space-y-4">
              <div className="bg-brand-50 dark:bg-brand-900/20 rounded-xl p-4 text-sm text-brand-700 dark:text-brand-300 space-y-1.5">
                <p className="font-bold flex items-center justify-center gap-1.5"><Wrench className="h-4 w-4 shrink-0" />何をやり直しますか？</p>
                <p className="text-xs">どちらもセットアップ画面へ移動します。現在のAPIキー・DB設定は保持されるので、必要な箇所だけ変更できます。</p>
                <p className="text-xs">現在: <span className="font-semibold">{currentMode === 'notion' ? 'シンプルモード' : 'パワーモード'}</span></p>
              </div>
              <button onClick={() => { onClose(); onRedo() }} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 hover:ring-brand-300 transition-all text-left">
                <Shuffle className="w-5 h-5 text-gray-400 dark:text-gray-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">モードを切り替える</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">シンプル↔パワーモードの変更（モード選択画面へ）</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </button>
              <button onClick={() => { onClose(); onRedoFromNotion() }} className="w-full flex items-center gap-3 px-4 py-3.5 rounded-xl bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 hover:ring-brand-300 transition-all text-left">
                <ClipboardList className="w-5 h-5 text-gray-400 dark:text-gray-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">NotionDBを作り直す・つなぎ直す</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">テンプレート複製 or 既存DBの接続（DB選択画面へ）</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-600 shrink-0" />
              </button>
              <button onClick={() => setSection('notion')} className="w-full text-center text-xs text-brand-500 hover:text-brand-700 dark:text-brand-400 py-1">
                APIキーやDBのURLを直すだけなら → 接続設定へ
              </button>
              <button onClick={() => setSection(null)} className="w-full border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-xl py-3 text-sm font-semibold hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">キャンセル</button>
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
  // Algolia未設定画面の「シンプルモードに切り替える」直後に getSettings() を読み直させる更新カウンタ。
  const [, bumpSettingsVersion] = useState(0)
  const [setupDone, setSetupDone] = useState<boolean | null>(null)
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  // 設定パネルを開くとき最初に表示するセクション（null=トップ一覧）。
  // アカウント(👤)メニューの「プレミアム設定・解約を開く」から 'subscription' で開く。
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsPanelSection>(null)
  const [premiumActivating, setPremiumActivating] = useState(false)
  const [premiumMessage, setPremiumMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  // アカウントメニューからのプレミアム設定オープン要求を購読。
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => {
      setSettingsInitialSection('subscription')
      setShowSettings(true)
    }
    window.addEventListener('medinode:open-premium-settings', handler)
    return () => window.removeEventListener('medinode:open-premium-settings', handler)
  }, [])

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
            notionToken: '', notionMedicalDbId: '', notionReferenceDbId: '', notionManualDbId: '',
            algoliaAppId: '', algoliaSearchKey: '', algoliaAdminKey: '', algoliaIndex: 'medical_knowledge',
            teamLabel: '', teamNotionToken: '', teamNotionMedicalDbId: '', teamNotionReferenceDbId: '', teamNotionManualDbId: '',
            subscriptionSearchKey: '', subscriptionAppId: '', subscriptionIndex: '',
            propSummary: '', propKeywords: '', propKnowledgeLevel: '', propGenre: '',
          }
          const current = getSettings() || defaultSettings
          saveSettings({
            ...current,
            subscriptionAppId: data.algolia.appId,
            subscriptionSearchKey: data.algolia.searchKey,
            subscriptionIndex: data.algolia.index,
            // Stripe正式登録なのでトライアル期限はクリア（無期限の正規会員に昇格）。
            subscriptionTrialEndsAt: '',
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

  // 'entry' はオンボーディング後の入口分岐（アカウント有無の選択）。初回・リセット・やり直しは
  // ここから始める。Notionだけ修正など特定ステップ直行のケースは個別に start/notion 等を指定する。
  const [setupInitialStep, setSetupInitialStep] = useState<'entry' | 'start' | 'mode' | 'notion' | 'options'>('entry')

  const handleReset = () => {
    clearSettings()
    setSetupDone(false)
    setShowSettings(false)
    setSetupInitialStep('entry')
  }

  const handleRedo = () => {
    // 「モードを切り替える」から来るので、入口分岐ではなくモード選択ステップへ直行する
    // （targets は初期値 personal:true のため 'mode' ステップは常に存在する）。
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
          <div className="flex justify-center animate-bounce text-purple-500"><Star className="h-12 w-12" /></div>
          <p className="text-lg font-bold text-purple-700 dark:text-purple-300">プレミアム登録を確認中...</p>
          <p className="text-sm text-gray-500 dark:text-gray-400">しばらくお待ちください</p>
        </div>
      </div>
    )
  }

  // プレミアム認証完了メッセージ（成功/失敗）
  if (premiumMessage) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-brand-50 to-white dark:from-gray-900 dark:to-gray-800 flex items-center justify-center px-4">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="flex justify-center">{premiumMessage.type === 'success' ? <CheckCircle2 className="h-12 w-12 text-green-500" /> : <AlertTriangle className="h-12 w-12 text-amber-500" />}</div>
          <p className={`text-base font-semibold ${premiumMessage.type === 'success' ? 'text-green-700 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
            {premiumMessage.text}
          </p>
          {premiumMessage.type === 'error' && (
            <button
              onClick={() => setPremiumMessage(null)}
              className="text-sm text-brand-500 hover:text-brand-700 dark:text-brand-400"
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
    // JS到着前からサーバーHTMLとして描画される骨格。実画面と同寸なので切替時のガタつきもない。
    return <AppSkeleton />
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
    return <SetupWizard onComplete={() => { setSetupDone(true); setShowSettings(false); setSetupInitialStep('entry') }} onShowOnboarding={() => setShowOnboardingFromSetup(true)} initialStep={setupInitialStep} />
  }

  const settings = getSettings()
  const searchMode = settings?.searchMode || 'algolia'
  const hasTeam = !!(settings?.teamNotionToken && settings?.teamNotionMedicalDbId)
  // プレミアム判定はキーの有無だけでなくトライアル期限切れも考慮する。
  // hasSubscriptionConfig() が isSubscriptionTrialExpired() を内包しており、
  // 期限切れトライアル（端末localStorageにキーが残った状態）を正しく無効化する。
  const hasSubscription = hasSubscriptionConfig()
  // マニュアルタブはオプトイン：個人 or 部署のマニュアルDBが設定されている時のみ表示。
  const hasManual = !!(settings?.notionManualDbId || settings?.teamNotionManualDbId)

  // タブごとの機能色（オンボーディングのタイル配色と対応）。
  // アクティブなタブにだけ色が乗り、「いまどの機能にいるか」が色でもわかる。
  // 常盤一色の単調さをほどく差し色でもある（ペールトーンで騒がない）。
  const TAB_TONES: Record<Tab, string> = {
    search: 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300',
    recent: 'bg-teal-100 dark:bg-teal-900/40 text-teal-700 dark:text-teal-300',
    browse: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300',
    reference: 'bg-sky-100 dark:bg-sky-900/40 text-sky-700 dark:text-sky-300',
    quiz: 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300',
    manual: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300',
  }
  const tabs: { id: Tab; label: string; Icon: LucideIcon }[] = [
    { id: 'search', label: '検索', Icon: Search },
    { id: 'recent', label: '新着', Icon: Clock },
    { id: 'browse', label: 'ジャンル', Icon: FolderOpen },
    { id: 'reference', label: '文献', Icon: BookMarked },
    // クイズはオプトアウト：検索・まとめ用途だけで使う人は設定の「表示のカスタマイズ」で外せる。
    ...(settings?.hideQuizTab ? [] : [{ id: 'quiz' as Tab, label: 'クイズ', Icon: Lightbulb }]),
    // マニュアルDBが設定されている時のみタブを表示（オプトイン）。
    ...(hasManual ? [{ id: 'manual' as Tab, label: 'マニュアル', Icon: ClipboardList }] : []),
  ]
  // 選択中のタブが非表示化された場合（クイズをオフ・マニュアルDB解除）は検索へ退避する。
  const activeTab: Tab = tabs.some((t) => t.id === tab) ? tab : 'search'

  const header = (
    <div className="sticky top-0 z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-gray-100 dark:border-gray-700 shadow-sm [padding-top:env(safe-area-inset-top)]">
      <div className="max-w-2xl mx-auto px-4 pt-3 pb-2">
        <div className="flex items-center justify-between mb-3">
          <div className="w-16 flex items-center">
            <AccountButton />
          </div>
          <div className="flex items-center gap-2">
            <img src="/icon-192.png" alt="MediNode" className="w-7 h-7 rounded-lg" />
            <h1 className="text-lg font-bold text-gray-900 dark:text-white">MediNode</h1>
          </div>
          <div className="min-w-16 flex justify-end items-center gap-2">
            <a
              href="https://foregoing-feta-45b.notion.site/MediNode-378fd756737081a2bc23f1acb5f3a4bc"
              target="_blank"
              rel="noopener noreferrer"
              className="w-10 h-10 -my-1 grid place-items-center rounded-xl text-gray-400 dark:text-gray-500 hover:text-brand-600 dark:hover:text-brand-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              title="使い方ガイド"
            >
              <BookOpen className="w-5 h-5" />
            </a>
            <button
              onClick={() => setShowSettings(true)}
              className="w-10 h-10 -my-1 grid place-items-center rounded-xl text-gray-400 dark:text-gray-500 hover:text-brand-600 dark:hover:text-brand-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              title="設定"
            >
              <SlidersHorizontal className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1 gap-0.5 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id)
                // 機能利用の実態把握用（どのタブが使われているか）。
                track('tab_switch', { tab: t.id })
              }}
              className={`shrink-0 flex-1 flex flex-col items-center gap-0.5 py-1.5 px-1 rounded-lg text-[11px] font-semibold transition-all whitespace-nowrap ${
                activeTab === t.id
                  ? TAB_TONES[t.id]
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              <t.Icon className="w-[17px] h-[17px]" strokeWidth={2} />
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )

  const settingsModal = showSettings && (
    <SettingsPanel
      onClose={() => { setShowSettings(false); setSettingsInitialSection(null) }}
      onReset={handleReset}
      onRedo={handleRedo}
      onRedoFromNotion={handleRedoFromNotion}
      currentMode={searchMode}
      initialSection={settingsInitialSection}
    />
  )

  // ========== Notionモード ==========
  if (searchMode === 'notion') {
    return (
      <SubscriptionSearchProvider enableBridge={true}>
      <OpenSettingsContext.Provider value={(section) => { setSettingsInitialSection(section ?? null); setShowSettings(true) }}>
      <CqCaptureProvider>
      <div className="min-h-screen bg-gradient-to-b from-brand-50 to-gray-50 dark:from-gray-900 dark:to-gray-800">
        {header}
        <UpdateBanner />
        <FeedbackNudgeBanner />
        <div className="max-w-2xl mx-auto px-4 py-4">
          <PowerModeUpgradeBanner onOpenSettings={() => setShowSettings(true)} />
          {activeTab === 'search' && <NotionSearchTab hasTeam={hasTeam} hasSubscription={hasSubscription} />}
          {activeTab === 'recent' && <NotionRecentTab hasTeam={hasTeam} hasSubscription={hasSubscription} />}
          {activeTab === 'browse' && <NotionBrowseTab hasTeam={hasTeam} hasSubscription={hasSubscription} />}
          {activeTab === 'reference' && <NotionReferenceTab hasTeam={hasTeam} hasSubscription={hasSubscription} />}
          {activeTab === 'quiz' && <NotionQuizTab hasTeam={hasTeam} hasSubscription={hasSubscription} />}
          {activeTab === 'manual' && <NotionManualTab />}
        </div>
        {settingsModal}
      </div>
      </CqCaptureProvider>
      </OpenSettingsContext.Provider>
      </SubscriptionSearchProvider>
    )
  }

  // ========== Algoliaモード ==========
  // Search KeyまたはApp IDが未設定の場合の案内画面。
  // セットアップでパワーモードを選んだままキー未入力の人が主に到達する。
  // 「なぜこの画面が出たか」と「2つの出口（キーを入力する／シンプルモードに切り替える）」を明示する。
  if (!settings?.algoliaSearchKey || !settings?.algoliaAppId) {
    // シンプルモード（Notion直結）は個人か部署どちらかのNotion接続があれば追加設定なしで動く。
    const canUseSimpleMode = !!(
      (settings?.notionToken && settings?.notionMedicalDbId) ||
      (settings?.teamNotionToken && settings?.teamNotionMedicalDbId)
    )
    return (
      <div className="min-h-screen bg-gradient-to-b from-brand-50 to-gray-50 dark:from-gray-900 dark:to-gray-800">
        {header}
        <div className="max-w-2xl mx-auto px-4 py-8">
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-2xl p-6 space-y-4">
            <div className="text-center">
              <p className="mb-3 flex justify-center"><AlertTriangle className="h-6 w-6 text-amber-500" /></p>
              <p className="font-bold text-amber-800 dark:text-amber-200 mb-2">パワーモードの追加設定が必要です</p>
              <p className="text-sm text-amber-700 dark:text-amber-300 leading-relaxed">
                現在<strong>パワーモード（Algolia検索）</strong>が選ばれていますが、AlgoliaのApp ID・Search API Keyが未入力のため、検索を始められません。
              </p>
            </div>
            <button
              onClick={() => { setSettingsInitialSection('notion'); setShowSettings(true) }}
              className="w-full bg-amber-600 text-white rounded-xl px-5 py-3 text-sm font-semibold hover:bg-amber-700 transition-colors"
            >
              Algoliaのキーを入力する
            </button>
            {canUseSimpleMode && (
              <div className="border-t border-amber-200 dark:border-amber-700 pt-4 space-y-2.5">
                <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                  Algoliaを使わない場合は、<strong>シンプルモード（Notion直結検索）</strong>に切り替えると追加設定なしでこのまま使えます。入力済みの設定は保持され、あとから戻せます。
                </p>
                <button
                  onClick={() => {
                    const cur = getSettings()
                    if (!cur) return
                    saveSettings({ ...cur, searchMode: 'notion' })
                    track('mode_switch', { to: 'notion', from: 'algolia_missing_keys' })
                    bumpSettingsVersion((n) => n + 1)
                  }}
                  className="w-full bg-white dark:bg-gray-800 text-amber-800 dark:text-amber-200 ring-1 ring-amber-300 dark:ring-amber-700 rounded-xl px-5 py-3 text-sm font-semibold hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                >
                  シンプルモードに切り替えて始める
                </button>
              </div>
            )}
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
    <OpenSettingsContext.Provider value={(section) => { setSettingsInitialSection(section ?? null); setShowSettings(true) }}>
    <CqCaptureProvider>
    <InstantSearch searchClient={dynamicSearchClient} indexName={dynamicIndexName} future={{ preserveSharedStateOnUnmount: false }}>
      <div className="min-h-screen bg-gradient-to-b from-brand-50 to-gray-50 dark:from-gray-900 dark:to-gray-800">
        {header}
        <UpdateBanner />
        <FeedbackNudgeBanner />
        <div className="max-w-2xl mx-auto bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-100 dark:border-gray-700">
          <SyncPanel />
        </div>
        <div className="max-w-2xl mx-auto px-4 py-4">
          <AlgoliaSearchErrorNotice />
          {activeTab === 'search' && <SearchTab hasTeam={hasTeam} hasSubscription={hasSubscription} />}
          {activeTab === 'recent' && (
            <RecentTabWithOwner hasTeam={hasTeam} hasSubscription={hasSubscription} />
          )}
          {activeTab === 'browse' && <GenreBrowse hasTeam={hasTeam} hasSubscription={hasSubscription} />}
          {activeTab === 'reference' && <ReferenceTab hasTeam={hasTeam} hasSubscription={hasSubscription} />}
          {activeTab === 'quiz' && (
            <QuizTabWithOwner hasTeam={hasTeam} hasSubscription={hasSubscription} />
          )}
          {/* マニュアルはMVPではNotion直読みで動かす（Algoliaモードでも同じコンポーネント） */}
          {activeTab === 'manual' && <NotionManualTab />}
        </div>
      </div>
      {settingsModal}
    </InstantSearch>
    </CqCaptureProvider>
    </OpenSettingsContext.Provider>
    </SubscriptionSearchProvider>
  )
}
