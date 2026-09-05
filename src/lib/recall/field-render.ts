// 描画層。位置・状態・カメラを受けて Canvas 2D に描くだけ。
// 半径・明るさ・要約は field-layout.ts、カメラの判断は field-camera.ts が決める。
// ここは式を持たない（持たせると、テストできない場所に判断が移ってしまう）。
//
// 見え方の共通則（設計 2026-09-04）:
//   ・線画。面・塗り・影は使わない。光（INK_HALO）は動きと離れかけにだけ
//   ・奥行きで明暗を分ける（芯は14段。段が狭いと針金細工が平たく見える）
//   ・空の惑星はモヤだけを描く。輪郭も芯も描かない（決定10・11）
//   ・動きを減らす設定では、芯の動き・明滅・弧・輪の自転を止める
import type { RecallState } from './types'
import type { Vec3 } from './layout'
import { coreLayers, DEPTH_STEPS, MIN_ALPHA, type CoreLayer } from './core-shapes'
import { CORE_SPIN, CORE_TILT, coreIndividual, type CoreKind } from './cores'
import {
  placeOf, lookOf, gainAlpha, HAZE_ALPHA, HALO_MAX,
  EDGE_CIRCLES, EDGE_LABELS, INK_HALO, R_COLD,
  type PlanetSummary,
} from './field-layout'
import { easeInOutCubic, RING_PITCH, INSIDE_STAGE } from './field-camera'
import type { PageFan } from './field-angle'
import {
  makeProjector, type FieldCamera, type FieldCenter, type FieldSeat, type Projector,
} from './field'
import { DARK_PALETTE, inkOf, type FieldPalette } from './field-palette'

// 地と文字の色は field-palette.ts（ダーク／ライトの2組）。ここは受け取った1組で描くだけ。
// FIELD_BG はダークの地。ライトの地は LIGHT_PALETTE.bg。
export const FIELD_BG = DARK_PALETTE.bg

// ── 芯（族）─────────────────────────────────────
export type CoreDrawOptions = {
  cx: number
  cy: number
  CR: number           // 芯の半径（画面上のピクセル）
  kind: CoreKind
  t: number            // 秒。動きを減らす設定では 0 のまま渡す
  reduced: boolean
  yaw?: number         // 手回しを足した向き。省略すると族の自転だけ
  pitch?: number
  minA?: number        // 光が当たっていない側の下限
  dim?: number         // 全体の濃さ（奥の惑星を薄くするのに使う）
  density?: number
  palette?: FieldPalette  // 省略するとダーク（芯の線の定義そのままの色）
}

function strokeSegments(ctx: CanvasRenderingContext2D, seg: number[]) {
  ctx.beginPath()
  for (let i = 0; i < seg.length; i += 4) {
    ctx.moveTo(seg[i], seg[i + 1])
    ctx.lineTo(seg[i + 2], seg[i + 3])
  }
  ctx.stroke()
}

