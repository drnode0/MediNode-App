// 記事の扇形（純関数）。席の中の主張を、記事ごとの扇形に割り、節の順に並べる。
// 描画を知らない（field-render はここが返した角度を置くだけ）。
//
// 設計: 2026-09-04「惑星の中の体験」決定4（詳細ジャンル＝記事）。
// 席の下の区分を節ではなく記事にしたのは、主張が「節 → 記事 → 席」の入れ子で、
// 記事が二度目に読み返す単位だから（節は1記事に7つ前後あり、扇形にすると名前が置けない）。
//
// 名前について: カメラ側の `field.ts` に、位置を正面へ持ってくる角度を返す `angleOf` が
// 既にある。計画はここの関数も `angleOf` と呼んでいたが、同じ名前を2つ置けないので
// `fanOf` にした（返すのは1つの角度ではなく、扇形と主張の角度の一式でもある）。
// 席1つぶんの主張。呼び出し側が席で絞ってから渡す。
export type FanClaim = {
  claimId: string
  pageId: string
  pageTitle: string
  sectionKey: string
  // DB の行にだけある作成時刻。同じ節の中の並びに使う。抽出しただけの主張には無い。
  createdAt?: string
}

export type PageFan = { pageId: string; title: string; n: number; a0: number; a1: number }
export type Fan = { pages: PageFan[]; angles: Map<string, number> }

// 扇形どうしの隙間（ラジアン）。
export const FAN_GAP = 0.09
// 最初の扇形が始まる角度。真上から時計回りに並ぶ。
export const FAN_START = -Math.PI / 2
// 隙間が輪を食い尽くさないための上限。記事が 70 を超えると隙間だけで一周してしまい、
// 扇形の幅が負になる。そこまで来たら隙間の方を細くする。
export const FAN_GAP_MAX_SHARE = 0.25

const TAU = Math.PI * 2

// 節の順。節キーは番号付きH2（claim-text.ts の SECTION_HEAD_RE）から作られる `sec{n}` なので、
// n がそのまま文書の順になる。
// 読めないキー（同期の失敗・手で入れた値）は落とさず、その記事の末尾へ回す。
export function sectionOrderOf(sectionKey: string): number {
  const m = /^sec(\d+)$/.exec(sectionKey ?? '')
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY
}

// 並びの鍵。作成時刻が同じ（初回同期で入った行はすべて同じ now()）なら主張IDで決める。
// layout.ts と同じ作り方にしておく（球と惑星で並びの根拠を分けない）。
const orderKey = (c: FanClaim) => `${c.createdAt ?? ''} ${c.claimId}`

// 席の主張を、記事ごとの扇形に割る。
//
// 記事の順は「初出（いちばん古い主張）」。新しい記事は必ず後ろに付くので、
// 記事が増えても既存の記事の扇形の順序は変わらない。
// 記事の中の主張は「節の順 → 作られた順」。主張を足しても既存の相対順は変わらない
// （幅と絶対の角度は動く。球のらせんと違い、扇形は件数の比で決まるため）。
export function fanOf(claims: FanClaim[]): Fan {
  const angles = new Map<string, number>()
  if (!claims.length) return { pages: [], angles }

  const byPage = new Map<string, FanClaim[]>()
  for (const c of claims) {
    const list = byPage.get(c.pageId)
    if (list) list.push(c)
    else byPage.set(c.pageId, [c])
  }

  const groups = [...byPage.entries()]
    .map(([pageId, list]) => ({
      pageId,
      title: list[0].pageTitle,
      // 記事の順は作られた順で決める。節で並べ替えたあとの先頭を使うと、
      // 節0を持たない記事だけが前後して、記事の順が主張の増減で動いてしまう。
      first: list.reduce((k, c) => (orderKey(c) < k ? orderKey(c) : k), orderKey(list[0])),
      list: [...list].sort((a, b) =>
        sectionOrderOf(a.sectionKey) - sectionOrderOf(b.sectionKey) ||
        (orderKey(a) < orderKey(b) ? -1 : orderKey(a) > orderKey(b) ? 1 : 0)),
    }))
    .sort((a, b) => (a.first < b.first ? -1 : a.first > b.first ? 1 : 0))

  const total = claims.length
  const gap = Math.min(FAN_GAP, (TAU * FAN_GAP_MAX_SHARE) / groups.length)
  const span = TAU - gap * groups.length

  const pages: PageFan[] = []
  let a0 = FAN_START
  for (const g of groups) {
    const width = span * (g.list.length / total)
    pages.push({ pageId: g.pageId, title: g.title, n: g.list.length, a0, a1: a0 + width })
    // 主張は扇形を等分した真ん中に置く。端に寄せないので、隣の記事の主張と混ざらない。
    g.list.forEach((c, i) => angles.set(c.claimId, a0 + ((i + 0.5) / g.list.length) * width))
    a0 += width + gap
  }
  return { pages, angles }
}
