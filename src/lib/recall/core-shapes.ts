// 芯の形（純関数）。族ごとの線の集まりを、時刻から作る。canvas を知らない。
//
// 出所: 惑星のラフにバンドルされていた出荷コード（設計 2026-09-03「七つの族の芯」）。
// 線だけで描く。面・塗り・影は使わない。
//
// 形を選んだ理由（設計書より）:
//   線が足りない形は平たく見える。針金細工の美しさは巻き数の密度・重なりの濃淡・曲率から出る。
//   だから立方体や八面体のような「辺の少ない多面体」は採らず、巻き線と編みを基本にした。
//   また、名前を伏せて並べたときに族が言い当てられる形にする（どの族に置いても成立する
//   形は使わない）。
//
//   流れ   閉じて戻る      ひと続きの巻き線（必ず出発点へ戻る）
//   交換   行って帰る      二枚の編みと、それを貫く通路（往復は交換の専売）
//   信号   伝って分岐する  1点から3方向へ二叉分岐
//   侵入   広がって戻らない 極を持たない編み＋食い込む異物
//   構造   撓んで耐える    テンセグリティ（直線は構造の専売）
//   調節   乱れて釣り合う  直交する三重の輪と中心の錘
//   体系   動かない        他の6族を縮小して同心に重ねる（自分の形を持たない）
import type { Vec3 } from './layout'
import { INVASION_CYCLE_SEC, INVASION_SCARS, type CoreKind } from './cores'

// 線の1点。4つ目があるものは「線に沿った位置」で、光を走らせるのに使う。
export type CorePoint = [number, number, number] | [number, number, number, number]
export type CoreLine = CorePoint[]

export type CoreGlow = { pos: number | number[]; w: number; wrap: number }
export type CoreLayer = {
  lines: CoreLine[]
  ink: string
  glow?: CoreGlow | null
  scale?: number
  dim?: number
  bold?: boolean
}

// 白の温度は3段（芯とLPで揃える）。光は動きにだけ使う。
export const INK_WARM = '#FAF2EA'
export const INK_COOL = '#EBF2FB'
export const INK_WHITE = '#F4F7FA'
export const INK_HALO = '#F6E7B8'

// 奥行きで明暗を分ける段数と、光が当たっていない側の下限。
// ここが狭いと平たく見える（設計書の指摘）。
export const DEPTH_STEPS = 14
export const MIN_ALPHA = 0.1

// 侵入の時間割。触れる前に凹まず、破れる前に波紋を出さない。
export const INVASION_TOUCH = 0.18
export const INVASION_BREAK = 0.34
const WEAVE_R = 0.92

const GOLDEN = 2.399963

const norm = (v: Vec3): Vec3 => {
  const L = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / L, v[1] / L, v[2] / L]
}
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

function basis(c: Vec3): [Vec3, Vec3] {
  const helper: Vec3 = Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const t1 = norm(cross(c, helper))
  return [t1, cross(c, t1)]
}

// 種から決まる乱数。同じ族なら毎回同じ形になる（形が呼ぶたびに変わらない）。
function seeded(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s + 1831565813) | 0
    let r = Math.imul(s ^ (s >>> 15), 1 | s)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

export function circle(radius: number, axis: Vec3, seg: number, center: Vec3 = [0, 0, 0]): CoreLine {
  const [t1, t2] = basis(norm(axis))
  const out: CoreLine = []
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2
    const c = Math.cos(a), s = Math.sin(a)
    out.push([
      center[0] + (t1[0] * c + t2[0] * s) * radius,
      center[1] + (t1[1] * c + t2[1] * s) * radius,
      center[2] + (t1[2] * c + t2[2] * s) * radius,
    ])
  }
  return out
}

function rotateY(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a)
  return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]
}

// 軸まわりの回転（ロドリゲス）。調節の三重の輪を別々に回すのに使う。
function rotateAxis(v: Vec3, axis: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a)
  const d = axis[0] * v[0] + axis[1] * v[1] + axis[2] * v[2]
  const k = cross(axis, v)
  return [
    v[0] * c + k[0] * s + axis[0] * d * (1 - c),
    v[1] * c + k[1] * s + axis[1] * d * (1 - c),
    v[2] * c + k[2] * s + axis[2] * d * (1 - c),
  ]
}

