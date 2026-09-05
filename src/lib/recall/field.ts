// 惑星の並びとカメラ（純関数）。canvas を知らない。
//
// 席＝惑星を環状に並べ、視点A（外から見る）と視点B（中心＝自分）の2つの投影を持つ。
// 判断の式（段の判定・倍率・傾きの頭打ち・慣性・移る時間）は field-camera.ts にあり、
// ここはその値を組み立てて位置と投影を返すだけ。
//
// 出所: 惑星のラフ（設計 2026-09-04「惑星の中の体験」決定3・5・6）。
// ラフはビルド後の1ファイルで変数名が潰れていたため、定数と式を写し取って書き直した。
import type { Vec3 } from './layout'
import { seatCenter } from './layout'
import { GENRE_SEATS, genreLabel, isRetiredSeat } from './genres'
import { coreKindOf, type CoreKind } from './cores'
import { planetRadius, R_RING_OUTER } from './field-layout'
import { clusterPointOf, CLUSTER_ZOOM, CLUSTER_PITCH, CLUSTER_MID_ZOOM } from './field-cluster'
import {
  OUTSIDE_STAGE, INSIDE_STAGE, PROJECT_SCALE, RING_PITCH,
  zoomForPlanet, eyeDistanceOf, wrapNear, lerp, lerpZoom,
  type FieldStage, type FieldCenter,
} from './field-camera'

export type { FieldStage, FieldCenter }

// 並べ方。ring が既定（09-03 決定）。sphere は球の配置をそのまま使う逃げ道で、
// 環状で行きたいジャンルに辿り着けなかったときの戻り先として残す。
// cluster は隠しコマンドの宇宙（族ごとの星団。設計 2026-09-05 再計画 §4.3）。
export type FieldMode = 'ring' | 'sphere' | 'cluster'

export type FieldSeat = {
  slot: number
  label: string
  kind: CoreKind
  at: Vec3      // リングの上の位置（単位円）
  r: number     // 惑星の半径（リングの半径を 1 とした値）
  n: number     // その席の主張数
}

// カメラ。視点A は rotY / rotX / zoom / focus、視点B は rotY / pitch / fov / eye を使う。
// 1つの型に両方を持たせるのは、切り替えのあいだ両方を混ぜて動かすため。
export type FieldCamera = {
  rotY: number
  rotX: number
  zoom: number
  focus: Vec3
  pitch: number
  fov: number
  eye: Vec3
}

export type Projected = { X: number; Y: number; Z: number; k: number }
// 視点B では背後の点が投影できない。描かない合図として null を返す。
export type Projector = (v: Vec3) => Projected | null

// ── 並び ────────────────────────────────────────
// 席番号から環状の位置。廃番の席のぶんは詰めない（穴が空くが、席番号と位置の対応が動かない）。
export function ringPointOf(slot: number, total: number, mode: FieldMode = 'ring'): Vec3 {
  if (mode === 'sphere') return seatCenter(slot)
  if (mode === 'cluster') return clusterPointOf(slot)
  const a = (slot / total) * Math.PI * 2
  return [Math.cos(a), 0, Math.sin(a)]
}

// 惑星どうしが重ならないよう、全体を一律に縮める倍率。
// 1 以上なら縮めない。個々の席だけを縮めると、主張の多い席が不当に小さくなる。
function fitScale(seats: FieldSeat[]): number {
  let k = 1
  for (let i = 0; i < seats.length; i++) {
    for (let j = i + 1; j < seats.length; j++) {
      const a = seats[i], b = seats[j]
      const d = Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1], a.at[2] - b.at[2])
      const need = (a.r + b.r) * R_RING_OUTER
      if (need > 0) k = Math.min(k, (d * 0.98) / need)
    }
  }
  return k
}

// 席ごとの主張数から惑星を並べる。counts の添字が席番号。
export function fieldLayout(counts: number[], mode: FieldMode = 'ring'): FieldSeat[] {
  const total = GENRE_SEATS.length
  const max = counts.reduce((m, n) => Math.max(m, n ?? 0), 0)
  const seats: FieldSeat[] = []
  for (let slot = 0; slot < total; slot++) {
    if (isRetiredSeat(slot)) continue
    const n = counts[slot] ?? 0
    seats.push({
      slot,
      label: genreLabel(slot),
      kind: coreKindOf(slot),
      at: ringPointOf(slot, total, mode),
      r: planetRadius(n, max),
      n,
    })
  }
  // 星団では一律縮小を掛けない（掛けると惑星が 5px になる。設計 §4.3）。
  const k = mode === 'cluster' ? 1 : fitScale(seats)
  return k >= 1 ? seats : seats.map((s) => ({ ...s, r: s.r * k }))
}

