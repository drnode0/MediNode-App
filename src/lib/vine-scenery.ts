// 時間の点景（正典§7の二層の下段）。実時間に紐づく季節の出来事で、誰にでも訪れる。
// 高さの印（実物ラダー）が年1〜8回の「稀で大きい」出会いなのに対し、点景は年12回の小さな出会い。
// 通知はしない——開いたときに見つけるもの。件数を数字でUIに出さない。
// 暦は固定月日・自然物のみ（行事・人工物は世界の嘘になる）。満月は毎月あって印が安売りになるので名月だけ。
import type { Step } from './tower-steps'
import { leafY, PX_PER_LEAF } from './vine-scroll'

export type SceneryEvent = { m: number; d: number; kind: string; label: string }
export const SCENERY_ALMANAC: readonly SceneryEvent[] = [
  { m: 1, d: 1, kind: 'hatsuhinode', label: '初日の出' },
  { m: 2, d: 20, kind: 'ume', label: '梅' },
  { m: 3, d: 28, kind: 'sakura', label: '桜' },
  { m: 4, d: 20, kind: 'tsubame', label: 'つばめ' },
  { m: 5, d: 20, kind: 'wakaba', label: '若葉' },
  { m: 6, d: 15, kind: 'hotaru', label: '蛍' },
  { m: 7, d: 20, kind: 'semi', label: '蝉しぐれ' },
  { m: 8, d: 12, kind: 'nagareboshi', label: '流れ星' },
  { m: 9, d: 15, kind: 'meigetsu', label: '名月' },
  { m: 10, d: 15, kind: 'kari', label: '雁' },
  { m: 11, d: 15, kind: 'momiji', label: '紅葉' },
  { m: 12, d: 10, kind: 'hatsuyuki', label: '初雪' },
]

const pad2 = (n: number) => String(n).padStart(2, '0')

// 期間内（from < t <= to）の点景を古い順に。日付はJSTで解釈する（日本の季節の暦）。
export function eventsBetween(fromIso: string, toIso: string): { kind: string; label: string; at: string }[] {
  const from = Date.parse(fromIso)
  const to = Date.parse(toIso)
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return []
  const out: { kind: string; label: string; at: string; t: number }[] = []
  const y0 = new Date(from).getUTCFullYear() - 1
  const y1 = new Date(to).getUTCFullYear() + 1
  for (let y = y0; y <= y1; y++) {
    for (const e of SCENERY_ALMANAC) {
      const at = `${y}-${pad2(e.m)}-${pad2(e.d)}T00:00:00+09:00`
      const t = Date.parse(at)
      if (t > from && t <= to) out.push({ kind: e.kind, label: e.label, at, t })
    }
  }
  return out.sort((a, b) => a.t - b.t).map(({ kind, label, at }) => ({ kind, label, at }))
}

export type SceneryMark = { kind: string; label: string; at: string; leafIndex: number; y: number }

// 点景の位置。葉kと葉k+1の間に、時間割合で置く（縦位置は葉の番号が基準＝正典§3を崩さない）。
// 葉が伸びなかった期間は同じ14pxの帯に重なる——空白が空白として読める（正典§7）。
// 最初の葉より前は置かない（蔓の記録が始まる前は蔓に無い）。
// 最後の葉より新しい分は穂先の上1葉ぶんに圧縮する——止まった人にも何かが起きる。
// ⚠️ leaves は leafSteps 済み（地上・attempt抜き）が契約。
export function sceneryMarks(leaves: Step[], nowIso: string, offset = 0): SceneryMark[] {
  const total = leaves.length
  if (total === 0) return []
  const times = leaves.map((s) => Date.parse(s.at)).filter(Number.isFinite).sort((a, b) => a - b)
  if (times.length === 0) return []
  const now = Date.parse(nowIso)
  const events = eventsBetween(new Date(times[0]).toISOString(), nowIso)
  return events.map((e) => {
    const t = Date.parse(e.at)
    let k = 0
    while (k < times.length && times[k] <= t) k++
    // k = tより古い葉の数（>=1。最初の葉より前はeventsBetweenが弾いている）
    let fraction: number
    if (k >= times.length) {
      const span = now - times[times.length - 1]
      fraction = span > 0 ? Math.max(0, Math.min(1, (t - times[times.length - 1]) / span)) : 0.5
    } else {
      const span = times[k] - times[k - 1]
      fraction = span > 0 ? (t - times[k - 1]) / span : 0.5
    }
    const kIndex = Math.min(k, total)
    return { kind: e.kind, label: e.label, at: e.at, leafIndex: kIndex, y: leafY(kIndex, total, offset) - fraction * PX_PER_LEAF }
  })
}