// ── 流れ: ひと続きの巻き線 ────────────────────────
// 1本の線が輪の周りを turns 周して**必ず出発点へ戻る**。巻きの重なりが濃淡を作る。
export function knot(turns: number): CoreLine[] {
  const n = turns * 22
  const line: CoreLine = []
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2
    const w = turns * a
    const r = 0.66 + 0.21 * Math.cos(w)
    line.push([r * Math.cos(a), 0.21 * Math.sin(w), r * Math.sin(a), a])
  }
  return [line]
}

// ── 編み: 極を持たない大円だけの球 ──────────────────
// 緯線・経線を使わない。極が生まれると地球儀に見え、それは体系の姿になる。
// 軸を球面へ黄金角で散らして、大円だけで組む。
export function weave(count: number, radius: number, seg = 90): CoreLine[] {
  const out: CoreLine[] = []
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const a = i * GOLDEN
    out.push(circle(radius, [r * Math.cos(a), y, r * Math.sin(a)], seg))
  }
  return out
}

// ── 交換: 内外の殻を貫く通路 ──────────────────────
export function passages(count: number, r0: number, r1: number): CoreLine[] {
  const out: CoreLine[] = []
  for (let i = 0; i < count; i++) {
    const y = 1 - (2 * (i + 0.5)) / count
    const r = Math.sqrt(Math.max(0, 1 - y * y))
    const a = i * GOLDEN + 0.9
    const d = norm([r * Math.cos(a), y, r * Math.sin(a)])
    const line: CoreLine = []
    for (let k = 0; k <= 10; k++) {
      const s = k / 10
      const rr = r0 + (r1 - r0) * s
      line.push([d[0] * rr, d[1] * rr, d[2] * rr, s])
    }
    out.push(line)
  }
  return out
}

// ── 信号: 分かれる枝 ─────────────────────────────
// 1点（下極）から3方向へ、深さ depth で二叉分岐。末端ほど短く細い。
export function tree(depth: number): CoreLine[] {
  const out: CoreLine[] = []
  const rnd = seeded(20260903)
  const grow = (from: Vec3, dir: Vec3, len: number, d: number, at: number) => {
    const to: Vec3 = [from[0] + dir[0] * len, from[1] + dir[1] * len, from[2] + dir[2] * len]
    const line: CoreLine = []
    for (let i = 0; i <= 4; i++) {
      const s = i / 4
      line.push([
        from[0] + (to[0] - from[0]) * s,
        from[1] + (to[1] - from[1]) * s,
        from[2] + (to[2] - from[2]) * s,
        at + len * s,
      ])
    }
    out.push(line)
    if (d >= depth) return
    for (let i = 0; i < 2; i++) {
      const next = norm([
        dir[0] + (rnd() - 0.5) * 1.05,
        dir[1] + (rnd() - 0.5) * 0.85,
        dir[2] + (rnd() - 0.5) * 1.05,
      ])
      grow(to, next, len * 0.66, d + 1, at + len)
    }
  }
  const root: Vec3 = [0, -0.86, 0]
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4
    grow(root, norm([Math.cos(a) * 0.55, 1, Math.sin(a) * 0.55]), 0.46, 0, 0)
  }
  return out
}

// ── 構造: テンセグリティ ──────────────────────────
// 棒はどこでも接触せず、細い張力線で吊られて立つ。直線が意味を持つ唯一の族。
export type Tensegrity = { struts: [Vec3, Vec3][]; cables: [Vec3, Vec3][] }

export function tensegrity(n: number, twist: number, half: number, ox = 0, oz = 0): Tensegrity {
  const lower: Vec3[] = []
  const upper: Vec3[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    lower.push([0.74 * Math.cos(a), -half, 0.74 * Math.sin(a)])
    upper.push([0.74 * Math.cos(a + twist) + ox, half, 0.74 * Math.sin(a + twist) + oz])
  }
  const struts: [Vec3, Vec3][] = []
  const cables: [Vec3, Vec3][] = []
  for (let i = 0; i < n; i++) {
    struts.push([lower[i], upper[(i + 2) % n]])
    cables.push([lower[i], lower[(i + 1) % n]])
    cables.push([upper[i], upper[(i + 1) % n]])
    cables.push([lower[i], upper[i]])
  }
  return { struts, cables }
}

// ── 調節: 三重の輪と錘 ────────────────────────────
export const gimbalRings = (): CoreLine[] => [
  circle(0.95, [0, 1, 0], 72),
  circle(0.77, [1, 0, 0], 72),
  circle(0.59, [0, 0, 1], 72),
]
const bob = (): CoreLine[] => [circle(0.11, [0, 1, 0], 24), circle(0.11, [1, 0, 0], 24), circle(0.11, [0, 0, 1], 24)]

