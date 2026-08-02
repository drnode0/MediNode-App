// 知の蔓のスクロール幾何（純関数）。DOMに触れない——描画とテストが同じ源を見る。
// 縦位置は「高さ」ではなく「葉の番号」に比例させる。複利のため高さに比例させると
// 初期の学びが潰れるため（葉900枚のとき最初の125枚は全体の0.2%）。
// これにより、どの時期の学びも等しい厚みで辿れる。高さは数字と「越えた印」で示す。
import { passedMilestones, type Milestone } from './vine-ladder'

// 1葉あたりの縦幅。葉身に対する節間の比が実測の自然な帯（0.22〜0.40）に入る値。
// ⚠️ 何枚あっても縮めない——縮めた瞬間に「葉が潰れて塊になる」旧構造に戻る。
export const PX_PER_LEAF = 14
export const SCENE_TOP_PAD = 80     // 穂先の上の余白
export const GROUND_GAP = 40        // 最古の葉から地面まで
export const SCENE_BOTTOM_PAD = 60  // 地面の下の余白

// 葉の番号（1=最古）→ シーン上端からのy。新しいほど上。
export function leafY(index: number, total: number): number {
  return SCENE_TOP_PAD + (total - index) * PX_PER_LEAF
}

export function groundY(total: number): number {
  return SCENE_TOP_PAD + Math.max(0, total - 1) * PX_PER_LEAF + GROUND_GAP
}

export function sceneHeightPx(total: number): number {
  return groundY(total) + SCENE_BOTTOM_PAD
}

// DOMに載せる葉の範囲。ビューポートの前後1画面分を余白に取る
// （スクロール中に葉が現れる瞬間が見えないようにするため）。
export function visibleRange(
  scrollTop: number, viewportH: number, total: number,
): { from: number; to: number } {
  if (total <= 0) return { from: 1, to: 0 }
  // 実DOMの scrollTop が取りうる範囲へ丸める。片側だけ守ると、極端な値のとき
  // from/to が同じ端に張り付いて窓が1枚に潰れる（両端を独立に丸めているため）。
  const maxScroll = Math.max(0, sceneHeightPx(total) - viewportH)
  const s = Math.min(Math.max(0, scrollTop), maxScroll)
  const yTop = s - viewportH
  const yBottom = s + viewportH * 2
  // y が小さいほど新しい。y → index は leafY の逆
  const idxAt = (y: number) => total - (y - SCENE_TOP_PAD) / PX_PER_LEAF
  const hi = Math.ceil(idxAt(yTop))
  const lo = Math.floor(idxAt(yBottom))
  return {
    from: Math.max(1, Math.min(total, lo)),
    to: Math.max(1, Math.min(total, hi)),
  }
}

// 越えた実物を、越えた時点の葉の位置に置く。これがそのまま目次になる（§4）。
export function markPositions(
  total: number,
): { milestone: Milestone; leafIndex: number; y: number }[] {
  return passedMilestones(total)
    .filter((m) => m.leaves <= total)
    .map((m) => ({ milestone: m, leafIndex: m.leaves, y: leafY(m.leaves, total) }))
}
