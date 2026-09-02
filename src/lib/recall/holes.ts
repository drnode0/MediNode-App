// 主張本文の中で伏せ字にする数値の範囲。前セッションの build-grains.mjs と同じ規則:
//  1) 研究記述子・出典番号・年号を空白でマスクする（穴にしない）
//  2) 閾値 → 範囲 → 単位値 の優先順で、最初に当たった種類だけを最大3つ取る
//     （同種の数値が同一文に並ぶときだけ複数穴。異種を混ぜると文が読めなくなる）
// 穴は「読者が思い出すべき臨床の数値（閾値・目標範囲・用量）」に限る。
// 試験の発生率や信頼区間を伏せると、判断の基準ではなく研究の些末を暗記させることになる。
//
// 上限そのものの定義は segments.ts に置く（このファイルは読み込むだけで正規表現を大量に
// 組み立てるため、数だけが要る管理画面がここを読まなくて済むようにする）。ここからも
// 再輸出しておき、`import { detectHoles, MAX_HOLES } from './holes'` を壊さない。
import { MAX_HOLES } from './segments'
export { MAX_HOLES }

const UNIT = '%|％|mmHg|mmol\\/L|mEq\\/L|mg\\/dL|kPa|mL\\/kg\\/時|mL\\/時|mL\\/kg|mL|L\\/分|L|時間|分|秒|日|点|℃|g\\/dL|mg|kg|IU|回\\/分'

// 穴にする数値の共通形。3つの RANKED 規則で同じ形を使う。
// 片方だけ桁区切りを許すと「2,000–12,900」で数の途中から拾ってしまう。
const NUM = '\\d+(?:[,.]\\d+)?'

// 研究統計に出てくる数の形。符号つき・桁区切りつきの数（SNUM）と、
// 2つの数を繋いだ区間（IVAL）。信頼区間は固定幅の窓ではなくこの形で消す。
const SNUM = '[−–—+-]?\\d+(?:,\\d{3})*(?:\\.\\d+)?'
const CONN = '\\s*[〜~～–—-]\\s*'
const IVAL = `${SNUM}(?:${CONN}${SNUM})?`
// 効果指標のラベル。点推定とその区間をひとまとまりで消すために使う。
const STAT = 'オッズ比|ハザード比|リスク比|相対リスク|OR|HR|RR|κ|AUC|I²|I2'

const NOISE: RegExp[] = [
  /(?:CQ|BQ|FRQ)\s*\d+(?:[-–]\d+)*/gu,
  /(?:statement|Table|Figure|表|図|推奨|Box)\s*\d+/giu,
  /第\s*\d+\s*版/gu,
  /(?:19|20)\d{2}\s*年?(?:版|度)?/gu,
  // 「95% CI 0.45〜0.82」。以前は [^。]{0,24} の固定幅の窓で消していたため、
  // 1文に信頼区間が2つあると1つ目の窓が2つ目の頭（「（9」）まで食い、
  // 残った「5%CI …」がどの規則にも当たらず2つ目の区間が穴になっていた。
  new RegExp(`\\d{2}\\s*[%％]\\s*(?:CI|信頼区間)\\s*[:：=＝]?\\s*${IVAL}(?:\\s*(?:${UNIT}))?`, 'gu'),
  // 「AOR 0.60・CI 0.49〜0.72」のように 95% の付かない信頼区間。
  // 心係数（CI 2.5–4.0 L/min/m²）は臨床の正常範囲なので、単位が続くものは残す。
  new RegExp(`(?<![A-Za-z])CI\\s*[:：=＝]?\\s*${SNUM}${CONN}${SNUM}(?![\\d.,])(?!\\s*[A-Za-zµμ%％℃])`, 'gu'),
  new RegExp(`(?:IQR|四分位範囲)\\s*[:：=＝]?\\s*${IVAL}`, 'gu'),
  // 「AUC 0.85（0.81〜0.88）」「I²=96%（94〜99）」。単位を持たない括弧内の区間は
  // 臨床の目標範囲ではなく推定の幅。単位が入る「（88〜92%）」は括弧閉じに届かず残る。
  new RegExp(`[（(]\\s*${SNUM}${CONN}${SNUM}\\s*[)）]`, 'gu'),
  // 「RR 0.94, 0.85〜1.03」「（0.98, 0.87〜1.10）」= 点推定とその区間。
  // 点推定だけを消すと区間が剥き出しで残る。
  new RegExp(`(?:(?:${STAT})\\s*(?:は|=|＝|:|：)?\\s*|[（(]\\s*)${SNUM}\\s*[,、]\\s*${SNUM}${CONN}${SNUM}`, 'gu'),
  /[pP]\s*[=＝<＜>＞]\s*0?\.\d+/gu,
  /合意率\s*\d+(?:\.\d+)?\s*%?/gu,
  new RegExp(`(?:${STAT})\\s*(?:は|=|＝|:|：)?\\s*\\d+(?:\\.\\d+)?\\s*[%％]?`, 'gu'),
  // 例数と、それに続く括弧内の発生率。「624例中57例（9.1%）」で例数だけ消すと
  // 片方の群の発生率が穴になり、判断の基準ではなく試験の結果を問うカードになる。
  /(?:n\s*=\s*)?\d{1,3}(?:,\d{3})*\s*(?:例|人|件|施設|試験|報|RCT)(?:\s*[（(]\s*\d+(?:\.\d+)?\s*[%％])?/gu,
]

// 数の途中から拾い始めない（「2,000–12,900」の 000、「1.0以上」の 0）。
const HEAD = '(?<![\\d.,])'

const RANKED: RegExp[] = [
  // 閾値。範囲の後半（「0.9〜1.0以上」の 1.0）を拾わない。拾うと片側だけが伏せられ、
  // 「0.9〜___」が別の閾値に読めてしまう。範囲の規則に落として全体を1つの穴にする。
  new RegExp(`(?<![〜~～–—]\\s*)${HEAD}${NUM}\\s*(?:${UNIT})?\\s*(?:未満|以上|以下|超|を超え|より低|より高)`, 'gu'),
  new RegExp(`${HEAD}${NUM}\\s*[〜~–—]\\s*${NUM}\\s*(?:${UNIT})?`, 'gu'),
  new RegExp(`${HEAD}${NUM}\\s*(?:${UNIT})`, 'gu'),
]

export function detectHoles(body: string): [number, number][] {
  let masked = body
  for (const re of NOISE) masked = masked.replace(re, (m) => ' '.repeat(m.length))
  for (const re of RANKED) {
    const hits: [number, number][] = []
    for (const m of masked.matchAll(re)) {
      if (m.index === undefined) continue
      // 末尾の空白を落とす。範囲の規則は単位が無いと \s* が空白を抱え込み、
      // 答えより広い伏せ字（「5〜10 」）になる。ここ1か所で全規則に効かせる。
      const text = m[0].replace(/\s+$/u, '')
      if (!text.trim().length) continue
      hits.push([m.index, m.index + text.length])
      if (hits.length === MAX_HOLES) break
    }
    if (hits.length) return hits
  }
  return []
}