// 形は毎フレーム作り直さない（線の本数が多いので、作り直すと描画より重くなる）。
const shapeCache = new Map<string, CoreLine[]>()
function cached(key: string, make: () => CoreLine[]): CoreLine[] {
  const hit = shapeCache.get(key)
  if (hit) return hit
  const made = make()
  shapeCache.set(key, made)
  return made
}

// ── 侵入の時間割 ─────────────────────────────────
// 一撃 = 9.5秒。順番を守る。
//   0 → 0.18      近づく。異物は球の外。編みは一切動かない
//   0.18          触れる
//   0.18 → 0.34   一緒に沈む。先端は常に凹みの底にいる
//   0.34          破れる
//   0.34 → 1.0    跳ね返りが波紋になって編みを渡り、反対側で消える。戻らない
export type InvasionPhase = {
  hit: number      // 何撃目か
  s: number        // その一撃の中の位置（0..1）
  stage: 'approach' | 'sink' | 'ripple'
  dent: number     // 凹みの深さ（0で凹んでいない）
  ripple: number   // 波紋の強さ（0で波紋なし）
}

const dentCurve = (s: number) => Math.pow((s - INVASION_TOUCH) / (INVASION_BREAK - INVASION_TOUCH), 0.75)

export function invasionPhase(t: number): InvasionPhase {
  const u = t / INVASION_CYCLE_SEC
  const hit = Math.floor(u)
  const s = u - hit
  if (s < INVASION_TOUCH) return { hit, s, stage: 'approach', dent: 0, ripple: 0 }
  if (s < INVASION_BREAK) return { hit, s, stage: 'sink', dent: 0.55 * dentCurve(s), ripple: 0 }
  const after = (s - INVASION_BREAK) / (1 - INVASION_BREAK)
  return { hit, s, stage: 'ripple', dent: 0.55 * 0.38 * Math.exp(-(s - INVASION_BREAK) * 0.85), ripple: 0.14 * Math.pow(1 - after, 1.2) }
}

// 次の一撃は別の方向から来る（黄金角で回す）。同じ点を二度は突かない。
export function invasionDir(hit: number): Vec3 {
  const a = hit * GOLDEN
  const p = 1.05 + 0.45 * Math.sin(hit * 1.7)
  return norm([Math.sin(p) * Math.cos(a), Math.cos(p), Math.sin(p) * Math.sin(a)])
}

// 異物。球の外から近づき、凹みの底に留まり、破れたあとは中へ抜ける。
function foreignBody(dir: Vec3, t: number, s: number, amp: number): CoreLine {
  const line: CoreLine = []
  const depth = s < INVASION_TOUCH
    ? 1.95 - (1.95 - WEAVE_R) * Math.pow(s / INVASION_TOUCH, 1.6)
    : s < INVASION_BREAK
      ? WEAVE_R * (1 - amp * dentCurve(s))
      : WEAVE_R * (1 - amp) - 1.4 * Math.min(1, ((s - INVASION_BREAK) / (1 - INVASION_BREAK)) * 2.2)
  const broke = s < INVASION_BREAK ? 0 : Math.min(1, ((s - INVASION_BREAK) / (1 - INVASION_BREAK)) * 2)
  const head = s < INVASION_BREAK ? depth + 0.78 : 1.74
  const tail = broke ? 0.3 : depth
  for (let i = 0; i <= 14; i++) {
    const r = head + (tail - head) * (i / 14)
    line.push([dir[0] * r, dir[1] * r, dir[2] * r])
  }
  if (!broke) return line
  const [t1, t2] = basis(dir)
  const turns = Math.round(72 * broke)
  for (let i = 0; i <= turns; i++) {
    const w = i / 72
    const a = w * Math.PI * 5.2 - t * 0.3
    const rad = 0.36 * Math.sin(Math.PI * Math.pow(w, 0.85))
    const along = 0.3 - w * 0.62
    line.push([
      dir[0] * along + t1[0] * rad * Math.cos(a) + t2[0] * rad * Math.sin(a),
      dir[1] * along + t1[1] * rad * Math.cos(a) + t2[1] * rad * Math.sin(a),
      dir[2] * along + t1[2] * rad * Math.cos(a) + t2[2] * rad * Math.sin(a),
    ])
  }
  return line
}

