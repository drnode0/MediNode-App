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

// 蔓の脇に描く印。近すぎるものは間引く——根元では実物の葉数が詰まっており
// （アリ=葉3・テントウムシ=葉4）、全件描くと文字が重なって読めなくなるため。
// 間引くのは描画だけで、目次（markPositions）からは落とさない。
export function sceneMarks(aboveTotal: number): ReturnType<typeof markPositions> {
  const marks = markPositions(aboveTotal)
  // 上（新しい側＝yが小さい側）から順に見て、直前に採った印とのyの差がMIN_MARK_GAP以上の
  // ものだけを採る。markPositionsはyが大きい順（古い順）に並んでいるので、末尾から遡る。
  const kept: ReturnType<typeof markPositions> = []
  let lastKeptY: number | null = null
  for (let i = marks.length - 1; i >= 0; i--) {
    const m = marks[i]
    if (lastKeptY === null || m.y - lastKeptY >= MIN_MARK_GAP) {
      kept.unshift(m)
      lastKeptY = m.y
    }
  }
  return kept
}
