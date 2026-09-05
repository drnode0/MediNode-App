'use client'

// 聞ける棚（ask_shelf）への投稿者の内訳（/admin 分析タブ）。
// データは /api/admin/cq-submitter-breakdown（管理者専用・cq_submissions の role/years を集計）。
// 「どんな属性の人が疑問を寄せているか」を作者が把握するための一覧。公開面には出さない。

import { useEffect, useState } from 'react'
import { Users } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { SectionHeading } from './SectionHeading'

type Tally = { label: string; count: number }
type Breakdown = { byOccupation: Tally[]; byExperience: Tally[]; total: number; ready: boolean }

function TallyList({ items, total }: { items: Tally[]; total: number }) {
  if (items.length === 0) {
    return <p className="text-xs text-gray-400 dark:text-gray-500 py-2">まだ投稿がありません。</p>
  }
  return (
    <ul className="space-y-1">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-2 text-sm py-0.5">
          <span className="flex-1 min-w-0 truncate text-gray-800 dark:text-gray-100">{it.label}</span>
          <span className="shrink-0 text-xs font-semibold text-gray-500 dark:text-gray-400 tabular-nums">
            {it.count.toLocaleString()}件
            {total > 0 && <span className="ml-1 text-gray-400 dark:text-gray-500">（{Math.round((it.count / total) * 100)}%）</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function CqSubmitterBreakdownPanel() {
  const [data, setData] = useState<Breakdown | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/cq-submitter-breakdown')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((d: Breakdown) => {
        if (cancelled) return
        setData(d)
      })
      .catch(() => {
        if (!cancelled) setData({ byOccupation: [], byExperience: [], total: 0, ready: false })
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 mb-4">
      <SectionHeading
        title="聞ける棚への投稿者の内訳"
        caption="アプリ内CQ投稿（/api/cq/submit）の職種・経験年数の件数。誰が投稿したかではなく、属性ごとの傾向を見るための集計。"
        help="cq_submissions（マイグレーション0019）の role（職種）・years（経験年数）を集計しています。user_id・疑問文などの個人が辿れる値は含みません。マイグレーション未適用の環境では0件のまま表示されます。"
      />

      {data === null && (
        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 py-4">
          <Spinner className="h-4 w-4" />読み込み中…
        </div>
      )}

      {data !== null && !data.ready && (
        <p className="text-xs text-gray-400 dark:text-gray-500 py-4 leading-relaxed">
          まだ集計できません。マイグレーション <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">0019</code> の適用後、投稿が貯まるとここに出ます。
        </p>
      )}

      {data !== null && data.ready && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">
              <Users className="w-3.5 h-3.5" aria-hidden />職種別（全{data.total.toLocaleString()}件）
            </h3>
            <TallyList items={data.byOccupation} total={data.total} />
          </div>
          <div>
            <h3 className="flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">
              <Users className="w-3.5 h-3.5" aria-hidden />経験年数別（全{data.total.toLocaleString()}件）
            </h3>
            <TallyList items={data.byExperience} total={data.total} />
          </div>
        </div>
      )}
    </section>
  )
}