// 族の芯を1つ描く。線を奥行きで DEPTH_STEPS 段に分け、段ごとにまとめて引く
//（1本ずつ引くと、線の本数だけ状態の切り替えが起きて描画が重くなる）。
export function drawCore3D(ctx: CanvasRenderingContext2D, o: CoreDrawOptions) {
  if (!(o.CR > 0)) return
  const t = o.reduced ? 0 : o.t
  const minA = o.minA ?? MIN_ALPHA
  const yaw = o.yaw ?? t * CORE_SPIN[o.kind]
  const pitch = o.pitch ?? CORE_TILT[o.kind]
  const cy = Math.cos(yaw), sy = Math.sin(yaw)
  const cp = Math.cos(pitch), sp = Math.sin(pitch)
  const fade = o.dim ?? 1
  const pal = o.palette ?? DARK_PALETTE
  const layers: CoreLayer[] = coreLayers(o.kind, t, { density: o.density, glow: !o.reduced })
  ctx.lineCap = 'round'
  for (const layer of layers) {
    const scale = layer.scale ?? 1
    const dim = layer.dim ?? 1
    const bold = !!layer.bold
    const buckets: number[][] = Array.from({ length: DEPTH_STEPS }, () => [])
    const glowSeg: number[] = []
    for (let li = 0; li < layer.lines.length; li++) {
      const line = layer.lines[li]
      const gpos = layer.glow ? (Array.isArray(layer.glow.pos) ? layer.glow.pos[li] ?? 0 : layer.glow.pos) : 0
      let prev: [number, number, number] | null = null
      for (const pt of line) {
        const x = pt[0] * scale, y = pt[1] * scale, z = pt[2] * scale
        const rx = x * cy + z * sy
        const rz = -x * sy + z * cy
        const ry = y * cp - rz * sp
        const dz = y * sp + rz * cp
        const cur: [number, number, number] = [o.cx + rx * o.CR, o.cy - ry * o.CR, dz]
        if (prev) {
          const depth = ((cur[2] + prev[2]) / 2 + 1) / 2
          const k = Math.max(0, Math.min(DEPTH_STEPS - 1, Math.floor(depth * DEPTH_STEPS)))
          buckets[k].push(prev[0], prev[1], cur[0], cur[1])
          // 光は線に沿って走る。4つ目の値が「線に沿った位置」。
          if (layer.glow && pt.length > 3) {
            const wrap = layer.glow.wrap
            const along = pt[3] as number
            const d = wrap ? ((along - gpos + wrap * 1.5) % wrap) - wrap / 2 : along - gpos
            if (Math.abs(d) < layer.glow.w) glowSeg.push(prev[0], prev[1], cur[0], cur[1])
          }
        }
        prev = cur
      }
    }
    ctx.strokeStyle = inkOf(pal, layer.ink)
    for (let i = 0; i < DEPTH_STEPS; i++) {
      const seg = buckets[i]
      if (!seg.length) continue
      const f = (i + 0.5) / DEPTH_STEPS
      ctx.globalAlpha = (bold ? 0.45 + 0.55 * f : minA + (1 - minA) * f * f) * dim * fade
      ctx.lineWidth = bold ? 1.05 + 0.95 * f : 0.45 + 1.05 * f
      strokeSegments(ctx, seg)
    }
    if (glowSeg.length) {
      ctx.strokeStyle = inkOf(pal, INK_HALO)
      ctx.globalAlpha = 0.85 * fade
      ctx.lineWidth = 1.6
      strokeSegments(ctx, glowSeg)
    }
    ctx.globalAlpha = 1
  }
}

// ── 惑星に置くもの ───────────────────────────────
// 主張1つ。状態（居場所5段）を持つ。旧 sphere の seen は持たない（決定1で廃止）。
export type ClaimDot = {
  claimId: string
  pageId: string
  state: RecallState
  angle: number    // 輪の上の角度（段3で記事の扇形に置き換わる）
  jitter: number   // いちばん外の霧のゆらぎ
  phase: number    // 明滅の位相
}

export type Planet = {
  seat: FieldSeat
  summary: PlanetSummary
  dots: ClaimDot[]
  pages?: PageFan[]   // 記事の扇形（段3）。渡されなければ扇形も記事名も描かない
}

// 輪から棚へ離れた主張。dir 1 で棚へ、-1 で輪へ戻る。
export type FlyingDot = {
  claimId: string
  from: { X: number; Y: number }
  p: number
  dir: 1 | -1
  again: boolean
  slot: number
}

export type FieldFrameArgs = {
  W: number
  H: number
  cam: FieldCamera
  center: FieldCenter
  planets: Planet[]
  nearSlot: number | null    // 近景で見ている惑星
  handYaw: number            // 近景で手回しした角度（輪と芯を一体で回す）
  lensPageId: string | null  // 記事名を押したときのレンズ
  flying: FlyingDot[]
  t: number                  // 秒
  reduced: boolean
  edgeAlpha: number          // 境目の名前の濃さ（field-camera が決める）
  palette: FieldPalette      // 地と線の色（ダーク／ライト）
  shelfBottom?: number       // 棚の、画面の下端からの高さ（px）。下の帯・ボタンより上に置く
  // 何を描くか（設計 2026-09-05 再計画 §4.2・§4.3）。省略した項目は今までどおり描く。
  show?: {
    edgeLabels?: boolean; edgeCircles?: boolean; fans?: boolean; pageLabels?: boolean
    planetLabels?: boolean; labelMinR?: number; nebula?: boolean; fanAlpha?: number
  }
  // 族の名前（宇宙の遠景だけ）。呼び出し側が遠景のときだけ渡す。
  familyLabels?: Array<{ text: string; sub: string; kind: CoreKind; at: Vec3 }>
  // 族名を押したあと、その族の惑星の名前と族の名詞を出す（until まで。最後の 600ms で薄れる）。
  // until は performance.now() の ms。a.t は秒なので a.t * 1000 と比べる。
  familyFocus?: { kind: CoreKind; until: number } | null
}

