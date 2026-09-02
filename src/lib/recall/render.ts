// 描画層。位置・状態・カメラを受けて Canvas 2D に描くだけ。配置と状態を知らない（差し替え可能にする）。
//
// 見え方の方針（2026-09-03 に入れ替え）:
//   ・球の実体を先に描く。点だけを浮かべると「粒の霧」に見えて、物体に見えない。
//   ・主張は円ではなく、流れの向きに寝かせた細長いかけらで描く。向きと大きさに個体差を持たせ、
//     「同じ形・同じ大きさ・等間隔」が同時に成り立たないようにする。
//   ・左上手前からの1方向の光を当てる。球面のどちら向きかで明るさが変わるので、
//     すべてが未着手（＝記憶による発光がない）でも、陰影のある1つの物体として見える。
//   ・「思い出せる度合い」は明るさと、かけらの中に出る芯で見せる。大きさには掛けない
//     （掛けるとシルエットが時間で痩せて、覚えているものほど大きいという別の意味に読める）。
import type { Vec3 } from './layout'
import { SPACING } from './layout'
import type { RecallState } from './types'
import { ESCAPE_THRESHOLD } from './srs'

export type Camera = { rotY: number; rotX: number; zoom: number }
export type Sprite = {
  claimId: string; home: Vec3; state: RecallState; phase: number
  dir: Vec3      // 流れの向き（home に直交する単位ベクトル）。画面上の傾きはこれを回して出す
  scale: number  // 大きさの個体差
  variant: number // かけらの形の種類
}
export type Mark = { text: string; v: Vec3; level: 'genre' | 'page'; n: number }
export type LensMode = 'all' | 'kept'

// 球の半径と画面上の中心。描く・当たり判定・いま見ている区画の3か所が同じ値を見るための1か所。
// 画面側でこの計算をやり直さない（やり直すとタップ位置がずれる）。
export type View = { R: number; cx: number; cy: number }

export function viewport(W: number, H: number, cam: Camera, flyingCount = 0): View {
  // 山（離脱中の主張）が出ているあいだは球を上へ寄せる。3か所で同じだけ寄せる。
  return { R: Math.min(W, H) * 0.40 * cam.zoom, cx: W / 2, cy: H / 2 - 14 - (flyingCount ? 46 : 0) }
}

// カメラの回転だけを掛ける（平行移動も遠近も掛けない）。向きベクトルに使う。
function rotate(v: Vec3, cam: Camera): Vec3 {
  const cyaw = Math.cos(cam.rotY), syaw = Math.sin(cam.rotY), cpit = Math.cos(cam.rotX), spit = Math.sin(cam.rotX)
  const X = v[0] * cyaw + v[2] * syaw
  let Z = -v[0] * syaw + v[2] * cyaw
  const Y = v[1] * cpit - Z * spit
  Z = v[1] * spit + Z * cpit
  return [X, Y, Z]
}

