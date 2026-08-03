// 知の蔓のスクロール幾何（純関数）。DOMに触れない——描画とテストが同じ源を見る。
// 縦位置は「高さ」ではなく「葉の番号」に比例させる。複利のため高さに比例させると
// 初期の学びが潰れるため（葉900枚のとき最初の125枚は全体の0.2%）。
// これにより、どの時期の学びも等しい厚みで辿れる。高さは数字と「越えた印」で示す。
// ⚠️ 幾何の契約: このモジュールの aboveTotal は「地上の葉数」。地面の位置はこれで決まる。
// 地下茎（利用開始前の日付の歩）は含めない——含めると全y座標が静かにズレる。
import { passedMilestones, type Milestone } from './vine-ladder'
import type { Step } from './tower-steps'

// 1葉あたりの縦幅。葉身（約24px）に対する節間の比は14/24≒0.58。
// ⚠️ 何枚あっても縮めない——縮めた瞬間に「葉が潰れて塊になる」旧構造に戻る。
export const PX_PER_LEAF = 14
export const SCENE_TOP_PAD = 80     // 穂先の上の余白
export const GROUND_GAP = 40        // 最古の葉から地面まで
export const SCENE_BOTTOM_PAD = 60  // 地面の下の余白

// 葉の番号（1=最古）→ シーン上端からのy。新しいほど上。
export function leafY(index: number, aboveTotal: number): number {
  return SCENE_TOP_PAD + (aboveTotal - index) * PX_PER_LEAF
}

export function groundY(aboveTotal: number): number {
  return SCENE_TOP_PAD + Math.max(0, aboveTotal - 1) * PX_PER_LEAF + GROUND_GAP
}

// 地下茎ゾーンの深さ（持ち込みがあるときだけシーンの下端に足す）。
// 深さでは測らない——地下に目盛りは打たない（正典§7）。定数なのは件数に比例させないため。
export const RHIZOME_DEPTH = 150

export function sceneHeightPx(aboveTotal: number, undergroundDepth = 0): number {
  return groundY(aboveTotal) + SCENE_BOTTOM_PAD + undergroundDepth
}

// DOMに載せる葉の範囲。ビューポートの前後1画面分を余白に取る
// （スクロール中に葉が現れる瞬間が見えないようにするため）。
export function visibleRange(
  scrollTop: number, viewportH: number, aboveTotal: number, undergroundDepth = 0,
): { from: number; to: number } {
  if (aboveTotal <= 0) return { from: 1, to: 0 }
  // 実DOMの scrollTop が取りうる範囲へ丸める。片側だけ守ると、極端な値のとき
  // from/to が同じ端に張り付いて窓が1枚に潰れる（両端を独立に丸めているため）。
  const maxScroll = Math.max(0, sceneHeightPx(aboveTotal, undergroundDepth) - viewportH)
  const s = Math.min(Math.max(0, scrollTop), maxScroll)
  const yTop = s - viewportH
  const yBottom = s + viewportH * 2
  // y が小さいほど新しい。y → index は leafY の逆
  const idxAt = (y: number) => aboveTotal - (y - SCENE_TOP_PAD) / PX_PER_LEAF
  const hi = Math.ceil(idxAt(yTop))
  const lo = Math.floor(idxAt(yBottom))
  return {
    from: Math.max(1, Math.min(aboveTotal, lo)),
    to: Math.max(1, Math.min(aboveTotal, hi)),
  }
}

// 越えた実物を、越えた時点の葉の位置に置く。これがそのまま目次になる（§4）。
export function markPositions(
  aboveTotal: number,
): { milestone: Milestone; leafIndex: number; y: number }[] {
  return passedMilestones(aboveTotal)
    .filter((m) => m.leaves <= aboveTotal)
    .map((m) => ({ milestone: m, leafIndex: m.leaves, y: leafY(m.leaves, aboveTotal) }))
}

