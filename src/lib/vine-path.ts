// 蔓の中心線パスを決定的に生成する純関数。DOMのgetPointAtLengthは使わない
// （SSR/hydrationで死ぬ・ブラウザ差がある・毎回測ると重い）。ベジェを自前サンプリングして
// 「高さ→座標」「高さ→弧長」の対応表を持つ。座標系は地面y=0・上が正（SVG側でscale(1,-1)）。
// yの厳密単調は生成規則で保証する: 各セグメントの制御点yを [prevY, y] の内側に置けば
// 3次ベジェのy(t)は単調になる（導関数が非負の凸結合になるため）。
export type VineSample = { x: number; y: number; len: number }
export type VinePath = { d: string; samples: VineSample[]; totalLen: number }

const SEG_PX = 120        // 節の名目長（アセットの節PNGとおおよそ対応）
const SAMPLES_PER_SEG = 24
const BEND = 0.4          // 制御点をセグメント内に寄せる比率（単調性の要）

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function cubic(p0: number, c1: number, c2: number, p1: number, t: number): number {
  const u = 1 - t
  return u * u * u * p0 + 3 * u * u * t * c1 + 3 * u * t * t * c2 + t * t * t * p1
}

export function generateVinePath(seed: number, heightPx: number, baseX: number, amp: number): VinePath {
  const rand = mulberry32(seed)
  const segCount = Math.max(1, Math.ceil(heightPx / SEG_PX))
  let x = baseX
  let y = 0
  let dir = rand() < 0.5 ? 1 : -1
  const samples: VineSample[] = [{ x, y, len: 0 }]
  let d = `M ${x.toFixed(1)} ${y.toFixed(1)}`
  let len = 0
  for (let i = 0; i < segCount; i++) {
    const nextY = Math.min(heightPx, y + SEG_PX)
    const span = nextY - y
    // 左右交互に振る。振れ幅は0.35〜1.0×ampで揺らぎ、常にbaseX±ampに収める。
    const targetX = Math.max(baseX - amp, Math.min(baseX + amp, baseX + dir * (0.35 + 0.65 * rand()) * amp))
    const c1x = x + (targetX - x) * 0.1
    const c1y = y + span * BEND
    const c2x = targetX - (targetX - x) * 0.1
    const c2y = nextY - span * BEND
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${targetX.toFixed(1)} ${nextY.toFixed(1)}`
    let px = x
    let py = y
    for (let s = 1; s <= SAMPLES_PER_SEG; s++) {
      const t = s / SAMPLES_PER_SEG
      const sx = cubic(x, c1x, c2x, targetX, t)
      const sy = cubic(y, c1y, c2y, nextY, t)
      len += Math.hypot(sx - px, sy - py)
      samples.push({ x: sx, y: sy, len })
      px = sx
      py = sy
    }
    x = targetX
    y = nextY
    dir = -dir
  }
  return { d, samples, totalLen: len }
}

// 高さ→サンプル（yが単調なので二分探索）。範囲外は端にクランプ。
export function pointAtHeight(path: VinePath, hPx: number): VineSample {
  const s = path.samples
  if (hPx <= s[0].y) return s[0]
  if (hPx >= s[s.length - 1].y) return s[s.length - 1]
  let lo = 0
  let hi = s.length - 1
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1
    if (s[mid].y <= hPx) lo = mid
    else hi = mid
  }
  const a = s[lo]
  const b = s[hi]
  const t = (hPx - a.y) / (b.y - a.y || 1)
  return { x: a.x + (b.x - a.x) * t, y: hPx, len: a.len + (b.len - a.len) * t }
}

export function lengthAtHeight(path: VinePath, hPx: number): number {
  return pointAtHeight(path, hPx).len
}
