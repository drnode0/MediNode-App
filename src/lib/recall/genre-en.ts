// 席の英名・族の英名（純関数・表）。表示だけに使う。
// 同期・席番号・キーには使わない（席の正規化は canonicalGenreKey のまま）。
//
// 出所: 設計書 2026-09-04「標本帳（図鑑）」§4。英名はオーナー確認済み
// （2026-09-04・3件を差し替え: 救急蘇生 Emergency Resuscitation／感染症 Infectious Diseases／
// 多臓器障害 MODS）。表を直せば画面が変わる。
import { GENRE_SEATS, OTHER_SLOT } from './genres'
import { canonicalGenreKey } from '@/lib/genre'
import type { CoreKind } from './cores'

// 席名（番号の接頭辞を落とした正規化キー）→ 英名。
// KIND_BY_SEAT（cores.ts）と同じ作り。改名のたびにここも直す。
export const GENRE_EN: Record<string, string> = {
  総論: 'Overview',
  医療倫理: 'Medical Ethics',
  救急蘇生: 'Emergency Resuscitation',
  呼吸: 'Respiratory',
  循環: 'Cardiovascular',
  中枢神経: 'Neurology',
  腎: 'Renal',
  '肝・胆道系': 'Hepatobiliary',
  膵: 'Pancreas',
  '消化管・その他腹部': 'GI & Abdomen',
  血液凝固線溶系: 'Coagulation',
  代謝内分泌: 'Metabolic & Endocrine',
  感染症: 'Infectious Diseases',
  多臓器障害: 'MODS',
  '外傷・整形': 'Trauma & Orthopedics',
  熱傷: 'Burns',
  急性中毒: 'Toxicology',
  '体温異常・環境障害': 'Thermal & Environmental',
  妊産婦: 'Obstetrics',
  小児: 'Pediatrics',
  移植: 'Transplantation',
  '輸液・輸血・水電解質': 'Fluids, Blood & Electrolytes',
  栄養: 'Nutrition',
  画像診断: 'Imaging',
  'ICU運営・医療安全・教育': 'ICU Management & Education',
  手技: 'Procedures',
  薬剤: 'Pharmacology',
  災害: 'Disaster Medicine',
  学会: 'Conferences',
  '統計・研究': 'Statistics & Research',
  他科救急: 'Other Specialties',
  'リハビリ・PICS': 'Rehabilitation & PICS',
  精神科: 'Psychiatry',
  'アレルギー・免疫': 'Allergy & Immunology',
  '周術期・麻酔': 'Perioperative & Anesthesia',
  '病院前・搬送': 'Prehospital & Transport',
  '腫瘍・血液救急': 'Oncologic & Hematologic Emergencies',
  症候: 'Symptoms & Signs',
}

// 画面に出す席の英名。その他（63番）は Others、席の外・表に無い席は空文字。
export function genreEnglishOf(slot: number): string {
  if (slot === OTHER_SLOT) return 'Others'
  if (!Number.isInteger(slot) || slot < 0) return ''
  const seat = GENRE_SEATS[slot] as string | undefined
  if (!seat) return ''
  return GENRE_EN[canonicalGenreKey(seat)] ?? ''
}

// 族の英名。CoreKind の内部名がそのまま英語なので、先頭を大文字にするだけ。
export function coreEnglishOf(kind: CoreKind): string {
  return kind.charAt(0).toUpperCase() + kind.slice(1)
}
