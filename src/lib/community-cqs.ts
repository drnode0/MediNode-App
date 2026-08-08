// 「みんなが待っている問い」——/cq の第2の空に浮かぶ、まだ答えの出ていない疑問。
//
// 出どころは2つ。
//   作者のCQ … プレミアム配信DBの「知識レベル = ❓ CQ」。作者が普段どんなことを
//              疑問に思っているかがそのまま出る。プレミアムのインデックスから引く。
//   読者投稿 … 受付DBのうち作者が板に出した分（/api/cq/board）。従来の板と同じ中身。
//
// どちらも「気になる」を押せる（プレミアムのみ）。押す場所を2つに割らないため、
// 設定の受付中タブはこの空への導線にする。
//
// 自分の未解決CQとは同じ空に混ぜない。混ぜると自分ごとが薄まる——という理由で
// 画面は2つの空に分ける。ここが持つのは他人の問いだけ。
//
// このファイルは fetch も Algolia クライアントも含まない純関数群（vitest対象）。

// 第2の空に同時に浮かべる上限。自分の空（FLOAT_MAX）より少し多く許す。
export const COMMUNITY_MAX = 12

export type CommunityOrigin = 'author' | 'reader'

export type CommunityCq = {
  // 投票の鍵。作者CQはサブスクindexのobjectID、読者投稿は受付DBのページID。
  // どちらも cq_votes.cq_id にそのまま入る（あの列はただの text）。
  id: string
  title: string
  origin: CommunityOrigin
  // 読者投稿だけ。「匿名さん（看護師）」等。作者CQは空。
  posterLabel: string
  createdAt: string
}

export type CommunityCqWithVote = CommunityCq & { voteCount: number; voted: boolean }

// プレミアムindexのヒット → 作者のCQ。
// 知識レベルの絞り込みは呼ぶ側（Algoliaのfilters）で済ませる前提だが、
// 取りこぼしが混ざっても困るのでここでも題の有無だけは見る。
export function toAuthorCqs(hits: Array<Record<string, unknown>>): CommunityCq[] {
  const out: CommunityCq[] = []
  for (const h of hits) {
    const id = String(h.objectID || '')
    const title = String(h.title || '').trim()
    if (!id || !title) continue
    out.push({
      id,
      title,
      origin: 'author',
      posterLabel: '',
      createdAt: String(h.createdAt || h.lastEdited || ''),
    })
  }
  return out
}

// /api/cq/board の項目 → 読者投稿のCQ。
export function toReaderCqs(
  items: Array<{ id?: string; title?: string; posterRole?: string; posterName?: string; createdAt?: string }>,
): CommunityCq[] {
  const out: CommunityCq[] = []
  for (const i of items) {
    const id = String(i.id || '')
    const title = String(i.title || '').trim()
    if (!id || !title) continue
    const name = i.posterName ? `${i.posterName}さん` : '匿名さん'
    out.push({
      id,
      title,
      origin: 'reader',
      posterLabel: i.posterRole ? `${name}（${i.posterRole}）` : name,
      createdAt: String(i.createdAt || ''),
    })
  }
  return out
}

// 2つの出どころを1つの空にまとめる。並びは「票の多い順 → 新しい順」。
// 同じidが両方に出ることは無いが、念のため先勝ちで重複を落とす。
export function mergeCommunityCqs(
  author: CommunityCq[],
  reader: CommunityCq[],
  votes: { counts: Record<string, number>; mine: string[] },
  max: number = COMMUNITY_MAX,
): CommunityCqWithVote[] {
  const mine = new Set(votes.mine)
  const seen = new Set<string>()
  const merged: CommunityCqWithVote[] = []
  for (const cq of [...reader, ...author]) {
    if (seen.has(cq.id)) continue
    seen.add(cq.id)
    merged.push({ ...cq, voteCount: votes.counts[cq.id] || 0, voted: mine.has(cq.id) })
  }
  merged.sort((a, b) => {
    if (a.voteCount !== b.voteCount) return b.voteCount - a.voteCount
    if (a.createdAt !== b.createdAt) return b.createdAt > a.createdAt ? 1 : -1
    return a.id > b.id ? 1 : -1
  })
  return merged.slice(0, max)
}

// 泡に添える一行。0票のときは数字を出さない（「0人が気になる」は寂しさの可視化）。
export function communityVoteLabel(cq: CommunityCqWithVote): string {
  if (cq.voteCount > 0) return `${cq.voteCount}人が気にしています`
  return cq.origin === 'author' ? '筆者が気にしている問い' : cq.posterLabel
}
