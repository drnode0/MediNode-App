'use client'
import { useHits, Configure } from 'react-instantsearch'
import { Lightbulb, ClipboardList, X, ChevronUp, ChevronDown, Search } from 'lucide-react'
import { useState, useMemo, useEffect } from 'react'
import {
  createSearchClient,
  getIndexName,
  createSubscriptionSearchClient,
  getSubscriptionIndexName,
  hasSubscriptionConfig,
} from '@/lib/algolia'
import { getSettings } from '@/lib/settings'
import { ResultCard, type Hit } from './ResultCard'
import { isTeamOwner, teamIdOf, type OwnerFilter } from './OwnerFilterTabs'
import {
  genreHueIndex,
  mergeGenreKeys,
  pickRepresentativeVariant,
  genreFacetFilter,
  genreMatchesCanonical,
  departmentColorToken,
  type DepartmentColorToken,
} from '@/lib/genre'

// 部署(team)はAlgoliaで管理しないため、Notionから直読みするフック。
// /api/notion/search の mode:'browse' で部署DB全件を取得し、owner==='team'のみ採用。
function useTeamGenreHits(): { teamHits: Hit[]; loading: boolean } {
  const [teamHits, setTeamHits] = useState<Hit[]>([])
  const [loading, setLoading] = useState(false)

  // 設定値を依存配列に入れて、設定変更（部署Reference DB追加など）後に
  // 再マウントしなくても再取得されるようにする。空依存だと設定追加が反映されず
  // 「部署DBを直したのにジャンルに反映されない」再発の温床になるため。
  const settings = getSettings()
  const teamToken = settings?.teamNotionToken || ''
  const teamMedicalDbId = settings?.teamNotionMedicalDbId || ''
  const teamReferenceDbId = settings?.teamNotionReferenceDbId || ''
  const teamLabel = settings?.teamLabel || ''
  // 追加部署（先行体験）。依存配列に入れて設定変更後に再取得させる。
  const additionalTeams = settings?.additionalTeams
  const additionalTeamsKey = JSON.stringify(additionalTeams ?? [])

  useEffect(() => {
    if (!teamToken || !teamMedicalDbId) {
      setTeamHits([])
      return
    }
    let cancelled = false
    setLoading(true)
    fetch('/api/notion/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // 部署DBのみ取得（teamOnly）。二重クエリを避ける。
        notionToken: teamToken,
        notionMedicalDbId: teamMedicalDbId,
        teamNotionToken: teamToken,
        teamNotionMedicalDbId: teamMedicalDbId,
        // 参考文献もジャンルタブに表示するため部署Reference DBも渡す。
        teamNotionReferenceDbId: teamReferenceDbId || undefined,
        // 部署バッジに部署名（例: 救急）を表示するため渡す。
        teamLabel: teamLabel || undefined,
        additionalTeams: additionalTeams && additionalTeams.length ? additionalTeams : undefined,
        teamOnly: true,
        mode: 'browse',
        pageSize: 200,
      }),
    })
      .then((res) => res.ok ? res.json() : { records: [] })
      .then((data) => {
        if (cancelled) return
        const all = (data.records as Hit[]) || []
        setTeamHits(all.filter((h) => h.owner === 'team'))
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setTeamHits([])
        setLoading(false)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamToken, teamMedicalDbId, teamReferenceDbId, teamLabel, additionalTeamsKey])

  return { teamHits, loading }
}

// Hitからジャンル一覧を正規化（genreList → genre[] → genre）
function getHitGenres(h: Hit): string[] {
  let list: string[] = []
  if (h.genreList && h.genreList.length) list = h.genreList
  else if (Array.isArray(h.genre)) list = h.genre
  else if (h.genre) list = [h.genre as string]
  return Array.from(new Set(list.map((g) => g.trim()).filter(Boolean)))
}

// ジャンルボタンの折りたたみ閾値（これを超えたら「すべて表示」で展開）
const GENRE_SHOW_LIMIT = 12

