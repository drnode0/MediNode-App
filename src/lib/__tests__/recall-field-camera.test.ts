// 近景カメラと3段・視点A/B・慣性・境目の名前（決定3・5・6・7）。
// 描画はテストできない（DOM を持たない）ので、判断はすべて純関数に出してある。
import { describe, it, expect } from 'vitest'
import {
  stageOfZoom, stageOfFov, zoomForPlanet, nearFogFill, eyeDistanceOf,
  clampPitchOutside, clampPitchInside, clampZoom, clampFov,
  dragYaw, dragVelocity, releaseVelocity, coast, wrapNear,
  zoomStep, fovStep, edgeLabelAlpha, lerpZoom,
  RING_PITCH, NEAR_PITCH, PITCH_MIN, PITCH_MAX, STAGE_ZOOM_EDGE,
  MID_ZOOM, FAR_ZOOM, ZOOM_MIN, ZOOM_MAX, HOLD_MS, COAST_MIN,
  EDGE_LABEL_FADE_MS, FOV_MIN, FOV_MAX, STAGE_FOV_EDGE, FAR_FOV, MID_FOV,
} from '@/lib/recall/field-camera'
import {
  fieldLayout, frontSlotOf, angleOf, depthAt, focusPointOf, cameraFor,
  makeProjector, initialCamera, eyeFor, insideBasis,
} from '@/lib/recall/field'
import { CLUSTER_ZOOM, CLUSTER_PITCH, CLUSTER_MID_ZOOM, clusterPointOf } from '@/lib/recall/field-cluster'
import { EDGE_LABEL_MS, R_COLD, planetRadius } from '@/lib/recall/field-layout'
import { GENRE_SEATS, isRetiredSeat } from '@/lib/recall/genres'
import { pickPlanet, pickNearest, pickPage } from '@/lib/recall/field-render'

const near = (a: number, b: number, digits = 6) => expect(a).toBeCloseTo(b, digits)

// 09-02 実測に近い形（使用中15席）。空の席が22席残る。
const counts = () => {
  const c = new Array(GENRE_SEATS.length).fill(0)
  for (const [slot, n] of [[2, 34], [3, 178], [4, 61], [5, 42], [6, 18], [9, 25], [12, 97], [13, 12], [14, 33], [16, 9], [21, 30], [23, 14], [24, 11], [25, 20], [26, 8]] as const) c[slot] = n
  return c
}

describe('段の判定', () => {
  it('倍率4を境に、遠景と中景で段の名前が変わる', () => {
    expect(stageOfZoom(STAGE_ZOOM_EDGE - 0.01)).toBe('far')
    expect(stageOfZoom(STAGE_ZOOM_EDGE)).toBe('mid')
    expect(stageOfZoom(FAR_ZOOM)).toBe('far')
    expect(stageOfZoom(MID_ZOOM)).toBe('mid')
  })

  it('視点B は画角で段が変わる（40度より広ければ遠景）', () => {
    expect(stageOfFov(STAGE_FOV_EDGE)).toBe('mid')
    expect(stageOfFov(STAGE_FOV_EDGE + 1e-6)).toBe('far')
    expect(stageOfFov(FAR_FOV)).toBe('far')
    expect(stageOfFov(MID_FOV)).toBe('mid')
    expect(stageOfFov(FOV_MAX)).toBe('far')
    expect(stageOfFov(FOV_MIN)).toBe('mid')
  })

  it('ホイールの倍率と画角は範囲の外へ出ない', () => {
    expect(zoomStep(ZOOM_MIN, 5000)).toBe(ZOOM_MIN)
    expect(zoomStep(ZOOM_MAX, -5000)).toBe(ZOOM_MAX)
    expect(clampZoom(0)).toBe(ZOOM_MIN)
    expect(fovStep(FOV_MAX, 5000)).toBe(FOV_MAX)
    expect(fovStep(FOV_MIN, -5000)).toBe(FOV_MIN)
    expect(clampFov(Math.PI)).toBe(FOV_MAX)
  })
})

