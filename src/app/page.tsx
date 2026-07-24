'use client'
import { InstantSearch, Configure, useHits, useSearchBox } from 'react-instantsearch'
import { useState, useEffect, useCallback, useRef, createContext, useContext, useMemo } from 'react'
import { track } from '@vercel/analytics'
import { weightedQuizOrder } from '@/lib/quiz-srs'
import { stripLeadingEmoji } from '@/lib/labels'
import {
  Search, Clock, FolderOpen, Lightbulb, ClipboardList, SlidersHorizontal,
  Link2, Building2, Star, Wrench, Megaphone, Send, HelpCircle, Trash2, Shuffle, BookMarked,
  Gift, CheckCircle2, AlarmClock, ArrowRight,
  Inbox, Brain, X, Zap, CreditCard, RefreshCw, AlertTriangle, Book, Check,
  KeyRound, XCircle, Microscope, BarChart3, Smartphone, FileText, Ambulance, Lock,
  ExternalLink, ChevronRight, ChevronUp, ChevronDown, Globe, NotebookPen, CircleUserRound,
  type LucideIcon,
} from 'lucide-react'
import {
  createSearchClient,
  getIndexName,
  createSubscriptionSearchClient,
  getSubscriptionIndexName,
  hasSubscriptionConfig,
} from '@/lib/algolia'
import { isSetupComplete, clearSettings, getSettings, saveSettings, getDraft, type AppSettings } from '@/lib/settings'
import { isLoginRequiredByServer } from '@/lib/login-policy'
import { usePremiumPaymentMode, TestModeNotice } from '@/components/premium-shared'
import { LoginGate } from '@/components/LoginGate'
import { SearchBox } from '@/components/SearchBox'
import { Spinner } from '@/components/Spinner'
import { SkeletonCards } from '@/components/SkeletonCards'
import { SearchResults } from '@/components/SearchResults'
import { ResultCard, type Hit } from '@/components/ResultCard'
import { QuizCard } from '@/components/QuizCard'
import { StudyNoteCard } from '@/components/StudyNoteCard'
import { useSearchHistory, SearchHistoryList } from '@/components/SearchHistory'
import { RecentViewsList } from '@/components/RecentViews'
import { BookmarksList } from '@/components/BookmarksList'
import { SearchSuggest } from '@/components/SearchSuggest'
import { recordRecentView } from '@/lib/recent-views'
import { recentGroupIndex } from '@/lib/recent-grouping'
import { DailyQuestionCard } from '@/components/DailyQuestionCard'
import { GenreBrowse, genreChipTone, GenreHitsList, GenreDotLegend } from '@/components/GenreBrowse'

import { SyncPanel } from '@/components/SyncPanel'

