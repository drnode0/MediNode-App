'use client'

// アカウント台帳（管理者専用画面）。
//
// /api/admin/ledger から全ユーザー×契約状態を取得し、
// 「誰がプレミアムで、誰が永続無料か」を1画面で見渡せるようにする。
// - comp / trial（コードによる無料解放）はこの画面から取り消せる（POST /api/premium/comp）
// - 無料のユーザーへは、コードを渡さずにその場で永続無料を付与できる（POST /api/admin/ledger）
// 認可はサーバー側（requireAdmin）が行い、この画面は結果を表示するだけ。

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Activity,
  BarChart3,
  Check,
  ChevronDown,
  Copy,
  CreditCard,
  Crown,
  Download,
  Eye,
  EyeOff,
  ExternalLink,
  Gift,
  Hourglass,
  LayoutDashboard,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Timer,
  Trash2,
  Trophy,
  UserPlus,
  Users,
  XCircle,
} from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { MEMBER_KIND_LABEL, type MemberKind } from '@/lib/member-ledger'
import { LAUNCH_CAMPAIGN_END } from '@/lib/campaign'
import {
  ActiveBreakdownBar,
  CountBars,
  DailyBarsChart,
  HourlyBarsChart,
  SegmentBar,
  TrendLineChart,
  buildCumulativeSeries,
  type ActiveBreakdown,
  type ChartEvent,
  type DailyPoint,
  type Segment,
} from './AdminCharts'
import { SectionHeading, InfoPopover } from './SectionHeading'
import { FunnelCard, RetentionCard, SourceQualityTable, RevenueCard } from './MarketingCards'
import {
  computeFunnel,
  computeRetention,
  computeSourceQuality,
  computeRevenue,
  countTrialStarted,
  PREMIUM_MONTHLY_JPY,
} from '@/lib/ledger-metrics'
import { ContractIssuesPanel, AnomalyPanel, AuditLogSection } from './SafetyPanels'
import { DailyCommandCenter } from './DailyCommandCenter'
import { AdminSettingsPanel } from './AdminSettingsPanel'
import { OperatingCostCard } from './OperatingCostCard'
import { maskEmail, detectLocalContractIssues, detectAnomalySignals } from '@/lib/ledger-safety'
import { eventStartMs, formatEventStamp } from '@/lib/event-time'

type LedgerRow = {
  userId: string
  email: string | null
  createdAt: string | null
  lastSignInAt: string | null
  kind: MemberKind
  plan: string | null
  status: string | null
  trialEndsAt: string | null
  subUpdatedAt: string | null
  settingsUpdatedAt: string | null
  lastUsedAt: string | null
  source: string | null
  onbFurthest: string | null
  onbTargets: string[] | null
  onbMode: string | null
  onbDbSetup: string | null
  // 友達紹介: 紹介者としての成立数／自身が紹介経由で始めたか。
  referralCount: number
  viaReferral: boolean
  premiumUsedAt: string | null
  isMonitor: boolean
  earlyAccess?: boolean
  hasStripe: boolean
  subCreatedAt: string | null
}

// プレミアムを見られる状態の区分（課金中＋各種トライアル）。プレミアム未利用者の抽出対象。
const PREMIUM_ELIGIBLE_KINDS: MemberKind[] = ['premium', 'stripe_trial', 'trial', 'auto_trial']

// セットアップのステップ名（離脱位置の表示用。SetupWizard の Step と対応）。
const STEP_LABEL: Record<string, string> = {
  entry: '入口',
  start: '知識の選択',
  mode: '接続モード',
  notion: 'Notion設定',
  algolia: 'Algolia設定',
  sync: '同期',
  options: 'オプション入力',
}
const STEP_ORDER = ['entry', 'start', 'mode', 'notion', 'algolia', 'sync', 'options']

const TARGET_LABEL: Record<string, string> = {
  premium: '専門医の知識',
  personal: '自分の知識',
  team: 'みんなの知識',
}