// ── 正面の席 ────────────────────────────────────
// 回したあとの奥行き。小さいほど手前。
export const depthAt = (at: Vec3, rotY: number): number =>
  -at[0] * Math.sin(rotY) + at[2] * Math.cos(rotY)

// その位置を正面へ持ってくる回転角。
export const angleOf = (at: Vec3): number => Math.atan2(at[2], at[0]) + Math.PI / 2

// いま正面にいる席。視点A・B で同じ関数を使う（見出しと帯の光る席が食い違わないため）。
export function frontSlotOf(seats: FieldSeat[], rotY: number): number | null {
  let best: FieldSeat | null = null
  for (const s of seats) {
    if (!best || depthAt(s.at, rotY) < depthAt(best.at, rotY)) best = s
  }
  return best ? best.slot : null
}

// 中景で見る先。環状ではリングの手前側（回したあとの奥行きが最小の点）を見る。
// 帯から選んだ惑星が来る場所と同じなので、帯で選ぶと惑星が画面の真ん中に来る。
export function focusPointOf(mode: FieldMode, rotY: number): Vec3 {
  if (mode !== 'ring') return [0, 0, 0]
  return [Math.sin(rotY), 0, -Math.cos(rotY)]
}

// ── 視点B の足元 ────────────────────────────────
// 中心に立ったときの前・右・上。pitch を上げると下を向く。
export type InsideBasis = { f: Vec3; r: Vec3; u: Vec3 }

export function insideBasis(rotY: number, pitch: number): InsideBasis {
  const h: Vec3 = [Math.sin(rotY), 0, -Math.cos(rotY)]
  const right: Vec3 = [Math.cos(rotY), 0, Math.sin(rotY)]
  const c = Math.cos(pitch), s = Math.sin(pitch)
  return {
    f: [h[0] * c, -s, h[2] * c],
    r: right,
    u: [h[0] * s, c, h[2] * s],
  }
}

// 近景で惑星へ歩み寄ったときの目の位置。惑星の手前に立つ。
export function eyeFor(seat: FieldSeat, rotY: number, pitch: number): Vec3 {
  const d = eyeDistanceOf(seat.r)
  const b = insideBasis(rotY, pitch)
  return [seat.at[0] - b.f[0] * d, seat.at[1] - b.f[1] * d, seat.at[2] - b.f[2] * d]
}

// ── 投影 ────────────────────────────────────────
// 視点A。弱い遠近を掛けてから、見る先が画面の中心に来るようずらす。
export function projectOutside(cam: FieldCamera, W: number, H: number): Projector {
  const f = Math.min(W, H) * PROJECT_SCALE * cam.zoom
  const cy = Math.cos(cam.rotY), sy = Math.sin(cam.rotY)
  const cx2 = Math.cos(cam.rotX), sx = Math.sin(cam.rotX)
  const raw = (v: Vec3) => {
    const x = v[0] * cy + v[2] * sy
    const z0 = -v[0] * sy + v[2] * cy
    const y = v[1] * cx2 - z0 * sx
    const z = v[1] * sx + z0 * cx2
    const p = 1 / (1 + z * 0.22)
    return { X: x * f * p, Y: -y * f * p, Z: z, k: f * p }
  }
  const at = raw(cam.focus)
  const cx = W / 2, cyy = H / 2
  return (v: Vec3) => {
    const q = raw(v)
    return { X: cx + q.X - at.X, Y: cyy + q.Y - at.Y, Z: q.Z, k: q.k }
  }
}

// 視点B。中心に立った透視投影。真横より後ろに回った点は描かない。
export const INSIDE_NEAR_CLIP = 0.03