import { PremiumValueProps } from '@/components/PremiumValueProps'
import { AccountButton } from '@/components/auth/AccountButton'
import { useAuth } from '@/components/auth/AuthProvider'
import { isSettingsSyncSettled, onSettingsSyncSettled } from '@/components/auth/SettingsSync'
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
// 設定パネル（約1400行の巨大モーダル）は開くまで不要なので初期バンドルから分離。
// → PWAコールドスタートのJS量とハイドレーション負荷を削減。
// （画面つきガイドの遅延読込は SettingsPanel.tsx 側に移動）
const SettingsPanel = dynamicImport(
  () => import('@/components/SettingsPanel'),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <Spinner className="h-8 w-8 text-white" />
      </div>
    ),
  },
)
import { MANUAL_GUIDE_URL, MANUAL_TEMPLATE_URL, FEEDBACK_FORM_URL, CLINICAL_QUESTION_FORM_URL, TEASER_LP_URL, NOTION_MAGAZINE_URL, PREMIUM_NOTE_URL } from '@/lib/app-links'
import { ANNOUNCEMENTS, UpdateBanner, FeedbackNudgeBanner, PowerModeUpgradeBanner, PwaInstallBanner, bumpSearchCount } from '@/components/AppBanners'
import { TrialLifecycleNotice } from '@/components/TrialLifecycleNotice'
import { ResolvedCqBanner } from '@/components/ResolvedCqs'
import { AuthorAdditionsBanner } from '@/components/AuthorAdditionsBanner'
import { fetchAuthorAdditions, markAuthorAdditionsSeen, isNewAuthorAddition, type AuthorAdditions } from '@/lib/author-additions'
import { OpenSettingsContext, SearchErrorNotice, AlgoliaSearchErrorNotice, type SettingsPanelSection } from '@/components/SearchErrors'
import { OwnerFilterTabs, buildOwnerFilter, isTeamOwner, teamIdOf, type OwnerFilter } from '@/components/OwnerFilterTabs'
import { CqCaptureProvider, useCqCapture } from '@/components/CqCapture'
import { ReaderProvider } from '@/components/reader/SubscriptionReader'
import { ReaderMarksProvider } from '@/components/reader/ReaderMarksProvider'
import { HelpFaq } from '@/components/HelpFaq'
import { FeatureTour, isFeatureTourDone } from '@/components/FeatureTour'
import { PREMIUM_VERIFY_FLAG } from '@/components/auth/PremiumSync'

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
// owner='team' → 個人の中からteamのみ（'team:<id>' なら該当部署のみ）
function mergeHitsByOwnerFilter(
  personalHits: Hit[],
  subHits: Hit[],
  owner: OwnerFilter,
): Hit[] {
  if (owner === 'subscription') return subHits
  if (owner === 'personal') return personalHits.filter((h) => !h.owner || h.owner === 'personal')
  if (isTeamOwner(owner)) {
    const id = teamIdOf(owner)
    return personalHits.filter((h) => h.owner === 'team' && (id ? h.teamId === id : true))
  }
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
  // 折りたたみ時でも「選択中のジャンル」は必ず見えるようにする。選択が overflow に
  // 隠れると、絞り込み中なのに画面に手がかりが無く「出題が少ない＝バグ」に見えるため、
  // 隠れている選択分だけを可視リストの末尾に足す（＝緑チップとして常に露出させる）。
  const base = showAll ? allGenres : allGenres.slice(0, GENRE_SHOW_LIMIT)
  const hiddenSelected = allGenres.filter((g) => selected.includes(g) && !base.includes(g))
  const visible = [...base, ...hiddenSelected]
  const remainingCollapsed = Math.max(0, allGenres.length - GENRE_SHOW_LIMIT - hiddenSelected.length)

  return (
    <div className="mb-3">
      {selected.length > 0 && (
        <div className="flex items-center gap-2 mb-1.5 text-xs">
          <span className="text-brand-600 dark:text-brand-400 font-medium">
            絞り込み中：{selected.map(displayGenreName).join('・')}
          </span>
          <button
            onClick={() => onChange([])}
            className="shrink-0 inline-flex items-center gap-0.5 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
          >
            <X className="w-3 h-3" />解除
          </button>
        </div>
      )}
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
      {(showAll || remainingCollapsed > 0) && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="text-xs text-brand-500 hover:text-brand-700 dark:text-brand-400 mt-1.5 inline-flex items-center gap-1"
        >
          {showAll
            ? <><ChevronUp className="w-3.5 h-3.5" />折りたたむ</>
            : <><ChevronDown className="w-3.5 h-3.5" />すべてのジャンル（残り {remainingCollapsed} 件）</>}
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
    groups[recentGroupIndex(hit.createdAt || hit.lastEdited, now.getTime())].hits.push(hit)
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
        <StudyNoteCard />
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
type RefLevel = 'all' | 'deep' | 'card'
// 参考文献の収録レベル判定。📄精読ノート（Tier A・柱の深掘り）／🔖文献カード（Tier B・支持文献の要点）。
// 収録レベルはサブスク配信のReference Libraryだけが持つプロパティで、一般ユーザーに配布している
// テンプレのReference DBには存在しない。未設定（＝一般ユーザーの文献）はこの仕組みの対象外として、
// 新着・絞り込みとも従来どおりの扱いにする（isDeepNote/isRefCardの両方がfalse）。
function isDeepNote(h: Hit): boolean {
  return (h.recordingLevel || '').includes('精読')
}
function isRefCard(h: Hit): boolean {
  return !!(h.recordingLevel || '').trim() && !isDeepNote(h)
}
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
  const [sort, setSort] = useState<RefSort>('lastEdited')
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')
  // 収録レベルの絞り込み。既定(all)では📄精読ノートを上に寄せ、柱の文献が🔖文献カードに埋もれないようにする。
  const [refLevel, setRefLevel] = useState<RefLevel>('all')
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
  // 特定部署（team:<id>）は buildOwnerFilter が owner:team に正規化する（Algolia に team は無い）。
  const refOwnerFilter = ownerFilter === 'subscription'
    ? 'owner:__none__'
    : buildOwnerFilter(ownerFilter)
  const refPersonalFilter = refOwnerFilter
    ? `source:reference AND ${refOwnerFilter}`
    : 'source:reference'

  // サブスク側フィルタ: source:reference (プレミアム / all) or 無効化
  useEffect(() => {
    if (!ctx) return
    if (ownerFilter === 'personal' || isTeamOwner(ownerFilter)) {
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
    if (isTeamOwner(ownerFilter)) {
      const id = teamIdOf(ownerFilter)
      return personalAndTeam.filter((h) => h.owner === 'team' && (id ? h.teamId === id : true))
    }
    const seen = new Set<string>()
    const merged: Hit[] = []
    for (const h of personalAndTeam) { if (!seen.has(h.objectID)) { merged.push(h); seen.add(h.objectID) } }
    for (const h of subHits) { if (!seen.has(h.objectID)) { merged.push(h); seen.add(h.objectID) } }
    return merged
  }, [ownerFilter, personalAndTeam, subHits])

  const filtered = useMemo(
    () => {
      const base = filterRefHits(mergedHits, query, refYear, refGenre)
      if (refLevel === 'all') return base
      // チップは収録レベルの付いた文献（サブスク配信）だけを対象に振り分ける。
      // 収録レベルの無い一般ユーザー自身の文献は「すべて」でのみ表示。
      return base.filter((h) => (refLevel === 'deep' ? isDeepNote(h) : isRefCard(h)))
    },
    [mergedHits, query, refYear, refGenre, refLevel],
  )
  // 収録レベルのバッジが付いた文献が両種そろっている時だけ、絞り込みチップを出す（片方しか無ければ無意味）。
  const hasDeep = useMemo(() => mergedHits.some(isDeepNote), [mergedHits])
  const hasCard = useMemo(() => mergedHits.some(isRefCard), [mergedHits])
  const showLevelChips = hasDeep && hasCard
  const sorted = [...filtered].sort((a, b) => {
    // 既定（レベル未指定）では📄精読ノートを先頭に寄せ、そのうえで選択中の並びを適用する。
    if (refLevel === 'all') {
      const ad = isDeepNote(a) ? 0 : 1
      const bd = isDeepNote(b) ? 0 : 1
      if (ad !== bd) return ad - bd
    }
    if (sort === 'year_desc') return (b.year || '0') > (a.year || '0') ? 1 : -1
    if (sort === 'year_asc') return (a.year || '0') > (b.year || '0') ? 1 : -1
    return (b.lastEdited || '') > (a.lastEdited || '') ? 1 : -1
  })
  const isFiltering = !!(query.trim() || refYear || refGenre || refLevel !== 'all')

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
            className="flex-1 min-w-0 border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
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
        {showLevelChips && !(ownerFilter === 'subscription' && !hasSubscription) && (
          <div className="mt-2 flex gap-1.5">
            {(([['all', 'すべて'], ['deep', '精読ノート'], ['card', '文献カード']]) as [RefLevel, string][]).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setRefLevel(v)}
                className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                  refLevel === v
                    ? 'bg-amber-600 text-white border-transparent'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
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

// newSince: 筆者追加分の既読水位（これより新しいプレミアム配信ページに「New」チップを出す）
function RecentTabWithOwner({ hasTeam, hasSubscription, newSince }: { hasTeam: boolean; hasSubscription: boolean; newSince?: string }) {
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
    if (ownerFilter === 'personal' || isTeamOwner(ownerFilter)) {
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
  // 新着は🔖文献カード（サブスク配信の支持文献）を出さない。数の多い文献カードで新着が埋まり、
  // 会員が追いたいCQ・ナレッジ・📄精読ノートが沈むのを防ぐ（文献カードは参考文献タブとナレッジからの導線で辿る）。
  // 収録レベルを持たない一般ユーザー自身の文献は、これまでどおり新着に出る。
  const visibleHits = useMemo(
    () => mergedHits.filter((h) => h.source !== 'reference' || !isRefCard(h)),
    [mergedHits],
  )
  const now = new Date()
  const groups: { label: string; hits: Hit[] }[] = [
    { label: '今日', hits: [] },
    { label: '今週', hits: [] },
    { label: '今月', hits: [] },
    { label: 'それ以前', hits: [] },
  ]
  for (const hit of visibleHits) {
    groups[recentGroupIndex(hit.createdAt || hit.lastEdited, now.getTime())].hits.push(hit)
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
      ) : visibleHits.length === 0 ? (
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
                {group.hits.map((hit) => <ResultCard key={hit.objectID} hit={hit} isNew={isNewAuthorAddition(hit, newSince || '')} />)}
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
    : buildOwnerFilter(ownerFilter)
  const quizPersonalFilter = quizOwnerFilter
    ? `source:medical AND ${quizOwnerFilter}`
    : 'source:medical'

  useEffect(() => {
    if (!ctx) return
    if (ownerFilter === 'personal' || isTeamOwner(ownerFilter)) {
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
                <StudyNoteCard />
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
          <Gift className="h-3 w-3 shrink-0" />最初の2週間は無料
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
        {loading ? <><Spinner className="h-4 w-4" />読み込み中...</> : <><Star className="h-4 w-4" />2週間無料で試す<ArrowRight className="h-4 w-4" /></>}
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
    : buildOwnerFilter(ownerFilter)

  // サブスク側のフィルタ：'personal'/team系の時は空にする、それ以外は通常検索
  useEffect(() => {
    if (!ctx) return
    if (ownerFilter === 'personal' || isTeamOwner(ownerFilter)) {
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
      <DailyQuestionCard />
      <div className="sticky top-[calc(120px+env(safe-area-inset-top))] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-3 pt-1 -mx-4 px-4">
        <SearchBox onSubmit={(q) => { addHistory(q); setHasSearched(true) }} history={history} />
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
          <BookmarksList />
          <RecentViewsList />
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
          additionalTeams: settings.additionalTeams && settings.additionalTeams.length ? settings.additionalTeams : undefined,
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
          additionalTeams: settings.additionalTeams && settings.additionalTeams.length ? settings.additionalTeams : undefined,
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
    ctx.setSubFilters(ownerFilter === 'personal' || isTeamOwner(ownerFilter) ? 'owner:__none__' : '')
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
  const [inputFocused, setInputFocused] = useState(false)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !composingRef.current && !e.nativeEvent.isComposing && query.trim()) {
      addHistory(query.trim())
    }
  }

  return (
    <>
      <DailyQuestionCard />
      <div className="sticky top-[calc(120px+env(safe-area-inset-top))] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-3 pt-1 -mx-4 px-4">
        <div className="relative mb-2">
          <input
            type="search"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onCompositionStart={() => { composingRef.current = true }}
            onCompositionEnd={() => { composingRef.current = false }}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder="キーワードで検索..."
            className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
          />
          <SearchSuggest
            value={query}
            history={history}
            visible={inputFocused}
            onPick={(q) => { addHistory(q); handleChange(q) }}
          />
        </div>
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
          <BookmarksList />
          <RecentViewsList />
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
// newSince: 筆者追加分の既読水位（これより新しいプレミアム配信ページに「New」チップを出す）
function NotionRecentTab({ hasTeam, hasSubscription, newSince }: { hasTeam: boolean; hasSubscription: boolean; newSince?: string }) {
  const { records, loading, error } = useNotionSearch('recent')
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')
  const ctx = useSubscriptionHits()
  const now = new Date()

  useEffect(() => {
    if (!ctx) return
    ctx.setSubFilters(ownerFilter === 'personal' || isTeamOwner(ownerFilter) ? 'owner:__none__' : '')
    ctx.setSubHitsPerPage(100)
  }, [ownerFilter, ctx])

  const subHits = ctx?.hits || []
  const merged = useMemo(() => {
    const all = mergeHitsByOwnerFilter(records, subHits, ownerFilter)
    // 新着は🔖文献カード（サブスク配信の支持文献）を出さない（パワーモードのRecentTabWithOwnerと同じ方針）。
    // 数の多い文献カードで新着が埋まり、CQ・ナレッジ・📄精読ノートが沈むのを防ぐ。
    // 収録レベルを持たない一般ユーザー自身の文献は、これまでどおり新着に出る。
    return all.filter((h) => h.source !== 'reference' || !isRefCard(h))
  }, [records, subHits, ownerFilter])

  const groups: { label: string; hits: Hit[] }[] = [
    { label: '今日', hits: [] },
    { label: '今週', hits: [] },
    { label: '今月', hits: [] },
    { label: 'それ以前', hits: [] },
  ]

  for (const hit of merged) {
    groups[recentGroupIndex(hit.createdAt || hit.lastEdited, now.getTime())].hits.push(hit)
  }

  const ownerTabs = (
    <div className="sticky top-[calc(120px+env(safe-area-inset-top))] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-2 pt-1 -mx-4 px-4 mb-2">
      <OwnerFilterTabs owner={ownerFilter} onChange={setOwnerFilter} hasTeam={hasTeam} hasSubscription={hasSubscription} />
    </div>
  )

  if (ownerFilter === 'subscription' && !hasSubscription) return <>{ownerTabs}<SubscriptionPromoPanel /></>
  if (loading) return <>{ownerTabs}<SkeletonCards /></>
  if (error) return <>{ownerTabs}<SearchErrorNotice error={error} /></>
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
            {group.hits.map((hit) => <ResultCard key={hit.objectID} hit={hit} isNew={isNewAuthorAddition(hit, newSince || '')} />)}
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
    ctx.setSubFilters(ownerFilter === 'personal' || isTeamOwner(ownerFilter) ? 'owner:__none__' : 'source:medical')
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
  if (error) return <>{ownerTabs}<SearchErrorNotice error={error} /></>
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
        additionalTeams: settings.additionalTeams && settings.additionalTeams.length ? settings.additionalTeams : undefined,
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
    else if (isTeamOwner(ownerFilter)) set = new Set(Object.keys(facets.team))
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
    if (isTeamOwner(ownerFilter)) {
      const id = teamIdOf(ownerFilter)
      return genreRecords.filter((h) => h.owner === 'team' && (id ? h.teamId === id : true))
    }
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
            additionalTeams: settings.additionalTeams && settings.additionalTeams.length ? settings.additionalTeams : undefined,
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
    const subTask: Promise<Hit[]> = subEnabled && ownerFilter !== 'personal' && !isTeamOwner(ownerFilter)
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
  // ドット凡例（GenreBrowseと同条件）：「全て」表示中かつ画面内にドットがある時だけ。
  const showTeamLegend = ownerFilter === 'all' && visibleGenres.some((g) => (facets.team[g] || 0) > 0)
  const showSubLegend = ownerFilter === 'all' && visibleGenres.some((g) => (facets.subscription[g] || 0) > 0)

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
                : isTeamOwner(ownerFilter)
                  ? teamCount
                  : ownerFilter === 'personal'
                    ? personalCount
                    : personalCount + teamCount + subCount
              const hasSub = subCount > 0 && ownerFilter !== 'personal' && !isTeamOwner(ownerFilter)
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
          <GenreDotLegend showTeam={showTeamLegend} showSub={showSubLegend} />
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

// マニュアルカード：種別バッジ・掲載日付きの軽量カード（ResultCardは医療/文献用なので別実装）。
// マニュアル系（マニュアル/お知らせ/業務改善）は出現頻度が低いので「1カテゴリ＝1色」で扱い、
// 医療カード（CQ=ローズ/ナレッジ=常盤/まとめ=スカイ/Ref=琥珀）と一目で見分けが
// つくようスレート（落ち着いた青みグレー）に統一する。サブ種別の違いはバッジの文字で示す。
const MANUAL_BADGE_STYLE = 'bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300'
const MANUAL_TYPE_STYLE: Record<string, string> = {
  '📕 マニュアル': MANUAL_BADGE_STYLE,
  '📝 メモ': MANUAL_BADGE_STYLE,
  '📢 お知らせ': MANUAL_BADGE_STYLE,
  '🔧 業務改善': MANUAL_BADGE_STYLE,
}

// 種別の正規化（先頭絵文字と空白を除去）。表記ゆれ・絵文字有無を吸収して
// タブ所属の判定やフィルタ照合に使う。norm('📝 メモ')==='メモ'。
function normManualType(s: string | null | undefined): string {
  return stripLeadingEmoji(s).replace(/\s+/g, '')
}
// 種別タブの正順。マニュアルDBは個人×部署の二層設計のため、個人で生きる
// マニュアル・メモを前、部署で生きるお知らせ・業務改善を後ろに置く。
// 実際に出すのはこのうちレコードが存在する種別だけ（ジャンルと同じ動的表示）。
const MANUAL_TYPE_ORDER = ['📕 マニュアル', '📝 メモ', '📢 お知らせ', '🔧 業務改善']
function ManualCard({ hit }: { hit: Hit }) {
  const [expanded, setExpanded] = useState(false)
  const displaySummary = hit.aiSummary || hit.summary || null
  const hasExpandable = !!displaySummary
  const typeStyle = hit.manualType ? (MANUAL_TYPE_STYLE[hit.manualType] || MANUAL_BADGE_STYLE) : ''
  const ownerLabel = hit.owner === 'team' ? (hit.teamLabel || '部署') : null
  const publishedLabel = hit.publishedAt
    ? new Date(hit.publishedAt).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' })
    : ''
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 border-l-4 border-l-slate-400 overflow-hidden">
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
            <a href={hit.notionUrl} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.stopPropagation(); recordRecentView(hit) }}
              className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-800">
              Notionで開く
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}
      {!hasExpandable && (
        <a href={hit.notionUrl} target="_blank" rel="noopener noreferrer" onClick={() => recordRecentView(hit)} className="inline-flex items-center gap-1 px-4 pb-3 text-xs text-brand-500 hover:text-brand-700">Notionで開く<ExternalLink className="w-3.5 h-3.5" /></a>
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
    // 種別はNotionのセレクト値がそのまま入る。テンプレDBは「📕 マニュアル」だが、
    // 自作DBでは「マニュアル」「お知らせ（重要）」等の絵文字なし・接尾辞つきもあり得る。
    // 完全一致だと表記ゆれで種別タブから無言で漏れるため、絵文字と空白を除いた
    // 部分一致でゆるく照合する（知識レベル判定と同じ寛容さに揃える）。
    const want = normManualType(typeFilter)
    return records.filter((r) => normManualType(r.manualType).includes(want))
  }, [records, typeFilter])

  // 種別タブは「実在する種別だけ」を正順で出す（ジャンルと同じ動的表示）。個人ユーザーに
  // 使わないお知らせ・業務改善の空タブを見せないため。0〜1種別なら絞り込む意味がないので
  // 種別バー自体を隠す（空DBは下のEmptyNoticeが案内を出すのでバグには見えない）。
  const presentTypes = useMemo(
    () => MANUAL_TYPE_ORDER.filter((c) => {
      const want = normManualType(c)
      return records.some((r) => normManualType(r.manualType).includes(want))
    }),
    [records],
  )
  const showTypeBar = presentTypes.length >= 2
  const TYPE_TABS = ['', ...presentTypes]
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
          placeholder="マニュアル・メモ・お知らせを検索..."
          className="w-full border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300 mb-2"
        />
        {showTypeBar && (
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
        )}
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
  const [sort, setSort] = useState<RefSort>('lastEdited')
  const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>('all')
  // 収録レベルの絞り込み。既定(all)では📄精読ノートを上に寄せ、柱の文献が🔖文献カードに埋もれないようにする。
  const [refLevel, setRefLevel] = useState<RefLevel>('all')
  const [query, setQuery] = useState('')
  const [refYear, setRefYear] = useState<string | null>(null)
  const [refGenre, setRefGenre] = useState<string | null>(null)
  const ctx = useSubscriptionHits()

  // 個人records は medical+reference 混在。reference のみ抽出
  const refRecords = records.filter((r) => r.source === 'reference')

  useEffect(() => {
    if (!ctx) return
    ctx.setSubFilters(ownerFilter === 'personal' || isTeamOwner(ownerFilter) ? 'owner:__none__' : 'source:reference')
    ctx.setSubHitsPerPage(100)
  }, [ownerFilter, ctx])

  const subHits = ctx?.hits || []
  const merged = useMemo(
    () => mergeHitsByOwnerFilter(refRecords, subHits, ownerFilter),
    [refRecords, subHits, ownerFilter],
  )

  // キーワード・年・ジャンルで絞り込み（取得済みレコードに対するクライアント側フィルタ）
  const filtered = useMemo(
    () => {
      const base = filterRefHits(merged, query, refYear, refGenre)
      if (refLevel === 'all') return base
      // チップは収録レベルの付いた文献（サブスク配信）だけを対象に振り分ける。
      // 収録レベルの無い一般ユーザー自身の文献は「すべて」でのみ表示。
      return base.filter((h) => (refLevel === 'deep' ? isDeepNote(h) : isRefCard(h)))
    },
    [merged, query, refYear, refGenre, refLevel],
  )
  // 収録レベルの絞り込みチップは両種そろっている時だけ出す（片方しか無ければ無意味）。
  const hasDeep = useMemo(() => merged.some(isDeepNote), [merged])
  const hasCard = useMemo(() => merged.some(isRefCard), [merged])
  const showLevelChips = hasDeep && hasCard

  const sorted = [...filtered].sort((a, b) => {
    // 既定（レベル未指定）では📄精読ノートを先頭に寄せ、そのうえで選択中の並びを適用する。
    if (refLevel === 'all') {
      const ad = isDeepNote(a) ? 0 : 1
      const bd = isDeepNote(b) ? 0 : 1
      if (ad !== bd) return ad - bd
    }
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
          className="flex-1 min-w-0 border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand-300"
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
      {showLevelChips && !(ownerFilter === 'subscription' && !hasSubscription) && (
        <div className="mt-2 flex gap-1.5">
          {(([['all', 'すべて'], ['deep', '精読ノート'], ['card', '文献カード']]) as [RefLevel, string][]).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setRefLevel(v)}
              className={`shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                refLevel === v
                  ? 'bg-amber-600 text-white border-transparent'
                  : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-gray-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {!(ownerFilter === 'subscription' && !hasSubscription) && (
        <div className="mt-2">
          <RefBrowseChips hits={merged} year={refYear} onYear={setRefYear} genre={refGenre} onGenre={setRefGenre} />
        </div>
      )}
    </div>
  )

  const isFiltering = !!(query.trim() || refYear || refGenre || refLevel !== 'all')

  if (ownerFilter === 'subscription' && !hasSubscription) return <>{ownerTabs}<SubscriptionPromoPanel /></>
  if (loading) return <>{ownerTabs}<SkeletonCards /></>
  if (error) return <>{ownerTabs}<SearchErrorNotice error={error} /></>

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
// 設定パネル → src/components/SettingsPanel.tsx に分離（遅延読込）
// プレミアム共有部品 → src/components/premium-shared.tsx
// ============================================================

// ============================================================
// メインページ
// ============================================================

export default function Home() {
  const [tab, setTab] = useState<Tab>('search')
  // 筆者追加分（プレミアム配信の新規ナレッジ・精読ノート）の未読状態。
  // あれば新着タブにドット（A）、条件を満たせばダイジェスト一行（B）を出す。
  const [authorAdds, setAuthorAdds] = useState<AuthorAdditions | null>(null)
  // C（新着タブ内カードの「New」チップ）用に、既読化前の水位をこのセッション中だけ保持。
  // 既読化（水位の永続化）後もリロードまではチップを出し続け、「どれが増えた分か」を見せる。
  const [authorNewSince, setAuthorNewSince] = useState('')
  useEffect(() => {
    let cancelled = false
    fetchAuthorAdditions().then((a) => {
      if (cancelled || !a) return
      setAuthorAdds(a)
      setAuthorNewSince(a.since)
    })
    return () => { cancelled = true }
  }, [])
  // 新着タブを開いたら既読化（水位を前進させ、ドットとダイジェストを消す）。
  useEffect(() => {
    if (tab === 'recent' && authorAdds) {
      markAuthorAdditionsSeen(authorAdds.latestCreatedAt)
      setAuthorAdds(null)
    }
  }, [tab, authorAdds])
  // Algolia未設定画面の「シンプルモードに切り替える」直後に getSettings() を読み直させる更新カウンタ。
  const [, bumpSettingsVersion] = useState(0)
  const [setupDone, setSetupDone] = useState<boolean | null>(null)
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null)
  // ログイン済みで端末に設定が無いとき、SettingsSync の復元チェックが決着するまで
  // セットアップ入口を出さない（入口が一瞬見えて復元リロードでホームへ飛ぶ現象の防止）。
  const { configured: authConfigured, user: authUser, loading: authLoading } = useAuth()
  const [syncSettled, setSyncSettled] = useState(() => isSettingsSyncSettled())
  useEffect(() => {
    if (syncSettled) return
    const off = onSettingsSyncSettled(() => setSyncSettled(true))
    // 万一決着イベントが来ない場合の保険（10秒でセットアップ入口を出す）。
    const failsafe = setTimeout(() => setSyncSettled(true), 10_000)
    return () => { off(); clearTimeout(failsafe) }
  }, [syncSettled])
  const [showSettings, setShowSettings] = useState(false)
  // 設定パネルを開くとき最初に表示するセクション（null=トップ一覧）。
  // アカウント(👤)メニューの「プレミアム設定・解約を開く」から 'subscription' で開く。
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsPanelSection>(null)
  const [premiumActivating, setPremiumActivating] = useState(false)
  const [premiumMessage, setPremiumMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  // 機能ツアー（はじめてガイド）。セットアップ完了直後の一度だけ自動表示し、
  // 設定 → ヘルプの「もう一度見る」からも呼び出せる。
  const [showTour, setShowTour] = useState(false)

  // 設定パネル（ヘルプ）からの機能ツアー再表示要求を購読。
  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = () => setShowTour(true)
    window.addEventListener('medinode:show-feature-tour', handler)
    return () => window.removeEventListener('medinode:show-feature-tour', handler)
  }, [])

  // 設定パネル（遅延チャンク）を起動後のアイドル時間に静かに先読みする。
  // これが無いと、弱電波で設定を初めて開いたときチャンク取得がストールし、
  // 閉じられないスピナーが出続けうる。先読みしておけば通常はキャッシュ即開、
  // さらに Service Worker のキャッシュにも入るためオフラインでも設定を開ける。
  // 失敗しても無視（開く瞬間に改めて読み込まれる）。
  useEffect(() => {
    const t = setTimeout(() => { import('@/components/SettingsPanel').catch(() => {}) }, 3000)
    return () => clearTimeout(t)
  }, [])

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

    // PremiumSync に「このロードは verify が契約状態を確定する」と伝える。
    // URLからパラメータを消す前に立てないと、消した後に走った PremiumSync が
    // 古い契約状態（自動トライアル等）で verify の保存結果を上書きするレースになる。
    try { sessionStorage.setItem(PREMIUM_VERIFY_FLAG, '1') } catch {}

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
            // 新規契約なので解約予約表示もクリア。
            subscriptionCancelAt: '',
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
        // 成功時は直後のリロードで、失敗時はこのロードのまま、次からは通常同期に戻す。
        try { sessionStorage.removeItem(PREMIUM_VERIFY_FLAG) } catch {}
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

  // ログイン済みなのに端末へ設定が無い＝サーバーからの復元が走る可能性が高い状態。
  // SettingsSync の決着（復元→リロード or 設定なし確定）まで、オンボーディングや
  // セットアップ入口を出さずに確認中表示を出す（一瞬出て消える画面を防ぐ）。
  // ※ 設定やセットアップ入力の途中経過（draft）がこの端末にある場合は掛けない。
  //   セットアップ最後のアカウント登録でログイン状態になった瞬間にウィザードを
  //   アンマウントしてしまい、完了処理（設定保存→完了）を巻き込む事故を防ぐため。
  if (!setupDone && authConfigured && authUser && !syncSettled && !getSettings() && !getDraft()) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-white dark:bg-gray-900">
        <Spinner className="h-6 w-6 text-brand-500" />
        <p className="text-sm text-gray-500 dark:text-gray-400">保存された設定を確認しています…</p>
      </div>
    )
  }

  // 初回のみオンボーディング（setupが未完了の場合のみ表示）、またはSetupWizardのヘルプ内「アプリの紹介」から再表示
  if ((!onboardingDone && !setupDone) || showOnboardingFromSetup) {
    return (
      <OnboardingScreen
        onComplete={completeOnboarding}
        onSkip={completeOnboarding}
      />
    )
  }

  if (!setupDone) {
    return <SetupWizard onComplete={() => { setSetupDone(true); setShowSettings(false); setSetupInitialStep('entry'); if (!isFeatureTourDone()) setShowTour(true) }} onShowOnboarding={() => setShowOnboardingFromSetup(true)} initialStep={setupInitialStep} />
  }

  const settings = getSettings()
  // 完了フラグが立っていても設定の実体が無い場合はセットアップへ戻す
  // （ログイン復元の事故などで空設定のままホームへ来た場合の防御。
  //   放置すると searchMode が 'algolia' 扱いになり「追加設定が必要です」で行き止まる）。
  if (!settings) {
    return <SetupWizard onComplete={() => { setSetupDone(true); setShowSettings(false); setSetupInitialStep('entry'); if (!isFeatureTourDone()) setShowTour(true) }} onShowOnboarding={() => setShowOnboardingFromSetup(true)} initialStep="entry" />
  }

  // ログイン必須モード（REQUIRE_LOGIN=true・proxyがcookieで通知）では、設定済み端末でも
  // 未ログインならホームを見せず、全画面のログインゲートを出す。トップはセットアップの
  // ため公開しているので、ここ（設定済み×未ログイン）だけがすり抜ける。全APIがログイン
  // 必須で何も表示できないガワだけのホームに着地させない。/loginへのリダイレクトではなく
  // トップ上で出すのは、はじめての人がオンボーディング→セットアップへ入る導線を
  // 残すため（リダイレクトだと/loginの「トップページへ」がここに跳ね返されて行き止まり）。
  // オンボーディング・セットアップ動線（上の分岐で処理済み）とモニター期（cookie=0）には影響しない。
  if (isLoginRequiredByServer() && authConfigured && (authLoading || !authUser)) {
    if (authLoading) return <AppSkeleton />
    return (
      <LoginGate
        onStartSetup={() => {
          // オンボーディングから始めて入口分岐→セットアップへ（初回動線と同じ順序）。
          // 端末の保存済み設定は消さない（セットアップ完了時に上書きされる）。
          setSetupInitialStep('entry')
          setOnboardingDone(false)
          setSetupDone(false)
        }}
      />
    )
  }

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
            {/* 外部ガイド直行はやめ、アプリ内ヘルプ（FAQ検索）を開く。ガイド全文はヘルプ内リンクから */}
            <button
              onClick={() => {
                setSettingsInitialSection('help')
                setShowSettings(true)
                track('help_open', { from: 'header' })
              }}
              className="w-10 h-10 -my-1 grid place-items-center rounded-xl text-gray-400 dark:text-gray-500 hover:text-brand-600 dark:hover:text-brand-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              title="ヘルプ"
            >
              <HelpCircle className="w-5 h-5" />
            </button>
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
              <span className="relative">
                <t.Icon className="w-[17px] h-[17px]" strokeWidth={2} />
                {/* 筆者追加分の未読ドット。新着タブを開いたら消える（文言なしの最も静かな通知） */}
                {t.id === 'recent' && authorAdds && (
                  <span className="absolute -top-0.5 -right-1 w-1.5 h-1.5 rounded-full bg-teal-500 dark:bg-teal-400">
                    <span className="sr-only">プレミアムに新しい追加があります</span>
                  </span>
                )}
              </span>
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

  // はじめてガイド（機能ツアー）。CQステップは実際にボタンが出ている場合のみ。
  const tourModal = showTour && (
    <FeatureTour
      searchMode={searchMode === 'notion' ? 'notion' : 'algolia'}
      showCqStep={!!(settings?.notionToken && settings?.notionMedicalDbId) && !settings?.hideCqButton}
      onClose={() => setShowTour(false)}
    />
  )

  // ========== Notionモード ==========
  if (searchMode === 'notion') {
    return (
      <SubscriptionSearchProvider enableBridge={true}>
      <OpenSettingsContext.Provider value={(section) => { setSettingsInitialSection(section ?? null); setShowSettings(true) }}>
      <CqCaptureProvider>
      <ReaderMarksProvider>
      <ReaderProvider>
      <div className="min-h-screen bg-gradient-to-b from-brand-50 to-gray-50 dark:from-gray-900 dark:to-gray-800">
        {header}
        <PwaInstallBanner />
        <UpdateBanner />
        <TrialLifecycleNotice />
        <ResolvedCqBanner />
        <AuthorAdditionsBanner additions={authorAdds} onOpenRecent={() => setTab('recent')} />
        <FeedbackNudgeBanner />
        <div className="max-w-2xl mx-auto px-4 py-4">
          <PowerModeUpgradeBanner onOpenSettings={() => setShowSettings(true)} />
          {activeTab === 'search' && <NotionSearchTab hasTeam={hasTeam} hasSubscription={hasSubscription} />}
          {activeTab === 'recent' && <NotionRecentTab hasTeam={hasTeam} hasSubscription={hasSubscription} newSince={authorNewSince} />}
          {activeTab === 'browse' && <NotionBrowseTab hasTeam={hasTeam} hasSubscription={hasSubscription} />}
          {activeTab === 'reference' && <NotionReferenceTab hasTeam={hasTeam} hasSubscription={hasSubscription} />}
          {activeTab === 'quiz' && <NotionQuizTab hasTeam={hasTeam} hasSubscription={hasSubscription} />}
          {activeTab === 'manual' && <NotionManualTab />}
        </div>
        {settingsModal}
        {tourModal}
      </div>
      </ReaderProvider>
      </ReaderMarksProvider>
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
    // シンプルモード（Notion直結）は個人・部署のNotion接続、またはプレミアムの
    // いずれかがあれば追加設定なしで動く（プレミアムのみの利用はシンプル固定が本来の姿）。
    const canUseSimpleMode = !!(
      (settings?.notionToken && settings?.notionMedicalDbId) ||
      (settings?.teamNotionToken && settings?.teamNotionMedicalDbId) ||
      hasSubscription
    )
    return (
      <ReaderMarksProvider>
      <ReaderProvider>
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
      </ReaderProvider>
      </ReaderMarksProvider>
    )
  }

  const dynamicSearchClient = createSearchClient()
  const dynamicIndexName = settings?.algoliaIndex || getIndexName()

  return (
    <SubscriptionSearchProvider enableBridge={true}>
    <OpenSettingsContext.Provider value={(section) => { setSettingsInitialSection(section ?? null); setShowSettings(true) }}>
    <CqCaptureProvider>
    <ReaderMarksProvider>
    <ReaderProvider>
    <InstantSearch searchClient={dynamicSearchClient} indexName={dynamicIndexName} future={{ preserveSharedStateOnUnmount: false }}>
      <div className="min-h-screen bg-gradient-to-b from-brand-50 to-gray-50 dark:from-gray-900 dark:to-gray-800">
        {header}
        <PwaInstallBanner />
        <UpdateBanner />
        <TrialLifecycleNotice />
        <ResolvedCqBanner />
        <AuthorAdditionsBanner additions={authorAdds} onOpenRecent={() => setTab('recent')} />
        <FeedbackNudgeBanner />
        <div className="max-w-2xl mx-auto bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm border-b border-gray-100 dark:border-gray-700">
          <SyncPanel />
        </div>
        <div className="max-w-2xl mx-auto px-4 py-4">
          <AlgoliaSearchErrorNotice />
          {activeTab === 'search' && <SearchTab hasTeam={hasTeam} hasSubscription={hasSubscription} />}
          {activeTab === 'recent' && (
            <RecentTabWithOwner hasTeam={hasTeam} hasSubscription={hasSubscription} newSince={authorNewSince} />
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
      {tourModal}
    </InstantSearch>
    </ReaderProvider>
    </ReaderMarksProvider>
    </CqCaptureProvider>
    </OpenSettingsContext.Provider>
    </SubscriptionSearchProvider>
  )
}
