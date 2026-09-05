// 7族の表（純関数・表）。Recall の説明の折りたたみ（設計 2026-09-05 再計画 §3）に出す。
// 属する分野は cores.ts の coreKindOf から導く（手で二重に持たない）。
// 短い名詞（R12）はオーナーが決める。決まるまで空文字。族の動きの言葉（閉じて戻る 等）は画面に出さない。
import { GENRE_SEATS, OTHER_SLOT, isRetiredSeat, genreLabel } from './genres'
import { coreKindOf, type CoreKind } from './cores'
import { coreEnglishOf } from './genre-en'

export const FAMILY_ORDER: CoreKind[] = ['flow', 'exchange', 'signal', 'invasion', 'structure', 'regulation', 'system']

// 族が何をまとめているかを言い切る短い言葉（2026-09-05 オーナー決定）。
// 族の動きの言葉（閉じて戻る 等）はここに書かない。動きは紋章が見せる。
export const FAMILY_NOUN: Record<CoreKind, string> = {
  flow: '血液と体液',
  exchange: '物質の出入り',
  signal: '情報の伝達',
  invasion: '外因と生体反応',
  structure: '身体の評価と介入',
  regulation: '生体の恒常性',
  system: '医療のしくみ',
}

export type FamilyRow = { kind: CoreKind; en: string; noun: string; members: string[] }

// 席番号の小さい順に、族ごとの分野名を集める。廃番の席（学会）とその他の席は出さない。
export function familyMembers(): FamilyRow[] {
  const members = new Map<CoreKind, string[]>(FAMILY_ORDER.map((k) => [k, []]))
  for (let slot = 0; slot < GENRE_SEATS.length; slot++) {
    if (!GENRE_SEATS[slot] || slot === OTHER_SLOT || isRetiredSeat(slot)) continue
    members.get(coreKindOf(slot))!.push(genreLabel(slot))
  }
  return FAMILY_ORDER.map((kind) => ({
    kind, en: coreEnglishOf(kind), noun: FAMILY_NOUN[kind], members: members.get(kind)!,
  }))
}
