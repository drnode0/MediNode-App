'use client'

// 📊 分析・マーケタブの「エンゲージメント・継続」セクション。
// /api/admin/engagement を自分で取得して描画する自己完結コンポーネント。
// 「売れているか」ではなく「使われ続けているか」を多面的に見る。

import { useCallback, useEffect, useState } from 'react'
import { Activity, Repeat, TrendingUp, HelpCircle, Eye, Bell, RefreshCw } from 'lucide-react'
import { Spinner } from '@/components/Spinner'
import { SegmentBar } from './AdminCharts'

type Engagement = {
  usage: { today: number; yesterday: number; avg7: number } | null
  members: { active: number; total: number; pct: number } | null
  stickiness: { dau: number; mau: number; pct: number } | null
  continuity: {
    buckets: { d1: number; d2_3: number; d4_6: number; daily: number }
    repeaterRate: number
  } | null
  retention: {
    thisWeekActive: number
    continuing: number
    newOrReturning: number
    churnRisk: number
  } | null
  dailyQuestion: { answeredToday: number; answered7: number; rate: number } | null
  topCq: Array<{ objectId: string; title: string | null; viewCount: number }> | null
  push: { activeSubscribers: number; everSubscribed: number; optOutRate: number } | null
  generatedAt: string
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-gray-100 dark:border-gray-700 p-3">
      <div className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">{label}</div>
      <div className="text-xl font-bold text-gray-900 dark:text-gray-100">{value}</div>
      {sub && <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
}

function Block({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Activity
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-3 flex items-center gap-1.5">
        <Icon className="w-4 h-4 text-brand-600 dark:text-brand-400" aria-hidden />
        {title}
      </h3>
      {children}
    </section>
  )
}

export function EngagementSection() {
  const [data, setData] = useState<Engagement | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/engagement', { cache: 'no-store' })
      if (res.ok) setData((await res.json()) as Engagement)
    } catch {
      // best-effort。取れなくても他タブに影響しない。
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-sm font-bold text-gray-800 dark:text-gray-100 flex items-center gap-1.5">
          <Activity className="w-4 h-4 text-brand-600 dark:text-brand-400" aria-hidden />
          エンゲージメント・継続（使われ続けているか）
        </h2>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50"
        >
          {loading ? <Spinner className="w-3.5 h-3.5" /> : <RefreshCw className="w-3.5 h-3.5" aria-hidden />}
          更新
        </button>
      </div>

      {loading && !data ? (
        <div className="flex items-center gap-2 text-sm text-gray-400 dark:text-gray-500 py-6">
          <Spinner className="w-4 h-4" />
          集計しています…
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {/* スティッキネス＋会員稼働率 */}
          <Block icon={TrendingUp} title="スティッキネス（毎日開く習慣か）">
            <div className="grid grid-cols-2 gap-2">
              <Stat
                label="DAU / MAU"
                value={data?.stickiness ? `${data.stickiness.pct}%` : '—'}
                sub={data?.stickiness ? `今日${data.stickiness.dau}人 / 月間${data.stickiness.mau}人` : '蓄積待ち'}
              />
              <Stat
                label="会員稼働率（7日以内）"
                value={data?.members ? `${data.members.pct}%` : '—'}
                sub={data?.members ? `稼働 ${data.members.active}/${data.members.total}人` : '—'}
              />
            </div>
            <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
              DAU/MAU が高いほど「日課」になっている。会員稼働率は解約の先行指標。
            </p>
          </Block>

          {/* 継続日数の分布 */}
          <Block icon={Repeat} title="継続日数の分布（直近7日）">
            {data?.continuity ? (
              <>
                <SegmentBar
                  label="継続日数の分布"
                  segments={[
                    { label: '1日', count: data.continuity.buckets.d1, className: 'bg-gray-300 dark:bg-gray-600' },
                    { label: '2〜3日', count: data.continuity.buckets.d2_3, className: 'bg-brand-300 dark:bg-brand-600' },
                    { label: '4〜6日', count: data.continuity.buckets.d4_6, className: 'bg-brand-500 dark:bg-brand-500' },
                    { label: '毎日', count: data.continuity.buckets.daily, className: 'bg-brand-700 dark:bg-brand-300' },
                  ]}
                />
                <p className="mt-2 text-[11px] text-gray-500 dark:text-gray-400">
                  リピーター率（2日以上使った人の割合）
                  <b className="ml-1 text-gray-800 dark:text-gray-100">{data.continuity.repeaterRate}%</b>
                </p>
              </>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500 py-2">まだ記録がありません（蓄積待ち）</p>
            )}
          </Block>

          {/* 復帰と離脱 */}
          <Block icon={Activity} title="復帰と離脱（週次）">
            {data?.retention ? (
              <div className="grid grid-cols-2 gap-2">
                <Stat label="今週アクティブ" value={`${data.retention.thisWeekActive}人`} />
                <Stat label="継続（先週も）" value={`${data.retention.continuing}人`} />
                <Stat label="新規・復帰（先週なし）" value={`${data.retention.newOrReturning}人`} />
                <Stat
                  label="離脱注意（先週あり・今週0）"
                  value={`${data.retention.churnRisk}人`}
                  sub={data.retention.churnRisk > 0 ? 'そっと離れた可能性' : ''}
                />
              </div>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500 py-2">まだ記録がありません（蓄積待ち）</p>
            )}
          </Block>

          {/* 今日の1問 回答率 */}
          <Block icon={HelpCircle} title="今日の1問（軽量エンゲージ）">
            {data?.dailyQuestion ? (
              <div className="grid grid-cols-2 gap-2">
                <Stat
                  label="今日の回答率"
                  value={`${data.dailyQuestion.rate}%`}
                  sub={`回答 ${data.dailyQuestion.answeredToday}人 / 今日の使用者`}
                />
                <Stat label="直近7日 回答者" value={`${data.dailyQuestion.answered7}人`} />
              </div>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500 py-2">まだ記録がありません（蓄積待ち）</p>
            )}
          </Block>

          {/* コンテンツ反応（解決CQ参照 上位） */}
          <Block icon={Eye} title="コンテンツ反応（解決CQ 参照 上位）">
            {data?.topCq && data.topCq.length > 0 ? (
              <ol className="space-y-1.5">
                {data.topCq.map((c, i) => (
                  <li key={c.objectId} className="flex items-baseline gap-2 text-sm">
                    <span className="inline-flex items-center justify-center w-5 h-5 shrink-0 rounded-full bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 text-[11px] font-bold">
                      {i + 1}
                    </span>
                    <span className="flex-1 min-w-0 truncate text-gray-800 dark:text-gray-100">
                      {c.title ?? c.objectId.replace(/^subscription_/, '').slice(0, 12) + '…'}
                    </span>
                    <span className="ml-auto shrink-0 font-semibold text-gray-700 dark:text-gray-200">
                      {c.viewCount}回
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500 py-2">まだ参照記録がありません（蓄積待ち）</p>
            )}
            <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
              よく読まれている内容＝次に何を書くかの指針。のべ参照回数（誰が、は保存しない）。
            </p>
          </Block>

          {/* Push健全性 */}
          <Block icon={Bell} title="通知の健全性">
            {data?.push ? (
              <div className="grid grid-cols-2 gap-2">
                <Stat
                  label="有効な購読者"
                  value={`${data.push.activeSubscribers}人`}
                  sub={`累計購読 ${data.push.everSubscribed}人`}
                />
                <Stat
                  label="オプトアウト率"
                  value={`${data.push.optOutRate}%`}
                  sub="通知を切った人の割合"
                />
              </div>
            ) : (
              <p className="text-xs text-gray-400 dark:text-gray-500 py-2">まだ記録がありません（蓄積待ち）</p>
            )}
          </Block>
        </div>
      )}

      <p className="mt-2 text-[11px] text-gray-400 dark:text-gray-500">
        ユニーク人数＝1人1日1カウント（のべではない）。利用記録は1日1回・best-effort＝実利用の下限（過小評価側）。
        日別ログは導入日以降のみ蓄積のため、MAU・週次は立ち上がり期間があります。会員数が少ない間は%が振れるので実数も併記しています。
      </p>
    </div>
  )
}