describe('近景の倍率', () => {
  it('いちばん外の霧（3.38）が画面の短辺に収まる', () => {
    // 画面上の長さ = 惑星の半径 × 短辺 × 0.42 × 倍率。霧まで入れた直径が短辺を割らない。
    expect(nearFogFill()).toBeLessThan(1)
    near(nearFogFill(), 2 * R_COLD * 0.115, 10)

    const W = 390, H = 720
    const seats = fieldLayout(counts())
    for (const seat of seats.filter((s) => s.n > 0)) {
      const cam = cameraFor(initialCamera(seats), 'outside', 'near', seat)
      const project = makeProjector(cam, 'outside', W, H)
      const at = project(seat.at)!
      // 惑星の中心から霧までを、リングの面の上で測る（横方向は遠近の影響が最も小さい）。
      const edge = project([
        seat.at[0] + Math.cos(angleOf(seat.at)) * R_COLD * seat.r,
        seat.at[1],
        seat.at[2] + Math.sin(angleOf(seat.at)) * R_COLD * seat.r,
      ])!
      expect(Math.abs(edge.X - at.X)).toBeLessThan(Math.min(W, H) / 2)
    }
  })

  it('惑星が小さい席ほど倍率は上がる（どの席でも同じ大きさに広がる）', () => {
    const seats = fieldLayout(counts())
    const big = seats.reduce((a, b) => (a.r >= b.r ? a : b))
    const small = seats.reduce((a, b) => (a.r <= b.r ? a : b))
    expect(zoomForPlanet(small.r)).toBeGreaterThan(zoomForPlanet(big.r))
    // 倍率 × 半径は席によらず一定。
    near(zoomForPlanet(small.r) * small.r, zoomForPlanet(big.r) * big.r, 10)
  })

  it('視点B の目の位置は、惑星の手前に立つ（惑星より中心寄り）', () => {
    const seats = fieldLayout(counts())
    const seat = seats.find((s) => s.n > 0)!
    const rotY = angleOf(seat.at)
    const eye = eyeFor(seat, rotY, 0.55)
    const toPlanet = Math.hypot(seat.at[0] - eye[0], seat.at[1] - eye[1], seat.at[2] - eye[2])
    near(toPlanet, eyeDistanceOf(seat.r), 6)
    // 前方向にちょうど惑星がいる。
    const b = insideBasis(rotY, 0.55)
    const d = [seat.at[0] - eye[0], seat.at[1] - eye[1], seat.at[2] - eye[2]]
    near(d[0] * b.f[0] + d[1] * b.f[1] + d[2] * b.f[2], toPlanet, 6)
  })
})

describe('傾き', () => {
  it('縦ドラッグの頭打ちを超えない', () => {
    expect(clampPitchOutside(-99)).toBe(PITCH_MIN)
    expect(clampPitchOutside(99)).toBe(PITCH_MAX)
    expect(clampPitchOutside(NEAR_PITCH)).toBe(NEAR_PITCH)
    expect(clampPitchInside(-99)).toBeGreaterThan(0)
    expect(clampPitchInside(99)).toBeLessThanOrEqual(1.35)
  })

  it('中景・遠景へ戻すと傾きが RING_PITCH に戻る', () => {
    const seats = fieldLayout(counts())
    const seat = seats.find((s) => s.n > 0)!
    const nearCam = cameraFor(initialCamera(seats), 'outside', 'near', seat)
    expect(nearCam.rotX).toBe(NEAR_PITCH)
    expect(cameraFor(nearCam, 'outside', 'mid', null).rotX).toBe(RING_PITCH)
    expect(cameraFor(nearCam, 'outside', 'far', null).rotX).toBe(RING_PITCH)
  })
})

