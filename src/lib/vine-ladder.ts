// 知の蔓の高さ関数。ルールは一文——「葉が1枚ひらくと、蔓が2mm伸びる」。
// 一升瓶のすぐ上（葉200枚=40cm）から先は複利（1枚ごとに+0.5%）。「学びは複利」を機構で語る。
// ⚠️ この3定数は表示露出後は実質変更不可（ユーザーの高さが動く）。
//    ゴールデンテスト（vine-ladder.test.ts）が事故的変更を封じている。GA前の監修でのみ動かす。
// ⚠️ この3定数は独立ではない。COMPOUND_START_LEAVES × COMPOUND_RATE = 1 が
//    成り立つときだけ複利の境界で「1枚=2mm」が途切れない。率だけ下げると
//    複利開始と同時に減速する（率0.0034にすると2mm→0.85mmに落ち、戻るのは葉379枚）。
//    変えるときは開始枚数を選び、率はその逆数にする。
export const MM_PER_LEAF = 2
export const COMPOUND_START_LEAVES = 200
export const COMPOUND_RATE = 0.005

const COMPOUND_BASE_MM = COMPOUND_START_LEAVES * MM_PER_LEAF // 400mm（一升瓶398mmのすぐ上）

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

// 実物ラダーv2（寸法は2026-08-01に裏取り済み。実寸を動かすことは世界の嘘になる＝禁止）。
// measure は画面に小さく明記する「測り方」。provisional=上段仮置き（画風テスト後に確定。
// 未到達ラダーの差し替えは記録（葉数）を壊さない——このテーブルは表示専用で台帳に書かれないため）。
export type Milestone = {
  mm: number; label: string; sizeLabel: string; measure: string
  provisional?: boolean; leaves: number
}

type RawMilestone = Omit<Milestone, 'leaves'>
const RAW: readonly RawMilestone[] = [
  { mm: 5, label: 'アリ', sizeLabel: '5mm', measure: '体長（クロヤマアリ働きアリ）' },
  { mm: 8, label: 'テントウムシ', sizeLabel: '8mm', measure: '体長（ナナホシテントウ）' },
  { mm: 20, label: 'ドングリ', sizeLabel: '2cm', measure: '果長（コナラ）' },
  { mm: 35, label: 'カタツムリ', sizeLabel: '3.5cm', measure: '殻径（ミスジマイマイ）' },
  { mm: 70, label: '湯のみ', sizeLabel: '7cm', measure: '器高（小ぶり）' },
  { mm: 100, label: 'スズメ', sizeLabel: '10cm', measure: '立ち姿の背丈' },
  { mm: 250, label: 'ネコ', sizeLabel: '25cm', measure: '体高（肩高）' },
  { mm: 398, label: '一升瓶', sizeLabel: '39.8cm', measure: '全高（JIS規格）' },
  { mm: 750, label: '番傘', sizeLabel: '75cm', measure: 'すぼめた全長' },
  { mm: 900, label: 'ニホンジカ', sizeLabel: '90cm', measure: '体高（本州産オス）' },
  { mm: 1400, label: 'タンチョウ', sizeLabel: '1.4m', measure: '立ち姿' },
  { mm: 1700, label: 'ヒト', sizeLabel: '1.7m', measure: '身長（笠の旅人）' },
  { mm: 3000, label: '白象', sizeLabel: '3m', measure: '肩高（オス）' },
  { mm: 5000, label: '鳥居', sizeLabel: '5m', measure: '全高（街の明神鳥居）' },
  { mm: 12_000, label: '合掌造りの民家', sizeLabel: '12m', measure: '棟高' },
  { mm: 15_000, label: '奈良の大仏', sizeLabel: '15m', measure: '像高（台座を除く）' },
  { mm: 25_000, label: 'ご神木の大杉', sizeLabel: '25m', measure: '樹高' },
  { mm: 54_800, label: '五重塔', sizeLabel: '54.8m', measure: '全高（東寺・相輪含む）' },
  { mm: 133_000, label: '那智の滝', sizeLabel: '133m', measure: '落差', provisional: true },
  { mm: 350_000, label: '称名滝', sizeLabel: '350m', measure: '落差（四段計）', provisional: true },
  { mm: 877_000, label: '筑波山', sizeLabel: '877m', measure: '標高', provisional: true },
  { mm: 1_982_000, label: '石鎚山', sizeLabel: '1982m', measure: '標高', provisional: true },
  { mm: 3_015_000, label: '立山', sizeLabel: '3015m', measure: '標高', provisional: true },
]

export const LADDER: readonly Milestone[] = RAW.map((m) => ({ ...m, leaves: leavesForHeightMm(m.mm) }))
export const FAR_DREAM: Milestone = {
  mm: 3_776_000, label: '富士山', sizeLabel: '3776m', measure: '標高（剣ヶ峰）',
  leaves: leavesForHeightMm(3_776_000),
}

// 富士山より先は「雲の上」＝測れない領域なので、nextは常に存在する（nullを返さない）。
export function nextMilestone(leafCount: number): Milestone {
  return LADDER.find((m) => m.leaves > leafCount) ?? FAR_DREAM
}

export function passedMilestones(leafCount: number): Milestone[] {
  return LADDER.filter((m) => m.leaves <= leafCount)
}

// シーン（帯）モデル: 1目盛り区間=1シーン。縮尺は「次の実物が画面高の70%」から決める。
// ラダーは対数線上でほぼ等間隔（隣接比は概ね2.5倍以内。仮置き上段の那智→称名2.63等の例外あり）なので、
// シーン切替時の縮尺ジャンプも同程度に収まる。
const NEXT_OBJECT_VIEWPORT_RATIO = 0.7

export function sceneForLeaves(leafCount: number, viewportHeightPx: number): {
  next: Milestone; prevMm: number; pxPerMm: number
} {
  const next = nextMilestone(leafCount)
  const passed = passedMilestones(leafCount)
  const prevMm = passed.length ? passed[passed.length - 1].mm : 0
  return { next, prevMm, pxPerMm: (viewportHeightPx * NEXT_OBJECT_VIEWPORT_RATIO) / next.mm }
}
