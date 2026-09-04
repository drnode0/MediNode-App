// 居場所5段（純関数）。状態と保持力から、惑星の中のどこに主張が居るかを決める。
// 描画を知らない（field-render はここを呼ぶだけで、式を持たない）。
//
// 設計: 2026-09-04「惑星の中の体験」決定1（居場所5段）・決定9〜11。
// 1軸だけで全状態を読む。中心に近いほど自分のもの。
//
//   深く残した … 輪の内縁より内（間隔90日以上。最も明るく、明滅も揺れもしない）
//   残した     … 輪（高度＝保持力。明るさも保持力に比例する）
//   離れかけ   … 輪の外縁を割る（保持力 0.28 未満。光の色で明滅し、次の確かめるで出る）
//   読んだ     … 輪の外の細い帯（節の読了。出題しない）
//   未着手     … いちばん外の霧
//
// 「定着」は画面に出さない（決定9）。内部名 settled は据え置きで、表示だけ「深く残した」。
import { ESCAPE_THRESHOLD, SETTLED_MIN_DAYS } from './srs'
import type { RecallStateKind } from './types'

export { ESCAPE_THRESHOLD, SETTLED_MIN_DAYS }

// 惑星の半径を 1 とした高度。設計書の表の値をそのまま定数にする。
export const R_SETTLED = 1.16
export const R_RING_INNER = 1.3
export const R_RING_OUTER = 2.6
export const R_ESCAPE_MAX = 2.85
export const R_TOUCHED = 3.05
export const R_COLD = 3.38

// 輪の高度。保持力 1 で内縁、0.28 で外縁、それより薄れると外縁を割って外へ出る。
//
// 出荷コードは「1本の式に上限を掛ける」形だった。実装計画では境目を連続にする
// 2本目の式を推測して書いていたが、実物はこちらなので、実物に合わせる。
//   ・保持力 1     → 1.3（内縁）
//   ・保持力 0.28  → 2.6（外縁。ちょうど離れかけの境目）
//   ・保持力 0     → 式の上では 3.105 まで伸びるが、下の CLAMP で 1.4 に頭打ち
// 頭打ちが要るのは、読んだの帯（3.05）と当たらないようにするため。
const RING_SPAN_CLAMP = 1.4

export function ringRadius(remaining: number): number {
  const rem = Number.isFinite(remaining) ? remaining : 0
  const t = Math.min(RING_SPAN_CLAMP, Math.max(0, (1 - rem) / (1 - ESCAPE_THRESHOLD)))
  return R_RING_INNER + (R_RING_OUTER - R_RING_INNER) * t
}

const isKept = (kind: RecallStateKind) => kind === 'kept' || kind === 'settled'

// 保持力が閾値を割った「残した」主張。次の確かめるで輪から剥がれる。
export function isEscaping(kind: RecallStateKind, remaining: number): boolean {
  return isKept(kind) && remaining < ESCAPE_THRESHOLD
}

// 主張1つの居場所。半径は惑星の半径を 1 とした値。
// 未着手だけ y のゆらぎを持つ（霧なので、きれいな球面に並ばない）。
export function placeOf(kind: RecallStateKind, remaining: number, jitter = 0): { r: number; y: number } {
  switch (kind) {
    case 'settled':
      return { r: R_SETTLED, y: 0 }
    case 'kept':
      // 離れかけも同じ式。外縁を割ったぶんだけ外へ出るが、読んだの帯に当たらないよう頭打ちにする。
      return { r: Math.min(R_ESCAPE_MAX, ringRadius(remaining)), y: 0 }
    case 'touched':
      return { r: R_TOUCHED, y: 0 }
    default:
      return { r: R_COLD, y: jitter }
  }
}

// 線画に使う色。面・塗り・影は使わない（芯とLPに揃える）。
export const INK_WHITE = '#F4F7FA'
export const INK_COOL = '#EBF2FB'
export const INK_HALO = '#F6E7B8'
export const INK_TOUCHED = '#8FA3BD'
export const INK_DIM = '#7C8DA6'

// alpha に palette の alphaGain を掛ける。1 を超えないよう頭打ちにする
//（掛けた先の値をそのまま globalAlpha に渡すため、1 を超えると Canvas 側で 1 に丸められて
//  gain の差が消える。ここで先に丸めておけば、頭打ち後の値をテストできる）。
export function gainAlpha(alpha: number, gain: number): number {
  return Math.min(1, alpha * gain)
}

export type Look = { ink: string; alpha: number; size: number; glow: boolean }

