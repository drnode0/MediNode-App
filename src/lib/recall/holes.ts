// 主張本文の中で伏せ字にする数値の範囲。前セッションの build-grains.mjs と同じ規則:
//  1) 研究記述子・出典番号・年号を空白でマスクする（穴にしない）
//  2) 閾値 → 範囲 → 単位値 の優先順で、最初に当たった種類だけを最大3つ取る
//     （同種の数値が同一文に並ぶときだけ複数穴。異種を混ぜると文が読めなくなる）
export const MAX_HOLES = 3

const UNIT = '%|％|mmHg|mmol\\/L|mEq\\/L|mg\\/dL|kPa|mL\\/kg\\/時|mL\\/時|mL\\/kg|mL|L\\/分|L|時間|分|秒|日|点|℃|g\\/dL|mg|kg|IU|回\\/分'

const NOISE: RegExp[] = [
  /(?:CQ|BQ|FRQ)\s*\d+(?:[-–]\d+)*/gu,
  /(?:statement|Table|Figure|表|図|推奨|Box)\s*\d+/giu,
  /第\s*\d+\s*版/gu,
  /(?:19|20)\d{2}\s*年?(?:版|度)?/gu,
  /95\s*%\s*CI[^。]{0,24}/gu,
  /[pP]\s*[=＝<＜>＞]\s*0?\.\d+/gu,
  /合意率\s*\d+(?:\.\d+)?\s*%?/gu,
  /(?:オッズ比|ハザード比|リスク比|OR|HR|RR|κ)\s*(?:は|=|＝|:|：)?\s*\d+(?:\.\d+)?/gu,
  /(?:n\s*=\s*)?\d{1,3}(?:,\d{3})*\s*(?:例|人|件|施設|試験|報|RCT)/gu,
]

const RANKED: RegExp[] = [
  new RegExp('\\d+(?:[,.]\\d+)?\\s*(?:' + UNIT + ')?\\s*(?:未満|以上|以下|超|を超え|より低|より高)', 'gu'),
  new RegExp('\\d+(?:\\.\\d+)?\\s*[〜~–—]\\s*\\d+(?:\\.\\d+)?\\s*(?:' + UNIT + ')?', 'gu'),
  new RegExp('\\d+(?:[,.]\\d+)?\\s*(?:' + UNIT + ')', 'gu'),
]

export function detectHoles(body: string): [number, number][] {
  let masked = body
  for (const re of NOISE) masked = masked.replace(re, (m) => ' '.repeat(m.length))
  for (const re of RANKED) {
    const ms = [...masked.matchAll(re)].filter((m) => m[0].trim().length > 0 && m.index !== undefined)
    if (!ms.length) continue
    return ms.slice(0, MAX_HOLES).map((m) => [m.index as number, (m.index as number) + m[0].length])
  }
  return []
}
