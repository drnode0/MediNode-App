// 描画層。位置・状態・カメラを受けて Canvas 2D に描くだけ。配置と状態を知らない（差し替え可能にする）。
import type { Vec3 } from './layout'
import type { RecallState } from './types'
import { ESCAPE_THRESHOLD } from './srs'

export type Camera = { rotY: number; rotX: number; zoom: number }
export type Sprite = { claimId: string; home: Vec3; state: RecallState; phase: number }
export type Mark = { text: string; v: Vec3; level: 'genre' | 'page'; n: number }
export type LensMode = 'all' | 'kept'

export function project(v: Vec3, cam: Camera, R: number, cx: number, cy: number) {
  const x = v[0] * R, y = v[1] * R, z = v[2] * R
  const cyaw = Math.cos(cam.rotY), syaw = Math.sin(cam.rotY), cpit = Math.cos(cam.rotX), spit = Math.sin(cam.rotX)
  const X = x * cyaw + z * syaw
  let Z = -x * syaw + z * cyaw
  const Y = y * cpit - Z * spit
  Z = y * spit + Z * cpit
  const persp = 1 / (1 + Z / (R * 4))
  return { X: cx + X * persp, Y: cy + Y * persp, Z, persp }
}

export function pickAt(sprites: Sprite[], cam: Camera, R: number, cx: number, cy: number, mx: number, my: number, radius: number): Sprite | null {
  let best: Sprite | null = null, bd = radius
  for (const s of sprites) {
    const p = project(s.home, cam, R, cx, cy)
    if (p.Z > R * 0.6) continue
    const d = Math.hypot(p.X - mx, p.Y - my)
    if (d < bd) { bd = d; best = s }
  }
  return best
}

// 状態ごとのスプライト（事前描画）。フレーム内は drawImage だけにする。
const COLORS: Record<RecallState['kind'], { color: string; glow: number; size: number; alpha: number }> = {
  settled: { color: 'rgba(234,247,253,1)', glow: 1, size: 10, alpha: 0.95 },
  kept:    { color: 'rgba(191,233,245,1)', glow: 0.95, size: 9, alpha: 0.95 },
  touched: { color: 'rgba(178,202,216,1)', glow: 0.92, size: 7.2, alpha: 0.92 },
  cold:    { color: 'rgba(66,80,96,.9)', glow: 0.55, size: 4.8, alpha: 0.55 },
}
let spriteCache: Record<string, HTMLCanvasElement> | null = null
function sprites(): Record<string, HTMLCanvasElement> {
  if (spriteCache) return spriteCache
  const make = (color: string, glow: number) => {
    const c = document.createElement('canvas'); c.width = c.height = 64
    const g = c.getContext('2d')!
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, color); grad.addColorStop(0.22, color); grad.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grad; g.globalAlpha = glow; g.fillRect(0, 0, 64, 64)
    return c
  }
  spriteCache = Object.fromEntries(Object.entries(COLORS).map(([k, v]) => [k, make(v.color, v.glow)]))
  return spriteCache
}

function noise(v: Vec3, t: number, ph: number) {
  return Math.sin(v[0] * 2.1 + t * 0.7 + ph) * 0.5 + Math.sin(v[1] * 2.7 + t * 0.9) * 0.3 + Math.sin(v[2] * 3.3 + t * 0.5 + ph) * 0.2
}

export const MAX_ZOOM = 3.4
export const LABEL_GENRE_ZOOM = 1.25
export const LABEL_PAGE_ZOOM = 2.0
export const HERE_ZOOM = 1.8

export type FrameArgs = {
  W: number; H: number; cam: Camera; sprites: Sprite[]
  flying: Map<string, number>   // claimId → 0..1（離脱の進み）。山の並び順は挿入順
  marks: Mark[]; t: number; reduced: boolean; dimmed: boolean; lens: LensMode
}