// 個人・サブスクのファセット（Algolia由来）。部署は per-team で別管理（teamFacetsByTeam）。
type FacetData = {
  personal: Record<string, number>
  subscription: Record<string, number>
}
// 部署ごとのジャンル件数: teamId → (genreKey → count)
type TeamFacetsByTeam = Record<string, Record<string, number>>

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
// ジャンルチップの巡回トーン（オンボーディングと同系のペール5色）。
// Notionモードのジャンルタブ（page.tsx）とも共有する。
const CHIP_TONES = [
  { active: 'bg-brand-600 text-white border-transparent shadow-sm', idle: 'bg-brand-50 dark:bg-brand-900/25 border-brand-100 dark:border-brand-800 text-brand-900 dark:text-brand-200 hover:border-brand-300' },
  { active: 'bg-amber-500 text-white border-transparent shadow-sm', idle: 'bg-amber-50 dark:bg-amber-900/25 border-amber-100 dark:border-amber-800 text-amber-900 dark:text-amber-200 hover:border-amber-300' },
  { active: 'bg-sky-500 text-white border-transparent shadow-sm', idle: 'bg-sky-50 dark:bg-sky-900/25 border-sky-100 dark:border-sky-800 text-sky-900 dark:text-sky-200 hover:border-sky-300' },
  { active: 'bg-violet-500 text-white border-transparent shadow-sm', idle: 'bg-violet-50 dark:bg-violet-900/25 border-violet-100 dark:border-violet-800 text-violet-900 dark:text-violet-200 hover:border-violet-300' },
  { active: 'bg-rose-500 text-white border-transparent shadow-sm', idle: 'bg-rose-50 dark:bg-rose-900/25 border-rose-100 dark:border-rose-800 text-rose-900 dark:text-rose-200 hover:border-rose-300' },
]
// 色相の決め方は genreHueIndex（lib/genre）に集約。番号プレフィックスがあれば番号順、
// 無ければ名前ハッシュで安定的に色相を決める。背景トーン(CHIP_TONES)と左色帯(ACCENT)が
// 同じ色相indexを共有するので、同じジャンルは常に同じ色相になる。
// page.tsx（searchタブのジャンル絞り込みチップ）でも使うため戻り値は不変。
export function genreChipTone(genre: string): { active: string; idle: string } {
  return CHIP_TONES[genreHueIndex(genre, CHIP_TONES.length)]
}

// ジャンルチップの「中立地＋左色帯」用トーン。CHIP_TONESと同じ5色相の並び。
// bar=左端の色帯、selBg=選択中の地の薄tint。
const ACCENT_BARS = [
  'bg-brand-400 dark:bg-brand-500',
  'bg-amber-400 dark:bg-amber-500',
  'bg-sky-400 dark:bg-sky-500',
  'bg-violet-400 dark:bg-violet-500',
  'bg-rose-400 dark:bg-rose-500',
]
const ACCENT_SEL_BG = [
  'bg-brand-50 dark:bg-brand-900/25',
  'bg-amber-50 dark:bg-amber-900/25',
  'bg-sky-50 dark:bg-sky-900/25',
  'bg-violet-50 dark:bg-violet-900/25',
  'bg-rose-50 dark:bg-rose-900/25',
]
function genreAccentTone(genre: string): { bar: string; selBg: string } {
  const i = genreHueIndex(genre, ACCENT_BARS.length)
  return { bar: ACCENT_BARS[i], selBg: ACCENT_SEL_BG[i] }
}

// 部署カラー（token→Tailwindクラス）。全キーをリテラルで持つことでTailwindが検出できる。
const DEPT_DOT_BG: Record<DepartmentColorToken, string> = {
  green: 'bg-green-500',
  amber: 'bg-amber-500',
  sky: 'bg-sky-500',
  rose: 'bg-rose-500',
  teal: 'bg-teal-500',
  orange: 'bg-orange-500',
}
const DEPT_CHIP: Record<DepartmentColorToken, { active: string; idle: string }> = {
  green: { active: 'bg-green-600 text-white', idle: 'bg-green-50 text-green-700 dark:bg-green-900/25 dark:text-green-300' },
  amber: { active: 'bg-amber-500 text-white', idle: 'bg-amber-50 text-amber-700 dark:bg-amber-900/25 dark:text-amber-300' },
  sky: { active: 'bg-sky-600 text-white', idle: 'bg-sky-50 text-sky-700 dark:bg-sky-900/25 dark:text-sky-300' },
  rose: { active: 'bg-rose-500 text-white', idle: 'bg-rose-50 text-rose-700 dark:bg-rose-900/25 dark:text-rose-300' },
  teal: { active: 'bg-teal-600 text-white', idle: 'bg-teal-50 text-teal-700 dark:bg-teal-900/25 dark:text-teal-300' },
  orange: { active: 'bg-orange-500 text-white', idle: 'bg-orange-50 text-orange-700 dark:bg-orange-900/25 dark:text-orange-300' },
}

