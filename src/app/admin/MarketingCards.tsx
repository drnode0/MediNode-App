'use client'
import type { ReactNode } from 'react'
import { SectionHeading } from './SectionHeading'
import type { FunnelStage, Retention, SourceQuality, Revenue } from '@/lib/ledger-metrics'

// 流入元キーの表示名（台帳の SOURCE_STYLE と揃える）。未知はそのまま。
const SOURCE_LABEL: Record<string, string> = {
  x: 'X', note: 'note', line: 'LINE', notion: 'Notion', lp: 'LP直接',
  direct: '直接', search: '検索', monitor: 'モニター', self: '本人', 未計測: '未計測',
}
function sourceLabel(s: string): string {
  return SOURCE_LABEL[s] ?? s
}

function Card({ children }: { children: ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      {children}
    </section>
  )
}

export function FunnelCard({ stages }: { stages: FunnelStage[] }) {
  const max = Math.max(1, ...stages.map((s) => s.count))
  return (
    <Card>
      <SectionHeading
        title="転換率ファネル"
        caption="LP訪問→登録→トライアル→課金の流れ。各段の下に前段からの転換率。"
        help="LP訪問は匿名の直近30日カウントのため、LP→登録の比率は「訪問数ベースの概算」です。登録以降は同じ母集団の内訳なので正確。"
      />
      <div className="space-y-2 mt-1">
        {stages.map((s) => (
          <div key={s.label}>
            <div className="flex items-baseline justify-between text-xs mb-0.5">
              <span className="text-gray-600 dark:text-gray-300">{s.label}</span>
              <span className="font-semibold text-gray-800 dark:text-gray-100">
                {s.count.toLocaleString()}人
                {s.pct !== null && (
                  <span className="ml-1.5 text-[11px] font-normal text-brand-600 dark:text-brand-400">
                    前段の{s.pct}%
                  </span>
                )}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
              <div
                className="h-full rounded-full bg-brand-500 dark:bg-brand-400"
                style={{ width: `${Math.max(2, (s.count / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

export function RetentionCard({ r }: { r: Retention }) {
  return (
    <Card>
      <SectionHeading
        title="トライアル→課金 と 解約率"
        caption="試用した人のうち課金に至った割合と、課金者の解約割合。"
        help="現時点のスナップショット比です（subscriptionsは履歴を持たないため期間コホートではありません）。解約＝Stripe課金からの失効。"
      />
      <div className="grid grid-cols-2 gap-3 mt-1">
        <div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-none">
            {Math.round(r.trialToPaying * 1000) / 10}
            <span className="text-sm font-medium text-gray-400 ml-0.5">%</span>
          </div>
          <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
            試用→課金（課金{r.payingActive}人）
          </div>
        </div>
        <div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-none">
            {Math.round(r.churn * 1000) / 10}
            <span className="text-sm font-medium text-gray-400 ml-0.5">%</span>
          </div>
          <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
            解約率（解約{r.churnedPaying}人）
          </div>
        </div>
      </div>
    </Card>
  )
}

export function SourceQualityTable({ rows }: { rows: SourceQuality[] }) {
  return (
    <Card>
      <SectionHeading
        title="流入元ごとの質"
        caption="チャネル別に、登録が実際に課金まで至るか（CVR）。発信の意思決定材料に。"
        help="流入元＝各行の実効的な媒体。CVR＝課金/登録。登録数の多い順。試用は無料トライアル中（課金除く）の人数です。"
      />
      <div className="overflow-x-auto mt-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400 dark:text-gray-500 text-left">
              <th className="font-medium py-1 pr-2">流入元</th>
              <th className="font-medium py-1 px-2 text-right">登録</th>
              <th className="font-medium py-1 px-2 text-right">試用</th>
              <th className="font-medium py-1 px-2 text-right">課金</th>
              <th className="font-medium py-1 pl-2 text-right">CVR</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.source} className="border-t border-gray-100 dark:border-gray-700">
                <td className="py-1 pr-2 text-gray-700 dark:text-gray-200">{sourceLabel(s.source)}</td>
                <td className="py-1 px-2 text-right tabular-nums text-gray-700 dark:text-gray-200">{s.registered}</td>
                <td className="py-1 px-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{s.trial}</td>
                <td className="py-1 px-2 text-right tabular-nums font-semibold text-gray-900 dark:text-gray-100">{s.paying}</td>
                <td className="py-1 pl-2 text-right tabular-nums text-brand-600 dark:text-brand-400">{s.cvr}%</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="py-3 text-center text-gray-400">蓄積待ち</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

export function RevenueCard({ rev }: { rev: Revenue }) {
  const yen = (n: number) => `¥${n.toLocaleString()}`
  const max = Math.max(1, ...rev.monthly.map((m) => m.count))
  return (
    <Card>
      <SectionHeading
        title="売上（MRR / ARR）"
        caption="現在の課金者数から算出した月次・年次の経常収益。"
        help="MRR＝課金中（premium）×980円。ARR＝MRR×12。プレミアムは単一プラン月額980円税込。"
      />
      <div className="grid grid-cols-2 gap-3 mt-1">
        <div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-none">{yen(rev.mrr)}</div>
          <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">MRR（課金{rev.payingCount}人）</div>
        </div>
        <div>
          <div className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-none">{yen(rev.arr)}</div>
          <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">ARR（年換算）</div>
        </div>
      </div>
      {rev.monthly.length >= 2 && (
        <div className="mt-3">
          <div className="text-[11px] text-gray-400 dark:text-gray-500 mb-1">課金者数の推移（累積）</div>
          <div className="flex items-end gap-1 h-12">
            {rev.monthly.map((m) => (
              <div key={m.month} className="flex-1 flex flex-col items-center justify-end" title={`${m.month}: ${m.count}人`}>
                <div className="w-full rounded-t bg-brand-400 dark:bg-brand-500" style={{ height: `${(m.count / max) * 100}%` }} />
                <div className="text-[9px] text-gray-400 mt-0.5">{m.month.slice(5)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}
