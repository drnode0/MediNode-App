'use client'

// アカウント台帳のグラフ部品（/admin 専用・依存ライブラリなしのインラインSVG）。
//
// - TrendLineChart   … 累積登録者数の推移（auth.users.created_at から全期間を描ける）
// - DailyBarsChart   … 日別アクティブ数（app_usage_daily の蓄積分。導入日から溜まる）
// - ActiveBreakdownBar … 現時点の利用状況の内訳を1本の帯で
//
// どれも単一系列・単一軸。色はブランド緑1色（ライト #196b4f / ダーク #4aae8c）を
// CSSクラスで切り替え、数値・ラベルは通常のテキスト色に載せる。

import { useMemo, useState } from 'react'

export type DailyPoint = { date: string; count: number }

// 日付キー（YYYY-MM-DD）を「M/D」表示にする。
function fmtShort(date: string): string {
  const [, m, d] = date.split('-')
  return `${Number(m)}/${Number(d)}`
}

// ---- 累積折れ線（登録者数の推移） ------------------------------------------

// createdAt の一覧から日別の累積数列を作る（呼び出し側でテストしやすい純関数）。
export function buildCumulativeSeries(createdAts: Array<string | null>): DailyPoint[] {
  const days = createdAts
    .filter((c): c is string => !!c)
    .map((c) => c.slice(0, 10))
    .sort()
  if (days.length === 0) return []
  const points: DailyPoint[] = []
  let total = 0
  // 登録があった日だけ点を打つ（間の日は折れ線の傾きが表す）。末尾に「今日」を足して
  // 最新の水準まで線を伸ばす。
  for (const day of days) {
    total++
    const last = points[points.length - 1]
    if (last && last.date === day) last.count = total
    else points.push({ date: day, count: total })
  }
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const last = points[points.length - 1]
  if (last && last.date < today) points.push({ date: today, count: total })
  return points
}

const CHART_W = 600
const CHART_H = 140
const PAD_L = 8
const PAD_R = 44 // 右端の直接ラベル（最新値）用の余白
const PAD_T = 12
const PAD_B = 22

export function TrendLineChart({ points, label }: { points: DailyPoint[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null)

  const geom = useMemo(() => {
    if (points.length === 0) return null
    const t0 = new Date(points[0].date).getTime()
    const t1 = new Date(points[points.length - 1].date).getTime()
    const span = Math.max(t1 - t0, 1)
    const max = Math.max(...points.map((p) => p.count), 1)
    const xy = points.map((p) => {
      const x = PAD_L + ((new Date(p.date).getTime() - t0) / span) * (CHART_W - PAD_L - PAD_R)
      const y = PAD_T + (1 - p.count / max) * (CHART_H - PAD_T - PAD_B)
      return { x, y }
    })
    return { xy, max }
  }, [points])

  if (!geom || points.length < 2) {
    return <p className="text-xs text-gray-400 dark:text-gray-500 py-8 text-center">データがまだありません</p>
  }

  const { xy } = geom
  const path = xy.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const area = `${path} L${xy[xy.length - 1].x.toFixed(1)},${CHART_H - PAD_B} L${xy[0].x.toFixed(1)},${CHART_H - PAD_B} Z`
  const lastP = xy[xy.length - 1]
  const hovered = hover != null ? points[hover] : null
  const hoveredXy = hover != null ? xy[hover] : null

  // マウス位置から最寄りの点を選ぶ（点そのものより当たり判定を大きく）。
  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = ((e.clientX - rect.left) / rect.width) * CHART_W
    let best = 0
    let bestD = Infinity
    xy.forEach((p, i) => {
      const d = Math.abs(p.x - mx)
      if (d < bestD) {
        bestD = d
        best = i
      }
    })
    setHover(best)
  }

  return (
    <figure aria-label={label} className="relative">
      <svg
        viewBox={`0 0 ${CHART_W} ${CHART_H}`}
        className="w-full h-auto"
        role="img"
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* 目安の横線（最大値の位置）と基線だけの控えめなグリッド */}
        <line x1={PAD_L} y1={CHART_H - PAD_B} x2={CHART_W - PAD_R} y2={CHART_H - PAD_B} className="stroke-gray-200 dark:stroke-gray-700" strokeWidth="1" />
        <path d={area} className="fill-brand-600/10 dark:fill-brand-400/10" />
        <path d={path} className="stroke-brand-600 dark:stroke-brand-400" strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round" />
        {/* 最新値の直接ラベル */}
        <circle cx={lastP.x} cy={lastP.y} r="3.5" className="fill-brand-600 dark:fill-brand-400" />
        <text x={lastP.x + 8} y={lastP.y + 4} className="fill-gray-700 dark:fill-gray-200" fontSize="12" fontWeight="600">
          {points[points.length - 1].count}人
        </text>
        {/* 両端の日付 */}
        <text x={PAD_L} y={CHART_H - 6} className="fill-gray-400 dark:fill-gray-500" fontSize="10">
          {fmtShort(points[0].date)}
        </text>
        <text x={CHART_W - PAD_R} y={CHART_H - 6} textAnchor="end" className="fill-gray-400 dark:fill-gray-500" fontSize="10">
          {fmtShort(points[points.length - 1].date)}
        </text>
        {/* ホバー: 縦線＋点 */}
        {hoveredXy && (
          <>
            <line x1={hoveredXy.x} y1={PAD_T} x2={hoveredXy.x} y2={CHART_H - PAD_B} className="stroke-gray-300 dark:stroke-gray-600" strokeWidth="1" />
            <circle cx={hoveredXy.x} cy={hoveredXy.y} r="4" className="fill-brand-600 dark:fill-brand-400 stroke-white dark:stroke-gray-800" strokeWidth="2" />
          </>
        )}
      </svg>
      {hovered && hoveredXy && (
        <div
          className="absolute -top-1 pointer-events-none px-2 py-1 rounded-md bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 text-xs whitespace-nowrap shadow"
          style={{ left: `${(hoveredXy.x / CHART_W) * 100}%`, transform: 'translateX(-50%)' }}
        >
          {fmtShort(hovered.date)}時点 {hovered.count}人
        </div>
      )}
    </figure>
  )
}

