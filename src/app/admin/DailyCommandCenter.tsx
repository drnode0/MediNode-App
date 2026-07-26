'use client'

// 🗼 今日の管理（デイリー・コマンドセンター）。/admin の最上部に置く。
//
// 3層構成:
//   A. ステータス帯   … 日次でチェックすべき外部ソースの「今の状態」をライブ表示
//   B. 今日やること   … ライブ状態を内蔵したルーティン。チェックはlocalStorageで翌日自動リセット
//   C. クイックリンク … 監視ダッシュボード・受付DB・媒体別URLコピー表
//
// データは GET /api/admin/daily（best-effort集約）。台帳本体(/api/admin/ledger)とは別fetchで、
// 重い台帳を待たずに先に表示する。未接続ソースは自動でリンクに劣化する。

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  Activity,
  AlertTriangle,
  Check,
  CheckSquare,
  ChevronDown,
  Copy,
  CreditCard,
  Database,
  ExternalLink,
  HelpCircle,
  Mail,
  Megaphone,
  MessageSquare,
  RefreshCw,
  Rocket,
  Search,
  Square,
  TowerControl,
  Users,
} from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { HeatmapChart, CumulativeLinesChart, buildCumulativeSeries } from './AdminCharts'
import { paceStatus } from '@/lib/knowledge-activity'
import type { DayActivity, ActivitySummary, PaceStatus } from '@/lib/knowledge-activity'
import {
  usagePct,
  usageSignal,
  pendingSignal,
  failedSignal,
  livenessSignal,
  bytesToMB,
  jstDateKey,
  type Signal,
} from '@/lib/admin-daily'

type NotionSource = { configured: boolean; pending?: number; url: string | null }
type StripeSource = { configured: boolean; todayCount?: number; failedCount?: number; url: string }
type AppSource = { configured: boolean; up: boolean; ms: number; url: string }
type VercelSource = { configured: boolean; state?: string; url: string }
type UsageSource = { configured: boolean; used?: number; quota?: number; pct?: number; url: string }
type LinkSource = { configured: boolean; url: string }
type SupabaseSource = { mau: number; mauQuota: number; dbBytes: number | null; dbQuota: number; url: string }

type Daily = {
  ok: true
  signupsToday: number
  supabase: SupabaseSource
  feedback: NotionSource
  cq: NotionSource
  stripe: StripeSource
  app: AppSource
  vercel: VercelSource
  algolia: UsageSource
  resend: LinkSource
}

// シグナル→タイルの色クラス（枠・文字）。
const SIGNAL_CLASS: Record<Signal, string> = {
  ok: 'border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/60 dark:bg-emerald-900/10',
  warn: 'border-amber-300 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-900/15',
  alert: 'border-red-300 dark:border-red-700 bg-red-50/70 dark:bg-red-900/15',
}
const SIGNAL_DOT: Record<Signal, string> = {
  ok: 'bg-emerald-500',
  warn: 'bg-amber-500',
  alert: 'bg-red-500',
}

// 未接続タイルの見た目（点線・淡色）。
const UNCONFIGURED_CLASS =
  'border-dashed border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/40'

const jstToday = () => jstDateKey(Date.now())
const checksKey = (dateKey: string) => `medinode.admin.daily.checks.${dateKey}`

type PaceData = {
  ready: boolean
  weeks?: number
  columns?: DayActivity[][]
  todayKey?: string
  summary?: ActivitySummary
  cumulative?: { medicalCreated: string[]; referenceCreated: string[]; readerCreated: string[] }
  totals?: { medical: number; reference: number; readerOrigin: number }
}
const PACE_GOAL_KEY = 'medinode.admin.pace.weeklyGoal'
const DEFAULT_WEEKLY_GOAL = 3
const PACE_WEEK_OPTIONS = [12, 26, 52] as const

// 状況ひとこと帯の色（レベル別）。
const PACE_STATUS_CLASS: Record<PaceStatus['level'], { box: string; dot: string; text: string }> = {
  good: { box: 'bg-emerald-50 dark:bg-emerald-900/15', dot: 'bg-emerald-500', text: 'text-emerald-700 dark:text-emerald-300' },
  warn: { box: 'bg-amber-50 dark:bg-amber-900/15', dot: 'bg-amber-500', text: 'text-amber-700 dark:text-amber-300' },
  alert: { box: 'bg-red-50 dark:bg-red-900/15', dot: 'bg-red-500', text: 'text-red-700 dark:text-red-300' },
  idle: { box: 'bg-gray-50 dark:bg-gray-800/40', dot: 'bg-gray-400', text: 'text-gray-600 dark:text-gray-300' },
}

