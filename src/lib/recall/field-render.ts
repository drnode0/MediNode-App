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
import { coreLayers, DEPTH_STEPS, MIN_ALPHA, type CoreLayer } from './core-shapes'
import { CORE_SPIN, CORE_TILT, coreIndividual, type CoreKind } from './cores'
import {
  placeOf, lookOf, HAZE_ALPHA, HALO_MAX,
  EDGE_CIRCLES, EDGE_LABELS, INK_HALO, R_COLD,
  type PlanetSummary,
} from './field-layout'
import { easeInOutCubic, RING_PITCH, INSIDE_STAGE } from './field-camera'
import {
  makeProjector, type FieldCamera, type FieldCenter, type FieldSeat, type Projector,
} from './field'

// 地と文字。芯とLPに揃えた3段の白は core-shapes 側にある。
export const FIELD_BG = '#0B1524'
export const INK_LABEL = '#A9B8CC'
export const INK_OUTLINE = '#EBF2FB'

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
    ctx.strokeStyle = layer.ink
    for (let i = 0; i < DEPTH_STEPS; i++) {
      const seg = buckets[i]
      if (!seg.length) continue
      const f = (i + 0.5) / DEPTH_STEPS
      ctx.globalAlpha = (bold ? 0.45 + 0.55 * f : minA + (1 - minA) * f * f) * dim * fade
      ctx.lineWidth = bold ? 1.05 + 0.95 * f : 0.45 + 1.05 * f
      strokeSegments(ctx, seg)
    }
    if (glowSeg.length) {
      ctx.strokeStyle = INK_HALO
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

// 記事の扇形（段3）。渡されなければ扇形も記事名も描かない。
export type PageArc = { pageId: string; title: string; n: number; a0: number; a1: number }

export type Planet = {
  seat: FieldSeat
  summary: PlanetSummary
  dots: ClaimDot[]
  pages?: PageArc[]
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
}

export type FieldHits = {
  planets: Array<{ slot: number; X: number; Y: number; S: number; Z: number }>
  dots: Array<{ claimId: string; X: number; Y: number }>
  pages: Array<{ pageId: string; x: number; y: number; w: number; h: number }>
  shelf: Array<{ claimId: string; X: number; Y: number }>
  dotPos: Map<string, { X: number; Y: number }>
}

// 惑星の名前・件数を出す下限の大きさ。これより小さいと文字が惑星に重なる。
const LABEL_MIN_R = 22
// 芯の半径は惑星の半径のこの割合。
const CORE_R_RATIO = 0.42
// 記事の扇形と記事名の高度。
const ARC_R = 3.62
const ARC_LABEL_R = 3.98
// 棚（画面の下の横一列）。
const SHELF_GAP = 52
const SHELF_BOTTOM = 34
const SHELF_LIFT = 60
// モヤ（決定10）。塗らず、短い線を散らして像を結ばせない。
const HAZE_STROKES = 9

const hash = (a: number, b: number) => {
  let h = (Math.imul(a, 374761393) + Math.imul(b, 668265263)) >>> 0
  h = (h ^ (h >>> 13)) >>> 0
  h = Math.imul(h, 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// 空の惑星のモヤ。席番号だけから決まるので、毎フレーム散らし直さない。
function drawHaze(ctx: CanvasRenderingContext2D, slot: number, X: number, Y: number, S: number, depth: number) {
  ctx.strokeStyle = INK_OUTLINE
  ctx.lineWidth = 0.6
  ctx.globalAlpha = HAZE_ALPHA * depth
  ctx.beginPath()
  for (let i = 0; i < HAZE_STROKES; i++) {
    const a = hash(slot, i * 2 + 1) * Math.PI * 2
    const r = S * (0.4 + hash(slot, i * 2 + 2) * 1.6)
    const len = S * 0.5
    const dir = hash(slot, i * 2 + 3) * Math.PI * 2
    const x = X + Math.cos(a) * r, y = Y + Math.sin(a) * r
    ctx.moveTo(x - Math.cos(dir) * len / 2, y - Math.sin(dir) * len / 2)
    ctx.lineTo(x + Math.cos(dir) * len / 2, y + Math.sin(dir) * len / 2)
  }
  ctx.stroke()
  ctx.globalAlpha = 1
}

// 1コマ描く。返り値はタップ判定の位置（描いた場所と選ばれる場所を二度と食い違わせない）。
export function drawField(ctx: CanvasRenderingContext2D, a: FieldFrameArgs): FieldHits {
  const { W, H, cam, center, t, reduced } = a
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = FIELD_BG
  ctx.fillRect(0, 0, W, H)

  const project: Projector = makeProjector(cam, center, W, H)
  const inside = center === 'inside'
  const hits: FieldHits = { planets: [], dots: [], pages: [], shelf: [], dotPos: new Map() }
  const T = reduced ? 0 : t
  // 輪の自転。内側ほど速い（深く残した主張が最も速く回る）。
  const spin = reduced ? 0 : T * 0.05
  const flyingIds = new Set(a.flying.map((f) => f.claimId))

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
      drawHaze(ctx, seat.slot, X, Y, S, depth)
    }
    if (sum.core) {
      // 奥行きの薄さは dim で渡す。外側で globalAlpha を掛けても、
      // drawCore3D が段ごとに上書きするので効かない。
      drawCore3D(ctx, {
        cx: X, cy: Y, CR: S * CORE_R_RATIO * ind.scale,
        kind: seat.kind, t: T * ind.rate, reduced, dim: depth,
        yaw: T * ind.rate * CORE_SPIN[seat.kind] + handYaw,
        pitch: ind.tilt + handPitch,
      })
    }
    if (sum.outline) {
      ctx.globalAlpha = sum.outlineAlpha * depth
      ctx.strokeStyle = INK_OUTLINE
      ctx.lineWidth = 0.8
      ctx.beginPath()
      ctx.arc(X, Y, S, 0, Math.PI * 2)
      ctx.stroke()
    }
    // 離れかけの光。惑星が小さくて点が読めない段（遠景・中景）の要約。
    if (S < LABEL_MIN_R && sum.halos > 0) {
      ctx.fillStyle = INK_HALO
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
      if (flyingIds.has(dot.claimId)) continue
      const place = placeOf(dot.state.kind, dot.state.remaining, dot.jitter)
      const at = onRing(dot.angle + spin / place.r, place.r, place.y)
      if (!at) continue
      hits.dotPos.set(dot.claimId, { X: at.X, Y: at.Y })
      const look = lookOf(dot.state.kind, dot.state.remaining, T, reduced, dot.phase)
      let alpha = look.alpha * depth
      // レンズ。押した記事だけ明るく、他は沈む。
      if (isNear && a.lensPageId && dot.pageId !== a.lensPageId) alpha *= 0.22
      const size = look.size * dotScale * (inside ? (at.k * seat.r) / S : 1)
      if (look.glow && S > LABEL_MIN_R) {
        ctx.globalAlpha = alpha * 0.25
        ctx.fillStyle = look.ink
        ctx.beginPath()
        ctx.arc(at.X, at.Y, size * 2.6, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = alpha
      ctx.fillStyle = look.ink
      ctx.beginPath()
      ctx.arc(at.X, at.Y, size, 0, Math.PI * 2)
      ctx.fill()
      if (isNear) hits.dots.push({ claimId: dot.claimId, X: at.X, Y: at.Y })
    }

    // 境目の名前（決定7）。近景に入った直後だけ、輪の境目に薄い円と名前。
    if (isNear && a.edgeAlpha > 0) {
      ctx.strokeStyle = INK_LABEL
      ctx.lineWidth = 0.7
      for (const r of EDGE_CIRCLES) {
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
      ctx.font = '400 10.5px "Zen Kaku Gothic New",sans-serif'
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = INK_LABEL
      for (const [r, text] of EDGE_LABELS) {
        const q = onRing(Math.PI, r)
        if (!q) continue
        ctx.globalAlpha = 0.8 * a.edgeAlpha
        ctx.fillText(text, q.X - 6, q.Y)
      }
      ctx.textBaseline = 'alphabetic'
    }

    // 記事の扇形と記事名（段3）。
    if (isNear && planet.pages?.length) {
      ctx.font = '400 11px "Zen Kaku Gothic New",sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const page of planet.pages) {
        const lit = !a.lensPageId || a.lensPageId === page.pageId
        ctx.globalAlpha = (lit ? 0.22 : 0.08) * depth
        ctx.strokeStyle = INK_LABEL
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
        const label = onRing((page.a0 + page.a1) / 2, ARC_LABEL_R)
        if (!label) continue
        const text = `${page.title}  ${page.n}`
        const w = ctx.measureText(text).width + 14
        ctx.globalAlpha = (lit ? 0.85 : 0.35) * depth
        ctx.fillStyle = 'rgba(11,21,36,.75)'
        ctx.fillRect(label.X - w / 2, label.Y - 9, w, 18)
        ctx.fillStyle = a.lensPageId === page.pageId ? INK_HALO : INK_LABEL
        ctx.fillText(text, label.X, label.Y)
        hits.pages.push({ pageId: page.pageId, x: label.X - w / 2, y: label.Y - 9, w, h: 18 })
      }
      ctx.textBaseline = 'alphabetic'
    }

    // 惑星の名前と件数（中景）。近景では上の見出しが担うので出さない。
    if (!isNear && S > LABEL_MIN_R) {
      ctx.globalAlpha = 0.6 * depth
      ctx.fillStyle = INK_LABEL
      ctx.textAlign = 'center'
      ctx.font = '400 10px "Zen Kaku Gothic New",sans-serif'
      ctx.fillText(seat.n ? `${seat.label}　${seat.n}` : seat.label, X, Y + S * 3.5 + 14)
      if (sum.halos > 0) {
        ctx.fillStyle = INK_HALO
        ctx.fillText(`離れかけ ${sum.halos}`, X, Y + S * 3.5 + 28)
      }
    }
    hits.planets.push({ slot: seat.slot, X, Y, S, Z: s.Z })
  }

  // 棚。輪の位置から画面の下へ、手前で大きくなりながら浅い弧で移る。
  const n = a.flying.length
  for (let i = 0; i < n; i++) {
    const f = a.flying[i]
    const toX = W / 2 + (i - (n - 1) / 2) * SHELF_GAP
    const toY = H - SHELF_BOTTOM
    const from = f.dir === 1 ? f.from : hits.dotPos.get(f.claimId) ?? f.from
    const e = easeInOutCubic(Math.max(0, Math.min(1, f.p)))
    const midX = (from.X + toX) / 2
    const midY = Math.min(from.Y, toY) - SHELF_LIFT
    const x = (1 - e) * (1 - e) * from.X + 2 * (1 - e) * e * midX + e * e * toX
    const y = (1 - e) * (1 - e) * from.Y + 2 * (1 - e) * e * midY + e * e * toY
    const r = 3 + 3.5 * e
    ctx.globalAlpha = 0.28
    ctx.fillStyle = INK_HALO
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
