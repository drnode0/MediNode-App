'use client'

// アカウント台帳（管理者専用画面）。
//
// /api/admin/ledger から全ユーザー×契約状態を取得し、
// 「誰がプレミアムで、誰が永続無料か」を1画面で見渡せるようにする。
// - comp / trial（コードによる無料解放）はこの画面から取り消せる（POST /api/premium/comp）
// - 無料のユーザーへは、コードを渡さずにその場で永続無料を付与できる（POST /api/admin/ledger）
// 認可はサーバー側（requireAdmin）が行い、この画面は結果を表示するだけ。

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Check,
  Copy,
  CreditCard,
  Crown,
  Download,
  Gift,
  Hourglass,
  RefreshCw,
  Search,
  ShieldCheck,
  Timer,
  Users,
  XCircle,
} from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { MEMBER_KIND_LABEL, type MemberKind } from '@/lib/member-ledger'
import {
  ActiveBreakdownBar,
  DailyBarsChart,
  TrendLineChart,
  buildCumulativeSeries,
  type ActiveBreakdown,
  type DailyPoint,
} from './AdminCharts'

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

// KPIカード（登録者数・アクティブ数など画面上部の数字）。
function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  highlight = false,
}: {
  icon: typeof Users
  label: string
  value: number
  sub?: string
  highlight?: boolean
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

export function AdminLedgerClient() {
  const [rows, setRows] = useState<LedgerRow[] | null>(null)
  const [dailyActive, setDailyActive] = useState<DailyPoint[]>([])
  const [error, setError] = useState<'login' | 'forbidden' | string | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null) // 取り消し/付与の実行中userId
  const [copied, setCopied] = useState<string | null>(null)

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
    const header = ['メール', '区分', '期限', '登録日', '最終ログイン', '最終利用', '設定同期', 'ユーザーID']
    const lines = rows.map((r) =>
      [
        csvCell(r.email),
        csvCell(MEMBER_KIND_LABEL[r.kind]),
        csvCell(r.kind === 'comp' ? '無期限' : fmtDate(r.trialEndsAt)),
        csvCell(fmtDate(r.createdAt)),
        csvCell(fmtDate(r.lastSignInAt)),
        csvCell(fmtDate(r.lastUsedAt)),
        csvCell(fmtDate(r.settingsUpdatedAt)),
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
  }, [rows])

  const filtered = useMemo(() => {
    if (!rows) return []
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) =>
        (r.email ?? '').toLowerCase().includes(q) ||
        r.userId.toLowerCase().includes(q) ||
        MEMBER_KIND_LABEL[r.kind].includes(query.trim()),
    )
  }, [rows, query])

  const counts = useMemo(() => {
    const c: Record<MemberKind, number> = { admin: 0, comp: 0, premium: 0, stripe_trial: 0, trial: 0, auto_trial: 0, expired: 0, free: 0 }
    for (const r of rows ?? []) c[r.kind]++
    return c
  }, [rows])

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

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 px-4 py-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-1">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-brand-600 dark:text-brand-400" aria-hidden />
            アカウント台帳
          </h1>
          <div className="flex items-center gap-2">
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
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          登録ユーザーと契約状態の一覧です（管理者のみ閲覧できます）
        </p>

        {loading && (
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
            {/* KPIカード列: 規模と勢いをまず数字で */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
              <KpiCard icon={Users} label="登録者数" value={rows.length} sub={newLast7d > 0 ? `直近7日 +${newLast7d}人` : '直近7日 +0人'} />
              <KpiCard icon={Activity} label="週間アクティブ" value={activity.wau} sub="7日以内に利用形跡" highlight />
              <KpiCard icon={Activity} label="月間アクティブ" value={activity.mau} sub="30日以内（参考）" />
              <KpiCard
                icon={Crown}
                label="サブスク中（課金）"
                value={counts.premium}
                sub={`カード登録トライアル ${counts.stripe_trial}人`}
              />
              <KpiCard
                icon={Hourglass}
                label="無料トライアル中"
                value={counts.auto_trial + counts.trial}
                sub={`自動3日 ${counts.auto_trial}・コード ${counts.trial}人`}
              />
            </div>

            {/* グラフ2枚: 登録の伸びと日々の利用 */}
            <div className="grid lg:grid-cols-2 gap-3 mb-4">
              <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">登録者数の推移（累積）</h2>
                <TrendLineChart points={cumulative} label="登録者数の推移" />
              </section>
              <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
                <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">日別アクティブ数（直近30日）</h2>
                <DailyBarsChart points={dailyActive} label="日別アクティブ数" />
              </section>
            </div>

            {/* 利用状況の内訳帯 */}
            <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 mb-4">
              <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3">最終利用の内訳（最終利用・ログイン・設定同期の最新値で判定）</h2>
              <ActiveBreakdownBar breakdown={activity.breakdown} />
            </section>

            {/* 区分ごとの人数サマリー。0人の区分も薄く表示して「0人」と「非表示」を区別できるようにする */}
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

            {/* 検索 */}
            <div className="relative mb-4">
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

            {/* 台帳テーブル */}
            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
                    <th className="px-4 py-3 font-medium">メール</th>
                    <th className="px-4 py-3 font-medium">区分</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">期限</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">登録日</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">最終ログイン</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">最終利用</th>
                    <th className="px-4 py-3 font-medium whitespace-nowrap">設定同期</th>
                    <th className="px-4 py-3 font-medium">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const Icon = KIND_STYLE[r.kind].icon
                    const canRevoke = r.kind === 'comp' || r.kind === 'trial' || r.kind === 'auto_trial'
                    const canGrant = r.kind === 'free' || r.kind === 'expired'
                    return (
                      <tr
                        key={r.userId}
                        className="border-b border-gray-100 dark:border-gray-700/60 last:border-b-0"
                      >
                        <td className="px-4 py-3 text-gray-900 dark:text-gray-100">
                          <div className="flex items-center gap-1.5">
                            <span className="max-w-[240px] truncate" title={r.email ?? undefined}>
                              {r.email ?? '（メール不明）'}
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
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                          {r.kind === 'comp' ? '無期限' : fmtDate(r.trialEndsAt)}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                          {fmtDate(r.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                          {fmtDate(r.lastSignInAt)}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                          {fmtDate(r.lastUsedAt)}
                        </td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                          {fmtDate(r.settingsUpdatedAt)}
                        </td>
                        <td className="px-4 py-3">
                          {canRevoke ? (
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
                          ) : canGrant ? (
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
                          ) : (
                            <span className="text-xs text-gray-300 dark:text-gray-600">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
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
              トライアル中（登録3日・自動）: 登録時にコードなしで自動付与される3日間（取り消し可）。
              <br />
              最終ログイン: 6桁コードやパスワードでログインが成立した日（ログインしたままの端末では動きません）。
              最終利用: ログイン中のユーザーがアプリを開いた日（1日1回記録・機能追加後の利用から）。
              設定同期: 設定がサーバーに保存された最後の日。
            </p>
          </>
        )}
      </div>
    </div>
  )
}
