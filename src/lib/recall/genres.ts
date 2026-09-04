// ジャンル席。球の中心を決める唯一の定義。
// 番号の振り直しは禁止(球が組み替わり genreHueIndex の色も同時にずれる)。追加は末尾のみ。
// 位置は fibPt(slot, GENRE_CAPACITY) で計算するので、末尾に足しても既存の中心は動かない。
//
// 席番号＝この配列の添字。**途中の要素を消してはいけない**（後ろの席が全部ずれる）。
// '29.学会' は 2026-09-03 に Notion 側の選択肢を廃止したが、ここには墓標として残す。
// 配列から抜くと 30 以降の 9 席が 1 つ手前にずれ、球の区画と genreHueIndex の色が
// まとめて変わる。使われない席は穴にならない（容量つき割り当てで使用中の席の区画が広がる）。
import { canonicalGenreKey } from '@/lib/genre'

export const GENRE_SEATS = [
  '01.総論', '02.医療倫理', '03.救急蘇生', '04.呼吸', '05.循環', '06.中枢神経', '07.腎',
  '08.肝・胆道系', '09.膵', '10.消化管・その他腹部', '11.血液凝固線溶系', '12.代謝内分泌',
  '13.感染症', '14.多臓器障害', '15.外傷・整形', '16.熱傷', '17.急性中毒', '18.体温異常・環境障害',
  '19.妊産婦', '20.小児', '21.移植', '22.輸液・輸血・水電解質', '23.栄養', '24.画像診断',
  '25.ICU運営・医療安全・教育', '26.手技', '27.薬剤', '28.災害', '29.学会', '30.統計・研究',
  '31.他科救急', '32.リハビリ・PICS', '33.精神科', '34.アレルギー・免疫', '35.周術期・麻酔',
  '36.病院前・搬送', '37.腫瘍・血液救急', '38.症候',
] as const

export const GENRE_CAPACITY = 64
export const OTHER_SLOT = 63
const INBOX = 'INBOX'

// new Map(...) は同じキーの後勝ちで前の席を黙って上書きするため、正規化キーが
// 衝突した席が将来足されたときに気付けない（例: 「38.呼吸」を追加すると 04.呼吸 の
// 席番号が静かに入れ替わり、既存の主張が別の席へ動いてしまう）。ここでは衝突を
// 例外で早期に落として、席の固定という前提を守る。
const SLOT_BY_KEY = new Map<string, number>()
for (const [i, g] of GENRE_SEATS.entries()) {
  const key = canonicalGenreKey(g)
  if (SLOT_BY_KEY.has(key)) {
    throw new Error(`GENRE_SEATS の正規化キーが重複している: "${g}"`)
  }
  SLOT_BY_KEY.set(key, i)
}

// 廃番になった席。番号を動かさないので配列には残すが、惑星としては出さない
// （'29.学会' は 2026-09-03 に Notion 側の選択肢を廃止した）。38席 − 1 = 37個の惑星。
// 名前で書くのは KIND_BY_SEAT と同じ理由（席番号の並びを触らずに済む）。
export const RETIRED_SEATS = ['学会'] as const

const RETIRED_SLOTS = new Set(RETIRED_SEATS.map((name) => {
  const slot = SLOT_BY_KEY.get(canonicalGenreKey(name))
  if (slot === undefined) throw new Error(`RETIRED_SEATS の席が GENRE_SEATS に無い: "${name}"`)
  return slot
}))

export const isRetiredSeat = (slot: number): boolean => RETIRED_SLOTS.has(slot)

export function genreSlotOf(genre: string): number {
  const slot = SLOT_BY_KEY.get(canonicalGenreKey(genre))
  return slot === undefined ? OTHER_SLOT : slot
}

// 主ジャンル＝Notion の並びの1つ目。INBOX は飛ばす。
export function primaryGenreOf(genres: string[]): { genre: string; slot: number } | null {
  for (const g of genres) {
    const key = canonicalGenreKey(g)
    if (key.toUpperCase() === INBOX) continue
    // 計画からの意図的な変更: 正規化して空になる facet（「05.」など。genre.ts の
    // mergeGenreKeys が同じ理由で捨てている）は主張の主張先にできないので飛ばす。
    // 飛ばさないと その他 の席に落ち、本来拾うべき次の実ジャンルを取り逃す。
    if (!key) continue
    return { genre: g, slot: genreSlotOf(g) }
  }
  return null
}

// 画面に出す席の名前。番号の接頭辞（「05.」）は落とす。
// GENRE_SEATS は 37 席しか無いのに席番号は GENRE_CAPACITY-1（63）まで取りうるので、
// 席の外は undefined になる。生の値を出す場所と落とす場所が分かれていると表記がぶれ、
// 席の外では空文字になるため、名前の作り方はここ1本に寄せる。
export function genreLabel(slot: number): string {
  if (slot === OTHER_SLOT) return 'その他'
  const seat = GENRE_SEATS[slot] as string | undefined
  return seat ? seat.replace(/^\d+\./, '') : 'その他'
}
