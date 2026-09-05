'use client'
// 標本帳（図鑑）の一覧。見出し・「今日」の帯・一枚（plate）の並び・空の席。
// 判断（点の見た目・トレイの配置・今日の帯の中身）は src/lib/recall/dex.ts の純関数が持つ。
// ここは受け取ったモデルを画面に写すだけ（DOM を持たないテストが判断側でカバーする）。
//
// 見た目の正本: オーナーのラフ（buildPlates・.plate/.tray/.n の CSS）。枠は 1px、
// 角の印は左上・右下の疑似要素、点は塗り・輪郭・外輪・滲みの4種で記憶の5段を表す（設計 §3）。
// 設計: 2026-09-04「標本帳（図鑑）の設計書」§2.1・§2.2・§2.3・§3・§9（用語）。
import { useEffect, useRef, useState } from 'react'
import type { PlateModel, TodayModel } from '@/lib/recall/dex'
import { nextDueText, trayLayout } from '@/lib/recall/dex'
import { CoreEmblem } from './CoreEmblem'
import { RecallDot } from './RecallDot'

// 一覧の記録カウント（useFieldData の counts と同じ形）。
type DexCounts = { kept: number; touched: number; cold: number; settled: number }

type Props = {
  plates: PlateModel[]
  empty: Array<{ slot: number; label: string; en: string }>
  today: TodayModel
  counts: DexCounts
  total: number
  onOpen: (slot: number) => void
  onSweep: () => void
}

