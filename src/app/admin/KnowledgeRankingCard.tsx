'use client'

// ナレッジ参照回数ランキング（/admin 分析タブ）。
// 「みんながどのナレッジを気にしているか」を作者が把握するための一覧。
// データは /api/admin/cq-ranking（管理者専用・cq_views の上位＋サブスクIndexのタイトル）。
// 記録は全プレミアムナレッジ対象なので、CQに限らず全ナレッジが並ぶ。

import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { SectionHeading } from './SectionHeading'

type RankItem = { objectID: string; title: string; count: number }

export function KnowledgeRankingCard() {
  const [items, setItems] = useState<RankItem[] | null>(null)
  const [ready, setReady] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/cq-ranking?limit=30')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((d: { items?: RankItem[]; ready?: boolean }) => {
        if (cancelled) return
        setItems(d.items || [])
        setReady(d.ready !== false)
      })
      .catch(() => { if (!cancelled) { setItems([]); setReady(false) } })
    return () => { cancelled = true }
  }, [])

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 mb-4">
      <SectionHeading
        title="よく参照されているナレッジ（のべ回数）"
        caption="読者が本文を開いた回数の多い順。みんなが今どのナレッジを気にしているかの目安に。"
        help="cq_views ののべ参照回数（詳細を開いた／本文を開いた回数。誰が見たかは保存していません）。マイグレーション0016の適用後から貯まり、CQに限らず全プレミアムナレッジが対象です。"
      />

      {items === null && (
        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 py-4">
          <Spinner className="h-4 w-4" />読み込み中…
        </div>
      )}

      {items !== null && !ready && (
        <p className="text-xs text-gray-400 dark:text-gray-500 py-4 leading-relaxed">
          まだ計測が始まっていません。マイグレーション <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">0016_cq_views.sql</code> を Supabase に適用すると、以降の参照回数がここに貯まります。
        </p>
      )}

      {items !== null && ready && items.length === 0 && (
        <p className="text-xs text-gray-400 dark:text-gray-500 py-4">まだ参照が記録されていません（適用直後は0からのスタートです）。</p>
      )}

      {items !== null && items.length > 0 && (
        <ol className="space-y-1">
          {items.map((it, i) => (
            <li key={it.objectID} className="flex items-baseline gap-2 text-sm py-1 border-b border-gray-50 dark:border-gray-700/50 last:border-0">
              <span className="inline-flex items-center justify-center w-5 h-5 shrink-0 self-center rounded-full bg-gray-100 dark:bg-gray-700 text-[11px] font-bold text-gray-500 dark:text-gray-300">{i + 1}</span>
              <span className="flex-1 min-w-0 truncate text-gray-800 dark:text-gray-100" title={it.title || it.objectID}>
                {it.title || <span className="text-gray-400 dark:text-gray-500">（タイトル未取得：{it.objectID.slice(0, 8)}…）</span>}
              </span>
              <span className="shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-gray-500 dark:text-gray-400 tabular-nums">
                <Search className="w-3 h-3 shrink-0" strokeWidth={2.2} />{it.count.toLocaleString()}回
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
