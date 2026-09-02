// 描画層。位置・状態・カメラを受けて Canvas 2D に描くだけ。配置と状態を知らない（差し替え可能にする）。
import type { Vec3 } from './layout'
import type { RecallState } from './types'
import { ESCAPE_THRESHOLD } from './srs'

export type Camera = { rotY: number; rotX: number; zoom: number }
export type Sprite = { claimId: string; home: Vec3; state: RecallState; phase: number }
export type Mark = { text: string; v: Vec3; level: 'genre' | 'page'; n: number }
export type LensMode = 'all' | 'kept'

// 球の半径と画面上の中心。描く・当たり判定・いま見ている区画の3か所が同じ値を見るための1か所。
// 画面側でこの計算をやり直さない（やり直すとタップ位置がずれる）。
export type View = { R: number; cx: number; cy: number }

export function viewport(W: number, H: number, cam: Camera, flyingCount = 0): View {
  // 山（離脱中の主張）が出ているあいだは球を上へ寄せる。3か所で同じだけ寄せる。
  return { R: Math.min(W, H) * 0.34 * cam.zoom, cx: W / 2, cy: H / 2 - 14 - (flyingCount ? 46 : 0) }
}

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

function noise(v: Vec3, t: number, ph: number) {
  return Math.sin(v[0] * 2.1 + t * 0.7 + ph) * 0.5 + Math.sin(v[1] * 2.7 + t * 0.9) * 0.3 + Math.sin(v[2] * 3.3 + t * 0.5 + ph) * 0.2
}

const isFading = (s: RecallState) => (s.kind === 'kept' || s.kind === 'settled') && s.remaining < ESCAPE_THRESHOLD

// 実際に描く位置（定位置からのゆらぎと、薄れかけの明滅を足したもの）。
// 当たり判定もこの関数を通す。見えている点と選ばれる点を二度と食い違わせないため、
// ずらし方はここだけに置く。動きを減らす設定のときは、ゆらぎも明滅も止める。
export function drawnPos(s: Sprite, t: number, reduced: boolean): Vec3 {
  if (reduced) return s.home
  const rr = 1 + noise(s.home, t, s.phase) * 0.05 + (isFading(s.state) ? Math.sin(t * 1.6 + s.phase) * 0.012 : 0)
  return [s.home[0] * rr, s.home[1] * rr, s.home[2] * rr]
}