// 流入元バッジの表示名と色。未知の値（ホスト名等）はそのままグレーで出す。
const SOURCE_STYLE: Record<string, { label: string; badge: string }> = {
  x: { label: 'X', badge: 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' },
  note: { label: 'note', badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200' },
  notion: { label: 'Notion', badge: 'bg-gray-100 text-gray-800 border border-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:border-gray-500' },
  line: { label: 'LINE', badge: 'bg-green-100 text-green-800 dark:bg-green-900/50 dark:text-green-200' },
  lp: { label: 'LP直接', badge: 'bg-orange-100 text-orange-800 dark:bg-orange-900/50 dark:text-orange-200' },
  direct: { label: '直接', badge: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
  search: { label: '検索', badge: 'bg-blue-100 text-blue-800 dark:bg-blue-900/50 dark:text-blue-200' },
  // 流入元計測より前（＝公開前）の登録者。全員モニターか本人なので、未計測とは区別して示す。
  monitor: { label: 'モニター', badge: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/50 dark:text-indigo-200' },
  self: { label: '本人', badge: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
}

// 公開（ローンチ）日時。これより前の登録は流入元計測が存在しなかったため、
// 「未計測」ではなく モニター（管理者は本人）として扱う。JST 2026-07-18 20:00。
const LAUNCH_MS = Date.parse('2026-07-18T20:00:00+09:00')

// 表記ゆれの吸収。対応表追加前に生ホスト名で記録された値も既知の媒体に寄せる。
function normalizeSource(source: string): string {
  if (source === 'notion.so' || source === 'notion.com' || source === 'notion.site') return 'notion'
  if (source === 't.co' || source === 'x.com' || source === 'twitter.com') return 'x'
  if (source === 'note.com' || source === 'note.mu') return 'note'
  // 生ホストで記録された検索エンジンも「検索」に寄せる。
  if (['google.', 'bing.', 'yahoo.', 'duckduckgo.', 'baidu.', 'ecosia.'].some((h) => source.includes(h))) return 'search'
  return source
}

// 表示用の実効的な流入元。記録があればそれ、無ければ公開前は monitor/self、公開後は null（未計測）。
function effectiveSource(r: {
  source: string | null
  createdAt: string | null
  kind: MemberKind
  isMonitor?: boolean
}): string | null {
  // 手動のモニター指定が最優先（公開後モニター等、計測では拾えない内輪ユーザーを分離する）。
  if (r.isMonitor) return r.kind === 'admin' ? 'self' : 'monitor'
  if (r.source) return normalizeSource(r.source)
  const created = r.createdAt ? new Date(r.createdAt).getTime() : 0
  if (created && created < LAUNCH_MS) return r.kind === 'admin' ? 'self' : 'monitor'
  return null // 公開後に計測できなかった人は本当に不明なので「未計測」のまま
}

function SourceBadge({ source: raw }: { source: string | null }) {
  if (!raw) return <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
  const source = normalizeSource(raw)
  const style = SOURCE_STYLE[source] ?? {
    label: source,
    badge: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  }
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${style.badge}`}>
      {style.label}
    </span>
  )
}

// 区分バッジの見た目。優先度の高い順（画面の並び・集計チップもこの順）。
const KIND_STYLE: Record<MemberKind, { badge: string; icon: typeof Crown }> = {
  admin: { badge: 'bg-brand-100 text-brand-800 dark:bg-brand-900 dark:text-brand-200', icon: ShieldCheck },
  comp: { badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200', icon: Gift },
  premium: { badge: 'bg-brand-100 text-brand-700 dark:bg-brand-900 dark:text-brand-300', icon: Crown },
  stripe_trial: { badge: 'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200', icon: CreditCard },
  trial: { badge: 'bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200', icon: Hourglass },
  auto_trial: { badge: 'bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200', icon: Timer },
  expired: { badge: 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300', icon: XCircle },
  free: { badge: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400', icon: Users },
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return iso.slice(0, 10)
}

// ツールチップ・CSV用の完全な日時（日本時間・分まで）。
function fmtDateTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return `${jst.toISOString().slice(0, 10)} ${jst.toISOString().slice(11, 16)}`
}

// 日付セル。ホバー（スマホは長押し）で時刻まで見える。
function DateCell({ iso }: { iso: string | null }) {
  return (
    <td
      className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap"
      title={fmtDateTime(iso) || undefined}
    >
      {fmtDate(iso)}
    </td>
  )
}

// KPIカード（登録者数・アクティブ数など画面上部の数字）。
function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  highlight = false,
  help,
}: {
  icon: typeof Users
  label: string
  value: number
  sub?: string
  highlight?: boolean
  help?: ReactNode
}) {
  return (
    <div
      className={`rounded-xl border p-3 bg-white dark:bg-gray-800 ${
        highlight
          ? 'border-brand-300 dark:border-brand-700'
          : 'border-gray-200 dark:border-gray-700'
      }`}
    >
      <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 mb-1">
        <Icon className={`w-3.5 h-3.5 ${highlight ? 'text-brand-600 dark:text-brand-400' : ''}`} aria-hidden />
        {label}
        {help && <InfoPopover>{help}</InfoPopover>}
      </div>
      <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-none">
        {value}
        <span className="text-sm font-medium text-gray-400 dark:text-gray-500 ml-0.5">人</span>
      </div>
      {sub && <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">{sub}</div>}
    </div>
  )
}

// CSVの1セル。カンマ・引用符・改行を含んでも壊れないようにする。
function csvCell(v: string | null): string {
  const s = v ?? ''
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// 運用ダッシュボードのタブ。長い1ページをスクロールせず切り替えて見るための分割単位。
type AdminTab = 'today' | 'accounts' | 'analytics' | 'settings'
const ADMIN_TABS: { key: AdminTab; label: string; icon: typeof Users }[] = [
  { key: 'today', label: '今日', icon: LayoutDashboard },
  { key: 'accounts', label: 'アカウント', icon: Users },
  { key: 'analytics', label: '分析・マーケ', icon: BarChart3 },
  { key: 'settings', label: '配信・設定', icon: Settings },
]

// アカウント台帳の日付ソート対象列。
type SortKey = 'createdAt' | 'lastSignInAt' | 'lastUsedAt'
const SORT_LABEL: Record<SortKey, string> = {
  createdAt: '登録日',
  lastSignInAt: '最終ログイン',
  lastUsedAt: '最終利用',
}

// クリックで並び替えできる日付列の見出し。有効列は矢印（▲昇順/▼降順）、それ以外は薄い↕。
function SortableTh({
  col,
  activeKey,
  dir,
  onSort,
}: {
  col: SortKey
  activeKey: SortKey
  dir: 'asc' | 'desc'
  onSort: (k: SortKey) => void
}) {
  const active = activeKey === col
  return (
    <th className="px-4 py-3 font-medium whitespace-nowrap">
      <button
        type="button"
        onClick={() => onSort(col)}
        className="inline-flex items-center gap-1 hover:text-gray-700 dark:hover:text-gray-200"
        title={`${SORT_LABEL[col]}で並び替え`}
      >
        {SORT_LABEL[col]}
        <span
          className={`text-[10px] ${active ? 'text-brand-600 dark:text-brand-400' : 'text-gray-300 dark:text-gray-600'}`}
          aria-hidden
        >
          {active ? (dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  )
}

export function AdminLedgerClient() {
  const [rows, setRows] = useState<LedgerRow[] | null>(null)
  const [dailyActive, setDailyActive] = useState<DailyPoint[]>([])
  const [events, setEvents] = useState<ChartEvent[]>([])
  const [eventsDbUrl, setEventsDbUrl] = useState<string | null>(null)
  const [hourlyActive, setHourlyActive] = useState<number[]>([])
  const [lpDaily, setLpDaily] = useState<DailyPoint[]>([])
  const [lpHourly, setLpHourly] = useState<number[]>([])
  const [lpSources, setLpSources] = useState<Array<{ source: string; count: number }>>([])
  const [auditLog, setAuditLog] = useState<
    { action: string; actorEmail: string; targetEmail: string | null; createdAt: string }[]
  >([])
  const [maskEmails, setMaskEmails] = useState(false)
  const [referralTotal, setReferralTotal] = useState(0)
  const [error, setError] = useState<'login' | 'forbidden' | string | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  // 「トライアル中・プレミアム未利用」だけに絞る表示（期限切れ前の声かけ対象の抽出）。
  const [onlyUntouchedTrials, setOnlyUntouchedTrials] = useState(false)
  // 「紹介経由で始めた人」だけに絞る表示（キャンペーンの効き具合を見る）。
  const [onlyReferred, setOnlyReferred] = useState(false)
  const [busy, setBusy] = useState<string | null>(null) // 取り消し/付与の実行中userId
  const [copied, setCopied] = useState<string | null>(null)
  // タブ切替（長い1ページを分割してスクロールを減らす）。既定は「今日」。
  const [tab, setTab] = useState<AdminTab>('today')
  // アカウント台帳のソート（日付列）。既定は登録日の新しい順。
  const [sortKey, setSortKey] = useState<SortKey>('createdAt')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/ledger', { cache: 'no-store' })
      if (res.status === 401) {
        setError('login')
        return
      }
      if (res.status === 403) {
        setError('forbidden')
        return
      }
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '読み込みに失敗しました')
      setRows(data.rows)
      setDailyActive(Array.isArray(data.dailyActive) ? data.dailyActive : [])
      setEvents(Array.isArray(data.events) ? data.events : [])
      setEventsDbUrl(typeof data.eventsDbUrl === 'string' ? data.eventsDbUrl : null)
      setHourlyActive(Array.isArray(data.hourlyActive) ? data.hourlyActive : [])
      setLpDaily(Array.isArray(data.lpDaily) ? data.lpDaily : [])
      setLpHourly(Array.isArray(data.lpHourly) ? data.lpHourly : [])
      setLpSources(Array.isArray(data.lpSources) ? data.lpSources : [])
      setAuditLog(Array.isArray(data.auditLog) ? data.auditLog : [])
      setReferralTotal(typeof data.referralTotal === 'number' ? data.referralTotal : 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // コードによる無料解放（comp/trial）の取り消し。
  const revoke = useCallback(
    async (row: LedgerRow) => {
      const label = MEMBER_KIND_LABEL[row.kind]
      const ok = window.confirm(
        `${row.email ?? row.userId} の「${label}」を取り消しますか？\n（取り消すと通常の無料利用に戻ります。この操作で行は消えず、履歴として残ります）`,
      )
      if (!ok) return
      setBusy(row.userId)
      try {
        const res = await fetch('/api/premium/comp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: row.userId }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) throw new Error(data.error || '取り消しに失敗しました')
        await load()
      } catch (err) {
        window.alert(err instanceof Error ? err.message : '取り消しに失敗しました')
      } finally {
        setBusy(null)
      }
    },
    [load],
  )

  // 永続無料（comp）をその場で付与。招待コードを渡す必要がない。
  const grant = useCallback(
    async (row: LedgerRow) => {
      const ok = window.confirm(
        `${row.email ?? row.userId} に「永続無料（プレミアム）」を付与しますか？\n（期限なしでプレミアム検索が使えるようになります。あとからこの画面で取り消せます）`,
      )
      if (!ok) return
      setBusy(row.userId)
      try {
        const res = await fetch('/api/admin/ledger', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: row.userId }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) throw new Error(data.error || '付与に失敗しました')
        await load()
      } catch (err) {
        window.alert(err instanceof Error ? err.message : '付与に失敗しました')
      } finally {
        setBusy(null)
      }
    },
    [load],
  )

  // アカウントの完全削除（タイプミス・重複登録の掃除用）。取り消せないため、
  // 確認としてメールアドレスの再入力を求める。Stripe契約のある人はサーバー側で拒否される。
  const removeAccount = useCallback(
    async (row: LedgerRow) => {
      const label = row.email ?? row.userId
      const typed = window.prompt(
        `このアカウントを完全に削除します（取り消せません・登録者数からも消えます）。
` +
          `間違いを防ぐため、確認としてメールアドレスをそのまま入力してください:
${label}`,
      )
      if (typed === null) return // キャンセル
      if (typed.trim() !== label) {
        window.alert('入力がメールアドレスと一致しませんでした。削除を中止しました。')
        return
      }
      setBusy(row.userId)
      try {
        const res = await fetch('/api/admin/ledger', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: row.userId }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) throw new Error(data.error || '削除に失敗しました')
        await load()
      } catch (err) {
        window.alert(err instanceof Error ? err.message : '削除に失敗しました')
      } finally {
        setBusy(null)
      }
    },
    [load],
  )

  // モニター指定の ON/OFF。流入元を「モニター」に振り分ける（計測では拾えない内輪ユーザーの分離）。
  const toggleMonitor = useCallback(
    async (row: LedgerRow) => {
      setBusy(row.userId)
      try {
        const res = await fetch('/api/admin/ledger', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: row.userId, isMonitor: !row.isMonitor }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) throw new Error(data.error || 'モニター指定の変更に失敗しました')
        await load()
      } catch (err) {
        window.alert(err instanceof Error ? err.message : 'モニター指定の変更に失敗しました')
      } finally {
        setBusy(null)
      }
    },
    [load],
  )

  // 先行体験（マルチ部署串刺し検索）の開放 ON/OFF。user_settings.early_access を更新する。
  const toggleEarlyAccess = useCallback(
    async (row: LedgerRow) => {
      setBusy(row.userId)
      try {
        const res = await fetch('/api/admin/ledger', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: row.userId, earlyAccess: !row.earlyAccess }),
        })
        const data = await res.json()
        if (!res.ok || !data.ok) throw new Error(data.error || '先行体験の変更に失敗しました')
        await load()
      } catch (err) {
        window.alert(err instanceof Error ? err.message : '先行体験の変更に失敗しました')
      } finally {
        setBusy(null)
      }
    },
    [load],
  )

  // ユーザーID（Supabaseの内部ID）をコピー。画面には出さず、必要なときだけ取り出す。
  const copyId = useCallback(async (row: LedgerRow) => {
    try {
      await navigator.clipboard.writeText(row.userId)
      setCopied(row.userId)
      window.setTimeout(() => setCopied((c) => (c === row.userId ? null : c)), 1500)
    } catch {
      window.prompt('コピーできませんでした。このIDを選択してコピーしてください', row.userId)
    }
  }, [])

  // CSVダウンロード（棚卸し・バックアップ用）。
  const downloadCsv = useCallback(() => {
    if (!rows) return
    if (!window.confirm('個人情報（メールアドレス等）を含むCSVを出力します。取り扱いに注意してください。続けますか？')) {
      return
    }
    const header = ['メール', '区分', '流入元', '紹介した数', '紹介経由', '知識の選択', 'モード', 'DB設定', '到達ステップ', 'プレミアム最終利用', '期限', '登録日', '最終ログイン', '最終利用', '設定同期', 'ユーザーID']
    const lines = rows.map((r) =>
      [
        csvCell(r.email),
        csvCell(MEMBER_KIND_LABEL[r.kind]),
        csvCell(effectiveSource(r) ?? '未計測'),
        csvCell(r.referralCount > 0 ? String(r.referralCount) : '0'),
        csvCell(r.viaReferral ? '紹介経由' : '—'),
        csvCell((r.onbTargets ?? []).map((t) => TARGET_LABEL[t] ?? t).join('/') || '—'),
        csvCell(r.onbMode === 'simple' ? 'シンプル' : r.onbMode === 'power' ? 'パワー' : '—'),
        csvCell(r.onbDbSetup === 'template' ? 'テンプレ複製' : r.onbDbSetup === 'existing' ? '既存DB連携' : '—'),
        csvCell(r.onbFurthest ? (STEP_LABEL[r.onbFurthest] ?? r.onbFurthest) : '—'),
        csvCell(fmtDateTime(r.premiumUsedAt) || (PREMIUM_ELIGIBLE_KINDS.includes(r.kind) ? '未利用' : '—')),
        csvCell(r.kind === 'comp' ? '無期限' : fmtDateTime(r.trialEndsAt) || '—'),
        csvCell(fmtDateTime(r.createdAt) || '—'),
        csvCell(fmtDateTime(r.lastSignInAt) || '—'),
        csvCell(fmtDateTime(r.lastUsedAt) || '—'),
        csvCell(fmtDateTime(r.settingsUpdatedAt) || '—'),
        csvCell(r.userId),
      ].join(','),
    )
    // BOM付きUTF-8（Excelで文字化けさせない）。
    const blob = new Blob(['﻿' + [header.join(','), ...lines].join('\r\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `medinode-accounts-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
    // 監査記録（best-effort。失敗してもダウンロードは完了済み）。
    void fetch('/api/admin/ledger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'audit', event: 'export_csv', detail: { count: rows.length } }),
    }).catch(() => {})
  }, [rows])

  // プレミアムを見られるのに一度も使っていない人（トライアル各種＋課金中が対象）。
  const isUntouchedPremium = useCallback(
    (r: LedgerRow) => PREMIUM_ELIGIBLE_KINDS.includes(r.kind) && !r.premiumUsedAt,
    [],
  )
  const untouchedTrialCount = useMemo(
    () => (rows ?? []).filter(isUntouchedPremium).length,
    [rows, isUntouchedPremium],
  )

  // 紹介経由で始めた人の数（キャンペーンの拡散効果）。
  const referredCount = useMemo(() => (rows ?? []).filter((r) => r.viaReferral).length, [rows])

  // 紹介してくれた人（アドボケイト）を多い順に。お礼・育成の対象を一目で。
  const topReferrers = useMemo(
    () =>
      (rows ?? [])
        .filter((r) => r.referralCount > 0)
        .sort((a, b) => b.referralCount - a.referralCount),
    [rows],
  )

  // キャンペーン残り日数（終了後は null）。ヘッダーのチップで進行中を示す。
  const campaignDaysLeft = useMemo(() => {
    const end = new Date(LAUNCH_CAMPAIGN_END).getTime()
    const diff = end - Date.now()
    return diff > 0 ? Math.ceil(diff / (24 * 60 * 60 * 1000)) : null
  }, [])

  // LP訪問の流入元内訳（既知の媒体は固定色・それ以外は「その他」）。ユーザー登録の流入元とは別物
  // （こちらは登録前の「LPを見た人」全員が母数。x=t.co経由なども含む）。
  const lpSourceSegments = useMemo<Segment[]>(() => {
    const counts: Record<string, number> = { x: 0, note: 0, notion: 0, line: 0, lp: 0, direct: 0, other: 0 }
    for (const s of lpSources) {
      if (s.source in counts) counts[s.source] += s.count
      else counts.other += s.count
    }
    return [
      { label: 'X', count: counts.x, className: 'bg-gray-800 dark:bg-gray-300' },
      { label: 'note', count: counts.note, className: 'bg-emerald-500 dark:bg-emerald-400' },
      { label: 'Notion', count: counts.notion, className: 'bg-violet-400' },
      { label: 'LINE', count: counts.line, className: 'bg-teal-400' },
      { label: 'LP直接', count: counts.lp, className: 'bg-orange-400' },
      { label: '直接', count: counts.direct, className: 'bg-gray-400 dark:bg-gray-500' },
      { label: 'その他', count: counts.other, className: 'bg-sky-400' },
    ]
  }, [lpSources])

  const lpTotal = useMemo(() => lpSources.reduce((sum, s) => sum + s.count, 0), [lpSources])

  const filtered = useMemo(() => {
    if (!rows) return []
    let base = onlyUntouchedTrials ? rows.filter(isUntouchedPremium) : rows
    if (onlyReferred) base = base.filter((r) => r.viaReferral)
    const q = query.trim().toLowerCase()
    if (!q) return base
    return base.filter(
      (r) =>
        (r.email ?? '').toLowerCase().includes(q) ||
        r.userId.toLowerCase().includes(q) ||
        MEMBER_KIND_LABEL[r.kind].includes(query.trim()) ||
        (r.source ?? '').toLowerCase().includes(q),
    )
  }, [rows, query, onlyUntouchedTrials, onlyReferred, isUntouchedPremium])

  // 台帳の並び替え（日付列の昇順/降順）。null（未記録）は方向に関わらず常に末尾へ寄せる。
  const sorted = useMemo(() => {
    const ms = (v: string | null) => (v ? new Date(v).getTime() : null)
    return [...filtered].sort((a, b) => {
      const av = ms(a[sortKey])
      const bv = ms(b[sortKey])
      if (av === null && bv === null) return 0
      if (av === null) return 1
      if (bv === null) return -1
      return sortDir === 'asc' ? av - bv : bv - av
    })
  }, [filtered, sortKey, sortDir])

  // 見出しクリックでソート。同じ列なら昇降トグル、別の列なら降順から。
  const toggleSort = useCallback(
    (key: SortKey) => {
      if (sortKey === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
      } else {
        setSortKey(key)
        setSortDir('desc')
      }
    },
    [sortKey],
  )

  const counts = useMemo(() => {
    const c: Record<MemberKind, number> = { admin: 0, comp: 0, premium: 0, stripe_trial: 0, trial: 0, auto_trial: 0, expired: 0, free: 0 }
    for (const r of rows ?? []) c[r.kind]++
    return c
  }, [rows])

  // マーケ・経営指標（すべて既存データの派生。ロジックは ledger-metrics に集約）。
  const funnel = useMemo(
    () =>
      computeFunnel({
        lpVisits: lpDaily.reduce((sum, p) => sum + p.count, 0),
        registered: (rows ?? []).length,
        trialStarted: countTrialStarted(rows ?? []),
        paying: counts.premium,
      }),
    [rows, lpDaily, counts.premium]
  )
  const retention = useMemo(
    () => computeRetention((rows ?? []).map((r) => ({ kind: r.kind, hasStripe: r.hasStripe }))),
    [rows]
  )
  const sourceQuality = useMemo(
    () =>
      computeSourceQuality(
        (rows ?? []).map((r) => ({ source: effectiveSource(r) ?? '未計測', kind: r.kind }))
      ),
    [rows]
  )
  const revenue = useMemo(
    () =>
      computeRevenue(
        (rows ?? []).map((r) => ({ kind: r.kind, subCreatedAt: r.subCreatedAt })),
        PREMIUM_MONTHLY_JPY
      ),
    [rows]
  )

  // 安全管理: ローカルの契約不整合とヒューリスティックな異常兆候。
  const contractIssues = useMemo(
    () =>
      detectLocalContractIssues(
        (rows ?? []).map((r) => ({
          userId: r.userId,
          email: r.email,
          kind: r.kind,
          status: r.status,
          plan: r.plan,
          hasStripe: r.hasStripe,
        }))
      ),
    [rows]
  )
  const anomalies = useMemo(
    () =>
      detectAnomalySignals(
        (rows ?? []).map((r) => ({
          email: r.email,
          kind: r.kind,
          referralCount: r.referralCount,
          premiumUsedAt: r.premiumUsedAt,
          trialEndsAt: r.trialEndsAt,
          createdAt: r.createdAt,
        })),
        Date.now()
      ),
    [rows]
  )

  // 直近7日の新規登録数（登録の勢いをチップで一目に）。
  const newLast7d = useMemo(() => {
    if (!rows) return 0
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000
    return rows.filter((r) => r.createdAt && new Date(r.createdAt).getTime() >= cutoff).length
  }, [rows])

  // 利用状況。「最後に見た形跡」= 最終利用・最終ログイン・設定同期のうち一番新しい日時。
  // （最終利用の記録は機能追加後の利用からしか残らないため、単独では実態より少なく出る）
  const activity = useMemo(() => {
    const breakdown: ActiveBreakdown = { within7: 0, within30: 0, older: 0, never: 0 }
    const now = Date.now()
    for (const r of rows ?? []) {
      const seen = Math.max(
        ...[r.lastUsedAt, r.lastSignInAt, r.settingsUpdatedAt]
          .filter((v): v is string => !!v)
          .map((v) => new Date(v).getTime()),
        0,
      )
      if (seen === 0) breakdown.never++
      else if (now - seen <= 7 * 24 * 60 * 60 * 1000) breakdown.within7++
      else if (now - seen <= 30 * 24 * 60 * 60 * 1000) breakdown.within30++
      else breakdown.older++
    }
    return { breakdown, wau: breakdown.within7, mau: breakdown.within7 + breakdown.within30 }
  }, [rows])

  // 登録者数の累積推移（全期間）。
  const cumulative = useMemo(() => buildCumulativeSeries((rows ?? []).map((r) => r.createdAt)), [rows])

  // イベント別の増加数: イベント当日0時から7日間（未経過なら今日まで）の新規登録数。
  const eventUplift = useMemo(() => {
    if (!rows || events.length === 0) return []
    const now = Date.now()
    return events.map((ev) => {
      const start = eventStartMs(ev.date)
      const end = start + 7 * 24 * 60 * 60 * 1000
      const count = rows.filter((r) => {
        if (!r.createdAt) return false
        const c = new Date(r.createdAt).getTime()
        return c >= start && c < end
      }).length
      const elapsedDays = Math.max(1, Math.min(7, Math.ceil((now - start) / (24 * 60 * 60 * 1000))))
      return { ...ev, count, elapsedDays, ongoing: now < end }
    })
  }, [rows, events])

  // 流入元の割合。既知の媒体は固定色、それ以外は「その他」にまとめる。
  const sourceSegments = useMemo<Segment[]>(() => {
    const counts = { x: 0, note: 0, notion: 0, line: 0, lp: 0, search: 0, direct: 0, monitor: 0, self: 0, other: 0, unknown: 0 }
    for (const r of rows ?? []) {
      const source = effectiveSource(r)
      if (source === null) counts.unknown++
      else if (source in counts) counts[source as keyof typeof counts]++
      else counts.other++
    }
    return [
      { label: 'X', count: counts.x, className: 'bg-gray-800 dark:bg-gray-300' },
      { label: 'note', count: counts.note, className: 'bg-emerald-500 dark:bg-emerald-400' },
      { label: 'Notion', count: counts.notion, className: 'bg-violet-400' },
      { label: 'LINE', count: counts.line, className: 'bg-teal-400' },
      { label: 'LP直接', count: counts.lp, className: 'bg-orange-400' },
      { label: '検索', count: counts.search, className: 'bg-blue-500 dark:bg-blue-400' },
      { label: '直接', count: counts.direct, className: 'bg-gray-400 dark:bg-gray-500' },
      { label: 'モニター', count: counts.monitor, className: 'bg-indigo-400' },
      { label: '本人', count: counts.self, className: 'bg-slate-400' },
      { label: 'その他', count: counts.other, className: 'bg-sky-400' },
      { label: '未計測', count: counts.unknown, className: 'bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700' },
    ]
  }, [rows])

  // セットアップ状況: 設定完了（サーバーに設定が保存された）／途中／未計測。
  const setupSegments = useMemo<Segment[]>(() => {
    let done = 0
    let midway = 0
    let unknown = 0
    for (const r of rows ?? []) {
      if (r.settingsUpdatedAt) done++
      else if (r.onbFurthest) midway++
      else unknown++
    }
    return [
      { label: '設定完了', count: done, className: 'bg-brand-600 dark:bg-brand-400' },
      { label: '途中', count: midway, className: 'bg-amber-400' },
      { label: '未計測', count: unknown, className: 'bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700' },
    ]
  }, [rows])

  // 設定が完了していない人の離脱位置（最後に到達したステップの分布）。
  const dropoffBars = useMemo<Segment[]>(() => {
    const counts = new Map<string, number>()
    for (const r of rows ?? []) {
      if (r.settingsUpdatedAt || !r.onbFurthest) continue
      counts.set(r.onbFurthest, (counts.get(r.onbFurthest) ?? 0) + 1)
    }
    return STEP_ORDER.filter((s) => (counts.get(s) ?? 0) > 0).map((s) => ({
      label: STEP_LABEL[s] ?? s,
      count: counts.get(s) ?? 0,
      className: 'bg-amber-400',
    }))
  }, [rows])

  // 使う知識の選択（複数選択可なので割合ではなく件数バー）。
  const knowledgeBars = useMemo<Segment[]>(() => {
    const counts = { premium: 0, personal: 0, team: 0 }
    for (const r of rows ?? []) {
      for (const t of r.onbTargets ?? []) {
        if (t in counts) counts[t as keyof typeof counts]++
      }
    }
    return [
      { label: TARGET_LABEL.premium, count: counts.premium, className: 'bg-amber-400' },
      { label: TARGET_LABEL.personal, count: counts.personal, className: 'bg-brand-600 dark:bg-brand-400' },
      { label: TARGET_LABEL.team, count: counts.team, className: 'bg-sky-500 dark:bg-sky-400' },
    ]
  }, [rows])

  // 接続モードとDB設定の内訳（記録がある人のみの割合）。
  const modeSegments = useMemo<Segment[]>(() => {
    let simple = 0
    let power = 0
    for (const r of rows ?? []) {
      if (r.onbMode === 'simple') simple++
      else if (r.onbMode === 'power') power++
    }
    return [
      { label: 'シンプル', count: simple, className: 'bg-sky-500 dark:bg-sky-400' },
      { label: 'パワー', count: power, className: 'bg-violet-500 dark:bg-violet-400' },
    ]
  }, [rows])

  const dbSetupSegments = useMemo<Segment[]>(() => {
    let template = 0
    let existing = 0
    for (const r of rows ?? []) {
      if (r.onbDbSetup === 'template') template++
      else if (r.onbDbSetup === 'existing') existing++
    }
    return [
      { label: 'テンプレ複製', count: template, className: 'bg-orange-400' },
      { label: '既存DB連携', count: existing, className: 'bg-brand-600 dark:bg-brand-400' },
    ]
  }, [rows])

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 px-4 py-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-brand-600 dark:text-brand-400" aria-hidden />
            運用ダッシュボード
          </h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMaskEmails((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
              title={maskEmails ? 'メールを表示する' : 'メールを隠す（スクショ・共有時の保護）'}
            >
              {maskEmails ? <Eye className="w-4 h-4" aria-hidden /> : <EyeOff className="w-4 h-4" aria-hidden />}
              {maskEmails ? '表示' : '隠す'}
            </button>
            <button
              type="button"
              onClick={downloadCsv}
              disabled={loading || !rows}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              <Download className="w-4 h-4" aria-hidden />
              CSV
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden />
              更新
            </button>
          </div>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
          日々の管理・会員・使用量・収支をまとめて見る管理者専用ダッシュボードです
        </p>

        {/* タブ。長い1ページを切り替えて見る。login/forbidden 時は出さない。 */}
        {!error && (
          <div className="flex gap-1 mb-5 border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
            {ADMIN_TABS.map((t) => {
              const TabIcon = t.icon
              const active = tab === t.key
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  aria-current={active ? 'page' : undefined}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                    active
                      ? 'border-brand-600 text-brand-700 dark:border-brand-400 dark:text-brand-300'
                      : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200'
                  }`}
                >
                  <TabIcon className="w-4 h-4" aria-hidden />
                  {t.label}
                </button>
              )
            })}
          </div>
        )}

        {/* 🗼 今日の管理（デイリー・コマンドセンター）。台帳の読み込みを待たず独立表示。 */}
        {!error && tab === 'today' && <DailyCommandCenter />}

        {/* ⚙️ 配信・設定タブ（台帳データ非依存・自己完結なので loading/error に関わらず出す）。 */}
        {!error && tab === 'settings' && (
          <div className="mt-2 mb-8">
            <AdminSettingsPanel />
          </div>
        )}
        {!loading && !error && rows && tab === 'today' && campaignDaysLeft != null && (
          <div className="mb-6 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-amber-100 text-amber-900 border border-amber-300 dark:bg-amber-900/40 dark:text-amber-200 dark:border-amber-700">
            <Sparkles className="w-3.5 h-3.5" aria-hidden />
            公開記念キャンペーン期間中 — 残り{campaignDaysLeft}日（〜8/18）。自動トライアル7日・note特典30日・友達紹介14日
          </div>
        )}

        {loading && tab !== 'settings' && (
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 py-12 justify-center">
            <Spinner className="w-4 h-4" />
            読み込んでいます…
          </div>
        )}

        {!loading && error === 'login' && (
          <div className="text-center py-12">
            <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">この画面を見るにはログインが必要です</p>
            <a
              href="/login?next=/admin"
              className="inline-block px-4 py-2 rounded-lg bg-brand-600 text-white text-sm hover:bg-brand-700"
            >
              ログインする
            </a>
          </div>
        )}

        {!loading && error === 'forbidden' && (
          <p className="text-center py-12 text-sm text-gray-600 dark:text-gray-300">
            この画面は管理者専用です
          </p>
        )}

        {!loading && error && error !== 'login' && error !== 'forbidden' && (
          <p className="text-center py-12 text-sm text-red-600 dark:text-red-400">{error}</p>
        )}

        {!loading && !error && rows && (
          <>
            {/* 👥 アカウントタブ: KPIカード列（規模と勢い）＋台帳 */}
            {tab === 'accounts' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
              <KpiCard icon={Users} label="登録者数" value={rows.length} sub={newLast7d > 0 ? `直近7日 +${newLast7d}人` : '直近7日 +0人'} help="auth.usersの全アカウント数。管理者・本人・モニターも含む総登録数です。" />
              <KpiCard icon={Activity} label="週間アクティブ" value={activity.wau} sub="7日以内に利用形跡" highlight help="直近7日にアプリ利用（app_usage）の記録がある人数（WAU）。" />
              <KpiCard icon={Activity} label="月間アクティブ" value={activity.mau} sub="30日以内（参考）" help="直近30日に利用記録がある人数（MAU・参考値）。" />
              <KpiCard
                icon={Crown}
                label="サブスク中（課金）"
                value={counts.premium}
                sub={`カード登録トライアル ${counts.stripe_trial}人`}
                help="Stripeで実際に課金中（premium）の人数。カード登録済みの無料トライアル中（stripe_trial）は下段に別カウントで併記しています。"
              />
              <KpiCard
                icon={Hourglass}
                label="無料トライアル中"
                value={counts.auto_trial + counts.trial}
                sub={`自動 ${counts.auto_trial}・コード ${counts.trial}人`}
                help="カード登録なしの無料トライアル。自動＝登録時の3日間、コード＝招待/noteコード経由。期限で自動失効します。"
              />
              <KpiCard icon={UserPlus} label="友達紹介で開始" value={referredCount || referralTotal} sub={topReferrers.length > 0 ? `${topReferrers.length}人が招待してくれた` : '紹介コード経由の累計'} help="referral_redemptions経由（友達紹介コード）で登録した人数の累計です。" />
            </div>
            )}

            {/* 📊 分析・マーケタブ: 運用コスト・収支＋深掘り（ファネル/売上/継続/グラフ/流入元/セットアップ/LP/安全） */}
            {tab === 'analytics' && <OperatingCostCard mrrJpy={revenue.mrr} />}

            {tab === 'analytics' && (
              <>
            {/* マーケ・経営サマリー: ファネル / 売上 / 継続 */}
            <div className="grid gap-3 mb-4 lg:grid-cols-2">
              <FunnelCard stages={funnel} />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <RevenueCard rev={revenue} />
                <RetentionCard r={retention} />
              </div>
            </div>

            {/* グラフ2枚: 登録の伸びと日々の利用 */}
            <div className="grid lg:grid-cols-2 gap-3 mb-4">
              <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                <div className="flex items-baseline justify-between mb-2 gap-2">
                  <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">登録者数の推移（累積）</h2>
                  {eventsDbUrl && (
                    <a
                      href={eventsDbUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-brand-600 dark:text-brand-400 hover:underline whitespace-nowrap shrink-0"
                      title="Notionのイベント記録DBを開く（ローンチ・キャンペーン・告知などを1行足すとグラフに反映）"
                    >
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden />
                      イベントを追加・編集
                    </a>
                  )}
                </div>
                <TrendLineChart points={cumulative} label="登録者数の推移" events={events} />
                {eventUplift.length === 0 && eventsDbUrl && (
                  <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
                    「イベントを追加・編集」からローンチ・キャンペーン・告知などを1行足すと、この線に縦マーカーで出ます。
                  </p>
                )}
                {eventUplift.length > 0 && (
                  <ol className="mt-2 space-y-0.5">
                    {eventUplift.map((ev, i) => (
                      <li key={`${ev.date}-${ev.label}`} className="flex items-baseline gap-1.5 text-xs text-gray-600 dark:text-gray-300">
                        <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-400 dark:bg-amber-500 text-white dark:text-gray-900 text-[10px] font-bold shrink-0 self-center" aria-hidden>{i + 1}</span>
                        <span className="text-gray-400 dark:text-gray-500 shrink-0">{formatEventStamp(ev.date)}</span>
                        <span className="truncate">{ev.label}</span>
                        <span className="ml-auto shrink-0 font-semibold text-gray-800 dark:text-gray-100">
                          {ev.ongoing ? `${ev.elapsedDays}日目 +${ev.count}人` : `7日で +${ev.count}人`}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
              <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                <SectionHeading title="日別アクティブ数（直近30日）" caption="その日にアプリを使った人数（ユニーク）。棒が高い日ほど利用が多い。" help="app_usage_daily の日別ユニーク数。同じ人が複数回使っても1人として数えます。" />
                <DailyBarsChart points={dailyActive} label="日別アクティブ数" />
              </section>
            </div>

            {/* 利用時間帯（ホットスポット）と利用状況の内訳帯 */}
            <div className="grid lg:grid-cols-2 gap-3 mb-4">
              <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                <SectionHeading title="利用時間帯（直近30日・日本時間）" caption="1日のうち何時ごろ使われているか。告知や配信のタイミングの参考に。" help="直近30日の利用を日本時間の時間帯別に合計したもの（app_usage_hourly）。" />
                <HourlyBarsChart hourly={hourlyActive} label="利用時間帯" />
              </section>
              <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                <SectionHeading title="最終利用の内訳" caption="登録者を「最後に使ったのはいつか」で分けたもの。定着度の目安。" help="最終利用・最終ログイン・設定同期の最新値で判定。7日以内／8〜30日／31日以上／形跡なし に分類します。" />
                <ActiveBreakdownBar breakdown={activity.breakdown} />
              </section>
            </div>

            {/* 流入元の割合とセットアップ状況（離脱位置・選択の内訳） */}
            <div className="grid lg:grid-cols-2 gap-3 mb-4">
              <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                <SectionHeading title="流入元の割合" caption="登録者がどの経路（X/note/LINE等）から来たかの内訳。" help="各行の実効的な流入元の割合。公開前の登録者はモニター/本人に自動振り分けされます（下の注記参照）。" />
                <SegmentBar segments={sourceSegments} label="流入元の割合" />
                <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
                  公開（7/18 20:00）より前の登録者は全員モニターか本人のため「モニター／本人」に自動振り分け。公開後のモニターは各行の「モニター指定」ボタンで手動タグ付けできます（流入元が「モニター」になり実ユーザーの集計から外れる）。それ以外で経路不明な人が「未計測」です
                </p>
              </section>
              <SourceQualityTable rows={sourceQuality} />
              <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                <SectionHeading title="セットアップ状況" caption="初期設定が完了/途中/未計測のどれか。途中なら離脱位置も下に出ます。" help="SetupWizard の到達ステップ（onb_furthest）で判定。「完了」は同期まで到達した人です。" />
                <SegmentBar segments={setupSegments} label="セットアップ状況" />
                {dropoffBars.length > 0 && (
                  <>
                    <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mt-4 mb-2">途中の人の離脱位置（最後に到達したステップ）</h3>
                    <CountBars items={dropoffBars} label="離脱位置" />
                  </>
                )}
              </section>
              <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                <SectionHeading title="使う知識の選択（複数選択可・記録がある人のみ）" caption="セットアップで選んだ知識ソース。専門医/自分/みんなの何を求めているか。" help="オンボーディングの選択（onb_targets）。複数選択可のため合計は人数と一致しません。" />
                <CountBars items={knowledgeBars} label="使う知識の選択" />
              </section>
              <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                <SectionHeading title="接続モードとDB設定（記録がある人のみ）" caption="シンプル/パワーの接続方式と、テンプレ複製/既存DB連携のどちらで入ったか。" help="onb_mode（接続モード）と onb_db_setup（DB設定の入り方）の内訳です。" />
                <div className="space-y-4">
                  <SegmentBar segments={modeSegments} label="接続モード" />
                  <SegmentBar segments={dbSetupSegments} label="DB設定の入り方" />
                </div>
              </section>
            </div>

            {/* LP訪問（medinode-lp）: 登録の手前、LPを見た人の推移・時間帯・流入元 */}
            <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 mb-4">
              <div className="flex items-baseline justify-between mb-3">
                <SectionHeading title="LP訪問（紹介ページ・登録の手前）" caption="登録の手前、紹介ページ（LP）を見た人の動き。登録者とは別集計の匿名カウント。" help="lp_visits（匿名の訪問計測）。個々の登録者とは紐付けできないため、あくまで登録前の到達量として見ます。" className="mb-0" />
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {lpTotal > 0 ? `流入元記録 累計 ${lpTotal}件` : '流入元は蓄積待ち'}
                </span>
              </div>
              <div className="grid lg:grid-cols-2 gap-4">
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">日別の訪問数（直近30日）</h3>
                  <DailyBarsChart points={lpDaily} label="LP日別訪問数" />
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">訪問の時間帯（直近30日・日本時間）</h3>
                  <HourlyBarsChart hourly={lpHourly} label="LP利用時間帯" />
                </div>
                <div className="lg:col-span-2">
                  <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">流入元の割合（LPに来た人・全期間）</h3>
                  <SegmentBar segments={lpSourceSegments} label="LP流入元の割合" />
                </div>
              </div>
              <p className="mt-3 text-[11px] text-gray-400 dark:text-gray-500">
                LPを開いた人（登録前を含む）が母数。日別推移は既存の記録から、時間帯・流入元は
                計測拡張の適用後（デプロイ＋DB反映後）の訪問から貯まります。1ブラウザ1セッション1回で数えます。
              </p>
            </section>

            {/* 区分ごとの人数サマリー。0人の区分も薄く表示して「0人」と「非表示」を区別できるようにする */}
            <SectionHeading title="区分ごとの人数" caption="登録者を区分（課金/トライアル/無料/失効など）別に集計したバッジ。0人の区分も薄く表示。" help="member-ledger の区分定義に基づく内訳です。永続無料(comp)・管理者(admin)なども含みます。" />
            <div className="flex flex-wrap gap-2 mb-4">
              {(Object.keys(KIND_STYLE) as MemberKind[]).map((k) => {
                const Icon = KIND_STYLE[k].icon
                const zero = counts[k] === 0
                return (
                  <span
                    key={k}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs ${
                      zero
                        ? 'bg-gray-50 text-gray-400 dark:bg-gray-800/60 dark:text-gray-500 border border-dashed border-gray-200 dark:border-gray-700'
                        : KIND_STYLE[k].badge
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" aria-hidden />
                    {MEMBER_KIND_LABEL[k]} {counts[k]}人
                  </span>
                )
              })}
            </div>

            {/* 紹介してくれた人（アドボケイト）ランキング。お礼・優遇の対象を一目で。 */}
            {topReferrers.length > 0 && (
              <section className="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50/60 dark:bg-amber-900/10 p-4 mb-4">
                <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200 mb-2 flex items-center gap-1.5">
                  <Trophy className="w-4 h-4" aria-hidden />
                  紹介してくれた人（多い順）
                </h2>
                <ol className="space-y-1">
                  {topReferrers.map((r, i) => (
                    <li key={r.userId} className="flex items-baseline gap-2 text-sm">
                      <span className="text-amber-500 dark:text-amber-400 font-bold w-5 shrink-0 text-right">{i + 1}</span>
                      <span className="truncate text-gray-800 dark:text-gray-100" title={maskEmails ? undefined : (r.email ?? undefined)}>
                        {maskEmails ? maskEmail(r.email) : (r.email ?? '（メール不明）')}
                      </span>
                      <span className="ml-auto shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-amber-800 dark:text-amber-300">
                        <Gift className="w-3.5 h-3.5" aria-hidden />
                        {r.referralCount}人を招待
                      </span>
                    </li>
                  ))}
                </ol>
                <p className="mt-2 text-[11px] text-amber-700/70 dark:text-amber-400/60">
                  アプリを広げてくれている人たち。お礼のメッセージや優遇（永続無料の付与など）の検討対象です。
                </p>
              </section>
            )}

            {/* 安全管理サマリー: 契約の要確認・気になる兆候 */}
            <div className="grid gap-3 mb-4 lg:grid-cols-2">
              <ContractIssuesPanel issues={contractIssues} />
              <AnomalyPanel signals={anomalies} />
            </div>
              </>
            )}

            {tab === 'accounts' && (
              <>
            {/* 検索＋プレミアム未利用の抽出 */}
            <div className="relative mb-2">
              <Search
                className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500 pointer-events-none"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="メール・ユーザーID・区分で絞り込み"
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
            <div className="mb-4">
              <button
                type="button"
                onClick={() => setOnlyUntouchedTrials((v) => !v)}
                aria-pressed={onlyUntouchedTrials}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                  onlyUntouchedTrials
                    ? 'bg-amber-100 text-amber-900 border-amber-400 dark:bg-amber-900/50 dark:text-amber-200 dark:border-amber-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-amber-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-amber-950/30'
                }`}
              >
                <Hourglass className="w-3.5 h-3.5" aria-hidden />
                トライアル中・プレミアム未利用 {untouchedTrialCount}人{onlyUntouchedTrials ? '（絞り込み中・もう一度押すと解除）' : 'だけ表示'}
              </button>
              <button
                type="button"
                onClick={() => setOnlyReferred((v) => !v)}
                aria-pressed={onlyReferred}
                className={`ml-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                  onlyReferred
                    ? 'bg-teal-100 text-teal-900 border-teal-400 dark:bg-teal-900/50 dark:text-teal-200 dark:border-teal-600'
                    : 'bg-white text-gray-600 border-gray-200 hover:bg-teal-50 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 dark:hover:bg-teal-950/30'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5" aria-hidden />
                紹介経由 {referredCount}人{onlyReferred ? '（絞り込み中・もう一度押すと解除）' : 'だけ表示'}
              </button>
            </div>

            {/* 台帳テーブル */}
            <div id="ledger" className="scroll-mt-4 overflow-auto max-h-[70vh] rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <table className="w-full text-sm">
                {/* スクロールしても列名が分かるよう、見出し行を上部に固定（sticky）。行が透けないよう各thに背景を敷く。 */}
                <thead className="sticky top-0 z-20">
                  <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 shadow-sm [&>th]:bg-gray-50 dark:[&>th]:bg-gray-800">
                    <th className="px-4 py-3 font-medium">メール</th>
                    <th className="px-4 py-3 font-medium">区分</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">流入元</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">紹介</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">期限</th>
                    <SortableTh col="createdAt" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                    <SortableTh col="lastSignInAt" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                    <SortableTh col="lastUsedAt" activeKey={sortKey} dir={sortDir} onSort={toggleSort} />
                    <th className="px-4 py-3 font-medium whitespace-nowrap">プレミアム利用</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">設定同期</th>
                    <th className="px-4 py-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r) => {
                    const Icon = KIND_STYLE[r.kind].icon
                    const canRevoke = r.kind === 'comp' || r.kind === 'trial' || r.kind === 'auto_trial'
                    // トライアル中でも「永続無料へ格上げ」できるようにする（期限終了を待たない）。
                    const canGrant =
                      r.kind === 'free' || r.kind === 'expired' || r.kind === 'trial' || r.kind === 'auto_trial'
                    // 削除可: 管理者・課金/カード登録は対象外（Stripeはサーバー側でも拒否）。
                    const canDelete =
                      r.kind !== 'admin' && r.kind !== 'premium' && r.kind !== 'stripe_trial'
                    return (
                      <tr
                        key={r.userId}
                        className="border-b border-gray-100 dark:border-gray-700/60 last:border-b-0 odd:bg-gray-50/50 dark:odd:bg-gray-900/20 hover:bg-emerald-50/50 dark:hover:bg-gray-700/30"
                      >
                        <td className="px-4 py-3 text-gray-900 dark:text-gray-100">
                          <div className="flex items-center gap-1.5">
                            <span className="max-w-[240px] truncate" title={maskEmails ? undefined : (r.email ?? undefined)}>
                              {maskEmails ? maskEmail(r.email) : (r.email ?? '（メール不明）')}
                            </span>
                            <button
                              type="button"
                              onClick={() => void copyId(r)}
                              title={`ユーザーIDをコピー: ${r.userId}`}
                              aria-label="ユーザーIDをコピー"
                              className="shrink-0 p-1 rounded text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400"
                            >
                              {copied === r.userId ? (
                                <Check className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" aria-hidden />
                              ) : (
                                <Copy className="w-3.5 h-3.5" aria-hidden />
                              )}
                            </button>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs whitespace-nowrap ${KIND_STYLE[r.kind].badge}`}
                          >
                            <Icon className="w-3.5 h-3.5" aria-hidden />
                            {MEMBER_KIND_LABEL[r.kind]}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <SourceBadge source={effectiveSource(r)} />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <div className="flex flex-col gap-1 items-start">
                            {r.referralCount > 0 && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200" title={`この人は ${r.referralCount}人 を招待しました`}>
                                <Gift className="w-3 h-3" aria-hidden />
                                {r.referralCount}人招待
                              </span>
                            )}
                            {r.viaReferral && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-teal-100 text-teal-800 dark:bg-teal-900/50 dark:text-teal-200" title="紹介コード経由で登録">
                                <UserPlus className="w-3 h-3" aria-hidden />
                                紹介で開始
                              </span>
                            )}
                            {r.referralCount === 0 && !r.viaReferral && (
                              <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                            )}
                          </div>
                        </td>
                        <td
                          className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap"
                          title={r.kind === 'comp' ? undefined : fmtDateTime(r.trialEndsAt) || undefined}
                        >
                          {r.kind === 'comp' ? '無期限' : fmtDate(r.trialEndsAt)}
                        </td>
                        <DateCell iso={r.createdAt} />
                        <DateCell iso={r.lastSignInAt} />
                        <DateCell iso={r.lastUsedAt} />
                        {/* プレミアム利用: 見られる区分なのに未利用なら「未」を強調表示 */}
                        {isUntouchedPremium(r) ? (
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200">未</span>
                          </td>
                        ) : (
                          <DateCell iso={r.premiumUsedAt} />
                        )}
                        <DateCell iso={r.settingsUpdatedAt} />
                        <td className="px-4 py-3">
                          <div className="flex flex-col gap-1 items-start">
                            {canGrant && (
                              <button
                                type="button"
                                onClick={() => void grant(r)}
                                disabled={busy === r.userId}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-amber-300 dark:border-amber-800 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 disabled:opacity-50 whitespace-nowrap"
                              >
                                {busy === r.userId ? (
                                  <Spinner className="w-3 h-3" />
                                ) : (
                                  <Gift className="w-3.5 h-3.5" aria-hidden />
                                )}
                                永続無料を付与
                              </button>
                            )}
                            {canRevoke && (
                              <button
                                type="button"
                                onClick={() => void revoke(r)}
                                disabled={busy === r.userId}
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50 whitespace-nowrap"
                              >
                                {busy === r.userId ? (
                                  <Spinner className="w-3 h-3" />
                                ) : (
                                  <XCircle className="w-3.5 h-3.5" aria-hidden />
                                )}
                                取り消す
                              </button>
                            )}
                            {r.kind !== 'admin' && (
                              <button
                                type="button"
                                onClick={() => void toggleMonitor(r)}
                                disabled={busy === r.userId}
                                title={r.isMonitor ? 'モニター指定を解除' : 'この人をモニターとして分類（流入元を「モニター」に）'}
                                className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border disabled:opacity-50 whitespace-nowrap ${
                                  r.isMonitor
                                    ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300'
                                    : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30'
                                }`}
                              >
                                {r.isMonitor ? (
                                  <Check className="w-3.5 h-3.5" aria-hidden />
                                ) : (
                                  <UserPlus className="w-3.5 h-3.5" aria-hidden />
                                )}
                                {r.isMonitor ? 'モニター' : 'モニター指定'}
                              </button>
                            )}
                            {r.kind !== 'admin' && (
                              <button
                                type="button"
                                onClick={() => void toggleEarlyAccess(r)}
                                disabled={busy === r.userId}
                                title={r.earlyAccess ? '先行体験を取り消す' : 'この人にマルチ部署串刺し検索を先行開放する'}
                                className={`inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md border disabled:opacity-50 whitespace-nowrap ${
                                  r.earlyAccess
                                    ? 'border-teal-300 dark:border-teal-700 bg-teal-50 dark:bg-teal-950/40 text-teal-700 dark:text-teal-300'
                                    : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:bg-teal-50 dark:hover:bg-teal-950/30'
                                }`}
                              >
                                {r.earlyAccess ? (
                                  <Check className="w-3.5 h-3.5" aria-hidden />
                                ) : (
                                  <Sparkles className="w-3.5 h-3.5" aria-hidden />
                                )}
                                {r.earlyAccess ? '先行体験' : '先行体験を開放'}
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => void removeAccount(r)}
                                disabled={busy === r.userId}
                                title="このアカウントを完全に削除（タイプミス・重複の掃除用）"
                                className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 dark:text-gray-500 dark:hover:text-red-400 dark:hover:bg-red-950/40 disabled:opacity-50 whitespace-nowrap"
                              >
                                <Trash2 className="w-3.5 h-3.5" aria-hidden />
                                削除
                              </button>
                            )}
                            {r.kind === 'admin' && !canGrant && !canRevoke && !canDelete && (
                              <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {sorted.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                        該当するアカウントがありません
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <p className="mt-3 text-xs text-gray-400 dark:text-gray-500">
              区分 — 管理者: COMP_ADMIN_EMAILS のメール（常時無料）／永続無料: 招待コードまたはこの画面で付与（取り消し可）／
              サブスク中: Stripeで課金中／トライアル中（カード登録）: Stripeの無料期間中（終了後は自動で課金開始）／
              トライアル中（無料コード）: note特典などのコード入力・期限で自動失効（取り消し可）／
              トライアル中（登録・自動）: 登録時にコードなしで自動付与されるトライアル（キャンペーン中7日・通常3日。取り消し可）。
              <br />
              最終ログイン: 6桁コードやパスワードでログインが成立した日（ログインしたままの端末では動きません）。
              最終利用: ログイン中のユーザーがアプリを開いた日（1時間に1回更新・機能追加後の利用から。日付にカーソルを載せると時刻も出ます）。
              設定同期: 設定がサーバーに保存された最後の日。
              流入元: LP経由のリンクで最初に計測できた媒体（X・note・LINE等）。機能追加前からの登録者は、
              次にLP経由で来訪した時に初めて記録されるため「—」のままの人もいます。
              セットアップ状況・選択の内訳: セットアップ画面での到達ステップと選択（知識・モード・DB設定）。
              計測開始（2026-07-19）以降にセットアップ画面を通った人から記録されます。個々の選択はCSVに入っています。
              プレミアム利用: プレミアム（サブスク配信）の検索が最後に実行された日（2026-07-19計測開始・1時間粒度）。
              見られる区分なのに一度も記録がない人は「未」＝期限切れ前の声かけ対象です。
              紹介: 「N人招待」＝この人が友達紹介で連れてきた人数（多い順は上のランキング参照）。
              「紹介で開始」＝この人自身が誰かの紹介コード経由で登録。友達紹介で開始した人数はKPIカードにも出ます。
            </p>
              </>
            )}

            {tab === 'analytics' && (
            <div className="mt-4">
              <AuditLogSection log={auditLog} />
            </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