// 描いたあと、山に並んだ主張の画面位置を返す（タップ判定に使う）
export function drawFrame(ctx: CanvasRenderingContext2D, a: FrameArgs): Map<string, { X: number; Y: number }> {
  const { W, H, cam, t } = a
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = '#05080e'; ctx.fillRect(0, 0, W, H)
  const R = Math.min(W, H) * 0.34 * cam.zoom
  const cx = W / 2, cy = H / 2 - 14 - (a.flying.size ? 46 : 0)
  const SP = sprites()
  const ds = Math.max(0.4, Math.sqrt(520 / Math.max(a.sprites.length, 520)))
  const flyOrder = [...a.flying.keys()]
  const deckPos = new Map<string, { X: number; Y: number }>()
  type Item = { X: number; Y: number; Z: number; persp: number; s: Sprite; depth: number; fly: number }
  const list: Item[] = []
  for (const s of a.sprites) {
    const wob = a.reduced ? 0 : noise(s.home, t, s.phase) * 0.05
    const fading = (s.state.kind === 'kept' || s.state.kind === 'settled') && s.state.remaining < ESCAPE_THRESHOLD
    const rr = 1 + wob + (fading ? Math.sin(t * 1.6 + s.phase) * 0.012 : 0)
    const v: Vec3 = [s.home[0] * rr, s.home[1] * rr, s.home[2] * rr]
    const pr = project(v, cam, R, cx, cy)
    let X = pr.X, Y = pr.Y
    const fly = a.flying.get(s.claimId) ?? 0
    if (fly > 0) {
      const e = 1 - Math.pow(1 - fly, 2.2)
      const k = flyOrder.indexOf(s.claimId), span = Math.min(W * 0.3, 150)
      const mid = (flyOrder.length - 1) / 2, u = (k - mid) / Math.max(mid, 1)
      const tx = W / 2 + u * span, ty = H - 104 + u * u * 14
      X = pr.X + (tx - pr.X) * e; Y = pr.Y + (ty - pr.Y) * e - Math.sin(fly * Math.PI) * 90
      if (fly >= 1) deckPos.set(s.claimId, { X, Y })
    }
    const depth = (1 - pr.Z / (R * 1.4)) * 0.5 + 0.5
    list.push({ X, Y, Z: fly > 0 ? -9999 : pr.Z, persp: pr.persp, s, depth, fly })
  }
  list.sort((p, q) => q.Z - p.Z)
  for (const d of list) {
    const k = d.s.state.kind
    const c = COLORS[k]
    let size: number, alpha: number
    if (d.fly > 0) { size = 9.5 * ds * (1 + d.fly * 0.5); alpha = 0.5 + d.fly * 0.5 }
    else {
      size = c.size * ds * d.persp * (0.55 + d.depth * 0.75)
      alpha = c.alpha * Math.pow(d.depth, cam.zoom > 1.4 ? 3.2 : 1.7)
      if (k === 'kept' || k === 'settled') alpha *= 0.55 + 0.45 * d.s.state.remaining // 明るさ＝記憶の残り
      if (a.lens === 'kept' && k !== 'kept' && k !== 'settled') alpha *= 0.25
    }
    ctx.globalAlpha = Math.min(1, alpha + 0.05) * (a.dimmed && d.fly === 0 ? 0.42 : 1)
    ctx.drawImage(SP[k], d.X - size, d.Y - size, size * 2, size * 2)
    if (k === 'settled') { ctx.globalAlpha = 0.12 * d.depth; ctx.drawImage(SP[k], d.X - size * 2.2, d.Y - size * 2.2, size * 4.4, size * 4.4) }
  }
  if (a.flying.size) {
    const gy = H - 100
    const g2 = ctx.createRadialGradient(W / 2, gy, 0, W / 2, gy, Math.min(W * 0.42, 220))
    g2.addColorStop(0, 'rgba(111,215,232,.08)'); g2.addColorStop(1, 'rgba(111,215,232,0)')
    ctx.globalAlpha = 1; ctx.fillStyle = g2; ctx.fillRect(0, gy - 90, W, 190)
  }
  // 目印（寄ったときだけ）
  if (cam.zoom > LABEL_GENRE_ZOOM) {
    ctx.textAlign = 'center'
    for (const m of a.marks) {
      const show = m.level === 'genre' ? cam.zoom < LABEL_PAGE_ZOOM : cam.zoom >= LABEL_PAGE_ZOOM
      if (!show) continue
      const p = project(m.v, cam, R, cx, cy)
      if (p.Z > -R * 0.15) continue
      if (p.X < 40 || p.X > W - 40 || p.Y < 50 || p.Y > H - 150) continue
      const fade = Math.min(1, (cam.zoom - LABEL_GENRE_ZOOM) * 2.2)
      ctx.globalAlpha = 0.55 * fade; ctx.fillStyle = '#9fd8e6'
      ctx.font = (m.level === 'genre' ? '500 15px' : '400 12px') + ' "Zen Kaku Gothic New",sans-serif'
      ctx.fillText(m.text, p.X, p.Y - 14)
      ctx.globalAlpha = 0.3 * fade; ctx.font = '400 10px "Zen Kaku Gothic New",sans-serif'
      ctx.fillText(`${m.n}主張`, p.X, p.Y + 2)
    }
  }
  ctx.globalAlpha = 1
  return deckPos
}

// 「いま見ている区画」: 画面中央に最も近い手前のページ目印
export function hereMark(marks: Mark[], cam: Camera, W: number, H: number): Mark | null {
  if (cam.zoom < HERE_ZOOM) return null
  const R = Math.min(W, H) * 0.34 * cam.zoom
  let best: Mark | null = null, bd = Infinity
  for (const m of marks) {
    if (m.level !== 'page') continue
    const p = project(m.v, cam, R, W / 2, H / 2 - 14)
    if (p.Z > 0) continue
    const d = Math.hypot(p.X - W / 2, p.Y - H / 2)
    if (d < bd) { bd = d; best = m }
  }
  return best
}
