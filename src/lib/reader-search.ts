// リーダー内検索の純関数。正規化は「長さ不変」が絶対条件 —
// 正規化後のindexをそのまま元文字列のindexとして使うため（NFKCは長さが変わるので使わない）。
import type { ReaderInline } from './reader-doc'

// 1コードポイント→1コードポイントの正規化: 小文字化・カタカナ→ひらがな・全角英数記号→半角。
// 変換で長さが変わる文字（ß等の特殊小文字化）は元のまま残す。
export function normalizeForSearch(s: string): string {
  let out = ''
  for (const ch of s) {
    const code = ch.codePointAt(0)!
    let norm: string
    if (code >= 0x30a1 && code <= 0x30f6) norm = String.fromCodePoint(code - 0x60)
    else if (code >= 0xff01 && code <= 0xff5e) norm = String.fromCodePoint(code - 0xfee0).toLowerCase()
    else norm = ch.toLowerCase()
    out += norm.length === ch.length ? norm : ch
  }
  return out
}

export type MatchRange = { start: number; end: number }

export function findMatchRanges(text: string, query: string): MatchRange[] {
  const q = normalizeForSearch(query.trim())
  if (!q) return []
  const t = normalizeForSearch(text)
  const out: MatchRange[] = []
  let i = 0
  for (;;) {
    const at = t.indexOf(q, i)
    if (at === -1) break
    out.push({ start: at, end: at + q.length })
    i = at + q.length
  }
  return out
}

export type InlineSegment = { text: string; mark: boolean }

// inlines を連結したテキスト上のレンジを、各 inline 内のセグメント列（mark有無つき）へ割り付ける。
export function inlineSegments(inlines: ReaderInline[], ranges: MatchRange[]): InlineSegment[][] {
  const out: InlineSegment[][] = []
  let offset = 0
  for (const inline of inlines) {
    const len = inline.text.length
    const end = offset + len
    const segs: InlineSegment[] = []
    let cursor = 0 // inline内の相対位置
    for (const r of ranges) {
      const s = Math.max(r.start - offset, 0)
      const e = Math.min(r.end - offset, len)
      if (e <= 0 || s >= len || e <= s) continue
      if (s > cursor) segs.push({ text: inline.text.slice(cursor, s), mark: false })
      segs.push({ text: inline.text.slice(s, e), mark: true })
      cursor = e
    }
    if (cursor < len) segs.push({ text: inline.text.slice(cursor), mark: false })
    if (segs.length === 0) segs.push({ text: inline.text, mark: false })
    out.push(segs)
    offset = end
  }
  return out
}