// ---- 日別バー（日別アクティブ数） ------------------------------------------

export function DailyBarsChart({ points, label }: { points: DailyPoint[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null)

  // 記録がない日も0本として埋める（直近30日分を表示）。
  const filled = useMemo(() => {
    const byDate = new Map(points.map((p) => [p.date, p.count]))
    const out: DailyPoint[] = []
    const todayJst = Date.now() + 9 * 60 * 60 * 1000
    for (let i = 29; i >= 0; i--) {
      const date = new Date(todayJst - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
      out.push({ date, count: byDate.get(date) ?? 0 })
    }
    return out
  }, [points])

  if (points.length === 0) {
    return (
      <p className="text-xs text-gray-400 dark:text-gray-500 py-8 text-center">
        記録はこれから蓄積されます（機能導入後の利用から）
      </p>
    )
  }

  const max = Math.max(...filled.map((p) => p.count), 1)
  const innerW = CHART_W - PAD_L - 8
  const step = innerW / filled.length
  const barW = Math.max(step - 2, 3) // 2px の隙間
  const hovered = hover != null ? filled[hover] : null

  return (
    <figure aria-label={label} className="relative">
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-auto" role="img" onMouseLeave={() => setHover(null)}>
        <line x1={PAD_L} y1={CHART_H - PAD_B} x2={CHART_W - 8} y2={CHART_H - PAD_B} className="stroke-gray-200 dark:stroke-gray-700" strokeWidth="1" />
        {filled.map((p, i) => {
          const h = (p.count / max) * (CHART_H - PAD_T - PAD_B)
          const x = PAD_L + i * step
          const y = CHART_H - PAD_B - h
          return (
            <g key={p.date} onMouseEnter={() => setHover(i)}>
              {/* 当たり判定はバーより広く（0人の日もホバーで日付を確認できる） */}
              <rect x={x} y={PAD_T} width={step} height={CHART_H - PAD_T - PAD_B} fill="transparent" />
              {p.count > 0 && (
                <rect
                  x={x + (step - barW) / 2}
                  y={y}
                  width={barW}
                  height={h}
                  rx="2"
                  className={
                    hover === i
                      ? 'fill-brand-700 dark:fill-brand-300'
                      : 'fill-brand-600 dark:fill-brand-400'
                  }
                />
              )}
            </g>
          )
        })}
        <text x={PAD_L} y={CHART_H - 6} className="fill-gray-400 dark:fill-gray-500" fontSize="10">
          {fmtShort(filled[0].date)}
        </text>
        <text x={CHART_W - 8} y={CHART_H - 6} textAnchor="end" className="fill-gray-400 dark:fill-gray-500" fontSize="10">
          {fmtShort(filled[filled.length - 1].date)}
        </text>
      </svg>
      {hovered && (
        <div
          className="absolute -top-1 pointer-events-none px-2 py-1 rounded-md bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 text-xs whitespace-nowrap shadow"
          style={{ left: `${((PAD_L + (hover! + 0.5) * step) / CHART_W) * 100}%`, transform: 'translateX(-50%)' }}
        >
          {fmtShort(hovered.date)} {hovered.count}人
        </div>
      )}
    </figure>
  )
}

// ---- 時間帯ヒストグラム（利用のホットスポット） -----------------------------

// hourly は 0〜23時の延べ利用数（人×日）24要素。空配列なら蓄積待ち。
export function HourlyBarsChart({ hourly, label }: { hourly: number[]; label: string }) {
  const [hover, setHover] = useState<number | null>(null)

  if (hourly.length !== 24) {
    return (
      <p className="text-xs text-gray-400 dark:text-gray-500 py-8 text-center">
        記録はこれから蓄積されます（機能導入後の利用から）
      </p>
    )
  }

  const max = Math.max(...hourly, 1)
  const peak = hourly.indexOf(max)
  const innerW = CHART_W - PAD_L - 8
  const step = innerW / 24
  const barW = Math.max(step - 2, 3)
  const hovered = hover != null ? hourly[hover] : null

  return (
    <figure aria-label={label} className="relative">
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full h-auto" role="img" onMouseLeave={() => setHover(null)}>
        <line x1={PAD_L} y1={CHART_H - PAD_B} x2={CHART_W - 8} y2={CHART_H - PAD_B} className="stroke-gray-200 dark:stroke-gray-700" strokeWidth="1" />
        {hourly.map((count, hour) => {
          const h = (count / max) * (CHART_H - PAD_T - PAD_B)
          const x = PAD_L + hour * step
          const y = CHART_H - PAD_B - h
          return (
            <g key={hour} onMouseEnter={() => setHover(hour)}>
              <rect x={x} y={PAD_T} width={step} height={CHART_H - PAD_T - PAD_B} fill="transparent" />
              {count > 0 && (
                <rect
                  x={x + (step - barW) / 2}
                  y={y}
                  width={barW}
                  height={h}
                  rx="2"
                  className={
                    hover === hour
                      ? 'fill-brand-700 dark:fill-brand-300'
                      : hour === peak
                        ? 'fill-brand-600 dark:fill-brand-400'
                        : 'fill-brand-600/60 dark:fill-brand-400/60'
                  }
                />
              )}
              {/* 3時間おきの目盛りラベル */}
              {hour % 3 === 0 && (
                <text x={x + step / 2} y={CHART_H - 6} textAnchor="middle" className="fill-gray-400 dark:fill-gray-500" fontSize="10">
                  {hour}
                </text>
              )}
            </g>
          )
        })}
        {/* ピーク時間帯の直接ラベル */}
        {max > 0 && (
          <text
            x={PAD_L + peak * step + step / 2}
            y={Math.max(CHART_H - PAD_B - (max / max) * (CHART_H - PAD_T - PAD_B) - 5, 10)}
            textAnchor="middle"
            className="fill-gray-700 dark:fill-gray-200"
            fontSize="11"
            fontWeight="600"
          >
            {peak}時台
          </text>
        )}
      </svg>
      {hovered != null && hover != null && (
        <div
          className="absolute -top-1 pointer-events-none px-2 py-1 rounded-md bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900 text-xs whitespace-nowrap shadow"
          style={{ left: `${((PAD_L + (hover + 0.5) * step) / CHART_W) * 100}%`, transform: 'translateX(-50%)' }}
        >
          {hover}時台 延べ{hovered}
        </div>
      )}
    </figure>
  )
}

// ---- 利用状況の内訳帯 -------------------------------------------------------

export type ActiveBreakdown = {
  within7: number
  within30: number // 8〜30日
  older: number // 31日以上前
  never: number // 利用形跡なし
}

const BREAKDOWN_SEGMENTS: Array<{ key: keyof ActiveBreakdown; label: string; className: string }> = [
  { key: 'within7', label: '7日以内', className: 'bg-brand-600 dark:bg-brand-400' },
  { key: 'within30', label: '8〜30日', className: 'bg-brand-300 dark:bg-brand-600' },
  { key: 'older', label: '31日以上前', className: 'bg-gray-300 dark:bg-gray-600' },
  { key: 'never', label: '形跡なし', className: 'bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700' },
]

export function ActiveBreakdownBar({ breakdown }: { breakdown: ActiveBreakdown }) {
  const total = breakdown.within7 + breakdown.within30 + breakdown.older + breakdown.never
  if (total === 0) return null
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden gap-0.5" role="img" aria-label="最終利用の内訳">
        {BREAKDOWN_SEGMENTS.map((s) =>
          breakdown[s.key] > 0 ? (
            <div
              key={s.key}
              className={s.className}
              style={{ width: `${(breakdown[s.key] / total) * 100}%` }}
              title={`${s.label} ${breakdown[s.key]}人`}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {BREAKDOWN_SEGMENTS.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
            <span className={`inline-block w-2.5 h-2.5 rounded-sm ${s.className}`} aria-hidden />
            {s.label} {breakdown[s.key]}人
          </span>
        ))}
      </div>
    </div>
  )
}

// ---- 汎用の内訳帯（流入元の割合・モード等） ---------------------------------

export type Segment = { label: string; count: number; className: string }

// ActiveBreakdownBar の汎用版。件数を持つセグメント配列から帯＋凡例を描く。
// 割合（排他的な選択）の可視化に使う。0件のセグメントは帯に出さず凡例だけ薄く出す。
export function SegmentBar({ segments, label }: { segments: Segment[]; label: string }) {
  const total = segments.reduce((sum, s) => sum + s.count, 0)
  if (total === 0) {
    return <p className="text-xs text-gray-400 dark:text-gray-500 py-2">まだ記録がありません（蓄積待ち）</p>
  }
  return (
    <div>
      <div className="flex h-3 rounded-full overflow-hidden gap-0.5" role="img" aria-label={label}>
        {segments.map((s) =>
          s.count > 0 ? (
            <div
              key={s.label}
              className={s.className}
              style={{ width: `${(s.count / total) * 100}%` }}
              title={`${s.label} ${s.count}人（${Math.round((s.count / total) * 100)}%）`}
            />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
        {segments.map((s) => (
          <span
            key={s.label}
            className={`inline-flex items-center gap-1.5 text-xs ${
              s.count === 0 ? 'text-gray-300 dark:text-gray-600' : 'text-gray-600 dark:text-gray-300'
            }`}
          >
            <span className={`inline-block w-2.5 h-2.5 rounded-sm ${s.className}`} aria-hidden />
            {s.label} {s.count}人{s.count > 0 && total > 0 ? `（${Math.round((s.count / total) * 100)}%）` : ''}
          </span>
        ))}
      </div>
    </div>
  )
}

// 複数選択の集計用（「使う知識」等、合計が100%にならないもの）。
// ラベルごとに件数バーを横に伸ばす。max は表示中の最大件数。
export function CountBars({ items, label }: { items: Segment[]; label: string }) {
  const max = Math.max(...items.map((i) => i.count), 0)
  if (max === 0) {
    return <p className="text-xs text-gray-400 dark:text-gray-500 py-2">まだ記録がありません（蓄積待ち）</p>
  }
  return (
    <div className="space-y-1.5" role="img" aria-label={label}>
      {items.map((i) => (
        <div key={i.label} className="flex items-center gap-2 text-xs">
          <span className="w-24 shrink-0 text-gray-600 dark:text-gray-300">{i.label}</span>
          <div className="flex-1 h-3 rounded bg-gray-100 dark:bg-gray-700/60 overflow-hidden">
            <div className={`h-full ${i.className}`} style={{ width: `${(i.count / max) * 100}%` }} />
          </div>
          <span className="w-8 text-right text-gray-500 dark:text-gray-400">{i.count}人</span>
        </div>
      ))}
    </div>
  )
}