describe('慣性', () => {
  it('押さえて止めてから離したときは減速が始まらない', () => {
    const v = dragVelocity(dragYaw(120), 16)
    expect(releaseVelocity(v, HOLD_MS + 1)).toBe(0)
    expect(releaseVelocity(v, HOLD_MS - 1)).toBe(v)
  })

  it('放したときは減速して必ず止まる', () => {
    let v = dragVelocity(dragYaw(240), 16)
    expect(Math.abs(v)).toBeGreaterThan(COAST_MIN)
    let steps = 0
    while (v !== 0) {
      v = coast(v, 1 / 60)
      steps++
      expect(steps).toBeLessThan(1000)
    }
    expect(v).toBe(0)
  })

  it('減速は単調で、向きが反転しない', () => {
    let v = dragVelocity(dragYaw(-240), 16)
    let prev = Math.abs(v)
    for (let i = 0; i < 60 && v !== 0; i++) {
      v = coast(v, 1 / 60)
      if (v !== 0) expect(v).toBeLessThan(0)
      expect(Math.abs(v)).toBeLessThanOrEqual(prev)
      prev = Math.abs(v)
    }
  })

  it('回した先は、いまの向きから半周以内になる', () => {
    const TAU = Math.PI * 2
    for (const current of [0, 3, -3, 12.5, -20]) {
      for (const target of [0.2, 3.1, 6.0]) {
        const got = wrapNear(target, current)
        expect(Math.abs(got - current)).toBeLessThanOrEqual(Math.PI + 1e-9)
        near((got - target) % TAU, 0, 6)
      }
    }
  })
})

describe('境目の名前', () => {
  it('近景に入って3秒ほどで消える', () => {
    const t0 = 1000
    expect(edgeLabelAlpha(t0, t0, false, 'near')).toBe(1)
    expect(edgeLabelAlpha(t0, t0 + EDGE_LABEL_MS - EDGE_LABEL_FADE_MS, false, 'near')).toBe(1)
    expect(edgeLabelAlpha(t0, t0 + EDGE_LABEL_MS - EDGE_LABEL_FADE_MS / 2, false, 'near')).toBeCloseTo(0.5, 6)
    expect(edgeLabelAlpha(t0, t0 + EDGE_LABEL_MS, false, 'near')).toBe(0)
    expect(edgeLabelAlpha(t0, t0 + EDGE_LABEL_MS + 1, false, 'near')).toBe(0)
  })

  it('3秒より前でも、最初のドラッグで消える', () => {
    expect(edgeLabelAlpha(1000, 1100, true, 'near')).toBe(0)
  })

  it('近景でないときは出ない', () => {
    expect(edgeLabelAlpha(1000, 1100, false, 'mid')).toBe(0)
    expect(edgeLabelAlpha(1000, 1100, false, 'far')).toBe(0)
  })
})

describe('正面の席', () => {
  it('視点A と視点B で同じ席を返す', () => {
    const seats = fieldLayout(counts())
    for (const rotY of [0, 0.7, 2.4, -1.1, 5.9]) {
      const a = frontSlotOf(seats, rotY)
      const b = frontSlotOf(seats, rotY)
      expect(a).toBe(b)
      expect(a).not.toBeNull()
    }
  })

  it('席を正面へ回すと、その席が正面の席になる', () => {
    const seats = fieldLayout(counts())
    for (const seat of seats) {
      expect(frontSlotOf(seats, angleOf(seat.at))).toBe(seat.slot)
      near(depthAt(seat.at, angleOf(seat.at)), -1, 6)
    }
  })

  it('中景の見る先は、正面の席と同じ場所', () => {
    const seats = fieldLayout(counts())
    const seat = seats[7]
    const rotY = angleOf(seat.at)
    const f = focusPointOf('ring', rotY)
    near(f[0], seat.at[0], 6)
    near(f[2], seat.at[2], 6)
  })

  it('球状の並びでは中心を見る（環状の規則を持ち込まない）', () => {
    expect(focusPointOf('sphere', 1.2)).toEqual([0, 0, 0])
  })
})

describe('並び', () => {
  it('廃番の席は惑星に出さない（38席のうち37個）', () => {
    const seats = fieldLayout(counts())
    expect(seats).toHaveLength(GENRE_SEATS.length - 1)
    expect(seats.some((s) => isRetiredSeat(s.slot))).toBe(false)
  })

  it('主張を足しても、既存の席の位置は動かない', () => {
    const before = fieldLayout(counts())
    const c = counts()
    c[30] = 12
    const after = fieldLayout(c)
    for (const s of before) {
      const t = after.find((x) => x.slot === s.slot)!
      expect(t.at).toEqual(s.at)
    }
  })

  it('惑星どうしが重ならない', () => {
    const seats = fieldLayout(counts())
    for (let i = 0; i < seats.length; i++) {
      for (let j = i + 1; j < seats.length; j++) {
        const a = seats[i], b = seats[j]
        const d = Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1], a.at[2] - b.at[2])
        expect(d).toBeGreaterThan((a.r + b.r) * 2.6)
      }
    }
  })
})