// 体系: 他の6族を縮小して同心に重ねる。自分の形を持たない。
type SystemLayer = { l: CoreLine[]; s: number; r: number }
let systemLayers: SystemLayer[] | null = null
function systemStack(): SystemLayer[] {
  if (systemLayers) return systemLayers
  const tg = tensegrity(6, (Math.PI / 6) * 1.15, 0.52)
  systemLayers = [
    { l: knot(8), s: 0.98, r: 0.03 },
    { l: weave(6, 0.92, 60), s: 0.86, r: -0.022 },
    { l: tree(3), s: 0.74, r: 0.017 },
    { l: [...tg.struts, ...tg.cables], s: 0.62, r: -0.013 },
    { l: gimbalRings(), s: 0.5, r: 0.01 },
    { l: weave(5, 0.92, 60), s: 0.36, r: -0.008 },
  ]
  return systemLayers
}

// 張力線の自然長。伸びている線と緩んでいる線を描き分けるために使う
//（テンセグリティは張力で立つので、全部を同じ濃さで引くと構造が読めない）。
const restCache = new Map<string, number[]>()
function cableRest(twist: number, half: number): number[] {
  const key = `${twist}:${half}`
  const hit = restCache.get(key)
  if (hit) return hit
  const out = tensegrity(6, twist, half).cables.map((c) =>
    Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1], c[1][2] - c[0][2]))
  restCache.set(key, out)
  return out
}

const seg = (pair: [Vec3, Vec3]): CoreLine => [pair[0], pair[1]]

export type CoreLayerOptions = { density?: number; glow?: boolean }

