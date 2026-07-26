'use client'
import { useState } from 'react'
import { ShieldAlert, AlertTriangle, ScrollText, RefreshCw } from 'lucide-react'
import { SectionHeading } from './SectionHeading'
import type { ContractIssue, AnomalySignal } from '@/lib/ledger-safety'

type ReconResult = {
  stripeConfigured: boolean
  orphanStripe: { subscriptionId: string; customer: string; status: string }[]
  staleLocal: { userId: string; email: string | null; status: string | null }[]
} | null

export function ContractIssuesPanel({ issues }: { issues: ContractIssue[] }) {
  const [loading, setLoading] = useState(false)
  const [recon, setRecon] = useState<ReconResult>(null)
  const [error, setError] = useState<string | null>(null)

  const runReconcile = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/ledger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'stripe_reconcile' }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '照合に失敗しました')
      setRecon(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : '照合に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-start justify-between gap-2">
        <SectionHeading
          title="契約の要確認"
          caption="台帳とStripeの食い違い。宙に浮いた契約や区分ズレを早期に発見。"
          help="常時はローカルの矛盾（課金中なのに顧客IDなし等）を表示。「Stripeと照合」でStripe側にだけある契約（未ログイン決済など）も洗います。"
          className="mb-0"
        />
        <button
          type="button"
          onClick={runReconcile}
          disabled={loading}
          className="shrink-0 inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden />
          Stripeと照合
        </button>
      </div>

      <div className="mt-2 space-y-1.5">
        {issues.length === 0 && !recon && (
          <p className="text-xs text-gray-400 dark:text-gray-500 inline-flex items-center gap-1">
            <ShieldAlert className="w-3.5 h-3.5 text-emerald-500" aria-hidden />
            ローカルの矛盾は見つかりません
          </p>
        )}
        {issues.map((it) => (
          <div key={it.userId} className="text-xs flex items-baseline gap-2">
            <span className="text-amber-600 dark:text-amber-400 shrink-0">●</span>
            <span className="text-gray-700 dark:text-gray-200 truncate">{it.email ?? it.userId}</span>
            <span className="text-gray-400 dark:text-gray-500 ml-auto shrink-0">{it.reason}</span>
          </div>
        ))}
      </div>

      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
      {recon && (
        <div className="mt-3 border-t border-gray-100 dark:border-gray-700 pt-2 space-y-1.5">
          {!recon.stripeConfigured && (
            <p className="text-xs text-gray-400">Stripe未設定のため照合をスキップしました。</p>
          )}
          {recon.stripeConfigured && recon.orphanStripe.length === 0 && recon.staleLocal.length === 0 && (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">Stripeとの食い違いはありません。</p>
          )}
          {recon.orphanStripe.map((o) => (
            <div key={o.subscriptionId} className="text-xs flex items-baseline gap-2">
              <span className="text-red-500 shrink-0">▲</span>
              <span className="text-gray-700 dark:text-gray-200 truncate">
                {o.subscriptionId}（{o.status}）
              </span>
              <a
                href={`https://dashboard.stripe.com/customers/${o.customer}`}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto shrink-0 text-brand-600 dark:text-brand-400 hover:underline"
              >
                Stripeで開く
              </a>
            </div>
          ))}
          {recon.orphanStripe.length > 0 && (
            <p className="text-[11px] text-gray-400 dark:text-gray-500">
              ▲ Stripeに契約があるのに台帳に無い（未ログイン決済など）。要対応。
            </p>
          )}
          {recon.staleLocal.map((s) => (
            <div key={s.userId} className="text-xs flex items-baseline gap-2">
              <span className="text-amber-500 shrink-0">●</span>
              <span className="text-gray-700 dark:text-gray-200 truncate">{s.email ?? s.userId}</span>
              <span className="text-gray-400 dark:text-gray-500 ml-auto shrink-0">
                台帳はactiveだがStripeに有効契約なし
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function AnomalyPanel({ signals }: { signals: AnomalySignal[] }) {
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <SectionHeading
        title="気になる兆候"
        caption="乱用・botの可能性がある兆候。※確定ではなく手がかりです。"
        help="登録時にIP等を保存していないため、同一人物や重複アカウントの断定はできません。ここは調査のきっかけとなる「兆候」の一覧です。"
      />
      <div className="mt-1 space-y-1.5">
        {signals.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500">特筆すべき兆候はありません。</p>
        )}
        {signals.map((s) => (
          <div key={s.key} className="text-xs">
            <div className="flex items-baseline gap-2">
              <AlertTriangle
                className={`w-3.5 h-3.5 shrink-0 ${s.level === 'watch' ? 'text-amber-500' : 'text-gray-400'}`}
                aria-hidden
              />
              <span className="text-gray-700 dark:text-gray-200">{s.label}</span>
              <span className="ml-auto shrink-0 font-semibold text-gray-800 dark:text-gray-100">{s.count}</span>
            </div>
            <p className="pl-5 text-[11px] text-gray-400 dark:text-gray-500">{s.hint}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

const ACTION_LABEL: Record<string, string> = {
  grant_comp: '永続無料を付与',
  revoke_comp: '永続無料を取消',
  delete_user: 'アカウント削除',
  set_monitor: 'モニター指定',
  unset_monitor: 'モニター解除',
  set_owner: 'オーナー指定',
  unset_owner: 'オーナー解除',
  export_csv: 'CSV出力',
}

export function AuditLogSection({
  log,
}: {
  log: { action: string; actorEmail: string; targetEmail: string | null; createdAt: string }[]
}) {
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 mb-4">
      <SectionHeading
        title="操作履歴（最近50件）"
        caption="台帳での付与/取消/削除/モニター指定/CSV出力の記録。誤操作・不正の証跡。"
        help="admin_audit_log（サーバーのみ書込・append-only）。表示が空の場合はまだ記録が無いか、テーブル(0011)の適用待ちです。"
      />
      <div className="mt-1 space-y-1">
        {log.length === 0 && (
          <p className="text-xs text-gray-400 dark:text-gray-500 inline-flex items-center gap-1">
            <ScrollText className="w-3.5 h-3.5" aria-hidden />
            まだ記録がありません（またはテーブル適用待ち）
          </p>
        )}
        {log.map((e, i) => (
          <div key={`${e.createdAt}-${i}`} className="text-xs flex items-baseline gap-2">
            <span className="text-gray-400 dark:text-gray-500 shrink-0 tabular-nums">
              {e.createdAt.slice(5, 16).replace('T', ' ')}
            </span>
            <span className="text-gray-700 dark:text-gray-200 shrink-0">
              {ACTION_LABEL[e.action] ?? e.action}
            </span>
            <span className="text-gray-500 dark:text-gray-400 truncate">{e.targetEmail ?? ''}</span>
            <span className="ml-auto shrink-0 text-gray-400 dark:text-gray-500 truncate max-w-[40%]">
              {e.actorEmail}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