// 地下茎と地上部の分割（正典§7）。利用開始日より前の日付の歩は地下、それ以降が地上。
// 高さ・リプレイ・幾何はすべて above だけで測る。joinedIso が空なら分割しない
// （旧データとdevハーネスの互換）。日付は Date で比較する——Notion由来のオフセット付きISOと
// toISOString が混在するため、文字列比較は使えない。
export function splitByJoin(steps: Step[], joinedIso: string): { underground: Step[]; above: Step[] } {
  if (!joinedIso) return { underground: [], above: steps }
  const joined = new Date(joinedIso).getTime()
  const underground: Step[] = []
  const above: Step[] = []
  for (const s of steps) {
    const t = new Date(s.at).getTime()
    // 解釈できない日付は地上へ倒す（見えなくなる側に倒さない）
    if (Number.isFinite(t) && t < joined) underground.push(s)
    else above.push(s)
  }
  return { underground, above }
}

// まだ地上に芽を出していない知識のid（地下で眠っている分）。
// ⚠️ 件数をUIに出さない——「未読200件」は負債台帳そのもの（正典§7の必須条件2）。
export function dormantIds(steps: Step[], joinedIso: string): string[] {
  const { underground, above } = splitByJoin(steps, joinedIso)
  const surfaced = new Set(above.map((s) => s.id))
  return [...new Set(underground.map((s) => s.id))].filter((id) => !surfaced.has(id))
}

// 印は1つにつき2行の文字を持つので、これ未満に近づくと重なる。
export const MIN_MARK_GAP = 28
// 点景のラベルは1行なので狭くてよい。
export const MIN_SCENERY_GAP = 12

export type LaneMark =
  | { type: 'milestone'; y: number; milestone: Milestone; withLabel: boolean }
  | { type: 'scenery'; y: number; label: string; withLabel: boolean }
  | { type: 'undergroundDone'; y: number; withLabel: true }

// 右レーン（蔓の脇の印の帯）を1本で整列する（地雷2の解消）。
// 実物の印・時間の点景・地下が尽きた日は同じ余白に住むので、置けるラベルをここで一元に決める。
// 優先度: 地下が尽きた日 ＞ 実物の印（新しい側優先） ＞ 点景（新しい側優先）。
// ⚠️ 間引くのはラベルだけ。印そのもの（刻み・点）は全件返す——目次から飛んだ先には必ず刻みがある（地雷5）。
export function laneMarks(
  aboveTotal: number,
  scenery: { y: number; label: string }[],
  undergroundDoneY: number | null,
): LaneMark[] {
  const labeledYs: { y: number; gap: number }[] = []
  const canPlace = (y: number, gap: number) => labeledYs.every((l) => Math.abs(l.y - y) >= Math.max(gap, l.gap))
  const place = (y: number, gap: number) => labeledYs.push({ y, gap })

  const out: LaneMark[] = []
  if (undergroundDoneY !== null) {
    place(undergroundDoneY, MIN_MARK_GAP)
    out.push({ type: 'undergroundDone', y: undergroundDoneY, withLabel: true })
  }
  // 実物の印: 新しい側（yが小さい側）からラベルを配る
  const ms = markPositions(aboveTotal)
  for (let i = ms.length - 1; i >= 0; i--) {
    const m = ms[i]
    const withLabel = canPlace(m.y, MIN_MARK_GAP)
    if (withLabel) place(m.y, MIN_MARK_GAP)
    out.push({ type: 'milestone', y: m.y, milestone: m.milestone, withLabel })
  }
  // 点景: 新しい側からラベルを配る（実物の印より弱い）
  const sc = [...scenery].sort((a, b) => a.y - b.y)
  for (const s of sc) {
    const withLabel = canPlace(s.y, MIN_SCENERY_GAP)
    if (withLabel) place(s.y, MIN_SCENERY_GAP)
    out.push({ type: 'scenery', y: s.y, label: s.label, withLabel })
  }
  return out.sort((a, b) => a.y - b.y)
}