// 当たり判定。drawFrame は Z の大きい順に描く＝ Z がいちばん小さい点が最後に描かれて上に乗る。
// なので半径内に複数あるときは、画面距離ではなく手前（Z が小さい方）を優先する。
// 山へ飛んでいる最中の主張は drawFrame 側で位置を差し替えるので、ここでは扱わない。
export function pickAt(sprites: Sprite[], cam: Camera, view: View, t: number, reduced: boolean, mx: number, my: number, radius: number): Sprite | null {
  const { R, cx, cy } = view
  let best: Sprite | null = null, bz = Infinity, bd = radius
  for (const s of sprites) {
    const p = project(drawnPos(s, t, reduced), cam, R, cx, cy)
    if (p.Z > R * 0.6) continue // 裏側は拾わない
    const d = Math.hypot(p.X - mx, p.Y - my)
    if (d >= radius) continue
    if (p.Z < bz || (p.Z === bz && d < bd)) { best = s; bz = p.Z; bd = d }
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
// 描くときに初めて canvas を触る（読み込むだけならブラウザ以外でも安全）。
// 2D コンテキストが取れない環境では null を返し、呼び出し側が点を描くのをやめる。
function sprites(): Record<string, HTMLCanvasElement> | null {
  if (spriteCache) return spriteCache
  const out: Record<string, HTMLCanvasElement> = {}
  for (const [k, v] of Object.entries(COLORS)) {
    const c = document.createElement('canvas'); c.width = c.height = 64
    const g = c.getContext('2d')
    if (!g) return null
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
    grad.addColorStop(0, v.color); grad.addColorStop(0.22, v.color); grad.addColorStop(1, 'rgba(0,0,0,0)')
    g.fillStyle = grad; g.globalAlpha = v.glow; g.fillRect(0, 0, 64, 64)
    out[k] = c
  }
  spriteCache = out
  return spriteCache
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
  const { R, cx, cy } = viewport(W, H, cam, a.flying.size)
  const SP = sprites()
  const ds = Math.max(0.4, Math.sqrt(520 / Math.max(a.sprites.length, 520)))
  const flyOrder = [...a.flying.keys()]
  const deckPos = new Map<string, { X: number; Y: number }>()
  type Item = { X: number; Y: number; Z: number; persp: number; s: Sprite; depth: number; fly: number }
  const list: Item[] = []
  for (const s of a.sprites) {
    const pr = project(drawnPos(s, t, a.reduced), cam, R, cx, cy)
    let X = pr.X, Y = pr.Y
    const fly = a.flying.get(s.claimId) ?? 0
    if (fly > 0) {
      const e = 1 - Math.pow(1 - fly, 2.2)
      const k = flyOrder.indexOf(s.claimId), span = Math.min(W * 0.3, 150)
      const mid = (flyOrder.length - 1) / 2, u = (k - mid) / Math.max(mid, 1)
      const tx = W / 2 + u * span, ty = H - 104 + u * u * 14
      // 弧を描いて飛ぶ動きは、動きを減らす設定のときは付けない（山へ真っ直ぐ移す）。
      const arc = a.reduced ? 0 : Math.sin(fly * Math.PI) * 90
      X = pr.X + (tx - pr.X) * e; Y = pr.Y + (ty - pr.Y) * e - arc
      if (fly >= 1) deckPos.set(s.claimId, { X, Y })
    }
    const depth = (1 - pr.Z / (R * 1.4)) * 0.5 + 0.5
    list.push({ X, Y, Z: fly > 0 ? -9999 : pr.Z, persp: pr.persp, s, depth, fly })
  }
  list.sort((p, q) => q.Z - p.Z)
  if (SP) for (const d of list) {
    const k = d.s.state.kind
    const c = COLORS[k]
    let size: number, alpha: number
    if (d.fly > 0) { size = 9.5 * ds * (1 + d.fly * 0.5); alpha = 0.5 + d.fly * 0.5 }
    else {
      size = c.size * ds * d.persp * (0.55 + d.depth * 0.75)
      // 奥行きの減衰は先に上限で止める。「記憶の残り」はそのあとに掛ける。
      // 順番を逆にすると、手前側では上限に張り付いて残りの差が消える（＝いちばん見たい所で見えない）。
      alpha = Math.min(1, c.alpha * Math.pow(d.depth, cam.zoom > 1.4 ? 3.2 : 1.7) + 0.05)
      if (k === 'kept' || k === 'settled') {
        const rem = d.s.state.remaining
        alpha *= 0.55 + 0.45 * rem   // 明るさ＝記憶の残り
        size *= 0.8 + 0.2 * rem      // 明るさだけに頼らず、粒の大きさでも残りを見せる
      }
      if (a.lens === 'kept' && k !== 'kept' && k !== 'settled') alpha *= 0.25
    }
    ctx.globalAlpha = alpha * (a.dimmed && d.fly === 0 ? 0.42 : 1)
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

// 「いま見ている区画」: 画面中央に最も近い手前のページ目印。
// 中心は viewport と同じ（球の中心）。投影と距離の基準を揃える。
export function hereMark(marks: Mark[], cam: Camera, view: View): Mark | null {
  if (cam.zoom < HERE_ZOOM) return null
  const { R, cx, cy } = view
  let best: Mark | null = null, bd = Infinity
  for (const m of marks) {
    if (m.level !== 'page') continue
    const p = project(m.v, cam, R, cx, cy)
    if (p.Z > 0) continue
    const d = Math.hypot(p.X - cx, p.Y - cy)
    if (d < bd) { bd = d; best = m }
  }
  return best
}
