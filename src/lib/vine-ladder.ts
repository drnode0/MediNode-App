// 知の蔓の高さ関数。ルールは一文——「葉が1枚ひらくと、蔓が2mm伸びる」。
// ネコ（葉125枚=25cm）から先は複利（1枚ごとに+0.8%）。「学びは複利」を機構で語る。
// ⚠️ この3定数は表示露出後は実質変更不可（ユーザーの高さが動く）。
//    ゴールデンテスト（vine-ladder.test.ts）が事故的変更を封じている。GA前の監修でのみ動かす。
export const MM_PER_LEAF = 2
export const COMPOUND_START_LEAVES = 125
export const COMPOUND_RATE = 0.008

const COMPOUND_BASE_MM = COMPOUND_START_LEAVES * MM_PER_LEAF // 250mm（ネコ）

export function heightMmFromLeaves(n: number): number {
  if (n <= COMPOUND_START_LEAVES) return n * MM_PER_LEAF
  return COMPOUND_BASE_MM * Math.pow(1 + COMPOUND_RATE, n - COMPOUND_START_LEAVES)
}

// その高さ以上になる最小の整数葉数。越え判定は必ずこの整数で行う（浮動小数比較の二重発火を防ぐ）。
export function leavesForHeightMm(mm: number): number {
  if (mm <= COMPOUND_BASE_MM) return Math.ceil(mm / MM_PER_LEAF)
  const n = COMPOUND_START_LEAVES + Math.log(mm / COMPOUND_BASE_MM) / Math.log(1 + COMPOUND_RATE)
  const whole = Math.ceil(n - 1e-9) // 表現誤差でceilが1つ滑るのを防ぐ
  return heightMmFromLeaves(whole) >= mm ? whole : whole + 1
}

export function formatHeight(mm: number): string {
  if (mm < 10) return `${Math.round(mm)}mm`
  if (mm < 1000) return `${(mm / 10).toFixed(1).replace(/\.0$/, '')}cm`
  return `${(mm / 1000).toFixed(2).replace(/\.?0+$/, '')}m`
}
