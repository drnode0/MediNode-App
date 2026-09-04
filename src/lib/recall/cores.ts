// 芯の族（純関数・データのみ）。描画を知らない。
//
// 出所: 惑星のラフ（設計 2026-09-03「七つの族の芯」／2026-09-04「惑星の中の体験」）。
// ラフはビルド後の1ファイルしか残っていなかったため、そこから族の割り当て・個体差・
// 動きの定数を写し取ってここに戻した。形（線の座標）は field-render 側に置く。
//
// 族は「席の性格」であって、記憶の状態ではない。記憶は居場所（field-layout.ts）が担う。
// 2族が同じ動きに見えたらどちらかを変える、という設計の約束があるので、
// 動きの定数（自転の速さ・傾き）も族ごとに1か所へ集める。
import { GENRE_SEATS, OTHER_SLOT } from './genres'
import { canonicalGenreKey } from '@/lib/genre'

export type CoreKind = 'flow' | 'exchange' | 'signal' | 'invasion' | 'structure' | 'regulation' | 'system'

export const CORE_LABEL: Record<CoreKind, string> = {
  flow: '流れ', exchange: '交換', signal: '信号', invasion: '侵入',
  structure: '構造', regulation: '調節', system: '体系',
}

// 席名（番号の接頭辞を落とした正規化キー）→ 族。
// 席番号ではなく名前で引くのは、席の番号が動かない代わりに名前は改名されうるため
// （18／25／32 は 2026-09-03 に改名した）。名前で書いておくと、改名のたびに
// ここを直せばよく、席番号の並びを触らずに済む。
const KIND_BY_SEAT: Record<string, CoreKind> = {
  // 流れ: 閉じて戻る
  救急蘇生: 'flow', 循環: 'flow', 血液凝固線溶系: 'flow', '輸液・輸血・水電解質': 'flow',
  // 交換: 行って帰る（往復は交換の専売）
  呼吸: 'exchange', 腎: 'exchange', '肝・胆道系': 'exchange', 膵: 'exchange',
  '消化管・その他腹部': 'exchange', 代謝内分泌: 'exchange', 栄養: 'exchange',
  // 信号: 伝って分岐する
  中枢神経: 'signal', 'リハビリ・PICS': 'signal', 精神科: 'signal', 症候: 'signal',
  // 侵入: 広がって戻らない
  感染症: 'invasion', 熱傷: 'invasion', 急性中毒: 'invasion', 'アレルギー・免疫': 'invasion',
  // 構造: 撓んで耐える（直線は構造の専売）
  '外傷・整形': 'structure', 画像診断: 'structure', 手技: 'structure', 災害: 'structure',
  '周術期・麻酔': 'structure', '病院前・搬送': 'structure',
  // 調節: 乱れて釣り合いへ戻る
  多臓器障害: 'regulation', '体温異常・環境障害': 'regulation', 薬剤: 'regulation',
  妊産婦: 'regulation', 小児: 'regulation', 移植: 'regulation', '腫瘍・血液救急': 'regulation',
  // 体系: 動かない（自分の形を持たず、他の6族を縮小して重ねる）
  総論: 'system', 医療倫理: 'system', 'ICU運営・医療安全・教育': 'system',
  学会: 'system', '統計・研究': 'system', 他科救急: 'system',
}

// 席の外（その他の席・範囲外）は体系に寄せる。体系は自分の形を持たない族なので、
// 「何の族か決まらないもの」の受け皿として無理がない。
export function coreKindOf(slot: number): CoreKind {
  if (!Number.isInteger(slot) || slot < 0 || slot === OTHER_SLOT) return 'system'
  const seat = GENRE_SEATS[slot] as string | undefined
  if (!seat) return 'system'
  return KIND_BY_SEAT[canonicalGenreKey(seat)] ?? 'system'
}

// 族ごとの見え方の既定。tilt は芯を見る角度、rate は自転の速さ。
// 「2族が同じ動きに見えたらどちらかを変える」を守るための表なので、
// 値を散らさずここだけに置く。
export const CORE_TILT: Record<CoreKind, number> = {
  flow: 0.5, exchange: 0.36, signal: 0.24, invasion: 0.4,
  structure: 0.3, regulation: 0.34, system: 0.38,
}
export const CORE_SPIN: Record<CoreKind, number> = {
  flow: 0.18, exchange: 0.1, signal: 0.09, invasion: 0.1,
  structure: 0.13, regulation: 0.16, system: 0.06,
}

// 侵入の一撃の長さ（秒）。触れる前に凹まず、破れる前に波紋を出さない時間割の全体。
export const INVASION_CYCLE_SEC = 9.5
// 残る凹みの数。古いものから塞がる。
export const INVASION_SCARS = 3

// 個体差（37席）は大きさ・傾き・自転の速さだけで付ける。族の中で形は変えない。
// 席番号だけから決まる（乱数の種を持たない）ので、席が増えても既存の惑星は変わらない。
function seededRandom(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 1831565813) | 0
    let r = Math.imul(s ^ (s >>> 15), 1 | s)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

const round4 = (n: number) => Math.round(n * 1e4) / 1e4

export type CoreIndividual = { scale: number; tilt: number; rate: number }

export function coreIndividual(slot: number): CoreIndividual {
  const rnd = seededRandom(24231 + slot * 2654435761)
  return {
    scale: round4(0.88 + rnd() * 0.24),
    tilt: round4((rnd() - 0.5) * 2.2),
    rate: round4(0.7 + rnd() * 0.6),
  }
}