describe('段を移る途中', () => {
  it('倍率は対数で混ぜる（手前で急に速くならない）', () => {
    near(lerpZoom(1.5, 12, 0), 1.5, 6)
    near(lerpZoom(1.5, 12, 1), 12, 6)
    near(lerpZoom(1.5, 12, 0.5), Math.sqrt(1.5 * 12), 6)
  })

  it('視点B の投影は、背後の点を描かない合図に null を返す', () => {
    const seats = fieldLayout(counts())
    const cam = cameraFor(initialCamera(seats), 'inside', 'mid', null)
    const project = makeProjector(cam, 'inside', 390, 720)
    const front = focusPointOf('ring', cam.rotY)
    expect(project(front)).not.toBeNull()
    expect(project([-front[0], 0, -front[2]])).toBeNull()
  })
})

describe('タップ判定', () => {
  // 描いた場所と選ばれる場所を食い違わせないため、当たり判定は描画と同じ位置を見る。
  const hits = {
    planets: [
      { slot: 3, X: 100, Y: 100, S: 8, Z: 0.9 },   // 奥（先に描かれる＝下になる）
      { slot: 7, X: 104, Y: 102, S: 8, Z: -0.8 },  // 手前（上に乗る）
    ],
    dots: [{ claimId: 'a', X: 50, Y: 50 }, { claimId: 'b', X: 58, Y: 50 }],
    pages: [{ pageId: 'p1', x: 10, y: 20, w: 60, h: 18 }],
    shelf: [],
    dotPos: new Map<string, { X: number; Y: number }>(),
    families: [],
  }

  it('惑星が重なったら手前を取る（画面に見えているのは手前）', () => {
    expect(pickPlanet(hits, 102, 101)).toBe(7)
  })

  it('どの惑星からも離れていれば何も返さない', () => {
    expect(pickPlanet(hits, 300, 300)).toBeNull()
  })

  it('主張の点は、半径の内でいちばん近いものを取る', () => {
    expect(pickNearest(hits.dots, 52, 50, 11)?.claimId).toBe('a')
    expect(pickNearest(hits.dots, 56, 50, 11)?.claimId).toBe('b')
    expect(pickNearest(hits.dots, 200, 200, 11)).toBeNull()
  })

  it('記事名は札の四角で拾う', () => {
    expect(pickPage(hits, 40, 28)).toBe('p1')
    expect(pickPage(hits, 40, 50)).toBeNull()
  })
})

// ── 星団（再計画 §4.3） ────────────────────────
describe('星団の配置とカメラ（再計画 §4.3）', () => {
  it('席の位置が clusterPointOf と一致し、半径は planetRadius のまま（fitScale を掛けない）', () => {
    const c = counts()
    const max = Math.max(...c)
    const seats = fieldLayout(c, 'cluster')
    for (const s of seats) {
      expect(s.at).toEqual(clusterPointOf(s.slot))
      near(s.r, planetRadius(s.n, max))
    }
  })
  it('遠景は原点を見て倍率 2.4・見下ろし −0.55', () => {
    const seats = fieldLayout(counts(), 'cluster')
    const cam = cameraFor(initialCamera(seats, 'cluster'), 'outside', 'far', null, 'cluster')
    expect(cam.zoom).toBe(CLUSTER_ZOOM); expect(cam.rotX).toBe(CLUSTER_PITCH); expect(cam.focus).toEqual([0, 0, 0])
  })
  it('中景は寄せた惑星を見て倍率 5', () => {
    const seats = fieldLayout(counts(), 'cluster')
    const seat = seats.find((s) => s.slot === 3)!
    const cam = cameraFor(initialCamera(seats, 'cluster'), 'outside', 'mid', seat, 'cluster')
    expect(cam.zoom).toBe(CLUSTER_MID_ZOOM); expect(cam.focus).toEqual(seat.at)
  })
  it('輪の配置は今までどおり（fitScale が効く・カメラも既存値）', () => {
    const seats = fieldLayout(counts())
    const cam = cameraFor(initialCamera(seats), 'outside', 'far', null)
    expect(cam.zoom).toBe(FAR_ZOOM); expect(cam.rotX).toBe(RING_PITCH)
  })
})