// 族と時刻から、描くべき線の層を返す。canvas を知らない。
export function coreLayers(kind: CoreKind, t: number, opts: CoreLayerOptions = {}): CoreLayer[] {
  const density = opts.density ?? 1
  const glowOn = opts.glow ?? true
  const n = (base: number, lo: number, hi: number) => clamp(Math.round(base * density), lo, hi)
  const key = (name: string) => `${name}:${density}`

  if (kind === 'flow') {
    return [{
      lines: cached(key('knot'), () => knot(n(24, 10, 44))),
      ink: INK_WARM,
      glow: glowOn ? { pos: (t * 0.55) % (Math.PI * 2), w: 0.26, wrap: Math.PI * 2 } : null,
    }]
  }

  if (kind === 'exchange') {
    const breath = Math.sin(t * 0.62)
    const pass = cached(key('exPass'), () => passages(n(9, 5, 14), 0.54, 0.94))
    // 通路の光は1本ずつ別の位相で往復する（行って帰るが交換の専売）。
    const pos = pass.map((_, i) => 0.5 + 0.5 * Math.sin(t * 0.9 + i * 1.05))
    return [
      { lines: cached(key('exOut'), () => weave(n(8, 5, 14), 0.94)), ink: INK_COOL, scale: 1 + 0.055 * breath },
      { lines: cached(key('exIn'), () => weave(n(7, 4, 12), 0.54)), ink: INK_COOL, scale: 1 - 0.075 * breath },
      { lines: pass, ink: INK_WHITE, glow: glowOn ? { pos, w: 0.11, wrap: 0 } : null },
    ]
  }

  if (kind === 'signal') {
    const fire = (t * 0.62) % 3.15
    const lines = cached(key('tree'), () => tree(density > 1.1 ? 5 : 4))
    return [
      {
        lines,
        ink: INK_COOL,
        glow: glowOn && fire < 1.9 ? { pos: (fire / 1.9) * 1.45, w: 0.11, wrap: 0 } : null,
      },
      // 幹（根から直に出る3本）だけ太く重ねる。信号は7族で唯一 bold を持たず、
      // ライトの紙の上で細く淡かった（2026-09-05 実画面）。枝の細さは信号らしさなので変えない。
      // tree の push は深さ優先で、先頭3本は「根1・根1の子・その子」になる。幹は始点で拾う。
      { lines: lines.filter((l) => l[0][0] === 0 && l[0][1] === -0.86 && l[0][2] === 0), ink: INK_COOL, bold: true },
    ]
  }

  if (kind === 'invasion') {
    const ph = invasionPhase(t)
    const dir = invasionDir(ph.hit)
    // 凹みは3回ぶんまで重なって、古いものから塞がる。
    const dents: { d: Vec3; amp: number; sig: number }[] = []
    for (let k = 0; k < INVASION_SCARS; k++) {
      if (k === 0) {
        if (ph.stage === 'sink') dents.push({ d: dir, amp: ph.dent, sig: 0.38 + 0.22 * dentCurve(ph.s) })
        else if (ph.stage === 'ripple') dents.push({ d: dir, amp: ph.dent, sig: 0.55 })
        continue
      }
      if (k > ph.hit) break
      const age = ph.s - INVASION_BREAK + k
      if (age > 0) dents.push({ d: invasionDir(ph.hit - k), amp: 0.55 * 0.38 * Math.exp(-age * 0.85), sig: 0.55 })
    }
    const front = ph.stage === 'ripple'
      ? { at: ((ph.s - INVASION_BREAK) / (1 - INVASION_BREAK)) * (Math.PI + 0.6), amp: ph.ripple }
      : null
    const base = cached(key('inv'), () => weave(n(9, 5, 16), WEAVE_R))
    const woven = base.map((line) => line.map((p) => {
      let push = 0
      for (const d of dents) {
        const cosA = clamp((p[0] * d.d[0] + p[1] * d.d[1] + p[2] * d.d[2]) / WEAVE_R, -1, 1)
        const ang = Math.acos(cosA)
        push += d.amp * Math.exp(-(ang * ang) / (2 * d.sig * d.sig))
      }
      if (front && front.amp > 0) {
        const cosA = clamp((p[0] * dir[0] + p[1] * dir[1] + p[2] * dir[2]) / WEAVE_R, -1, 1)
        const a = Math.acos(cosA) - front.at
        push -= front.amp * Math.cos(9 * a) * Math.exp(-(a * a) / (2 * 0.28 * 0.28))
      }
      const k = 1 - push
      return [p[0] * k, p[1] * k, p[2] * k] as CorePoint
    }))
    return [
      { lines: woven, ink: INK_COOL },
      { lines: [foreignBody(dir, t, ph.s, 0.55)], ink: INK_WARM, bold: true },
    ]
  }

  if (kind === 'structure') {
    const twist = (Math.PI / 6) * 1.15
    const half = 0.52
    const rest = cableRest(twist, half)
    const sway = t * 0.42
    const amp = 0.115
    const tg = tensegrity(6, twist + 0.06 * Math.sin(t * 0.31), half - 0.02 * Math.sin(t * 0.31),
      amp * Math.cos(sway), amp * Math.sin(sway))
    // 伸びている張力線と緩んでいる張力線を分ける。撓んで耐える姿はここに出る。
    const taut: CoreLine[] = []
    const slack: CoreLine[] = []
    tg.cables.forEach((c, i) => {
      const len = Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1], c[1][2] - c[0][2])
      ;(len >= rest[i] * 1.002 ? taut : slack).push(seg(c))
    })
    return [
      { lines: slack, ink: INK_WHITE, dim: 0.34 },
      { lines: taut, ink: INK_WHITE },
      { lines: tg.struts.map(seg), ink: INK_WHITE, bold: true },
    ]
  }

  if (kind === 'regulation') {
    // 乱れて釣り合いへ戻る。周期の頭で乱れ、指数で収まる。
    const beat = t % 7.4
    const kick = 0.42 * Math.exp(-beat * 1.5) * Math.sin(beat * 7.4)
    const rings = cached(key('gim'), gimbalRings)
    const axes: Vec3[] = [[1, 0, 0], [0, 0, 1], [0, 1, 0]]
    const angles = [t * 0.3 + kick, -t * 0.44 - kick * 1.3, t * 0.62 + kick * 0.7]
    const turned = rings.map((line, i) => line.map((p) => rotateAxis([p[0], p[1], p[2]], axes[i], angles[i]) as CorePoint))
    const nudge = 0.055 * Math.exp(-beat * 2.1) * Math.sin(beat * 9.2)
    const weight = cached(key('bob'), bob).map((line) =>
      line.map((p) => [p[0] + nudge, p[1] + nudge * 0.6, p[2] - nudge * 0.4] as CorePoint))
    return [
      { lines: turned, ink: INK_WHITE },
      { lines: weight, ink: INK_HALO, bold: true },
    ]
  }

  // 体系: 動かない。層ごとにごく遅く向きだけ変える。
  return systemStack().map((layer) => ({
    lines: layer.l.map((line) => line.map((p) => rotateY([p[0], p[1], p[2]], t * layer.r * 6) as CorePoint)),
    ink: INK_WHITE,
    scale: layer.s,
    dim: 0.62,
    glow: null,
  }))
}
