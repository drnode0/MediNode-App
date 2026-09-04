// カメラの判断（純関数）。段の判定・惑星への倍率・傾きの頭打ち・慣性の減速・
// 境目の名前の出し入れを、ここ1か所に集める。描画も canvas も知らない。
//
// テストが DOM を持たない（vitest に environment 指定が無い）ので、
// 画面の見え方を決める式はすべてここに出してテストする。
// field.ts と field-render.ts は、ここの値を組み立てるだけで式を持たない。
//
// 出所: 惑星のラフ（設計 2026-09-04「惑星の中の体験」決定3・6・7）。
// ラフはビルド後の1ファイルで変数名が潰れていたため、定数と式を写し取って書き直した。
import { EDGE_LABEL_MS, R_COLD } from './field-layout'

export type FieldStage = 'far' | 'mid' | 'near'
// 中心に何を置くか（決定5）。既定は「外から見る」、B は視点の切り替えとして残す。
export type FieldCenter = 'outside' | 'inside'

export const rad = (deg: number) => (deg * Math.PI) / 180
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

// ── 視点A（外から見る）─────────────────────────────
// リングの見下ろし角。中景・遠景はこの固定値で、近景だけ手で動かせる。
export const RING_PITCH = -0.18
// 近景に入った直後の見下ろし角。
export const NEAR_PITCH = -0.62
// 縦ドラッグの頭打ち。下限を割ると輪を真上から見てしまい、
// 上限を超えると輪が裏返って「高度＝保持力」の読みが崩れる。
export const PITCH_MIN = -1.35
export const PITCH_MAX = 0.05

export const FAR_ZOOM = 1.5
export const MID_ZOOM = 8
export const ZOOM_MIN = 1.2
export const ZOOM_MAX = 12
// 段の名前が変わる倍率。ここより低ければ遠景。
export const STAGE_ZOOM_EDGE = 4

// ── 視点B（中心＝自分）────────────────────────────
// カメラをリングの中心に置いたときの画角。遠景は視野を広げ、近景は惑星へ歩み寄る。
export const FAR_FOV = rad(95)
export const MID_FOV = rad(15)
export const NEAR_FOV = rad(42)
export const FOV_MIN = rad(12)
export const FOV_MAX = rad(100)
export const STAGE_FOV_EDGE = rad(40)

export const INSIDE_PITCH_MIN = 0.05
export const INSIDE_PITCH_MAX = 1.35

// 段ごとのカメラの目標値。field.ts がこの表を読んで FieldCamera を組み立てる。
export const OUTSIDE_STAGE = {
  far: { rotX: RING_PITCH, zoom: FAR_ZOOM },
  mid: { rotX: RING_PITCH, zoom: MID_ZOOM },
  near: { rotX: NEAR_PITCH },
} as const

export const INSIDE_STAGE = {
  far: { pitch: 0.24, fov: FAR_FOV, eyeY: 0.24 },
  mid: { pitch: 0.16, fov: MID_FOV, eyeY: 0.16 },
  near: { pitch: 0.55, fov: NEAR_FOV },
} as const

export const stageOfZoom = (zoom: number): FieldStage => (zoom < STAGE_ZOOM_EDGE ? 'far' : 'mid')
export const stageOfFov = (fov: number): FieldStage => (fov > STAGE_FOV_EDGE ? 'far' : 'mid')

export const clampZoom = (zoom: number) => clamp(zoom, ZOOM_MIN, ZOOM_MAX)
export const clampFov = (fov: number) => clamp(fov, FOV_MIN, FOV_MAX)
export const clampPitchOutside = (rotX: number) => clamp(rotX, PITCH_MIN, PITCH_MAX)
export const clampPitchInside = (pitch: number) => clamp(pitch, INSIDE_PITCH_MIN, INSIDE_PITCH_MAX)

// 近景の倍率（視点A）。惑星の輪郭の半径が短辺の 11.5% になるところで止める。
// 画面上の長さは「惑星の半径 × 短辺 × 0.42 × 倍率」なので、
// いちばん外の霧（3.38）まで入れても短辺の 78%（= 3.38 × 0.115 × 2）に収まり、
// 輪が指で選べる大きさに広がる。惑星が小さい席ほど倍率は上がる。
export const NEAR_PLANET_SCREEN_R = 0.115
export const PROJECT_SCALE = 0.42

export function zoomForPlanet(planetRadius: number): number {
  if (!(planetRadius > 0)) return MID_ZOOM
  return NEAR_PLANET_SCREEN_R / (PROJECT_SCALE * planetRadius)
}

// 近景で霧まで見たときに、短辺のどれだけを使うか（直径の比）。1 未満なら収まっている。
export const nearFogFill = (): number => 2 * R_COLD * NEAR_PLANET_SCREEN_R