export function project(v: Vec3, cam: Camera, R: number, cx: number, cy: number) {
  const [X, Y, Z] = rotate(v, cam)
  const persp = 1 / (1 + Z / 4)
  return { X: cx + X * R * persp, Y: cy + Y * R * persp, Z: Z * R, persp, n: [X, Y, Z] as Vec3 }
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
  // 内側にだけ揺らす。外へ膨らませると、輪郭のかけらが球の外へ出て毛羽立って見える。
  const rr = 1 - Math.abs(noise(s.home, t, s.phase)) * 0.04 - (isFading(s.state) ? (1 + Math.sin(t * 1.6 + s.phase)) * 0.008 : 0)
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

// 光の向き（面から光源へ向かう単位ベクトル）。左・上・手前から当てる（手前は -z）。
const LIGHT: Vec3 = [-0.45, -0.62, -0.64]

// 状態ごとの見え方。len はかけらの長さ（隣との間隔に対する倍率）。
// color は本体、edge は上の縁（面の向きを出す細い筋）。
export type StateLook = { color: string; edge: string; len: number; alpha: number; core: boolean }
// 見た目一式。地の色が変わると、かけらの色・球の面・ラベルまで全部が変わるので1か所にまとめる。
export type Palette = {
  name: string
  bg: string                                   // 画面の地
  ball: { base: string; lit: string; shade: string; contour: string }
  ballAlpha: number                            // 球の面の不透明度（裏側の主張を透かす量）
  litFloor: number                             // 光が当たっていない側の見え方の下限（0で真っ暗）
  states: Record<RecallState['kind'], StateLook>
  core: string                                 // 「思い出せる度合い」の芯
  strand: string                               // 枝（同じページを繋ぐ筋）
  label: string                                // 目印の文字
  deck: string                                 // 山（離脱中）の光
}

// 夜。暗い地に、光を受けたかけらが浮かぶ。
export const PALETTE_NIGHT: Palette = {
  name: 'night',
  bg: '#05080e',
  ball: { base: 'rgba(7,12,19,0.92)', lit: 'rgba(58,92,116,0.42)', shade: 'rgba(2,4,8,0.55)', contour: 'rgba(126,196,222,0.30)' },
  ballAlpha: 0.9,
  litFloor: 0.26,
  states: {
    settled: { color: 'rgba(226,244,252,1)', edge: 'rgba(255,255,255,1)', len: 1.75, alpha: 0.95, core: true },
    kept:    { color: 'rgba(178,226,242,1)', edge: 'rgba(232,250,255,1)', len: 1.65, alpha: 0.92, core: true },
    touched: { color: 'rgba(150,180,199,1)', edge: 'rgba(198,222,236,1)', len: 1.45, alpha: 0.82, core: false },
    cold:    { color: 'rgba(96,116,138,1)', edge: 'rgba(132,158,180,1)', len: 1.30, alpha: 0.58, core: false },
  },
  core: 'rgba(255,255,255,1)',
  strand: '164,196,210',
  label: '#9fd8e6',
  deck: '111,215,232',
}

// 紙。明るい地に、墨のかけらが載る。濃さ＝思い出せる度合い。
// アプリの他の画面が白地なので、Recall だけが穴のように黒くならない。
export const PALETTE_PAPER: Palette = {
  name: 'paper',
  bg: '#e9eae6',
  // 球は「立体の玉」ではなく「紙にできた面」。陰影は浅く、輪郭の線で球だと分からせる。
  ball: { base: 'rgba(241,241,237,1)', lit: 'rgba(255,255,255,0.30)', shade: 'rgba(150,161,160,0.30)', contour: 'rgba(66,82,86,0.42)' },
  ballAlpha: 1,
  litFloor: 0.62,
  states: {
    // 濃い墨ほど「いま思い出せる」。edge は本体より淡く、めくれた側に紙の色が残る感じ。
    settled: { color: 'rgba(10,22,28,1)', edge: 'rgba(96,116,124,1)', len: 1.75, alpha: 1, core: true },
    kept:    { color: 'rgba(24,44,54,1)', edge: 'rgba(112,132,140,1)', len: 1.65, alpha: 0.95, core: true },
    touched: { color: 'rgba(62,82,92,1)', edge: 'rgba(140,156,162,1)', len: 1.45, alpha: 0.8, core: false },
    cold:    { color: 'rgba(112,128,136,1)', edge: 'rgba(170,181,184,1)', len: 1.30, alpha: 0.62, core: false },
  },
  core: 'rgba(14,124,149,1)',
  strand: '92,108,114',
  label: '#3d5a63',
  deck: '20,110,132',
}
const VARIANTS = 4
const S = 96 // かけらの下絵の一辺（描くのは十数〜数十pxなので、縮小前提で大きめに焼く）

// かけら1枚を焼く。x 方向に寝た、両端が尖った細長い形。円は使わない。
// 上の縁だけを明るくして、面がどちらを向いているかを出す（1方向の光と揃う）。
function shard(color: string, edge: string, variant: number): HTMLCanvasElement | null {
  const c = document.createElement('canvas'); c.width = c.height = S
  const g = c.getContext('2d')
  if (!g) return null
  const bend = [-0.15, -0.05, 0.05, 0.16][variant % VARIANTS] * S
  const half = (0.13 + 0.028 * (variant % VARIANTS)) * S
  const x0 = 0.03 * S, x1 = 0.97 * S, mid = S / 2
  const y0 = mid + bend * 0.35, y1 = mid + bend * 0.15
  // 本体。両端は形そのもので尖らせる（グラデーションで溶かさないので輪郭が残る）。
  g.fillStyle = color
  g.beginPath()
  g.moveTo(x0, y0)
  g.quadraticCurveTo(mid, mid + bend - half, x1, y1)
  g.quadraticCurveTo(mid, mid + bend + half * 0.62, x0, y0)
  g.closePath(); g.fill()
  // 上の縁。本体より細い形を少し上へずらして重ね、明るい筋にする。
  g.globalAlpha = 0.62
  g.fillStyle = edge
  g.beginPath()
  g.moveTo(x0 + 0.04 * S, y0 - half * 0.05)
  g.quadraticCurveTo(mid, mid + bend - half, x1 - 0.04 * S, y1 - half * 0.05)
  g.quadraticCurveTo(mid, mid + bend - half * 0.55, x0 + 0.04 * S, y0 - half * 0.05)
  g.closePath(); g.fill()
  return c
}

// 芯。「思い出せる度合い」が高いほど、かけらの中に細い筋が通る。
function core(color: string): HTMLCanvasElement | null {
  const c = document.createElement('canvas'); c.width = c.height = S
  const g = c.getContext('2d')
  if (!g) return null
  const grad = g.createLinearGradient(S * 0.2, 0, S * 0.8, 0)
  grad.addColorStop(0, 'rgba(0,0,0,0)'); grad.addColorStop(0.5, color); grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.beginPath()
  g.moveTo(S * 0.2, S / 2)
  g.quadraticCurveTo(S / 2, S / 2 - S * 0.055, S * 0.8, S / 2)
  g.quadraticCurveTo(S / 2, S / 2 + S * 0.055, S * 0.2, S / 2)
  g.closePath(); g.fill()
  return c
}

type Atlas = { shard: Record<string, HTMLCanvasElement[]>; core: HTMLCanvasElement }
// 見た目一式ごとに焼く（色が違えば別の下絵になる）。名前で引く。
const atlasCache = new Map<string, Atlas>()
// 描くときに初めて canvas を触る（読み込むだけならブラウザ以外でも安全）。
// 2D コンテキストが取れない環境では null を返し、呼び出し側が点を描くのをやめる。
function atlas(p: Palette): Atlas | null {
  const hit = atlasCache.get(p.name)
  if (hit) return hit
  const out: Record<string, HTMLCanvasElement[]> = {}
  for (const [k, v] of Object.entries(p.states)) {
    const list: HTMLCanvasElement[] = []
    for (let i = 0; i < VARIANTS; i++) {
      const c = shard(v.color, v.edge, i)
      if (!c) return null
      list.push(c)
    }
    out[k] = list
  }
  const cr = core(p.core)
  if (!cr) return null
  const made = { shard: out, core: cr }
  atlasCache.set(p.name, made)
  return made
}

export const MAX_ZOOM = 3.4
export const LABEL_GENRE_ZOOM = 1.25
export const LABEL_PAGE_ZOOM = 2.0
export const HERE_ZOOM = 1.8

// 球の実体。面・光・影を円の中だけに塗り、最後に輪郭を1本引く。
// 円で切り抜くのは、明るい地のときに縁がぼやけると物として見えないため。
// 点より先に（裏側の点より後に）描く。
function globe(ctx: CanvasRenderingContext2D, view: View, p: Palette) {
  const { R, cx, cy } = view
  const box = R * 2.4
  const fill = () => ctx.fillRect(cx - box / 2, cy - box / 2, box, box)
  ctx.globalAlpha = 1
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, R, 0, Math.PI * 2)
  ctx.clip()
  ctx.globalAlpha = p.ballAlpha
  ctx.fillStyle = p.ball.base
  fill()
  // 光。左上手前から当たっているぶんだけ面が持ち上がる。
  const lit = ctx.createRadialGradient(cx - R * 0.40, cy - R * 0.46, R * 0.04, cx - R * 0.22, cy - R * 0.26, R * 1.25)
  lit.addColorStop(0, p.ball.lit)
  lit.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = lit
  fill()
  // 影。反対側（右下）を沈める。
  const shade = ctx.createRadialGradient(cx + R * 0.62, cy + R * 0.66, R * 0.06, cx + R * 0.30, cy + R * 0.34, R * 1.30)
  shade.addColorStop(0, p.ball.shade)
  shade.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = shade
  fill()
  ctx.restore()
  // 輪郭。球であることを一目で分かるようにする1本。
  ctx.globalAlpha = 1
  ctx.beginPath()
  ctx.arc(cx, cy, R - 0.5, 0, Math.PI * 2)
  ctx.strokeStyle = p.ball.contour
  ctx.lineWidth = 1
  ctx.stroke()
}