export function projectInside(cam: FieldCamera, W: number, H: number): Projector {
  const m = Math.min(W, H) / 2 / Math.tan(cam.fov / 2)
  const b = insideBasis(cam.rotY, cam.pitch)
  const e = cam.eye
  const cx = W / 2, cy = H / 2
  return (v: Vec3) => {
    const d: Vec3 = [v[0] - e[0], v[1] - e[1], v[2] - e[2]]
    const z = d[0] * b.f[0] + d[1] * b.f[1] + d[2] * b.f[2]
    if (z < INSIDE_NEAR_CLIP) return null
    const x = d[0] * b.r[0] + d[1] * b.r[1] + d[2] * b.r[2]
    const y = d[0] * b.u[0] + d[1] * b.u[1] + d[2] * b.u[2]
    return { X: cx + (x / z) * m, Y: cy - (y / z) * m, Z: z, k: m / z }
  }
}

export function makeProjector(cam: FieldCamera, center: FieldCenter, W: number, H: number): Projector {
  return center === 'inside' ? projectInside(cam, W, H) : projectOutside(cam, W, H)
}

// ── 段を移る ────────────────────────────────────
const copy = (c: FieldCamera): FieldCamera => ({ ...c, focus: [...c.focus] as Vec3, eye: [...c.eye] as Vec3 })

// 段（と惑星）ごとのカメラの目標。数はすべて field-camera.ts の表から取る。
export function cameraFor(
  cam: FieldCamera, center: FieldCenter, stage: FieldStage, seat: FieldSeat | null, mode: FieldMode = 'ring',
): FieldCamera {
  const next = copy(cam)
  if (center === 'inside') {
    if (stage === 'near' && seat) {
      const rotY = wrapNear(angleOf(seat.at), cam.rotY)
      const pitch = INSIDE_STAGE.near.pitch
      return { ...next, rotY, pitch, fov: INSIDE_STAGE.near.fov, eye: eyeFor(seat, rotY, pitch) }
    }
    const s = stage === 'far' ? INSIDE_STAGE.far : INSIDE_STAGE.mid
    return { ...next, pitch: s.pitch, fov: s.fov, eye: [0, s.eyeY, 0] }
  }
  if (stage === 'near' && seat) {
    return {
      ...next,
      rotY: wrapNear(angleOf(seat.at), cam.rotY),
      rotX: OUTSIDE_STAGE.near.rotX,
      zoom: zoomForPlanet(seat.r),
      focus: [...seat.at] as Vec3,
    }
  }
  if (stage === 'far') {
    if (mode === 'cluster') return { ...next, rotX: CLUSTER_PITCH, zoom: CLUSTER_ZOOM, focus: [0, 0, 0] }
    return { ...next, rotX: OUTSIDE_STAGE.far.rotX, zoom: OUTSIDE_STAGE.far.zoom, focus: [0, 0, 0] }
  }
  // 星団の中景は、寄せた惑星そのものを見る（輪のように手前側の一点ではない）。
  if (mode === 'cluster') {
    return { ...next, rotX: CLUSTER_PITCH, zoom: CLUSTER_MID_ZOOM, focus: seat ? [...seat.at] as Vec3 : [0, 0, 0] }
  }
  return {
    ...next,
    rotX: OUTSIDE_STAGE.mid.rotX,
    zoom: OUTSIDE_STAGE.mid.zoom,
    focus: focusPointOf(mode, cam.rotY),
  }
}

const lerp3 = (a: Vec3, b: Vec3, k: number): Vec3 => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]

// 飛んでいる途中のカメラ。倍率だけ対数で混ぜる。
export function lerpCamera(from: FieldCamera, to: FieldCamera, k: number): FieldCamera {
  return {
    rotY: lerp(from.rotY, to.rotY, k),
    rotX: lerp(from.rotX, to.rotX, k),
    zoom: lerpZoom(from.zoom, to.zoom, k),
    focus: lerp3(from.focus, to.focus, k),
    pitch: lerp(from.pitch, to.pitch, k),
    fov: lerp(from.fov, to.fov, k),
    eye: lerp3(from.eye, to.eye, k),
  }
}

// 開いたときのカメラ。中景・視点A・既定8倍で、正面の席を1つ決めておく。
export function initialCamera(seats: FieldSeat[], mode: FieldMode = 'ring'): FieldCamera {
  const first = seats.find((s) => s.n > 0) ?? seats[0]
  const rotY = first ? angleOf(first.at) : 0
  return {
    rotY,
    rotX: RING_PITCH,
    zoom: OUTSIDE_STAGE.mid.zoom,
    focus: focusPointOf(mode, rotY),
    pitch: INSIDE_STAGE.mid.pitch,
    fov: INSIDE_STAGE.mid.fov,
    eye: [0, INSIDE_STAGE.mid.eyeY, 0],
  }
}
