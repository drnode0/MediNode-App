'use client'

// 💰 運用コスト・収支（月額）。アプリ運用にかかっている固定費を、売上(MRR)と並べて収支を出す。
// コストの内訳は src/config/operating-costs.ts（オーナーが編集・変更時は再デプロイ）。
// 売上(MRR)は台帳側の computeRevenue から受け取る（このカードは表示だけ）。

import { useMemo, useState } from 'react'
import { ChevronDown, Wallet } from 'lucide-react'
import { OPERATING_COSTS, operatingCostTotal } from '@/config/operating-costs'

const yen = (n: number) => `¥${Math.round(n).toLocaleString('ja-JP')}`

export function OperatingCostCard({ mrrJpy }: { mrrJpy: number }) {
  const [open, setOpen] = useState(false)
  const total = useMemo(() => operatingCostTotal(), [])
  const net = mrrJpy - total
  const positive = net >= 0

  return (
    <section className="mb-6 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-1.5">
          <Wallet className="w-4 h-4 text-brand-600 dark:text-brand-400" aria-hidden />
          運用コスト・収支（月額）
        </h2>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          aria-expanded={open}
        >
          内訳
          <ChevronDown className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2.5">
          <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">運用コスト</div>
          <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{yen(total)}</div>
        </div>
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-2.5">
          <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">売上（MRR）</div>
          <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{yen(mrrJpy)}</div>
        </div>
        <div
          className={`rounded-lg border p-2.5 ${
            positive
              ? 'border-emerald-200 dark:border-emerald-800/60 bg-emerald-50/60 dark:bg-emerald-900/10'
              : 'border-red-200 dark:border-red-800/60 bg-red-50/60 dark:bg-red-900/10'
          }`}
        >
          <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-0.5">収支</div>
          <div
            className={`text-lg font-bold ${
              positive ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
            }`}
          >
            {positive ? '+' : ''}
            {yen(net)}
          </div>
        </div>
      </div>

      {open && (
        <ul className="mt-3 space-y-1">
          {OPERATING_COSTS.map((c) => (
            <li key={c.label} className="flex items-baseline gap-2 text-sm">
              <span className="text-gray-700 dark:text-gray-200">{c.label}</span>
              {c.note && <span className="text-[11px] text-gray-400 dark:text-gray-500">{c.note}</span>}
              <span className="ml-auto text-gray-600 dark:text-gray-300">{yen(c.monthlyJpy)}</span>
            </li>
          ))}
          <li className="flex items-baseline gap-2 text-sm border-t border-gray-100 dark:border-gray-700 pt-1 mt-1">
            <span className="font-semibold text-gray-700 dark:text-gray-200">合計</span>
            <span className="ml-auto font-semibold text-gray-800 dark:text-gray-100">{yen(total)}</span>
          </li>
        </ul>
      )}

      <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
        金額の編集は <code className="text-gray-500 dark:text-gray-400">src/config/operating-costs.ts</code>（変更後に再デプロイで反映）。
        売上は現在プレミアム課金数 × 月額の概算です。
      </p>
    </section>
  )
}
