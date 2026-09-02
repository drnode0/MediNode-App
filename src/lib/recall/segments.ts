// 伏せ字の範囲を「そのまま信じずに」整えてから、本文を段に切り分ける純関数。
// holes は jsonb から来る（DB に検査制約がなく、管理画面では人が手で直す）。
// 素直に body.slice(last, a) / body.slice(a, b) を回すと、次のように本文が壊れる:
//   - 並びが前後している → last が巻き戻り、いちど出した文字をもう一度出す（主張が読めなくなる）
//   - 範囲が重なっている → 重なった分の文字が二重に出る
//   - 本文の外を指す     → 中身のない伏せ字（答えの無い穴）が出る
//   - 負の数             → slice が末尾から切り出し、まったく別の場所が伏せ字になる
//   - 配列でない         → forEach が例外を投げ、画面が真っ白になる
// ここで全部落としてから切り分ける。段の text をつなぐと必ず body に戻る（テストで固定）。

export type Segment = { text: string; blank: boolean }

// 使える範囲だけを、前から順に、重なりを畳んで返す。
// 逆順の対（[12, 10] のような対）は入れ替えずに捨てる。書き手が 10〜12 のつもりだったのか
// 数を打ち間違えたのかを機械が決められないため、間違った場所を伏せるより出さない方を採る。
export function normalizeHoles(bodyLength: number, holes: unknown): [number, number][] {
  if (!Array.isArray(holes)) return []
  const len = Number.isInteger(bodyLength) && bodyLength > 0 ? bodyLength : 0
  const ranges: [number, number][] = []
  for (const h of holes) {
    if (!Array.isArray(h) || h.length !== 2) continue
    const [a, b] = h as unknown[]
    if (typeof a !== 'number' || typeof b !== 'number') continue
    if (!Number.isInteger(a) || !Number.isInteger(b)) continue
    if (a >= b) continue
    const s = Math.max(0, Math.min(len, a))
    const e = Math.max(0, Math.min(len, b))
    if (s >= e) continue // 本文の外を丸めた結果、幅が無くなったもの
    ranges.push([s, e])
  }
  ranges.sort((x, y) => x[0] - y[0] || x[1] - y[1])
  const merged: [number, number][] = []
  for (const r of ranges) {
    const last = merged[merged.length - 1]
    // 接している範囲も畳む（[0,3] と [3,5] を分けて出すと、間に文字の無い伏せ字が2つ並ぶ）
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  return merged
}

// 本文を「素の文字」と「伏せ字」の段に切り分ける。表（伏せる側）と裏（見せる側）で
// 同じ段の並びを使う。片方だけ並びがずれることが起きないよう、入口はこの1本だけにする。
export function segmentBody(body: string, holes: unknown): Segment[] {
  const text = typeof body === 'string' ? body : ''
  const ranges = normalizeHoles(text.length, holes)
  const out: Segment[] = []
  let last = 0
  for (const [a, b] of ranges) {
    if (a > last) out.push({ text: text.slice(last, a), blank: false })
    out.push({ text: text.slice(a, b), blank: true })
    last = b
  }
  if (last < text.length) out.push({ text: text.slice(last), blank: false })
  return out
}