export type FieldHits = {
  planets: Array<{ slot: number; X: number; Y: number; S: number; Z: number }>
  dots: Array<{ claimId: string; X: number; Y: number }>
  pages: Array<{ pageId: string; x: number; y: number; w: number; h: number }>
  shelf: Array<{ claimId: string; X: number; Y: number }>
  dotPos: Map<string, { X: number; Y: number }>
  families: Array<{ kind: CoreKind; x: number; y: number; w: number; h: number }>
}

// 惑星の名前・件数を出す下限の大きさ。これより小さいと文字が惑星に重なる。
const LABEL_MIN_R = 22
// 芯の半径は惑星の半径のこの割合。
const CORE_R_RATIO = 0.42
// 記事の扇形と記事名の高度。
const ARC_R = 3.62
const ARC_LABEL_R = 3.98
// 棚（画面の下の横一列）。画面の下端からの高さは呼び出し側が渡す
//（帯やボタンの下に潜ると、棚をタップできない。2026-09-04 に実画面で確認）。
const SHELF_GAP = 52
export const SHELF_BOTTOM_DEFAULT = 34
const SHELF_LIFT = 60
// 境目の名前を輪のどこに置くか探すときの、輪をなぞる点の数。
const EDGE_LABEL_SAMPLES = 48
// モヤ（決定10）。塗らず、短い線を散らして像を結ばせない。
const HAZE_STROKES = 12
// モヤの粒の数の上限と、1粒の長さの上限（画面のピクセル）。
// 長さを惑星の大きさに比例させると、寄ったときに引っかき傷のような長い線になる
//（2026-09-04 に実機で確認）。粒は画面上で常に短いままにして、
// 惑星が大きく見えるときは「長く」ではなく「数を増やして」濃さを保つ。
const HAZE_STROKES_MAX = 72
const HAZE_LEN_MAX = 3.5

// 書体（R10）。英字は幾何学の細字・字間広め、日本語は同じ細さのゴシック。
// これまで指定していた "Zen Kaku Gothic New" は読み込まれておらず、端末のゴシックで出ていた。
export const FONT_LATIN = '300 11px Jost, "Helvetica Neue", sans-serif'
export const FONT_JP = '300 10.5px "Noto Sans JP", sans-serif'

// next/font は書体名を生成するので、実際の family 名は CSS 変数 --font-jost から読む
// （読めない環境＝テストや古い端末では FONT_LATIN のまま）。1回だけ読んで覚える。
let latinFamily: string | null = null
export function fontLatin(): string {
  if (latinFamily === null) {
    const v = typeof document !== 'undefined'
      ? getComputedStyle(document.documentElement).getPropertyValue('--font-jost').trim()
      : ''
    latinFamily = v ? `${v}, "Helvetica Neue", sans-serif` : 'Jost, "Helvetica Neue", sans-serif'
  }
  return `300 11px ${latinFamily}`
}
// 族名の字間と、族名を押したときの表示（3.2秒・最後の 600ms で薄れる）。
const FAMILY_TRACKING = '0.32em'
const FADE_MS = 600
// 族名を星団の上端からどれだけ離すか（px）。
const FAMILY_LABEL_GAP = 12
// 字間の px（FONT_LATIN の 11px × 0.32）。ctx.letterSpacing に対応しない端末で使う。
const FAMILY_TRACKING_PX = 11 * 0.32
// ctx.letterSpacing に対応しているか（Chrome 99+・Safari 17.4+。古い iOS では未対応）。
const SPACED = typeof CanvasRenderingContext2D !== 'undefined'
  && 'letterSpacing' in CanvasRenderingContext2D.prototype