// 部署メタ（順序リスト）。追加順の index で色を割り当て、1個目=緑。
// フィルタチップ・ドット・凡例が同じソースを使うことで色がずれないようにする。
type TeamMeta = { id: string; label: string; colorToken: DepartmentColorToken; ownerFilterId: OwnerFilter }
function orderedTeams(hasTeam: boolean): TeamMeta[] {
  if (!hasTeam) return []
  const settings = getSettings()
  const teamLabel = (settings?.teamLabel || '').trim() || '部署'
  const primaryId = settings?.teamNotionMedicalDbId || ''
  const additional = (settings?.additionalTeams ?? []).filter((t) => t.label?.trim() && t.medicalDbId)
  const base: { id: string; label: string }[] = [
    { id: primaryId, label: teamLabel },
    ...additional.map((t) => ({ id: t.medicalDbId, label: t.label.trim() })),
  ]
  return base.map((t, i) => ({
    id: t.id,
    label: t.label,
    colorToken: departmentColorToken(i),
    ownerFilterId: (t.id ? `team:${t.id}` : 'team') as OwnerFilter,
  }))
}

function displayGenreName(g: string): string {
  return g.replace(/^\d+\./, '')
}

// ジャンルタブ専用のフィルタチップ（アプリ全体共用の OwnerFilterTabs とは別物）。
// 「ジャンルの時だけ薄く色をつける」要望に応え、プレミアム=紫・各部署=部署色で着色する。
// 全て/個人は中立ダーク（部署の緑と衝突させないため）。
type GenreChipOpt = { id: OwnerFilter; label: string; inactive?: boolean; token?: DepartmentColorToken; premium?: boolean }
function GenreOwnerFilterTabs({ owner, onChange, teams, hasTeam, hasSubscription }: {
  owner: OwnerFilter
  onChange: (v: OwnerFilter) => void
  teams: TeamMeta[]
  hasTeam: boolean
  hasSubscription: boolean
}) {
  const teamTabLabel = (getSettings()?.teamLabel || '').trim() || '部署'
  const teamChips: GenreChipOpt[] = hasTeam
    ? teams.map((t) => ({ id: t.ownerFilterId, label: t.label, token: t.colorToken }))
    : [{ id: 'team' as OwnerFilter, label: teamTabLabel, inactive: true }]
  const fixedOptions: GenreChipOpt[] = [
    { id: 'all', label: '全て' },
    { id: 'personal', label: '個人' },
    { id: 'subscription', label: 'プレミアム', inactive: !hasSubscription, premium: true },
  ]
  const chipClass = (o: GenreChipOpt): string => {
    const active = owner === o.id
    if (o.inactive) {
      return 'bg-gray-50 dark:bg-gray-800 text-gray-300 dark:text-gray-600 border border-gray-200 dark:border-gray-700'
    }
    if (o.token) {
      return active ? DEPT_CHIP[o.token].active : `${DEPT_CHIP[o.token].idle} hover:brightness-95`
    }
    if (o.premium) {
      return active
        ? 'bg-violet-600 text-white'
        : 'bg-violet-50 text-violet-700 dark:bg-violet-900/25 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40'
    }
    return active
      ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
      : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600'
  }
  const renderChip = (o: GenreChipOpt) => (
    <button
      key={o.id}
      onClick={() => onChange(o.id)}
      className={`shrink-0 text-xs font-medium px-3 py-1 rounded-full transition-colors ${chipClass(o)}`}
    >
      {o.label}
    </button>
  )
  return (
    <div className="flex gap-1.5 mb-3 items-center">
      {fixedOptions.map(renderChip)}
      <div className="flex gap-1.5 overflow-x-auto flex-1 min-w-0 pb-0.5 [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {teamChips.map(renderChip)}
      </div>
    </div>
  )
}