// 枝を描く。手前側（Z<0）の続いている区間だけを1本の曲線にして、まとめて1回ずつ引く。
// かけらより先に描いて下に敷く。線が主役になると点が読めなくなるので、必ず薄く。
function drawStrands(ctx: CanvasRenderingContext2D, strands: Vec3[][], cam: Camera, view: View, p: Palette) {
  const { R, cx, cy } = view
  ctx.lineWidth = Math.max(0.7, R * 0.0045)
  ctx.lineCap = 'round'
  for (const line of strands) {
    const pts = line.map((v) => project(v, cam, R, cx, cy))
    let run: typeof pts = []
    const flush = () => {
      if (run.length >= 2) {
        // 奥ほど薄く。区間の平均の深さで1回だけ決める（区切りごとに引き直さない）。
        const depth = run.reduce((sum, q) => sum + (1 - q.Z / R) / 2, 0) / run.length
        ctx.globalAlpha = 0.16 + 0.24 * depth
        ctx.strokeStyle = `rgba(${p.strand},1)`
        ctx.beginPath()
        ctx.moveTo(run[0].X, run[0].Y)
        for (let i = 1; i < run.length - 1; i++) {
          ctx.quadraticCurveTo(run[i].X, run[i].Y, (run[i].X + run[i + 1].X) / 2, (run[i].Y + run[i + 1].Y) / 2)
        }
        ctx.quadraticCurveTo(run[run.length - 2].X, run[run.length - 2].Y, run[run.length - 1].X, run[run.length - 1].Y)
        ctx.stroke()
      }
      run = []
    }
    for (const q of pts) {
      if (q.Z < 0) run.push(q)
      else flush()
    }
    flush()
  }
  ctx.globalAlpha = 1
}