// 主張1つの見え方。t は秒（明滅に使う）。動きを減らす設定では明滅を止める。
//
// 明るさは保持力に比例する（保持力が高いほど明るい）。
// 現行の球（field-render の旧式）は 0.42 + 0.34 × (1 − 保持力) で、忘れるほど明るかった。
// 設計書と向きが逆だったので、ここで 0.5 + 0.45 × 保持力 に直してある。
// 薄れた主張を見失わないのは、離れかけが光の色で別に立つため。
export function lookOf(kind: RecallStateKind, remaining: number, t: number, reduced: boolean, phase = 0): Look {
  if (isEscaping(kind, remaining)) {
    return {
      ink: INK_HALO,
      alpha: reduced ? 0.9 : 0.6 + 0.38 * Math.sin(t * 3.2 + phase),
      size: 1.9,
      glow: true,
    }
  }
  switch (kind) {
    case 'settled':
      return { ink: INK_WHITE, alpha: 0.95, size: 1.35, glow: true }
    case 'kept':
      return { ink: INK_COOL, alpha: 0.5 + 0.45 * remaining, size: 1.15, glow: false }
    case 'touched':
      return { ink: INK_TOUCHED, alpha: 0.4, size: 1, glow: false }
    default:
      return { ink: INK_DIM, alpha: 0.2, size: 0.9, glow: false }
  }
}

// ── 境目の名前（決定7）──────────────────────────────
// 近景に入った直後の約3秒だけ、輪の境目に薄い円を描き、左端に名前を添える。
// 最初のドラッグで消える。土星の環の区分に名前が付いているのと同じ見せ方。
export const EDGE_CIRCLES = [R_RING_INNER, R_RING_OUTER, 2.95, 3.22] as const

// 「定着」は使わない（決定9）。画面に出るのはこの5語だけ。
export const EDGE_LABELS: ReadonlyArray<readonly [number, string]> = [
  [0.98, '深く残した'],
  [1.95, '残した'],
  [2.76, '離れかけ'],
  [3.06, '読んだ'],
  [3.42, '未着手'],
]

export const EDGE_LABEL_MS = 3400

// 境目の名前を出すか。入って一定時間だけ、かつ一度もドラッグしていないとき。
// 居場所5段のときだけ出す（高度1軸には境目が無い）。
export function edgeLabelsVisible(enteredAt: number, now: number, dragged: boolean): boolean {
  if (dragged) return false
  return now - enteredAt < EDGE_LABEL_MS
}

// ── 遠景・中景での要約 ────────────────────────────
// 芯が5〜7pxに潰れる倍率では点が読めない。惑星そのものに要約を持たせる。

// リングの上での惑星の大きさ。主張が多い席ほど大きいが、平方根で頭を押さえる
// （呼吸の178件と、1件の席とで、大きさが178倍にならないようにする）。
export const PLANET_R_MIN = 0.022
export const PLANET_R_MAX = 0.075

export function planetRadius(count: number, maxCount: number): number {
  if (!(count > 0)) return PLANET_R_MIN
  const t = Math.sqrt(Math.min(1, count / Math.max(1, maxCount)))
  return PLANET_R_MIN + (PLANET_R_MAX - PLANET_R_MIN) * t
}

// 惑星の顔つき。3つに分かれる。
//   empty     … 主張が1件も無い席。**モヤ**（決定10）。輪郭も芯も描かない（決定11）
//   untouched … 主張はあるが1つも触れていない席。輪郭は最も薄く、芯は出す
//   active    … 何か残している席。輪郭の明るさ＝残した主張の平均保持力
//
// 空の惑星と未開拓の惑星を取り違えない。モヤが付くのは前者だけで、
// 「モヤが晴れて芯が現れる＝その分野に最初の記事が入った合図」にする。
export type PlanetFace = 'empty' | 'untouched' | 'active'

export type PlanetSummary = {
  face: PlanetFace
  haze: boolean          // モヤを描くか
  core: boolean          // 芯（族）を描くか
  outline: boolean       // 輪郭の円を描くか
  outlineAlpha: number   // 輪郭の明るさ（平均保持力から）
  halos: number          // 輪郭のすぐ外に出す光の点の数（離れかけの数。上限5）
}

export const HALO_MAX = 5

// モヤの濃さ。37席のうち22席が空なので、遠景の6割がモヤになる。
// 「これから埋まる場所が見える」に見えるか「未完成」に見えるかは実機で決まるので、
// 振れるように1か所へ出しておく。
export const HAZE_ALPHA = 0.35

export type PlanetStat = { total: number; keptRemainings: number[]; escaping: number }

export function planetSummary(stat: PlanetStat): PlanetSummary {
  const kept = stat.keptRemainings
  const avg = kept.length ? kept.reduce((s, r) => s + r, 0) / kept.length : 0
  const halos = Math.min(HALO_MAX, Math.max(0, stat.escaping))
  if (stat.total <= 0) {
    return { face: 'empty', haze: true, core: false, outline: false, outlineAlpha: 0, halos: 0 }
  }
  const face: PlanetFace = kept.length === 0 ? 'untouched' : 'active'
  return {
    face,
    haze: false,
    core: true,
    outline: true,
    // 何も残していない惑星は輪郭だけ薄く（0.16）、残すほど明るくなる。
    outlineAlpha: 0.16 + 0.42 * avg,
    halos,
  }
}