function Tile({
  icon: Icon,
  label,
  value,
  signal,
  configured,
  url,
}: {
  icon: typeof Users
  label: string
  value: ReactNode
  signal?: Signal
  configured: boolean
  url: string | null
}) {
  const cls = !configured ? UNCONFIGURED_CLASS : signal ? SIGNAL_CLASS[signal] : SIGNAL_CLASS.ok
  const body = (
    <div className={`rounded-xl border p-2.5 h-full ${cls}`}>
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 mb-1">
        <Icon className="w-3.5 h-3.5" aria-hidden />
        <span className="truncate">{label}</span>
        {configured && signal && (
          <span className={`ml-auto w-1.5 h-1.5 rounded-full shrink-0 ${SIGNAL_DOT[signal]}`} aria-hidden />
        )}
      </div>
      <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-1">
        {configured ? value : <span className="text-gray-400 dark:text-gray-500">— 接続</span>}
        {url && <ExternalLink className="w-3 h-3 text-gray-300 dark:text-gray-600 shrink-0" aria-hidden />}
      </div>
    </div>
  )
  if (!url) return body
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="block hover:opacity-90 transition-opacity">
      {body}
    </a>
  )
}

// 使用量ゲージ（無料枠に対する使用率のバー）。数値が取れないものはリンクにフォールバック。
function UsageBar({
  icon: Icon,
  label,
  text,
  pct,
  signal,
  url,
  fallback,
}: {
  icon: typeof Users
  label: string
  text?: string
  pct?: number
  signal?: Signal
  url: string
  fallback?: string
}) {
  const barColor = signal ? SIGNAL_DOT[signal] : 'bg-brand-500'
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="block rounded-lg border border-gray-200 dark:border-gray-700 p-2.5 hover:bg-gray-50 dark:hover:bg-gray-700/40"
    >
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500 dark:text-gray-400 mb-1.5">
        <Icon className="w-3.5 h-3.5" aria-hidden />
        <span className="truncate">{label}</span>
        <span className="ml-auto text-gray-600 dark:text-gray-300 whitespace-nowrap">
          {text ?? <span className="text-gray-400 dark:text-gray-500">{fallback ?? '—'}</span>}
        </span>
      </div>
      {/* 数値が取れるものだけバーを出す。リンクのみ（Algolia無料/Resend/egress）は横棒を出さない。 */}
      {typeof pct === 'number' && (
        <div className="h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
          <div className={`h-full rounded-full ${barColor}`} style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
      )}
    </a>
  )
}

// バイト量を MB/GB の読みやすい文字列に（例: 12MB / 8GB）。
function fmtSize(bytes: number): string {
  const mb = bytesToMB(bytes)
  return mb < 1024 ? `${mb}MB` : `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)}GB`
}

// クイックリンクのボタン。
function LinkChip({ icon: Icon, label, url }: { icon: typeof Users; label: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 whitespace-nowrap"
    >
      <Icon className="w-4 h-4 text-gray-400 dark:text-gray-500" aria-hidden />
      {label}
      <ExternalLink className="w-3 h-3 text-gray-300 dark:text-gray-600" aria-hidden />
    </a>
  )
}

type BroadcastHistoryItem = {
  id: string
  title: string
  body: string
  url: string | null
  sent: number
  pruned: number
  created_at: string
}

// お知らせ一斉送信フォーム（Web Push）。POST /api/admin/push-broadcast を叩く。
// 週1程度に留める運用ルールはUI注記のみ（サーバー側の回数制限はない）。
// 1回目の「送信」クリックでは即送信せず、内容確認ビューを経由してから送る。
function SubscriptionSyncButton() {
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState<{ medical: number; reference: number; total: number; at: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    setSyncing(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/admin/subscription-sync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '同期に失敗しました')
      const synced = data.synced ?? { medical: 0, reference: 0, total: 0 }
      setResult({
        medical: synced.medical ?? 0,
        reference: synced.reference ?? 0,
        total: synced.total ?? 0,
        at: new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : '同期に失敗しました')
    } finally {
      setSyncing(false)
    }
  }, [])

  return (
    <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
        <RefreshCw className="w-3.5 h-3.5" aria-hidden />
        サブスクをアプリに同期
      </h3>
      <button
        type="button"
        onClick={() => void run()}
        disabled={syncing}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {syncing ? <Spinner className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" aria-hidden />}
        {syncing ? '同期中…' : 'サブスクをアプリに同期'}
      </button>
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {result && (
        <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
          同期しました（医療{result.medical}件・文献{result.reference}件／{result.at}）
        </p>
      )}
      <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
        Notionのサブスク側を編集したら押す。毎朝6時にも自動で同期されます。
      </p>
    </div>
  )
}

