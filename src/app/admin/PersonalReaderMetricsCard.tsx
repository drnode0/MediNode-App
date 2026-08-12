'use client'

// 個人・部署リーダー Phase 0 計測（/admin 分析タブ）。
// 「作るべきか・どのブロック対応を優先すべきか」を意見でなくデータで決めるためのカード。
// - 離脱タップ: クイズ・検索から個人/部署ページがNotionへ飛ばされた回数＝リーダーの需要
// - ブロックタイプ分布: 実際のページに出るブロックのtype別頻度。未対応（降格対象）に印
// データは /api/admin/personal-reader-metrics（管理者専用・マイグレーション0025）。

import { useEffect, useState } from 'react'
import { ExternalLink, Blocks } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { SectionHeading } from './SectionHeading'
import { READER_SUPPORTED_BLOCK_TYPES } from '@/lib/reader-doc'

type Metrics = {
  blockTypes: Array<{ type: string; count: number }>
  escapes: {
    total: number
    byContext: Record<string, number>
    recentDays: Array<{ day: string; count: number }>
  } | null
  ready?: boolean
}

const CONTEXT_LABEL: Record<string, string> = {
  quiz: 'クイズ',
  daily_question: '今日の1問',
  search: '検索',
  reader: 'リーダー内',
}

export function PersonalReaderMetricsCard() {
  const [data, setData] = useState<Metrics | null>(null)
  const [ready, setReady] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetch('/api/admin/personal-reader-metrics')
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((d: Metrics) => {
        if (cancelled) return
        setData(d)
        setReady(d.ready !== false)
      })
      .catch(() => { if (!cancelled) { setData({ blockTypes: [], escapes: null }); setReady(false) } })
    return () => { cancelled = true }
  }, [])

  const blockTypes = data?.blockTypes || []
  const maxCount = blockTypes.reduce((m, b) => Math.max(m, b.count), 0)
  const unsupportedTotal = blockTypes
    .filter((b) => !READER_SUPPORTED_BLOCK_TYPES.has(b.type))
    .reduce((s, b) => s + b.count, 0)
  const allTotal = blockTypes.reduce((s, b) => s + b.count, 0)

  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 mb-4">
      <SectionHeading
        title="個人・部署リーダーの計測"
        caption="「Notionで開く」への離脱回数と、個人・部署ページに実際に出るブロックの分布。アプリ内リーダーの需要と対応優先度をデータで見るための土台。"
        help="離脱タップ＝クイズ・検索で個人/部署ページをNotionアプリで開いた回数（どのページ・誰かは保存していません）。ブロック分布＝穴埋め同期が読んだ本文のtype別出現数。どちらもマイグレーション0025の適用後から貯まります。"
      />

      {data === null && (
        <div className="flex items-center gap-2 text-xs text-gray-400 dark:text-gray-500 py-4">
          <Spinner className="h-4 w-4" />読み込み中…
        </div>
      )}

      {data !== null && !ready && (
        <p className="text-xs text-gray-400 dark:text-gray-500 py-4 leading-relaxed">
          まだ計測が始まっていません。マイグレーション <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">0025_personal_reader_metrics.sql</code> を Supabase に適用すると、以降の離脱タップとブロック分布がここに貯まります。
        </p>
      )}

      {data !== null && ready && (
        <div className="space-y-4">
          {/* 離脱タップ */}
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">
              <ExternalLink className="w-3.5 h-3.5 shrink-0" strokeWidth={2.2} />
              「Notionで開く」離脱タップ
            </p>
            {!data.escapes || data.escapes.total === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">まだ記録がありません（適用直後は0からのスタートです）。</p>
            ) : (
              <div className="text-xs text-gray-700 dark:text-gray-200">
                <p className="mb-1">
                  累計 <span className="font-bold tabular-nums">{data.escapes.total.toLocaleString()}</span> 回
                  <span className="text-gray-400 dark:text-gray-500 ml-2">
                    {Object.entries(data.escapes.byContext)
                      .sort(([, a], [, b]) => b - a)
                      .map(([ctx, n]) => `${CONTEXT_LABEL[ctx] || ctx} ${n.toLocaleString()}`)
                      .join('・')}
                  </span>
                </p>
                {data.escapes.recentDays.length > 0 && (
                  <p className="text-gray-400 dark:text-gray-500">
                    直近14日: {data.escapes.recentDays.map((d) => `${d.day.slice(5)}=${d.count}`).join(' / ')}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ブロックタイプ分布 */}
          <div>
            <p className="flex items-center gap-1.5 text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1.5">
              <Blocks className="w-3.5 h-3.5 shrink-0" strokeWidth={2.2} />
              ブロックタイプ分布
              {allTotal > 0 && (
                <span className="font-normal text-gray-400 dark:text-gray-500">
                  未対応 {unsupportedTotal.toLocaleString()} / {allTotal.toLocaleString()}（{Math.round((unsupportedTotal / allTotal) * 100)}%）
                </span>
              )}
            </p>
            {blockTypes.length === 0 ? (
              <p className="text-xs text-gray-400 dark:text-gray-500">まだ記録がありません。個人・部署の同期（穴埋め読み取り）が走ると貯まります。</p>
            ) : (
              <ul className="space-y-0.5">
                {blockTypes.map((b) => {
                  const supported = READER_SUPPORTED_BLOCK_TYPES.has(b.type)
                  return (
                    <li key={b.type} className="flex items-center gap-2 text-xs py-0.5">
                      <span className={`w-40 shrink-0 truncate font-mono ${supported ? 'text-gray-500 dark:text-gray-400' : 'text-amber-700 dark:text-amber-400 font-semibold'}`} title={b.type}>
                        {b.type}
                      </span>
                      <span className="flex-1 min-w-0 h-2 rounded bg-gray-100 dark:bg-gray-700 overflow-hidden">
                        <span
                          className={`block h-full rounded ${supported ? 'bg-gray-300 dark:bg-gray-500' : 'bg-amber-400 dark:bg-amber-500'}`}
                          style={{ width: `${maxCount ? Math.max(2, Math.round((b.count / maxCount) * 100)) : 0}%` }}
                        />
                      </span>
                      <span className="w-14 shrink-0 text-right tabular-nums text-gray-500 dark:text-gray-400">{b.count.toLocaleString()}</span>
                      {!supported && <span className="shrink-0 text-[10px] px-1 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">未対応</span>}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
