'use client'
// 記憶の見せ方を表す点。一覧のトレイ（RecallDex の Tray）と分野ページの行（RecallPlatePage）の
// 両方から呼ぶ、共通の小さな部品。塗り・輪郭・外輪・滲みの4種を bg/border/box-shadow で表し、
// 不透明度だけを DotLook.alpha から取る（判断はしない。dex.ts の dotLookOf が決めた値をそのまま写す）。
//
// 見た目の正本はオーナーのラフの .plate .tray i / .row i（設計 2026-09-04「標本帳（図鑑）の設計書」§3）。
// settled の外輪の太さだけ、トレイ（6px/4px の点）と行（9px の点）で違う（ラフの .tray i.s は 1.5px、
// .row i.s は 2px）ので row で切り替える。
import type { DotKind, DotLook } from '@/lib/recall/dex'

const DOT_BASE =
  'relative block shrink-0 rounded-full border border-current box-border transition-opacity duration-[600ms] motion-reduce:transition-none'

// 分野ページの点（14px）を指で押せるようにする当たり判定。14 + 6×2 = 26px。
// 点そのものは aria-hidden の <i> なので、押す役目は親の <button> が持つ。
const HIT_CLASS = "after:content-[''] after:absolute after:-inset-1.5 after:rounded-full"

const KIND_CLASS: Record<DotKind, string> = {
  cold: 'bg-transparent',
  touched: 'bg-transparent',
  kept: 'bg-current',
  settled: 'bg-current shadow-[0_0_0_1.5px_color-mix(in_srgb,currentColor_45%,transparent)]',
  escaping: 'bg-current text-[#A86B0C] dark:text-[#F0D68A] shadow-[0_0_6px_currentColor]',
}

// 行専用（9px）の settled だけ外輪を太くする。他の kind は共通のままでよい。
const KIND_CLASS_ROW: Record<DotKind, string> = {
  ...KIND_CLASS,
  settled: 'bg-current shadow-[0_0_0_2px_color-mix(in_srgb,currentColor_45%,transparent)]',
}

type Props = {
  look: DotLook
  size: number
  // 分野ページの行（9px）で使うときに true。settled の外輪の太さだけ変わる。
  row?: boolean
  // 分野ページの点（14px）で true。::after で 26px の当たり判定を広げる（指で押せる）。
  hit?: boolean
  className?: string
}

export function RecallDot({ look, size, row, hit, className }: Props) {
  const cls = (row ? KIND_CLASS_ROW : KIND_CLASS)[look.kind]
  return (
    <i
      aria-hidden="true"
      className={`${DOT_BASE} ${cls}${hit ? ` ${HIT_CLASS}` : ''}${className ? ` ${className}` : ''}`}
      style={{ width: size, height: size, opacity: look.alpha }}
    />
  )
}