// 管理者専用：メール配信（Resend）の疎通テスト。自分宛に1通だけ送って届くか確認する。
// 体験終了メールと同じ経路なので、これが届けば終了メールも届く。
function EmailTestButton() {
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)

  const run = useCallback(async () => {
    setSending(true)
    setResult(null)
    try {
      const res = await fetch('/api/admin/email-test', { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        setResult({ ok: true, message: `送信しました（${data.to}）。数分内に届くか確認してください（迷惑メールも）。` })
      } else if (data.reason === 'not_configured') {
        const miss = [!data.configured?.apiKey && 'RESEND_API_KEY', !data.configured?.from && 'RESEND_FROM']
          .filter(Boolean)
          .join('・')
        setResult({ ok: false, message: `RESEND未設定（${miss} が空）。アプリからメールは一切飛んでいません。Vercelの環境変数を設定してください。` })
      } else {
        const detail = data.detail ? `：${data.detail}` : ''
        setResult({ ok: false, message: `送信失敗（${data.resendStatus ?? data.reason}）${detail}` })
      }
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : '送信に失敗しました' })
    } finally {
      setSending(false)
    }
  }, [])

  return (
    <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
        <Mail className="w-3.5 h-3.5" aria-hidden />
        メール配信テスト
      </h3>
      <button
        type="button"
        onClick={() => void run()}
        disabled={sending}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
      >
        {sending ? <Spinner className="w-3.5 h-3.5" /> : <Mail className="w-3.5 h-3.5" aria-hidden />}
        {sending ? '送信中…' : '自分宛にテスト送信'}
      </button>
      {result && (
        <p className={`mt-2 text-xs ${result.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>
          {result.message}
        </p>
      )}
      <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
        自分（管理者）宛に1通だけ送ります。届けば体験終了メールも届きます。
      </p>
    </div>
  )
}

// お知らせ一斉送信フォーム。運用の集約に伴い「通知・配信」タブ（操作卓）から描画する。
export function BroadcastForm() {
  const [title, setTitle] = useState('')
  const [bodyText, setBodyText] = useState('')
  const [url, setUrl] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ sent: number; pruned: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<BroadcastHistoryItem[]>([])
  const [historyLoaded, setHistoryLoaded] = useState(false)

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/push-broadcast')
      if (res.ok) {
        const data = (await res.json()) as { items?: BroadcastHistoryItem[] }
        setHistory(data.items ?? [])
      }
    } catch {
      // 履歴が取れなくても送信フォームの動作には影響させない。
    } finally {
      setHistoryLoaded(true)
    }
  }, [])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const requestConfirm = useCallback(() => {
    if (!title.trim() || !bodyText.trim()) {
      setError('件名と本文は必須です')
      return
    }
    setError(null)
    setResult(null)
    setConfirming(true)
  }, [title, bodyText])

  const cancelConfirm = useCallback(() => {
    setConfirming(false)
  }, [])

  const send = useCallback(async () => {
    setSending(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/admin/push-broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim(), body: bodyText.trim(), url: url.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '送信に失敗しました')
      setResult({ sent: data.sent ?? 0, pruned: data.pruned ?? 0 })
      setTitle('')
      setBodyText('')
      setUrl('')
      setConfirming(false)
      void loadHistory()
    } catch (e) {
      setError(e instanceof Error ? e.message : '送信に失敗しました')
    } finally {
      setSending(false)
    }
  }, [title, bodyText, url, loadHistory])

  return (
    <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
        <Megaphone className="w-3.5 h-3.5" aria-hidden />
        お知らせ送信（Web Push）
      </h3>
      {!confirming ? (
        <div className="space-y-2 max-w-md">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="件名"
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <textarea
            value={bodyText}
            onChange={(e) => setBodyText(e.target.value)}
            placeholder="本文"
            rows={2}
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
          />
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="リンク先URL（任意・未入力なら / ）"
            className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            type="button"
            onClick={requestConfirm}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
          >
            送信
          </button>
        </div>
      ) : (
        <div className="max-w-md rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/40 p-3 space-y-2">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400">この内容で送信します</p>
          <div className="text-sm">
            <p className="font-semibold text-gray-900 dark:text-gray-100">{title.trim()}</p>
            <p className="mt-1 text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{bodyText.trim()}</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              リンク先: {url.trim() || '（未入力 → トップ /）'}
            </p>
          </div>
          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            送信対象は現在の公開段階に従います（preview＝あなたと指定アドレスのみ／on＝全員）。
          </p>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {sending && <Spinner className="w-3.5 h-3.5" />}
              この内容で送信
            </button>
            <button
              type="button"
              onClick={cancelConfirm}
              disabled={sending}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700/40 disabled:opacity-50"
            >
              戻る
            </button>
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {result && (
        <p className="mt-2 text-xs text-emerald-600 dark:text-emerald-400">
          送信しました（成功 {result.sent}件・失効整理 {result.pruned}件）
        </p>
      )}
      <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
        お知らせは週1程度までにとどめる（頻度が高いと通知をオフにされやすくなるため、目安として自主的に守る）。
      </p>

      <div className="mt-4">
        <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">送信履歴</h4>
        {historyLoaded && history.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500">まだ送信履歴はありません。</p>
        )}
        {history.length > 0 && (
          <ul className="space-y-1.5 max-w-md">
            {history.map((item) => (
              <li
                key={item.id}
                className="rounded-lg border border-gray-100 dark:border-gray-700 px-3 py-1.5"
              >
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">{item.title}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{item.body}</p>
                <p className="text-[11px] text-gray-400 dark:text-gray-500">
                  送信 {item.sent}件・{new Date(item.created_at).toLocaleString('ja-JP')}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// 利用状況ヘッドライン（/api/admin/engagement の一部）。深掘りは分析タブの EngagementSection。
type UsageHeadline = {
  usage: { today: number; yesterday: number; avg7: number } | null
  members: { active: number; total: number; pct: number } | null
}

export function DailyCommandCenter() {
  const [data, setData] = useState<Daily | null>(null)
  const [eng, setEng] = useState<UsageHeadline | null>(null)
  const [loading, setLoading] = useState(true)
  const [checks, setChecks] = useState<Record<string, boolean>>({})
  const [openLinks, setOpenLinks] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [pace, setPace] = useState<PaceData | null>(null)
  const [paceWeeks, setPaceWeeks] = useState<number>(12)
  const [weeklyGoal, setWeeklyGoal] = useState<number>(DEFAULT_WEEKLY_GOAL)

  const load = useCallback(async () => {
    setLoading(true)
    // daily と engagement を並列取得（更新ボタンで両方リフレッシュ）。互いに独立の best-effort。
    const daily = fetch('/api/admin/daily', { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<Daily>) : null))
      .then((d) => d && setData(d))
      .catch(() => {})
    const engagement = fetch('/api/admin/engagement', { cache: 'no-store' })
      .then((res) => (res.ok ? (res.json() as Promise<UsageHeadline>) : null))
      .then((e) => e && setEng(e))
      .catch(() => {})
    try {
      await Promise.all([daily, engagement])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // 投稿ペース（台帳・daily とは独立の best-effort fetch）。週切替で再取得。
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const res = await fetch(`/api/admin/knowledge-activity?weeks=${paceWeeks}`, { cache: 'no-store' })
        if (alive && res.ok) setPace((await res.json()) as PaceData)
      } catch {
        // best-effort。
      }
    })()
    return () => {
      alive = false
    }
  }, [paceWeeks])

  // 週目標（localStorage）。
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PACE_GOAL_KEY)
      const n = raw ? Number(raw) : NaN
      if (Number.isFinite(n) && n > 0) setWeeklyGoal(n)
    } catch {
      // 既定値のまま。
    }
  }, [])

  const updateGoal = useCallback((n: number) => {
    const v = Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 99) : DEFAULT_WEEKLY_GOAL
    setWeeklyGoal(v)
    try {
      localStorage.setItem(PACE_GOAL_KEY, String(v))
    } catch {
      // 保存不可でも UI は効く。
    }
  }, [])

  // チェックリスト状態の読み込み（当日キー）。日付が変われば空＝全未チェックに戻る。
  useEffect(() => {
    try {
      const raw = localStorage.getItem(checksKey(jstToday()))
      if (raw) setChecks(JSON.parse(raw) as Record<string, boolean>)
    } catch {
      // localStorage 不可でも動作は続ける。
    }
  }, [])

  const toggleCheck = useCallback((id: string) => {
    setChecks((prev) => {
      const next = { ...prev, [id]: !prev[id] }
      try {
        localStorage.setItem(checksKey(jstToday()), JSON.stringify(next))
      } catch {
        // 保存できなくてもUI上のチェックは効く。
      }
      return next
    })
  }, [])

  const copy = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(key)
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1500)
    } catch {
      window.prompt('コピーできませんでした。手動で選択してください', text)
    }
  }, [])

  // 媒体別URL（LP入口）。LPのURLは env。未設定なら表は出さない。
  const lpBase = process.env.NEXT_PUBLIC_LP_URL
  const utmRows = useMemo(
    () =>
      lpBase
        ? [
            { label: 'X', url: `${lpBase}/?utm_source=x` },
            { label: 'note', url: `${lpBase}/?utm_source=note` },
            { label: 'LINE', url: `${lpBase}/?utm_source=line` },
            { label: 'Notion', url: `${lpBase}/?utm_source=notion` },
            { label: '直接（DM・口頭）', url: `${lpBase}/` },
          ]
        : [],
    [lpBase],
  )

  // ステータス帯のタイル定義。
  const tiles = useMemo(() => {
    if (!data) return []
    const d = data
    return [
      {
        icon: Users,
        label: '新規登録（今日）',
        value: <>+{d.signupsToday}人</>,
        signal: 'ok' as Signal,
        configured: true,
        url: '#ledger',
      },
      {
        icon: MessageSquare,
        label: 'フィードバック',
        value: <>未対応 {d.feedback.pending ?? 0}件</>,
        signal: pendingSignal(d.feedback.pending ?? 0),
        configured: d.feedback.configured,
        url: d.feedback.url,
      },
      {
        icon: HelpCircle,
        label: '臨床疑問(CQ)',
        value: <>未対応 {d.cq.pending ?? 0}件</>,
        signal: pendingSignal(d.cq.pending ?? 0),
        configured: d.cq.configured,
        url: d.cq.url,
      },
      {
        icon: CreditCard,
        label: '決済（今日）',
        value: (
          <>
            {d.stripe.todayCount ?? 0}件
            {(d.stripe.failedCount ?? 0) > 0 && (
              <span className="text-red-600 dark:text-red-400">・失敗{d.stripe.failedCount}</span>
            )}
          </>
        ),
        signal: failedSignal(d.stripe.failedCount ?? 0),
        configured: d.stripe.configured,
        url: d.stripe.url,
      },
      {
        icon: Activity,
        label: 'アプリ生存',
        value: d.app.up ? <>稼働中 {d.app.ms}ms</> : <>応答なし</>,
        signal: livenessSignal(d.app.up),
        configured: d.app.configured,
        url: d.app.url || null,
      },
      {
        icon: Rocket,
        label: 'デプロイ',
        value: <>{d.vercel.state ?? '—'}</>,
        signal: d.vercel.state === 'ERROR' ? ('alert' as Signal) : ('ok' as Signal),
        configured: d.vercel.configured,
        url: d.vercel.url,
      },
      {
        icon: Search,
        label: 'Algolia（月）',
        value: <>{d.algolia.pct ?? 0}%</>,
        signal: usageSignal(d.algolia.pct ?? 0),
        configured: d.algolia.configured,
        url: d.algolia.url,
      },
    ]
  }, [data])

  // 今日やること（毎日）。ライブ状態を内蔵。
  const dailySteps = useMemo(() => {
    const d = data
    return [
      { id: 'signups', label: '新規登録・会員区分を見る', badge: d ? `今日 +${d.signupsToday}人` : '', url: '#ledger' },
      {
        id: 'feedback',
        label: 'フィードバック新着を読む',
        badge: d?.feedback.configured ? `未対応 ${d.feedback.pending ?? 0}件` : '未接続',
        url: d?.feedback.url ?? null,
      },
      {
        id: 'cq',
        label: '臨床疑問の新着を確認',
        badge: d?.cq.configured ? `未対応 ${d.cq.pending ?? 0}件` : '未接続',
        url: d?.cq.url ?? null,
      },
      {
        id: 'app',
        label: 'アプリの生存確認',
        badge: d?.app.configured ? (d.app.up ? '稼働中' : '応答なし') : '未接続',
        url: d?.app.url || null,
      },
      {
        id: 'deploy',
        label: 'デプロイ・エラーを確認',
        badge: d?.vercel.configured ? (d.vercel.state ?? '—') : 'リンクで確認',
        url: d?.vercel.url ?? 'https://vercel.com/dashboard',
      },
      {
        id: 'stripe',
        label: '決済・プレミアム登録を確認',
        badge: d?.stripe.configured
          ? `今日 ${d.stripe.todayCount ?? 0}件${(d.stripe.failedCount ?? 0) > 0 ? `・失敗${d.stripe.failedCount}` : ''}`
          : 'リンクで確認',
        url: d?.stripe.url ?? 'https://dashboard.stripe.com/payments',
      },
    ]
  }, [data])

  const doneCount = dailySteps.filter((s) => checks[s.id]).length

  return (
    <section className="mb-6 rounded-2xl border border-brand-200 dark:border-brand-800/60 bg-white dark:bg-gray-800 overflow-hidden">
      {/* ヘッダー */}
      <div className="flex items-center justify-between gap-2 px-4 py-3 bg-brand-50/70 dark:bg-brand-900/15 border-b border-brand-100 dark:border-brand-800/60">
        <h2 className="text-base font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
          <TowerControl className="w-4 h-4 text-brand-600 dark:text-brand-400" />
          今日の管理
          <span className="text-xs font-normal text-gray-500 dark:text-gray-400">
            上から順に確認（{doneCount}/{dailySteps.length}）
          </span>
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          更新
        </button>
      </div>

      <div className="p-4">
        {/* A. ステータス帯 */}
        {loading && !data ? (
          <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500 py-4">
            <Spinner className="w-4 h-4" />
            状態を確認しています…
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-5">
            {tiles.map((t) => (
              <Tile key={t.label} {...t} />
            ))}
          </div>
        )}

        {/* 利用状況（実利用・ユニーク人数）。のべではなく1人1日1カウント。深掘りは分析タブ。 */}
        <div className="mb-5">
          <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5" aria-hidden />
            利用状況（実利用・ユニーク人数）
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-2.5">
              <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">今日 使った人</div>
              <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {eng?.usage ? `${eng.usage.today}人` : '—'}
              </div>
            </div>
            <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-2.5">
              <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">昨日 使った人</div>
              <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {eng?.usage ? `${eng.usage.yesterday}人` : '—'}
              </div>
            </div>
            <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-2.5">
              <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">7日平均 / 日</div>
              <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {eng?.usage ? `${eng.usage.avg7}人` : '—'}
              </div>
            </div>
            <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-2.5">
              <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">会員稼働率（7日）</div>
              <div className="text-lg font-bold text-gray-900 dark:text-gray-100">
                {eng?.members ? (
                  <>
                    {eng.members.pct}%
                    <span className="ml-1 text-xs font-normal text-gray-500 dark:text-gray-400">
                      {eng.members.active}/{eng.members.total}人
                    </span>
                  </>
                ) : (
                  '—'
                )}
              </div>
            </div>
          </div>
          <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
            1人1日1カウント（のべではない）。実利用の下限＝過小評価側。導入日以降ぶんのみ。詳しい継続・離脱は「分析・マーケ」タブ。
          </p>
        </div>

        {/* 投稿ペース（ナレッジ＋参考文献） */}
        {pace?.ready && pace.columns && pace.summary && pace.todayKey && (
          <div className="mb-5">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5" />
                ナレッジ投稿ペース
              </h3>
              <div className="flex items-center gap-1">
                {PACE_WEEK_OPTIONS.map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setPaceWeeks(w)}
                    className={`px-2 py-0.5 text-xs rounded-md border ${
                      paceWeeks === w
                        ? 'border-brand-400 bg-brand-50 text-brand-700 dark:border-brand-600 dark:bg-brand-900/30 dark:text-brand-300'
                        : 'border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {w}週
                  </button>
                ))}
              </div>
            </div>

            {/* 状況ひとこと（順調／低調／停滞） */}
            {(() => {
              const st = paceStatus(pace.summary!, weeklyGoal)
              const c = PACE_STATUS_CLASS[st.level]
              return (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg mb-3 ${c.box}`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${c.dot}`} aria-hidden />
                  <span className={`text-xs ${c.text}`}>{st.message}</span>
                </div>
              )
            })()}

            {/* サマリー行 */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-300 mb-2">
              <span>
                直近7日{' '}
                <b className="text-gray-900 dark:text-gray-100">
                  ナレッジ{pace.summary.last7.medical}・文献{pace.summary.last7.reference}
                </b>
              </span>
              <span>
                30日{' '}
                <b className="text-gray-900 dark:text-gray-100">
                  ナレッジ{pace.summary.last30.medical}・文献{pace.summary.last30.reference}
                </b>
              </span>
              <span>
                最終投稿から{' '}
                <b className="text-gray-900 dark:text-gray-100">
                  {pace.summary.daysSinceLastMedical == null ? '—' : `${pace.summary.daysSinceLastMedical}日`}
                </b>
              </span>
            </div>

            {/* 週目標バー */}
            <div className="flex items-center gap-2 mb-3 text-xs">
              <span className="text-gray-500 dark:text-gray-400">今週のナレッジ</span>
              <div className="relative h-2 w-32 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    pace.summary.thisWeekMedical >= weeklyGoal ? 'bg-brand-500' : 'bg-brand-300 dark:bg-brand-700'
                  }`}
                  style={{
                    width: `${Math.min(100, Math.round((pace.summary.thisWeekMedical / Math.max(1, weeklyGoal)) * 100))}%`,
                  }}
                />
              </div>
              <span className="text-gray-700 dark:text-gray-200">
                {pace.summary.thisWeekMedical}/
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={weeklyGoal}
                  onChange={(e) => updateGoal(Number(e.target.value))}
                  className="w-10 mx-0.5 px-1 py-0 text-xs text-center rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800"
                  aria-label="週目標件数"
                />
                件
              </span>
              {pace.summary.thisWeekMedical < weeklyGoal && (
                <span className="text-amber-600 dark:text-amber-400">
                  あと{weeklyGoal - pace.summary.thisWeekMedical}件
                </span>
              )}
            </div>

            <HeatmapChart columns={pace.columns} todayKey={pace.todayKey} />

            {/* 累積の伸び（ライブラリ総数の推移） */}
            {pace.cumulative && (
              <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700/60">
                <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
                  ライブラリの伸び（累積）
                </h4>
                <CumulativeLinesChart
                  lines={[
                    {
                      name: 'ナレッジ総数',
                      points: buildCumulativeSeries(pace.cumulative.medicalCreated),
                      strokeClass: 'stroke-emerald-600 dark:stroke-emerald-400',
                      dotClass: 'fill-emerald-600 dark:fill-emerald-400',
                      swatchClass: 'bg-emerald-600 dark:bg-emerald-400',
                      labelClass: 'fill-emerald-700 dark:fill-emerald-300',
                    },
                    {
                      name: '参考文献総数',
                      points: buildCumulativeSeries(pace.cumulative.referenceCreated),
                      strokeClass: 'stroke-amber-500 dark:stroke-amber-400',
                      dotClass: 'fill-amber-500 dark:fill-amber-400',
                      swatchClass: 'bg-amber-500 dark:bg-amber-400',
                      labelClass: 'fill-amber-700 dark:fill-amber-300',
                    },
                    {
                      name: 'うち現場の疑問由来',
                      points: buildCumulativeSeries(pace.cumulative.readerCreated),
                      strokeClass: 'stroke-teal-500 dark:stroke-teal-400',
                      dotClass: 'fill-teal-500 dark:fill-teal-400',
                      swatchClass: 'bg-teal-500 dark:bg-teal-400',
                      labelClass: 'fill-teal-700 dark:fill-teal-300',
                      dashed: true,
                    },
                  ]}
                />
              </div>
            )}
          </div>
        )}

        {/* B. 今日やること */}
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">今日やること（毎日）</h3>
        <ul className="space-y-1 mb-4">
          {dailySteps.map((s, i) => {
            const done = !!checks[s.id]
            return (
              <li
                key={s.id}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${
                  done ? 'opacity-50' : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleCheck(s.id)}
                  className="shrink-0 text-gray-400 hover:text-brand-600 dark:hover:text-brand-400"
                  aria-pressed={done}
                  aria-label={done ? 'チェックを外す' : 'チェックする'}
                >
                  {done ? (
                    <CheckSquare className="w-4 h-4 text-brand-600 dark:text-brand-400" aria-hidden />
                  ) : (
                    <Square className="w-4 h-4" aria-hidden />
                  )}
                </button>
                <span className="text-gray-400 dark:text-gray-500 text-xs w-4 shrink-0">{i + 1}</span>
                <span className={`text-sm text-gray-800 dark:text-gray-100 ${done ? 'line-through' : ''}`}>
                  {s.label}
                </span>
                {s.badge && (
                  <span className="ml-auto text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{s.badge}</span>
                )}
                {s.url && (
                  <a
                    href={s.url}
                    target={s.url.startsWith('#') ? undefined : '_blank'}
                    rel="noopener noreferrer"
                    className="shrink-0 text-brand-600 dark:text-brand-400 hover:underline"
                    aria-label="開く"
                  >
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden />
                  </a>
                )}
              </li>
            )
          })}
        </ul>

        {/* 枠の残り（無料枠に対する使用量） */}
        {data && (
          <div className="mb-4">
            <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">
              枠の残り（プラン枠に対する使用量・今月）
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
              {data.supabase.dbBytes != null ? (
                <UsageBar
                  icon={Database}
                  label="Supabase DB"
                  text={`${fmtSize(data.supabase.dbBytes)} / ${fmtSize(data.supabase.dbQuota)}`}
                  pct={usagePct(data.supabase.dbBytes, data.supabase.dbQuota)}
                  signal={usageSignal(usagePct(data.supabase.dbBytes, data.supabase.dbQuota))}
                  url={data.supabase.url}
                />
              ) : (
                <UsageBar icon={Database} label="Supabase DB" url={data.supabase.url} fallback="関数未適用" />
              )}
              <UsageBar
                icon={Users}
                label="推定MAU"
                text={`${data.supabase.mau}/${data.supabase.mauQuota / 1000}k`}
                pct={usagePct(data.supabase.mau, data.supabase.mauQuota)}
                signal={usageSignal(usagePct(data.supabase.mau, data.supabase.mauQuota))}
                url={data.supabase.url}
              />
              {data.algolia.configured && typeof data.algolia.pct === 'number' ? (
                <UsageBar
                  icon={Search}
                  label="Algolia検索"
                  text={`${data.algolia.pct}%`}
                  pct={data.algolia.pct}
                  signal={usageSignal(data.algolia.pct)}
                  url={data.algolia.url}
                />
              ) : (
                <UsageBar icon={Search} label="Algolia検索" url={data.algolia.url} fallback="ダッシュボード" />
              )}
              <UsageBar icon={Mail} label="Resend送信" url={data.resend.url} fallback="ダッシュボード" />
              <UsageBar icon={Activity} label="Supabase egress" url={data.supabase.url} fallback="ダッシュボード" />
            </div>
            <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">
              8割で警告色。DB容量はデータの増え方、推定MAUは利用者規模の目安（Supabase Pro枠 DB 8GB・MAU 10万・egress 250GB／Algolia 無料枠 1万検索/月）。
              Algolia検索・Resend送信量・egress はプラン制限やAPI不在のため、数値ではなくリンクから確認します。
            </p>
          </div>
        )}

        {/* C. クイックリンク（折りたたみ） */}
        <button
          type="button"
          onClick={() => setOpenLinks((v) => !v)}
          className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        >
          <ChevronDown className={`w-4 h-4 transition-transform ${openLinks ? 'rotate-180' : ''}`} aria-hidden />
          クイックリンク（監視ダッシュボード・受付DB・貼るURL）
        </button>
        {openLinks && data && (
          <div className="mt-3 space-y-4">
            <div>
              <h4 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 mb-1.5">監視ダッシュボード</h4>
              <div className="flex flex-wrap gap-2">
                <LinkChip icon={Rocket} label="Vercel" url={data.vercel.url} />
                <LinkChip icon={CreditCard} label="Stripe" url={data.stripe.url} />
                <LinkChip icon={Search} label="Algolia" url={data.algolia.url} />
                <LinkChip icon={Mail} label="Resend" url={data.resend.url} />
                <LinkChip icon={Database} label="Supabase" url={data.supabase.url} />
              </div>
            </div>
            {(data.feedback.url || data.cq.url) && (
              <div>
                <h4 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 mb-1.5">受付DB（Notion）</h4>
                <div className="flex flex-wrap gap-2">
                  {data.feedback.url && <LinkChip icon={MessageSquare} label="フィードバックDB" url={data.feedback.url} />}
                  {data.cq.url && <LinkChip icon={HelpCircle} label="臨床疑問受付DB" url={data.cq.url} />}
                </div>
              </div>
            )}
            {utmRows.length > 0 && (
              <div>
                <h4 className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 mb-1.5">
                  媒体別 貼るURL（コピー用・末尾のutmで流入元を計測）
                </h4>
                <div className="flex flex-wrap gap-2">
                  {utmRows.map((r) => (
                    <button
                      key={r.label}
                      type="button"
                      onClick={() => void copy(r.url, r.label)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
                      title={r.url}
                    >
                      {copied === r.label ? (
                        <Check className="w-4 h-4 text-brand-600 dark:text-brand-400" aria-hidden />
                      ) : (
                        <Copy className="w-4 h-4 text-gray-400 dark:text-gray-500" aria-hidden />
                      )}
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* 未接続の案内（1つでも未接続なら控えめに出す） */}
        {data && (!data.feedback.configured || !data.cq.configured || !data.vercel.configured) && (
          <p className="mt-3 text-[11px] text-gray-400 dark:text-gray-500 flex items-start gap-1">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden />
            「— 接続」のタイルは環境変数（Notion DB ID／Vercelトークン等）を設定すると点灯します。設定するまではリンクとして機能します。
          </p>
        )}

        {/* D. サブスク同期（オーナー操作・スマホから1タップ） */}
        <SubscriptionSyncButton />
        {/* D'. メール配信テスト（Resend疎通確認・自分宛に1通） */}
        <EmailTestButton />
        {/* お知らせ一斉送信は「通知・配信」タブの操作卓へ集約（重複表示を避けるためここでは出さない）。 */}
      </div>
    </section>
  )
}