export type FrameArgs = {
  W: number; H: number; cam: Camera; sprites: Sprite[]
  flying: Map<string, number>   // claimId → 0..1（離脱の進み）。山の並び順は挿入順
  marks: Mark[]; t: number; reduced: boolean; dimmed: boolean; lens: LensMode
  palette?: Palette   // 省略時は夜。地の色ごとに、かけら・球・目印の色が一式で変わる
  strands?: Vec3[][]  // 同じページの主張を繋ぐ折れ線（球面上）。かけらの下に敷く
}

// 描いたあと、山に並んだ主張の画面位置を返す（タップ判定に使う）
export function drawFrame(ctx: CanvasRenderingContext2D, a: FrameArgs): Map<string, { X: number; Y: number }> {
  const { W, H, cam, t } = a
  const pal = a.palette ?? PALETTE_NIGHT
  ctx.clearRect(0, 0, W, H); ctx.fillStyle = pal.bg; ctx.fillRect(0, 0, W, H)
  const view = viewport(W, H, cam, a.flying.size)
  const { R, cx, cy } = view
  const AT = atlas(pal)
  // かけらの長さ。隣との間隔（SPACING*R）に比例させ、寄るほど間隔ほどには伸ばさない
  // （寄ると1つずつが離れて見える）。
  const unitLen = SPACING * R / Math.sqrt(cam.zoom)
  const flyOrder = [...a.flying.keys()]
  const deckPos = new Map<string, { X: number; Y: number }>()
  type Item = { X: number; Y: number; Z: number; persp: number; s: Sprite; depth: number; lit: number; ang: number; fly: number }
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
    // 手前 1・真裏 0。1 を超えないので、手前の主張の明るさが上限に張り付かない
    // （張り付くと、いちばん見たい所で「記憶の残り」の差が消える）。
    const depth = (1 - pr.Z / R) / 2
    // 面の向きと光の向きの内積。球面のどこにあるかだけで決まるので、未着手でも陰影が出る。
    const n = pr.n
    const lit = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2])
    // 画面上の傾き。向きベクトルをカメラで回して、その X/Y を見る（球の回転に付いてくる）。
    const d = rotate(s.dir, cam)
    const ang = Math.atan2(d[1], d[0])
    list.push({ X, Y, Z: fly > 0 ? -9999 : pr.Z, persp: pr.persp, s, depth, lit, ang, fly })
  }
  list.sort((p, q) => q.Z - p.Z)
  let painted = false
  const paintGlobe = () => {
    if (painted) return
    globe(ctx, view, pal)
    if (a.strands?.length) drawStrands(ctx, a.strands, cam, view, pal)
    painted = true
  }
  if (AT) for (const d of list) {
    // 裏側（Z>0）は球の実体より先に描く。球を透かしてぼんやり見える状態になる。
    if (d.Z <= 0) paintGlobe()
    const k = d.s.state.kind
    const c = pal.states[k]
    let len: number, alpha: number
    if (d.fly > 0) {
      len = unitLen * 1.9 * (1 + d.fly * 0.5); alpha = 0.5 + d.fly * 0.5
    } else {
      len = unitLen * c.len * d.s.scale * d.persp * (0.82 + d.depth * 0.28)
      // 光の当たり（未着手でも効く）と、奥行きの減衰。
      alpha = c.alpha * (pal.litFloor + (1 - pal.litFloor) * d.lit) * (0.12 + 0.88 * Math.pow(d.depth, cam.zoom > 1.4 ? 2.2 : 1.4))
      if (d.Z > 0) alpha *= 0.55 // 球の向こう側
      if (k === 'kept' || k === 'settled') alpha *= 0.55 + 0.45 * d.s.state.remaining // 明るさ＝記憶の残り
      if (a.lens === 'kept' && k !== 'kept' && k !== 'settled') alpha *= 0.25
      alpha = Math.min(1, alpha)
    }
    ctx.globalAlpha = alpha * (a.dimmed && d.fly === 0 ? 0.42 : 1)
    ctx.save()
    ctx.translate(d.X, d.Y)
    ctx.rotate(d.ang)
    ctx.drawImage(AT.shard[k][d.s.variant % VARIANTS], -len / 2, -len / 2, len, len)
    // 芯。残りが多いほど濃く出る。大きさを変えずに「まだ思い出せる」を見せる担当。
    if (c.core && d.fly === 0) {
      const rem = d.s.state.remaining
      ctx.globalAlpha = Math.min(1, alpha * (0.15 + 0.85 * rem))
      ctx.drawImage(AT.core, -len / 2, -len / 2, len, len)
    }
    ctx.restore()
  }
  paintGlobe()
  if (a.flying.size) {
    const gy = H - 100
    const g2 = ctx.createRadialGradient(W / 2, gy, 0, W / 2, gy, Math.min(W * 0.42, 220))
    g2.addColorStop(0, `rgba(${pal.deck},.10)`); g2.addColorStop(1, `rgba(${pal.deck},0)`)
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
      ctx.globalAlpha = 0.62 * fade; ctx.fillStyle = pal.label
      ctx.font = (m.level === 'genre' ? '500 15px' : '400 12px') + ' "Zen Kaku Gothic New",sans-serif'
      ctx.fillText(m.text, p.X, p.Y - 14)
      ctx.globalAlpha = 0.34 * fade; ctx.font = '400 10px "Zen Kaku Gothic New",sans-serif'
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