// ジャンルボタンの色ドット（緑=部署・紫=プレミアム）の凡例。ドットの意味を伝える手段が
// これまでtitle属性のみでスマホでは知りようがなかったため追加。ただし常設はしない：
// 部署・プレミアム未登録の人にはドット自体が出ないので、凡例も「画面内にドットが
// 1つでもある時だけ」表示する（Notionモードのジャンルタブと共用）。
export function GenreDotLegend({ showTeam, showSub }: { showTeam: boolean; showSub: boolean }) {
  const teamLabel = getSettings()?.teamLabel?.trim() || '部署'
  if (!showTeam && !showSub) return null
  return (
    <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-gray-400 dark:text-gray-500 -mt-1 mb-3">
      {showTeam && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-green-500" />
          {teamLabel}にもあります
        </span>
      )}
      {showSub && (
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-500" />
          プレミアムにもあります
        </span>
      )}
    </p>
  )
}

// 統合済みジャンル（1チップぶん）。key=正規化表示名、variants=束ねた元キー、rep=色/並びの代表。
type MergedGenreRow = { key: string; variants: string[]; rep: string }

function GenreList({ onGenreSelect, selectedGenre, owner, teamFacetsByTeam, teams }: {
  onGenreSelect: (sel: { key: string; variants: string[] } | null) => void
  selectedGenre: string | null
  owner: OwnerFilter
  teamFacetsByTeam: TeamFacetsByTeam
  teams: TeamMeta[]
}) {
  const [facetData, setFacetData] = useState<FacetData>({ personal: {}, subscription: {} })
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [filterText, setFilterText] = useState('')
  const subEnabled = hasSubscriptionConfig()

  useEffect(() => {
    let cancelled = false
    const idx = createSearchClient().initIndex(getIndexName())
    const tasks: Promise<{ source: 'personal' | 'subscription'; facets: Record<string, number> }>[] = []

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

  // 全部署を合算したジャンル件数（union と「全て」ビューの件数に使う）。
  const teamAggregate = useMemo(() => {
    const agg: Record<string, number> = {}
    for (const tid of Object.keys(teamFacetsByTeam)) {
      for (const [g, c] of Object.entries(teamFacetsByTeam[tid])) agg[g] = (agg[g] || 0) + c
    }
    return agg
  }, [teamFacetsByTeam])

  // ownerに応じた「生のファセットキー」集合。
  const rawKeys = useMemo<string[]>(() => {
    if (owner === 'subscription') return Object.keys(facetData.subscription)
    if (isTeamOwner(owner)) {
      const id = teamIdOf(owner)
      return Object.keys(id ? teamFacetsByTeam[id] || {} : teamAggregate)
    }
    if (owner === 'personal') return Object.keys(facetData.personal)
    return [
      ...Object.keys(facetData.personal),
      ...Object.keys(teamAggregate),
      ...Object.keys(facetData.subscription),
    ]
  }, [owner, facetData, teamFacetsByTeam, teamAggregate])

  // 同名統合＋代表variantで並べ替え（番号順を代表variantで維持）。
  const mergedGenres = useMemo<MergedGenreRow[]>(() => {
    return mergeGenreKeys(rawKeys)
      .map((m) => ({ ...m, rep: pickRepresentativeVariant(m.variants) }))
      .sort((a, b) => hybridSort(a.rep, b.rep))
  }, [rawKeys])

  // 現在のownerでの件数（束ねた全variantを合算）。
  const countFor = (m: MergedGenreRow): number => {
    const sum = (facet: Record<string, number>) => m.variants.reduce((n, v) => n + (facet[v] || 0), 0)
    if (owner === 'subscription') return sum(facetData.subscription)
    if (isTeamOwner(owner)) {
      const id = teamIdOf(owner)
      return sum(id ? teamFacetsByTeam[id] || {} : teamAggregate)
    }
    if (owner === 'personal') return sum(facetData.personal)
    return sum(facetData.personal) + sum(teamAggregate) + sum(facetData.subscription)
  }
  // このジャンルを持つ部署（順序保持）。ドット・凡例に使う。
  const teamsWithGenre = (m: MergedGenreRow): TeamMeta[] =>
    teams.filter((t) => m.variants.some((v) => (teamFacetsByTeam[t.id]?.[v] || 0) > 0))
  const hasSubFor = (m: MergedGenreRow): boolean =>
    m.variants.some((v) => (facetData.subscription[v] || 0) > 0)

  if (loading) {
    return (
      <div className="text-center py-8 text-gray-400">
        <p className="text-sm">読み込み中...</p>
      </div>
    )
  }

  if (mergedGenres.length === 0) {
    return (
      <div className="bg-brand-50 dark:bg-brand-900/40 border border-brand-200 dark:border-brand-700 rounded-xl p-4 text-sm text-brand-800 leading-relaxed">
        <p className="font-medium mb-2"><Lightbulb className="inline-block h-3.5 w-3.5 align-text-bottom mr-1" />ジャンルを使ってみよう</p>
        <p className="text-brand-700 dark:text-brand-300">
          Notion側の「ジャンル」プロパティにオプションを追加すると、ここに一覧表示されます。
        </p>
        <p className="text-brand-700 dark:text-brand-300 mt-2">
          オプション名の先頭を <span className="font-mono bg-white dark:bg-gray-800 px-1.5 py-0.5 rounded">01.総論</span> <span className="font-mono bg-white dark:bg-gray-800 px-1.5 py-0.5 rounded">05.循環</span> のように
          <strong className="font-semibold">2桁数字＋ピリオド</strong>で始めると、アプリ内でも同じ順番に並びます。
        </p>
      </div>
    )
  }

  const isFiltering = filterText.trim().length > 0
  const q = filterText.trim().toLowerCase()
  const filtered = isFiltering ? mergedGenres.filter((m) => m.key.toLowerCase().includes(q)) : mergedGenres
  // 絞り込み中は折りたたみを解除して全件表示。
  const visible = showAll || isFiltering ? filtered : filtered.slice(0, GENRE_SHOW_LIMIT)
  const hiddenCount = filtered.length - visible.length
  // 絞り込み入力はジャンルが多い時だけ（うざくない原則）。
  const showFilterInput = mergedGenres.length > GENRE_SHOW_LIMIT
  // 凡例は「全て」表示中、画面内に実際にドットがある部署/プレミアムだけ列挙。
  const legendTeams = owner === 'all'
    ? teams.filter((t) => visible.some((m) => m.variants.some((v) => (teamFacetsByTeam[t.id]?.[v] || 0) > 0)))
    : []
  const showSubLegend = owner === 'all' && visible.some((m) => hasSubFor(m))

  return (
    <>
    {showFilterInput && (
      <div className="relative mb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
        <input
          type="text"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
          placeholder="ジャンルを絞り込む"
          className="w-full pl-9 pr-8 py-2 text-sm rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:border-brand-400"
        />
        {isFiltering && (
          <button
            onClick={() => setFilterText('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            aria-label="絞り込みをクリア"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    )}
    {visible.length === 0 ? (
      <p className="text-center text-sm text-gray-400 py-6">「{filterText.trim()}」に一致するジャンルはありません</p>
    ) : (
    <div className="grid grid-cols-2 gap-2 mb-4">
      {visible.map((m) => {
        const total = countFor(m)
        const isActive = selectedGenre === m.key
        const accent = genreAccentTone(m.rep)
        const dotTeams = owner === 'all' ? teamsWithGenre(m) : []
        const showSub = owner === 'all' && hasSubFor(m)
        return (
          <button
            key={m.key}
            onClick={() => onGenreSelect(isActive ? null : { key: m.key, variants: m.variants })}
            className={`relative overflow-hidden text-left pl-4 pr-3 py-2 rounded-xl border border-gray-200 dark:border-gray-700 text-sm font-medium transition-all flex items-center justify-between gap-2 hover:shadow-sm ${
              isActive ? accent.selBg : 'bg-white dark:bg-gray-800/60'
            }`}
          >
            <span className={`absolute left-0 top-0 bottom-0 w-1 ${accent.bar}`} aria-hidden />
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="truncate text-gray-800 dark:text-gray-200">{m.key}</span>
              {dotTeams.map((t) => (
                <span
                  key={t.id || t.label}
                  className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${DEPT_DOT_BG[t.colorToken]}`}
                  title={`${t.label}にもあります`}
                  aria-label={`${t.label}にもあります`}
                />
              ))}
              {showSub && (
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full shrink-0 bg-purple-500"
                  title="プレミアムにもあります"
                  aria-label="プレミアムにもあります"
                />
              )}
            </span>
            <span className="text-xs shrink-0 text-gray-500 dark:text-gray-400 opacity-70">{total}</span>
          </button>
        )
      })}
    </div>
    )}
    {(legendTeams.length > 0 || showSubLegend) && (
      <p className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-gray-400 dark:text-gray-500 -mt-1 mb-3">
        {legendTeams.map((t) => (
          <span key={t.id || t.label} className="inline-flex items-center gap-1.5">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${DEPT_DOT_BG[t.colorToken]}`} />
            {t.label}にもあります
          </span>
        ))}
        {showSubLegend && (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-500" />
            プレミアムにもあります
          </span>
        )}
      </p>
    )}
    {!isFiltering && (hiddenCount > 0 || showAll) && filtered.length > GENRE_SHOW_LIMIT && (
      <button
        onClick={() => setShowAll((v) => !v)}
        className="w-full text-center text-xs font-medium text-brand-600 dark:text-brand-300 hover:text-brand-700 dark:hover:text-brand-200 py-2 mb-4 inline-flex items-center justify-center gap-1"
      >
        {showAll
          ? <><ChevronUp className="w-3.5 h-3.5" />折りたたむ</>
          : <><ChevronDown className="w-3.5 h-3.5" />すべて表示（残り {hiddenCount} 件）</>}
      </button>
    )}
    </>
  )
}

// ジャンル選択後のヒット一覧。「📋 まとめ」をジャンルの入り口として先頭に
// ピン留めして表示する（まとめ＝そのジャンルの地図、という位置づけ。
// クイズには出さない代わりに、ブラウズの起点でいちばん目立つ場所に置く）。
// Notionモードのジャンルタブ（page.tsx）とも共有。
export function GenreHitsList({ hits }: { hits: Hit[] }) {
  const isMatome = (h: Hit) => (h.knowledgeLevel || '').includes('まとめ')
  const matome = hits.filter(isMatome)
  const rest = hits.filter((h) => !isMatome(h))
  if (matome.length === 0) {
    return (
      <div className="space-y-3">
        {hits.map((hit) => <ResultCard key={hit.objectID} hit={hit} />)}
      </div>
    )
  }
  return (
    <>
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-semibold text-brand-700 dark:text-brand-300"><ClipboardList className="inline-block h-3.5 w-3.5 align-text-bottom mr-1" />このジャンルのまとめ</span>
          <div className="flex-1 h-px bg-brand-200 dark:bg-brand-800" />
          <span className="text-xs text-gray-300 dark:text-gray-600">{matome.length}件</span>
        </div>
        <div className="space-y-3">
          {matome.map((hit) => <ResultCard key={hit.objectID} hit={hit} />)}
        </div>
      </div>
      {rest.length > 0 && (
        <>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">ノート</span>
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            <span className="text-xs text-gray-300 dark:text-gray-600">{rest.length}件</span>
          </div>
          <div className="space-y-3">
            {rest.map((hit) => <ResultCard key={hit.objectID} hit={hit} />)}
          </div>
        </>
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

function SelectedGenreView({ genre, variants, onClear, owner, teamGenreHits }: {
  genre: string
  variants: string[]
  onClear: () => void
  owner: OwnerFilter
  teamGenreHits: Hit[]
}) {
  const subEnabled = hasSubscriptionConfig()
  const [personalHits, setPersonalHits] = useState<Hit[]>([])
  const [subHits, setSubHits] = useState<Hit[]>([])
  const [subLoading, setSubLoading] = useState(subEnabled)

  // 統合チップは束ねた全variantをORで引く（片方のvariantしか出ない事故を防ぐ）。
  const genreFilter = genreFacetFilter(variants)

  // サブスクは直接Algoliaから取得
  useEffect(() => {
    if (!subEnabled || !genreFilter) {
      setSubHits([])
      setSubLoading(false)
      return
    }
    let cancelled = false
    setSubLoading(true)
    createSubscriptionSearchClient()
      .initIndex(getSubscriptionIndexName())
      .search('', { filters: genreFilter, hitsPerPage: 50 })
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
  }, [genreFilter, subEnabled])

  // ownerFilterに基づいてヒットをマージ（部署はNotion由来 teamGenreHits）
  const displayedHits = useMemo(() => {
    if (owner === 'subscription') return subHits
    if (owner === 'personal') return personalHits.filter((h) => !h.owner || h.owner === 'personal')
    if (isTeamOwner(owner)) {
      const id = teamIdOf(owner)
      return id ? teamGenreHits.filter((h) => h.teamId === id) : teamGenreHits
    }
    // all: 個人 → 部署 → サブスクの順に並べる（個人優先）
    const seen = new Set<string>()
    const merged: Hit[] = []
    for (const h of personalHits) {
      if (!seen.has(h.objectID)) { merged.push(h); seen.add(h.objectID) }
    }
    for (const h of teamGenreHits) {
      if (!seen.has(h.objectID)) { merged.push(h); seen.add(h.objectID) }
    }
    for (const h of subHits) {
      if (!seen.has(h.objectID)) { merged.push(h); seen.add(h.objectID) }
    }
    return merged
  }, [owner, personalHits, subHits, teamGenreHits])

  // 個人側フィルタ: ownerに応じて絞る（部署はNotion由来なのでAlgolia個人側は無効化）。
  // 統合variantをORでまとめ、個人絞り込み時は owner 条件と AND する。
  const personalFilter = owner === 'subscription' || isTeamOwner(owner) || !genreFilter
    ? 'owner:__none__'
    : owner === 'personal'
      ? `(${genreFilter}) AND (owner:personal OR NOT _exists_:owner)`
      : `(${genreFilter})`

  return (
    <>
      {/* 個人側はreact-instantsearch経由で取得 */}
      <Configure filters={personalFilter} hitsPerPage={50} />
      <PersonalHitsCollector onLoaded={setPersonalHits} />

      <div className="flex items-center justify-between mb-3 gap-2">
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 truncate">{displayGenreName(genre)}</p>
        <button
          onClick={onClear}
          className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 dark:text-gray-300 shrink-0"
        >
          <X className="inline-block h-3.5 w-3.5 align-text-bottom mr-1" />解除
        </button>
      </div>

      {subLoading && owner !== 'personal' && !isTeamOwner(owner) && (
        <p className="text-xs text-gray-400 mb-2">プレミアム読み込み中...</p>
      )}

      {displayedHits.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <p>このジャンルにはまだエントリがありません</p>
        </div>
      ) : (
        <GenreHitsList hits={displayedHits} />
      )}
    </>
  )
}

export function GenreBrowse({ hasTeam = false, hasSubscription = false }: { hasTeam?: boolean; hasSubscription?: boolean }) {
  // 選択は正規化キー＋束ねたvariant集合で保持（統合チップの全variantを引くため）。
  const [selected, setSelected] = useState<{ key: string; variants: string[] } | null>(null)
  const [owner, setOwner] = useState<OwnerFilter>('all')
  // 部署(team)はNotionから直読み
  const { teamHits } = useTeamGenreHits()

  // 部署メタ（追加順・色つき）。フィルタチップ／ドット／凡例が共有する。
  // settings由来（部署の増減で変わる）なので毎レンダー計算（安価）。
  const teams = orderedTeams(hasTeam)

  // 部署ジャンルファセットを teamId ごとに集計（部署色ドット・件数に使う）。
  const teamFacetsByTeam = useMemo<TeamFacetsByTeam>(() => {
    const byTeam: TeamFacetsByTeam = {}
    for (const h of teamHits) {
      const tid = h.teamId || ''
      const bucket = (byTeam[tid] ||= {})
      for (const g of getHitGenres(h)) bucket[g] = (bucket[g] || 0) + 1
    }
    return byTeam
  }, [teamHits])

  // 選択ジャンル（正規化キー）に一致する部署hits。番号有無の揺れを正規化で吸収。
  const teamGenreHits = useMemo(() => {
    if (!selected) return []
    return teamHits.filter((h) => genreMatchesCanonical(getHitGenres(h), selected.key))
  }, [teamHits, selected])

  return (
    <div>
      <div className="sticky top-[88px] z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm pb-2 pt-1 -mx-4 px-4 mb-1">
        <GenreOwnerFilterTabs owner={owner} onChange={(v) => { setOwner(v); setSelected(null) }} teams={teams} hasTeam={hasTeam} hasSubscription={hasSubscription} />
      </div>
      {selected ? (
        <SelectedGenreView genre={selected.key} variants={selected.variants} onClear={() => setSelected(null)} owner={owner} teamGenreHits={teamGenreHits} />
      ) : (
        <GenreList onGenreSelect={setSelected} selectedGenre={null} owner={owner} teamFacetsByTeam={teamFacetsByTeam} teams={teams} />
      )}
    </div>
  )
}
