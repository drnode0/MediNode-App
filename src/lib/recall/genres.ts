// ジャンル席。球の中心を決める唯一の定義。
// 番号の振り直しは禁止(球が組み替わり genreHueIndex の色も同時にずれる)。追加は末尾のみ。
// 位置は fibPt(slot, GENRE_CAPACITY) で計算するので、末尾に足しても既存の中心は動かない。
import { canonicalGenreKey } from '@/lib/genre'

export const GENRE_SEATS = [
  '01.総論', '02.医療倫理', '03.救急蘇生', '04.呼吸', '05.循環', '06.中枢神経', '07.腎',
  '08.肝・胆道系', '09.膵', '10.消化管・その他腹部', '11.血液凝固線溶系', '12.代謝内分泌',
  '13.感染症', '14.多臓器障害', '15.外傷・整形', '16.熱傷', '17.急性中毒', '18.体温異常',
  '19.妊産婦', '20.小児', '21.移植', '22.輸液・輸血・水電解質', '23.栄養', '24.画像診断',
  '25.集中治療医', '26.手技', '27.薬剤', '28.災害', '29.学会', '30.統計・研究', '31.マイナー',
  '32.リハビリ', '33.精神科',
] as const

export const GENRE_CAPACITY = 64
export const OTHER_SLOT = 63
const INBOX = 'INBOX'

const SLOT_BY_KEY = new Map<string, number>(GENRE_SEATS.map((g, i) => [canonicalGenreKey(g), i]))

export function genreSlotOf(genre: string): number {
  const slot = SLOT_BY_KEY.get(canonicalGenreKey(genre))
  return slot === undefined ? OTHER_SLOT : slot
}

// 主ジャンル＝Notion の並びの1つ目。INBOX は飛ばす。
export function primaryGenreOf(genres: string[]): { genre: string; slot: number } | null {
  for (const g of genres) {
    if (canonicalGenreKey(g).toUpperCase() === INBOX) continue
    return { genre: g, slot: genreSlotOf(g) }
  }
  return null
}
