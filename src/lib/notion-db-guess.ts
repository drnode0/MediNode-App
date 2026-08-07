// 許可されたNotionのデータベース一覧から、3つの役割（知識・文献・マニュアル）の
// 既定値を決める。
//
// かんたん接続で初めて設定する人は保存済みの選択を持たないため、以前は全欄が空のまま
// 「選んでください」と出ていた。自分のNotionのどれを選べばいいのか分からない、という
// 実機フィードバック（2026-08-07）への対応。
//
// ここが決めるのは**既定値だけ**で、決定ではない。画面はDBの名前を出すので、
// 外れていればユーザーが選び直せる。

import { normalizeNotionId } from './settings'

export type DbCandidate = { id: string; title: string }

// 「自分のNotionの何を選べばいいのか分からない」への手がかり。かんたん接続の
// 仕上げシートと、手動セットアップのNotionステップの両方で同じ文を出す。
export const DB_PICK_HINT =
  '症例メモや勉強ノートなど、検索したい記事が1行1件で並んでいるデータベースを選びます。'

// NotionのDB名は先頭に絵文字が入っていることがある（「📋 マニュアル_DB」など）。
// 画面では落として表示する。保存するのはIDなので、表示だけの処理でよい。
// 落とすのは先頭の絵文字と、それに続く空白・中黒だけ。名前の途中や末尾は触らない。
const LEADING_EMOJI = /^(?:[\p{Extended_Pictographic}\p{Emoji_Presentation}️‍]+)[\s・:：-]*/u

export function displayDbTitle(title: string): string {
  const stripped = title.replace(LEADING_EMOJI, '').trim()
  // 絵文字だけの名前を空にしてしまわない。
  return stripped || title.trim()
}

// 役割の呼び方は、アプリで見える場所に揃える（Medical DB のような語は画面に出さない）。
export const DB_ROLE_UI = {
  medical: { label: '知識', where: '検索と新着に出ます', required: true },
  reference: { label: '文献', where: '文献タブに出ます', required: false },
  manual: { label: 'マニュアル', where: 'マニュアルタブに出ます', required: false },
} as const

export type DbRoleKey = keyof typeof DB_ROLE_UI

export type DbRoles = {
  medicalId: string
  referenceId: string
  manualId: string
}

const ROLE_HINTS: Array<{ role: keyof DbRoles; pattern: RegExp }> = [
  // 文献・マニュアルを先に判定する。「参考文献マニュアル」のような複合名でも、
  // 先に決まった役割が勝ち、同じDBが2つの役割に就くことはない。
  { role: 'referenceId', pattern: /文献|参考|reference/i },
  { role: 'manualId', pattern: /マニュアル|手順|お知らせ|manual|notice/i },
  { role: 'medicalId', pattern: /medical|知識|ナレッジ|knowledge|症例/i },
]

export function guessDbRoles(
  list: DbCandidate[],
  stored?: { medicalId?: string; referenceId?: string; manualId?: string }
): DbRoles {
  const roles: DbRoles = { medicalId: '', referenceId: '', manualId: '' }
  const taken = new Set<string>()

  const byNormalizedId = new Map(list.map((d) => [normalizeNotionId(d.id), d]))
  const assign = (role: keyof DbRoles, id: string) => {
    if (roles[role] || taken.has(id)) return
    roles[role] = id
    taken.add(id)
  }

  // 1. 保存済みの選択を引き継ぐ。手入力で登録したIDはハイフン無し32桁に正規化されて
  //    いるのに対し、一覧のIDはハイフン付きなので、双方を正規化して突き合わせる。
  //    <select> に入れる値は一覧側の表記でなければならない。
  for (const role of ['medicalId', 'referenceId', 'manualId'] as const) {
    const storedId = stored?.[role] || ''
    if (!storedId) continue
    const hit = byNormalizedId.get(normalizeNotionId(storedId))
    if (hit) assign(role, hit.id)
  }

  // 2. 空いている役割を、DBの名前から推し当てる。
  for (const { role, pattern } of ROLE_HINTS) {
    if (roles[role]) continue
    const hit = list.find((d) => !taken.has(d.id) && pattern.test(d.title))
    if (hit) assign(role, hit.id)
  }

  // 3. 知識だけは空のままだと先へ進めない。どの役割にも就いていないDBがちょうど
  //    1件なら、それを知識にする（旧「候補が1件だけなら自動選択」の一般化）。
  if (!roles.medicalId) {
    const rest = list.filter((d) => !taken.has(d.id))
    if (rest.length === 1) assign('medicalId', rest[0].id)
  }

  return roles
}