// 近景の目の位置までの距離（視点B）。惑星へ歩み寄ったときに、
// 霧（3.38 に余白を足した 3.45）が画角にちょうど入る距離。
export const NEAR_EYE_SPAN = 3.45
export const NEAR_EYE_MARGIN = 0.92

export function eyeDistanceOf(planetRadius: number): number {
  return (NEAR_EYE_SPAN * planetRadius) / (Math.tan(NEAR_FOV / 2) * NEAR_EYE_MARGIN)
}

// ── 回す・慣性 ───────────────────────────────────
export const DRAG_YAW_PER_PX = 0.006
export const DRAG_PITCH_PER_PX = 0.005
// 指を離してから減速し切るまでの速さ。exp(-dt × 2.6) で毎秒 7% まで落ちる。
export const COAST_DECAY = 2.6
// これより遅くなったら止める。止めないと、いつまでも極小の回転が残る。
export const COAST_MIN = 0.002
// 押さえて止めてから離したと見なす時間。最後に動いてからこれだけ経っていたら慣性を付けない。
export const HOLD_MS = 80
export const WHEEL_K = 0.0012

export const dragYaw = (dx: number) => dx * DRAG_YAW_PER_PX
export const dragPitch = (dy: number) => dy * DRAG_PITCH_PER_PX

// ドラッグの速さ（ラジアン毎秒）。間隔が短すぎるフレームで速さが跳ねないよう下限を置く。
export function dragVelocity(dYaw: number, dtMs: number): number {
  return dYaw / (Math.max(8, dtMs) / 1000)
}

// 指を離したときの初速。押さえて止めてから離したときは 0（慣性を付けない）。
export function releaseVelocity(vel: number, sinceLastMoveMs: number): number {
  return sinceLastMoveMs > HOLD_MS ? 0 : vel
}

// リングのゆっくりした自転（ラジアン毎秒）。約3分で一周する。
// 2026-09-04 にオーナーの指示で入れた（決定14）。09-04 の当初は「リングの自転は既定で止める」
// だったが、止めると画面が静止画に見えるため向きを変えた。
// 遠景・中景でだけ回る（近景は惑星が画面の中央から動かないことを優先する）。
// 指で回しているあいだ・慣性が残っているあいだ・動きを減らす設定では回さない。
export const IDLE_SPIN = 0.035

// 慣性の減速。必ず 0 へ収束する（COAST_MIN を割ったところで止める）。
export function coast(vel: number, dtSec: number): number {
  if (!Number.isFinite(vel) || Math.abs(vel) < COAST_MIN) return 0
  const next = vel * Math.exp(-dtSec * COAST_DECAY)
  return Math.abs(next) < COAST_MIN ? 0 : next
}

export const zoomStep = (zoom: number, deltaY: number) => clampZoom(zoom * Math.exp(-deltaY * WHEEL_K))
export const fovStep = (fov: number, deltaY: number) => clampFov(fov * Math.exp(deltaY * WHEEL_K))

// 回した先の角度。いまの向きから半周以内になるように 2π の倍数を足す
//（帯で選んだ惑星が、遠回りせずに正面へ来る）。
export function wrapNear(target: number, current: number): number {
  const TAU = Math.PI * 2
  return target + Math.round((current - target) / TAU) * TAU
}

// ── 段を移るときの動き ───────────────────────────
export const FLY_MS = 650      // 惑星へ寄る・中景へ戻る
export const JUMP_MS = 600     // 帯で選んだ惑星が正面へ来る
export const SHELF_MS = 900    // 輪から棚へ離れる
export const SHELF_STAGGER_MS = 70
export const SHELF_DELAY_MS = 120

export const easeInOutCubic = (x: number) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2

export const lerp = (a: number, b: number, k: number) => a + (b - a) * k
// 倍率は対数で混ぜる。線形に混ぜると 1.5 倍から 8 倍へ飛ぶ間に、手前で急に速くなる。
export const lerpZoom = (a: number, b: number, k: number) => Math.exp(lerp(Math.log(a), Math.log(b), k))

// 動きを減らす設定のときは飛ばない（位置の変更は即時）。
export const flyDuration = (reduced: boolean, ms = FLY_MS) => (reduced ? 0 : ms)

// ── 境目の名前（決定7）─────────────────────────────
// 近景に入った直後の約3秒だけ出て、最後の 600ms で薄れて消える。最初のドラッグでも消える。
// 出すのは近景だけ（遠景・中景では輪そのものが読めない）。
// 見せ方は居場所5段だけなので（決定1）、状態の見せ方による出し分けは持たない。
export const EDGE_LABEL_FADE_MS = 600

export function edgeLabelAlpha(enteredAt: number, now: number, dragged: boolean, stage: FieldStage): number {
  if (stage !== 'near' || dragged) return 0
  const remain = EDGE_LABEL_MS - (now - enteredAt)
  if (remain <= 0) return 0
  return Math.min(1, remain / EDGE_LABEL_FADE_MS)
}