// 1字ずつ字間を空けて置き、置いた幅を返す（中央そろえ）。
function spacedText(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, gap: number): number {
  const widths = [...text].map((ch) => ctx.measureText(ch).width)
  const total = widths.reduce((s, w) => s + w, 0) + gap * Math.max(0, text.length - 1)
  const prev = ctx.textAlign
  ctx.textAlign = 'left'
  let x = cx - total / 2
  for (let i = 0; i < widths.length; i++) {
    ctx.fillText([...text][i], x, y)
    x += widths[i] + gap
  }
  ctx.textAlign = prev
  return total
}

const hash = (a: number, b: number) => {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) >>> 0
  h = (h ^ (h >>> 13)) >>> 0
  h = Math.imul(h, 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// 空の惑星のモヤ。席番号だけから決まるので、毎フレーム散らし直さない。
//
// 散らす範囲は、主張がある惑星と同じ広さ（いちばん外の霧 R_COLD まで）にする。
// 2026-09-04 に実機で2つの失敗を見て、いまの形になった。
//   ・輪郭のすぐ内側に詰めると、線が中心で交わって小さな星に見えた
//   ・向きを接線に揃えると、破線の円＝輪郭に見えた（決定10 は輪郭を引かないと決めている）
//   ・長さを惑星の大きさに比例させると、中景で引っかき傷のような長い線になった
// 広く散らし、向きは揃えず、粒は画面上で短いまま。半径は平方根で配って内側に溜まらないようにする。
function drawHaze(ctx: CanvasRenderingContext2D, pal: FieldPalette, slot: number, X: number, Y: number, S: number, depth: number) {
  ctx.strokeStyle = pal.outline
  ctx.lineWidth = 0.6
  ctx.globalAlpha = gainAlpha(HAZE_ALPHA, pal.alphaGain) * depth
  ctx.beginPath()
  const strokes = Math.max(HAZE_STROKES, Math.min(HAZE_STROKES_MAX, Math.round(S * 1.8)))
  const len = Math.min(S * 0.5, HAZE_LEN_MAX)
  for (let i = 0; i < strokes; i++) {
    const a = hash(slot, i * 3 + 1) * Math.PI * 2
    const r = S * (0.8 + Math.sqrt(hash(slot, i * 3 + 2)) * (R_COLD - 0.8))
    const dir = hash(slot, i * 3 + 3) * Math.PI * 2
    const x = X + Math.cos(a) * r, y = Y + Math.sin(a) * r
    ctx.moveTo(x - Math.cos(dir) * len / 2, y - Math.sin(dir) * len / 2)
    ctx.lineTo(x + Math.cos(dir) * len / 2, y + Math.sin(dir) * len / 2)
  }
  ctx.stroke()
  ctx.globalAlpha = 1
}

// 宇宙で、まだ何も残っていない席をガスで覆う（R8）。淡い光の霧を2枚重ねてゆっくり漂わせる。
// 面を塗る唯一の例外。動きを減らす設定では t が 0 で渡るので止まる。
function drawNebula(
  ctx: CanvasRenderingContext2D, pal: FieldPalette, slot: number,
  X: number, Y: number, S: number, depth: number, t: number,
) {
  for (let i = 0; i < 2; i++) {
    const a = hash(slot, i * 5 + 1) * Math.PI * 2 + t * 0.04 * (i ? 1 : -1)
    const rr = S * (0.3 + hash(slot, i * 5 + 2) * 0.8)
    const cx = X + Math.cos(a) * rr, cy = Y + Math.sin(a) * rr * 0.7
    const rad = S * (1.3 + hash(slot, i * 5 + 3) * 0.7)
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad)
    g.addColorStop(0, pal.outline)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.globalAlpha = gainAlpha(0.07, pal.alphaGain) * depth
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(cx, cy, rad, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

// 族名を押してからの残り時間を 0..1 で。最後の 600ms で薄れる。
const focusFade = (focus: FieldFrameArgs['familyFocus'], kind: CoreKind, tSec: number): number =>
  focus && focus.kind === kind ? Math.max(0, Math.min(1, (focus.until - tSec * 1000) / FADE_MS)) : 0

// 1コマ描く。返り値はタップ判定の位置（描いた場所と選ばれる場所を二度と食い違わせない）。
export function drawField(ctx: CanvasRenderingContext2D, a: FieldFrameArgs): FieldHits {
  const { W, H, cam, center, t, reduced, palette: pal } = a
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = pal.bg
  ctx.fillRect(0, 0, W, H)

  const project: Projector = makeProjector(cam, center, W, H)
  const inside = center === 'inside'
  const hits: FieldHits = { planets: [], dots: [], pages: [], shelf: [], dotPos: new Map(), families: [] }
  const T = reduced ? 0 : t
  // 輪の自転。内側ほど速い（深く残した主張が最も速く回る）。
  const spin = reduced ? 0 : T * 0.05
  const flyingIds = new Set(a.flying.map((f) => f.claimId))
  const show = {
    edgeLabels: true, edgeCircles: true, fans: true, pageLabels: true,
    planetLabels: true, labelMinR: LABEL_MIN_R, nebula: false, fanAlpha: 1,
    ...(a.show ?? {}),
  }

  type Shown = { planet: Planet; X: number; Y: number; Z: number; S: number }
  const shown: Shown[] = []
  for (const planet of a.planets) {
    const p = project(planet.seat.at)
    if (!p) continue
    shown.push({ planet, X: p.X, Y: p.Y, Z: p.Z, S: planet.seat.r * p.k })
  }
  // 奥から描く。
  shown.sort((x, y) => y.Z - x.Z)

  for (const s of shown) {
    const { planet, X, Y, S } = s
    const seat = planet.seat
    const margin = S * 4.2
    if (X + margin < 0 || X - margin > W || Y + margin < 0 || Y - margin > H) continue

    const depth = inside
      ? Math.max(0.4, Math.min(1, 0.4 + 0.6 * Math.min(1, 1.15 / s.Z)))
      : 0.45 + 0.55 * ((1 - s.Z) / 2)
    const isNear = a.nearSlot === seat.slot
    const ind = coreIndividual(seat.slot)
    const sum = planet.summary
    // 近景では、輪と芯を一体で掴んで回す。族の動きは止めない。
    const handYaw = isNear ? a.handYaw : 0
    const handPitch = isNear ? (inside ? cam.pitch - INSIDE_STAGE.near.pitch : cam.rotX - RING_PITCH) * 0.6 : 0

    // 空の惑星はモヤだけ。輪郭も芯も描かない（決定10・11）。
    if (sum.haze) {
      if (show.nebula) drawNebula(ctx, pal, seat.slot, X, Y, S, depth, T)
      else drawHaze(ctx, pal, seat.slot, X, Y, S, depth)
    }
    if (sum.core) {
      // 奥行きの薄さは dim で渡す。外側で globalAlpha を掛けても、
      // drawCore3D が段ごとに上書きするので効かない。
      drawCore3D(ctx, {
        cx: X, cy: Y, CR: S * CORE_R_RATIO * ind.scale,
        kind: seat.kind, t: T * ind.rate, reduced, dim: depth,
        yaw: T * ind.rate * CORE_SPIN[seat.kind] + handYaw,
        pitch: ind.tilt + handPitch,
        palette: pal,
      })
    }
    if (sum.outline) {
      ctx.globalAlpha = gainAlpha(sum.outlineAlpha, pal.alphaGain) * depth
      ctx.strokeStyle = pal.outline
      ctx.lineWidth = 0.8
      ctx.beginPath()
      ctx.arc(X, Y, S, 0, Math.PI * 2)
      ctx.stroke()
    }
    // 離れかけの光。惑星が小さくて点が読めない段（遠景・中景）の要約。
    if (S < LABEL_MIN_R && sum.halos > 0) {
      ctx.fillStyle = inkOf(pal, INK_HALO)
      for (let i = 0; i < Math.min(HALO_MAX, sum.halos); i++) {
        ctx.globalAlpha = 0.85 * depth
        const ang = -Math.PI * 0.35 + i * 0.22
        ctx.beginPath()
        ctx.arc(X + Math.cos(ang) * (S + 5), Y + Math.sin(ang) * (S + 5), 1.6, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // 輪の面。惑星ごとに少し傾ける（同じ角度で並ぶと、環状が板に見える）。
    const ringTilt = ind.tilt * 0.35
    const ringYaw = isNear && !inside ? a.handYaw : 0
    const onRing = (angle: number, r: number, y = 0) => {
      const c = Math.cos(angle + ringYaw) * r
      const sn = Math.sin(angle + ringYaw) * r
      return project([
        seat.at[0] + c * seat.r,
        seat.at[1] + (y + sn * Math.sin(ringTilt)) * seat.r,
        seat.at[2] + sn * Math.cos(ringTilt) * seat.r,
      ])
    }

    const dotScale = Math.max(1, Math.min(4.4, S / 38))
    for (const dot of planet.dots) {
      const place = placeOf(dot.state.kind, dot.state.remaining, dot.jitter)
      const at = onRing(dot.angle + spin / place.r, place.r, place.y)
      if (!at) continue
      // 棚にいるあいだも輪の上の居場所は控える。覚えたときに輪へ帰る先が、
      // 剥がれた時点の古い位置ではなく、いまの居場所（保持力1＝内側）になる。
      hits.dotPos.set(dot.claimId, { X: at.X, Y: at.Y })
      if (flyingIds.has(dot.claimId)) continue
      const look = lookOf(dot.state.kind, dot.state.remaining, T, reduced, dot.phase)
      let alpha = gainAlpha(look.alpha, pal.alphaGain) * depth
      // レンズ。押した記事だけ明るく、他は沈む。
      if (isNear && a.lensPageId && dot.pageId !== a.lensPageId) alpha *= 0.22
      const size = look.size * dotScale * (inside ? (at.k * seat.r) / S : 1)
      const ink = inkOf(pal, look.ink)
      if (look.glow && S > LABEL_MIN_R) {
        ctx.globalAlpha = alpha * pal.glow
        ctx.fillStyle = ink
        ctx.beginPath()
        ctx.arc(at.X, at.Y, size * 2.6, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = alpha
      ctx.fillStyle = ink
      ctx.beginPath()
      ctx.arc(at.X, at.Y, size, 0, Math.PI * 2)
      ctx.fill()
      if (isNear) hits.dots.push({ claimId: dot.claimId, X: at.X, Y: at.Y })
    }

    // 境目の名前（決定7）。近景に入った直後だけ、輪の境目に薄い円と名前。
    if (isNear && a.edgeAlpha > 0) {
      ctx.strokeStyle = pal.label
      ctx.lineWidth = 0.7
      for (const r of show.edgeCircles ? EDGE_CIRCLES : []) {
        ctx.globalAlpha = 0.16 * a.edgeAlpha
        ctx.beginPath()
        let started = false
        for (let i = 0; i <= 64; i++) {
          const q = onRing((i / 64) * Math.PI * 2, r)
          if (!q) continue
          if (started) ctx.lineTo(q.X, q.Y)
          else { ctx.moveTo(q.X, q.Y); started = true }
        }
        if (started) ctx.stroke()
      }
      ctx.font = FONT_JP
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = pal.label
      for (const [r, text] of show.edgeLabels ? EDGE_LABELS : []) {
        // 名前は輪の左端に添える（設計 決定7）。輪の上の固定の角度に置くと、
        // どの席を見ているかで名前が画面のあちこちへ動く（輪の角度は世界の側で決まるため）。
        // 描くのに使うのと同じ点を辿って、いちばん左に来た点を選ぶ。
        let at: { X: number; Y: number } | null = null
        for (let i = 0; i < EDGE_LABEL_SAMPLES; i++) {
          const q = onRing((i / EDGE_LABEL_SAMPLES) * Math.PI * 2, r)
          if (q && (!at || q.X < at.X)) at = q
        }
        if (!at) continue
        ctx.globalAlpha = 0.8 * a.edgeAlpha
        ctx.fillText(text, at.X - 6, at.Y)
      }
      ctx.textBaseline = 'alphabetic'
    }

    // 記事の扇形と記事名（段3）。
    if (isNear && planet.pages?.length && show.fans && show.fanAlpha > 0) {
      ctx.font = FONT_JP
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const page of planet.pages) {
        const lit = !a.lensPageId || a.lensPageId === page.pageId
        ctx.globalAlpha = (lit ? 0.22 : 0.08) * depth * show.fanAlpha
        ctx.strokeStyle = pal.label
        ctx.lineWidth = 1
        ctx.beginPath()
        let started = false
        for (let i = 0; i <= 24; i++) {
          const q = onRing(page.a0 + ((page.a1 - page.a0) * i) / 24, ARC_R)
          if (!q) continue
          if (started) ctx.lineTo(q.X, q.Y)
          else { ctx.moveTo(q.X, q.Y); started = true }
        }
        if (started) ctx.stroke()
        const label = show.pageLabels ? onRing((page.a0 + page.a1) / 2, ARC_LABEL_R) : null
        if (!label) continue
        const text = `${page.title}  ${page.n}`
        const w = ctx.measureText(text).width + 14
        ctx.globalAlpha = (lit ? 0.85 : 0.35) * depth
        ctx.fillStyle = pal.labelBg
        ctx.fillRect(label.X - w / 2, label.Y - 9, w, 18)
        ctx.fillStyle = a.lensPageId === page.pageId ? inkOf(pal, INK_HALO) : pal.label
        ctx.fillText(text, label.X, label.Y)
        hits.pages.push({ pageId: page.pageId, x: label.X - w / 2, y: label.Y - 9, w, h: 18 })
      }
      ctx.textBaseline = 'alphabetic'
    }

    // 惑星の名前（中景）。近景では上の見出しが担うので出さない。
    // 輪の配置（show 省略）は今までどおり件数と離れかけを添える。
    // 宇宙（show.planetLabels=false）は文字を族名だけに絞り（R6）、族名を押した族の惑星だけ
    // 名前が一時的に浮かぶ。
    const nameFade = focusFade(a.familyFocus, seat.kind, a.t)
    if (!isNear && (show.planetLabels ? S > show.labelMinR : nameFade > 0) && seat.n > 0) {
      ctx.textAlign = 'center'
      ctx.fillStyle = pal.label
      ctx.font = FONT_JP
      if (show.planetLabels) {
        ctx.globalAlpha = 0.6 * depth
        ctx.fillText(`${seat.label}　${seat.n}`, X, Y + S * 3.5 + 14)
        if (sum.halos > 0) {
          ctx.fillStyle = inkOf(pal, INK_HALO)
          ctx.fillText(`離れかけ ${sum.halos}`, X, Y + S * 3.5 + 28)
        }
      } else {
        ctx.globalAlpha = 0.9 * nameFade * depth
        const c = ctx as unknown as { letterSpacing: string }
        c.letterSpacing = '0.12em'
        ctx.fillText(seat.label, X, Y + Math.min(S * 2.1, 64) + 12)
        c.letterSpacing = '0px'
      }
    }
    hits.planets.push({ slot: seat.slot, X, Y, S, Z: s.Z })
  }

  // 族の名前（宇宙の遠景だけ。R6・R7）。細い幾何学書体・広い字間・大文字。
  // 置き場所は星団の投影範囲の上端の少し上（族の中心の真上に置くと惑星に重なる。設計 §4.3）。
  // 族の名詞は押したときだけ下に出す（R7・R12）。
  if (a.familyLabels?.length) {
    const c = ctx as unknown as { letterSpacing: string }
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const f of a.familyLabels) {
      const q = project(f.at)
      if (!q) continue
      // その族の惑星（ガスを含む）の、画面での上端。
      let top = q.Y
      for (const s of shown) {
        if (s.planet.seat.kind !== f.kind) continue
        top = Math.min(top, s.Y - s.S * (s.planet.summary.haze ? 2.0 : R_COLD))
      }
      q.Y = top - FAMILY_LABEL_GAP
      const d = 0.45 + 0.55 * ((1 - q.Z) / 2)
      const text = f.text.toUpperCase()
      ctx.font = fontLatin()
      ctx.fillStyle = pal.label
      ctx.globalAlpha = 0.55 * d
      let w: number
      if (SPACED) {
        c.letterSpacing = FAMILY_TRACKING
        ctx.fillText(text, q.X + 2, q.Y)
        w = ctx.measureText(text).width + 24
      } else {
        // ctx.letterSpacing に対応していない端末（古い iOS Safari 等）では1字ずつ置く。
        w = spacedText(ctx, text, q.X + 2, q.Y, FAMILY_TRACKING_PX) + 24
      }
      const subAlpha = 0.7 * focusFade(a.familyFocus, f.kind, a.t)
      if (f.sub && subAlpha > 0) {
        ctx.font = FONT_JP
        c.letterSpacing = '0.1em'
        ctx.globalAlpha = subAlpha * d
        ctx.fillText(f.sub, q.X, q.Y + 15)
      }
      hits.families.push({ kind: f.kind, x: q.X - w / 2, y: q.Y - 12, w, h: 34 })
    }
    c.letterSpacing = '0px'
    ctx.textBaseline = 'alphabetic'
    ctx.globalAlpha = 1
  }

  // 棚。輪の位置から画面の下へ、手前で大きくなりながら浅い弧で移る。
  const n = a.flying.length
  for (let i = 0; i < n; i++) {
    const f = a.flying[i]
    const toX = W / 2 + (i - (n - 1) / 2) * SHELF_GAP
    const toY = H - (a.shelfBottom ?? SHELF_BOTTOM_DEFAULT)
    const from = f.dir === 1 ? f.from : hits.dotPos.get(f.claimId) ?? f.from
    const e = easeInOutCubic(Math.max(0, Math.min(1, f.p)))
    const midX = (from.X + toX) / 2
    const midY = Math.min(from.Y, toY) - SHELF_LIFT
    const x = (1 - e) * (1 - e) * from.X + 2 * (1 - e) * e * midX + e * e * toX
    const y = (1 - e) * (1 - e) * from.Y + 2 * (1 - e) * e * midY + e * e * toY
    const r = 3 + 3.5 * e
    ctx.globalAlpha = 0.28
    ctx.fillStyle = inkOf(pal, INK_HALO)
    ctx.beginPath()
    ctx.arc(x, y, r * 2.4, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = f.again ? 0.7 : 0.98
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    if (f.p >= 1) hits.shelf.push({ claimId: f.claimId, X: x, Y: y })
  }
  ctx.globalAlpha = 1
  return hits
}

// 惑星のタップ判定。惑星は小さいので、輪のぶんまで当たりを広げる。
// 重なったときは手前（Z がいちばん小さい惑星）を取る。奥から描くので、
// 画面に見えているのは手前の惑星であり、奥を返すと押した物と違う惑星へ飛ぶ。
export function pickPlanet(hits: FieldHits, mx: number, my: number): number | null {
  let best: FieldHits['planets'][number] | null = null
  for (const p of hits.planets) {
    if (Math.hypot(p.X - mx, p.Y - my) >= Math.max(p.S * R_COLD, 14)) continue
    if (!best || p.Z < best.Z) best = p
  }
  return best ? best.slot : null
}

// いちばん近いものを1つ返す。半径の外なら null。
export function pickNearest<T extends { X: number; Y: number }>(list: T[], mx: number, my: number, radius: number): T | null {
  let best: T | null = null
  let bd = radius
  for (const item of list) {
    const d = Math.hypot(item.X - mx, item.Y - my)
    if (d < bd) { bd = d; best = item }
  }
  return best
}

export function pickPage(hits: FieldHits, mx: number, my: number): string | null {
  const hit = hits.pages.find((p) => mx >= p.x && mx <= p.x + p.w && my >= p.y && my <= p.y + p.h)
  return hit ? hit.pageId : null
}
