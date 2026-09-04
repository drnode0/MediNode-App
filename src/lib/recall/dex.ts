// 標本帳（図鑑）。点の見た目とトレイの配置（純関数）。
// 描画を知らない（DOM を持たない）。判断はここに置き、部品側は呼ぶだけにする。
//
// 設計: 2026-09-04「標本帳（図鑑）の設計書」§3「点（記憶の見せ方・D8）」・§3.1「点の大きさ」。
// 濃さの向きは field-layout.ts の lookOf と同じ（保持力が高いほど濃い）。isEscaping はそちらの実装を使う。
import { isEscaping } from './field-layout'
import type { RecallState } from './types'

// ── 点の見た目（§3）────────────────────────────
// 塗り・線の区別は部品側の責務。ここは種別と不透明度だけを返す。
export type DotKind = 'cold' | 'touched' | 'kept' | 'settled' | 'escaping'
export type DotLook = { kind: DotKind; alpha: number }

export function dotLookOf(state: RecallState): DotLook {
  // 離れかけは「残した」系（kept/settled）から保持力で切り出す。kept より優先。
  if (isEscaping(state.kind, state.remaining)) {
    return { kind: 'escaping', alpha: 1 }
  }
  switch (state.kind) {
    case 'settled':
      return { kind: 'settled', alpha: 1 }
    case 'kept':
      return { kind: 'kept', alpha: 0.5 + 0.45 * state.remaining }
    case 'touched':
      return { kind: 'touched', alpha: 0.55 }
    default:
      return { kind: 'cold', alpha: 0.35 }
  }
}

// ── トレイの配置（§3.1）──────────────────────────
// 一覧の幅から1行に入る点の数を出し、6行を超えるなら点を6px→4pxに落とす。
// それでも6行を超えるなら、入りきる分だけ見せて残りを「ほか rest」にする。
export type TrayLayout = { size: 6 | 4; gap: 3 | 2; perRow: number; rows: number; shown: number; rest: number }

export const TRAY_MAX_ROWS = 6

// size・gap の組で、幅 widthPx に何個並ぶか。点どうしの間隔だけを数え、
// 最後の点の後ろに余分な間隔は要らないので (widthPx + gap) / (size + gap) で数える。
// 幅0でも1個は入る扱いにする（0除算・0個表示を避ける）。
function fitCount(size: number, gap: number, widthPx: number): number {
  return Math.max(1, Math.floor((widthPx + gap) / (size + gap)))
}

function rowsFor(n: number, perRow: number): number {
  return n <= 0 ? 0 : Math.ceil(n / perRow)
}

export function trayLayout(n: number, widthPx: number): TrayLayout {
  const bigPerRow = fitCount(6, 3, widthPx)
  const bigRows = rowsFor(n, bigPerRow)
  if (bigRows <= TRAY_MAX_ROWS) {
    return { size: 6, gap: 3, perRow: bigPerRow, rows: bigRows, shown: n, rest: 0 }
  }

  const smallPerRow = fitCount(4, 2, widthPx)
  const smallRows = rowsFor(n, smallPerRow)
  if (smallRows <= TRAY_MAX_ROWS) {
    return { size: 4, gap: 2, perRow: smallPerRow, rows: smallRows, shown: n, rest: 0 }
  }

  const shown = smallPerRow * TRAY_MAX_ROWS
  return { size: 4, gap: 2, perRow: smallPerRow, rows: TRAY_MAX_ROWS, shown, rest: n - shown }
}
