// みんなの臨床疑問「受付中」の板（未解決CQボード）の純ロジック。
//
// 受付DB（CQ_INTAKE_DB_ID）のうち、作者が「ボード公開」をONにした未対応の疑問だけを
// 板に出す。投票（cq_votes）は Supabase 側で数え、ここでは並べ替えと表示文言だけを持つ。
//
// 設計方針（うるさくしない）:
// - 板は同時 BOARD_MAX 件まで。未解決が積み上がった見た目にしない。
//   （解決済み側の在庫が少ないうちに未解決を大量に並べると、
//     「訊いても返ってこない場所」に見えてしまう）
// - 票数は0のとき何も出さない。「0人が気になる」は寂しさを可視化するだけ。
// - 匿名性は受付DBの「掲載名の希望」に従う。未選択なら匿名扱い（安全側）。
//
// このファイルは fetch も Notion クライアントも含まない純関数群（vitest対象）。

// 板に同時に出す上限。控えの投稿は作者が「ボード公開」をONにして補充する。
export const BOARD_MAX = 5

// 「掲載名の希望」がこの値のときだけペンネームを表示する。
const PEN_NAME_ALLOWED = 'ペンネーム使用可'

export type BoardCq = {
  id: string
  title: string
  posterRole: string // 空なら職種を出さない
  posterName: string // 空なら「匿名さん」
  createdAt: string
}

export type RankedBoardCq = BoardCq & { voteCount: number }

// /api/cq/board がクライアントに返す形。voted は「自分が入れたか」だけで、
// 他人の投票者は誰にも返さない。
export type BoardCqWithVote = RankedBoardCq & { voted: boolean }

// notion.databases.query の results の最小形（必要なプロパティだけ読む）。
export type NotionIntakePage = {
  id: string
  created_time?: string
  properties?: Record<string, unknown>
}

type Prop = Record<string, unknown> | undefined

function propOf(page: NotionIntakePage, name: string): Prop {
  const p = page.properties?.[name]
  return (p as Record<string, unknown> | undefined) ?? undefined
}

function plainText(p: Prop, key: 'title' | 'rich_text'): string {
  const arr = p?.[key]
  if (!Array.isArray(arr)) return ''
  return arr
    .map((t) => String((t as { plain_text?: unknown })?.plain_text ?? ''))
    .join('')
    .trim()
}

function selectName(p: Prop): string {
  const sel = p?.select as { name?: unknown } | null | undefined
  return sel?.name ? String(sel.name) : ''
}

function checkbox(p: Prop): boolean {
  return p?.checkbox === true
}

// 受付DBの行 → 板の項目。公開ONかつ未対応のものだけを、必要な列だけ写して返す。
// 個人が特定できる項目（メール・通知先ユーザーID）は意図的に一切写さない。
export function toBoardCqs(pages: NotionIntakePage[]): BoardCq[] {
  const items: BoardCq[] = []
  for (const page of pages) {
    if (!checkbox(propOf(page, 'ボード公開'))) continue
    // 対応状態が入っている＝解決済み or 取り下げ。受付中の板からは外す。
    if (selectName(propOf(page, '対応状態'))) continue

    const title = plainText(propOf(page, '疑問'), 'title')
    if (!title) continue

    // 匿名が既定。「ペンネーム使用可」が明示されているときだけ名前を出す。
    const wantsPenName = selectName(propOf(page, '掲載名の希望')) === PEN_NAME_ALLOWED
    const posterName = wantsPenName ? plainText(propOf(page, 'ペンネーム'), 'rich_text') : ''

    items.push({
      id: page.id,
      title,
      posterRole: selectName(propOf(page, '投稿者職種')),
      posterName,
      createdAt: String(page.created_time || ''),
    })
  }
  return items
}

// 票の多い順（同数なら新しい順）に並べ、BOARD_MAX 件で切る。
// 票数で並べるのは、作者の執筆キューがそのまま需要順になるため。
export function rankBoard(items: BoardCq[], votes: Record<string, number>): RankedBoardCq[] {
  return items
    .map((i) => ({ ...i, voteCount: votes[i.id] ?? 0 }))
    .sort((a, b) => (b.voteCount - a.voteCount) || (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, BOARD_MAX)
}

// 票数の表示文言。0のときは空文字＝何も描かない。
export function voteCountLabel(count: number): string {
  return count > 0 ? `${count}人が気になっています` : ''
}