// トレイの幅（一枚の中で点を並べる横幅）。固定値（1列 約560px・2列 約270px）で始めたが、
// 実際に描いて測ると一枚の内側（emblem 72px・gap・左右の padding を引いた後）は
// 2列時で約176pxしかなく、固定値のままだと trayLayout が「6行に収まる」と誤判定して
// 点が枠の下からはみ出た（実測は報告に書く）。ResizeObserver でトレイ自身の実幅を測る。
// 初期値は「まだ測れていない」（null）にする。固定値のままだと ResizeObserver が効くまでの
// 1コマだけ本当の行数と違う並びが描かれるため、測れるまではトレイ自体を描かない。
function useMeasuredWidth<T extends HTMLElement>(): [React.RefObject<T>, number | null] {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState<number | null>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(([entry]) => {
      const w = entry?.contentRect.width
      if (w) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width]
}

function Tray({ tray }: { tray: PlateModel['tray'] }) {
  const [ref, widthPx] = useMeasuredWidth<HTMLDivElement>()
  // 幅がまだ測れていない間はトレイを描かない（固定値の仮並びを一瞬だけ見せない）。
  const layout = widthPx == null ? null : trayLayout(tray.length, widthPx)
  const shown = layout ? tray.slice(0, layout.shown) : []
  return (
    <div>
      {/* 点の容器には点だけを入れる。「ほか n」を同じ flex-wrap の中に混ぜると、
          6行が埋まったあとに折り返して7行目に出てしまい、trayLayout の「6行に収める」
          約束が崩れる（実測で発生。報告に書く）。 */}
      <div ref={ref} className={`flex flex-wrap content-start items-center ${layout?.gap === 3 ? 'gap-[3px]' : 'gap-[2px]'}`}>
        {shown.map((dot) => (
          <RecallDot key={dot.claimId} look={dot.look} size={layout!.size} />
        ))}
      </div>
      {layout && layout.rest > 0 && (
        <p className="mt-0.5 text-right text-[10px] leading-none text-slate-400 dark:text-slate-500 tabular-nums">ほか {layout.rest}</p>
      )}
    </div>
  )
}

function Plate({ plate, onOpen }: { plate: PlateModel; onOpen: (slot: number) => void }) {
  const kept = plate.kept + plate.settled
  return (
    <button type="button" onClick={() => onOpen(plate.slot)} aria-label={plate.label}
      className="relative grid grid-cols-[72px_1fr] gap-x-3.5 gap-y-1.5 items-start border border-slate-300/70 dark:border-white/20 px-4 pt-3.5 pb-3 text-left text-slate-800 dark:text-[#F2F5F1] hover:border-slate-400 dark:hover:border-white/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-gray-900
        before:content-[''] before:absolute before:left-[-1px] before:top-[-1px] before:w-2 before:h-2 before:border before:border-current before:border-r-0 before:border-b-0
        after:content-[''] after:absolute after:right-[-1px] after:bottom-[-1px] after:w-2 after:h-2 after:border after:border-current after:border-l-0 after:border-t-0">
      {/* 紋章は名前の先頭に揃える（items-start）。和名・英名が折り返して名前ブロックが
          4行になる分野（PC幅の2列時）でも、紋章が名前＋トレイの中央に浮かない。 */}
      <CoreEmblem slot={plate.slot} kind={plate.kind} size={72} className="row-span-2 mt-0.5" />
      {/* 和名・英名・族は常に3行の縦積み（標本帳は並びが動かないことで場所を覚える。
          flex-wrap で横に流すと、名前の長さ次第で1〜3行と枚ごとに組み方が変わってしまう）。 */}
      <div className="min-w-0">
        <p className="text-[17px] tracking-[.03em] font-medium leading-tight">{plate.label}</p>
        <p className="mt-0.5 text-[11px] tracking-[.12em] uppercase text-slate-500 dark:text-slate-400 leading-tight">{plate.en}</p>
        <p className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500 leading-tight">{plate.kindEn}</p>
      </div>
      <Tray tray={plate.tray} />
      <div className="col-span-2 mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] tracking-[.06em] text-slate-500 dark:text-slate-400 tabular-nums">
        <span>主張 {plate.n}</span>
        <span>残した {kept}</span>
        {plate.escaping > 0 && (
          <span className="inline-flex items-center gap-1 text-[#A86B0C] dark:text-[#F0D68A]">
            <i className="inline-block w-1.5 h-1.5 rounded-full bg-current" />離れかけ {plate.escaping}
          </span>
        )}
      </div>
    </button>
  )
}

export function RecallDex({ plates, empty, today, counts, total, onOpen, onSweep }: Props) {
  const now = new Date()

  return (
    <div className="bg-[#F5F7FA] dark:bg-transparent text-slate-800 dark:text-[#F2F5F1] rounded-lg p-4">
      {/* 見出し（設計 §2.1） */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[21px] tracking-[.14em] font-semibold">Recall</h1>
          <p className="mt-1.5 text-[11px] tracking-[.08em] text-slate-500 dark:text-slate-400">検証済みの主張 {total}　濃いほど、自分のもの</p>
        </div>
        <div className="text-right">
          <div className="text-[28px] font-light tabular-nums leading-none">{total}<small className="ml-1.5 text-[11px] tracking-widest text-slate-500 dark:text-slate-400">主張</small></div>
          <p className="mt-1.5 text-[10.5px] tracking-[.1em] text-slate-500 dark:text-slate-400">残した {counts.kept} ／ 深く残した {counts.settled} ／ 読んだ {counts.touched}</p>
        </div>
      </div>

      {/* 今日の帯（設計 §2.1） */}
      <div className="mt-4 rounded-md border border-slate-300/70 dark:border-white/15 px-4 py-3">
        <p className="mb-1.5 text-[10px] tracking-[.14em] text-slate-400 dark:text-slate-500">今日</p>
        {today.escaping > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[12.5px] tracking-[.06em] text-slate-600 dark:text-slate-300">
              <span className="text-[#A86B0C] dark:text-[#F0D68A]">離れかけ {today.escaping}（{today.seats}分野）</span>
              {today.next && <span>{nextDueText(today.next, now)}</span>}
            </div>
            <button type="button" onClick={onSweep}
              className="shrink-0 rounded-full border border-[#A86B0C]/60 dark:border-[#F0D68A]/60 px-4 py-2 text-[12px] tracking-[.06em] text-[#A86B0C] dark:text-[#F0D68A] hover:bg-[#A86B0C]/5 dark:hover:bg-[#F0D68A]/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
              離れかけを順に確かめる
            </button>
          </div>
        ) : (
          <p className="text-[12.5px] tracking-[.06em] text-slate-500 dark:text-slate-400">{today.notice}</p>
        )}
      </div>

      {/* 一枚の一覧（設計 §2.2） */}
      <div className="mt-5 grid grid-cols-1 min-[560px]:grid-cols-2 gap-4">
        {plates.map((p) => <Plate key={p.slot} plate={p} onOpen={onOpen} />)}
      </div>

      {/* 空の席（設計 §2.3） */}
      {empty.length > 0 && (
        <div className="mt-6 pb-2 text-[11.5px] leading-7 tracking-[.05em] text-slate-400 dark:text-slate-500">
          <p className="mb-1">まだ主張のない分野 {empty.length}</p>
          <p>
            {empty.map((e) => (
              <span key={e.slot} className="inline-block whitespace-nowrap">{e.label}　</span>
            ))}
          </p>
        </div>
      )}
    </div>
  )
}
