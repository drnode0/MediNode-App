'use client'
// 惑星の canvas。回す（ドラッグ・慣性）・寄る（タップ／ホイール／ピンチ）・
// 近景で輪と芯を掴んで回す・点と記事名と棚をタップする。
// 描画は drawField、判断は field-camera に委ね、ここは操作と RAF だけを持つ。
// タブ非表示のあいだは RAF を止める。
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import {
  drawField, pickPlanet, pickNearest, pickPage,
  type FieldHits, type FlyingDot, type Planet, type FieldFrameArgs,
} from '@/lib/recall/field-render'
import {
  cameraFor, frontSlotOf, focusPointOf, initialCamera, lerpCamera, eyeFor, angleOf,
  type FieldCamera, type FieldCenter, type FieldMode,
} from '@/lib/recall/field'
import {
  stageOfZoom, stageOfFov, zoomStep, fovStep, clampZoom, clampFov,
  dragYaw, dragPitch, dragVelocity, releaseVelocity, coast,
  clampPitchOutside, clampPitchInside, edgeLabelAlpha, easeInOutCubic, wrapNear,
  FLY_MS, JUMP_MS, SHELF_MS, SHELF_DELAY_MS, SHELF_STAGGER_MS, IDLE_SPIN,
  RING_PITCH, INSIDE_STAGE,
  type FieldStage,
} from '@/lib/recall/field-camera'
import { CLUSTER_PITCH, CLUSTER_ZOOM, FAMILY_FOCUS_ZOOM } from '@/lib/recall/field-cluster'
import { paletteOf } from '@/lib/recall/field-palette'
import { isDarkNow } from './useIsDark'
import type { CoreKind } from '@/lib/recall/cores'

// 族名を押したときに、族の名詞と惑星の名前を出しておく長さ（設計 §4.3）。
const FAMILY_FOCUS_MS = 3200
// 触れてから扇形の弧が消えるまで（案4・設計 §4.2）。
const FAN_MS = 2600

export type FieldHandle = {
  // 惑星へ寄る。空の惑星（主張0件）には入れないので false を返す。
  enterNear: (slot?: number) => boolean
  backToMid: () => void
  backToFar: () => void
  jumpTo: (slot: number) => void
  frontSlot: () => number | null
  stage: () => FieldStage
}

type Props = {
  planets: Planet[]
  center: FieldCenter
  reduced: boolean
  initialNear?: number         // 渡されたら、中景を経由せずこの席の近景で開く（隠しコマンド用）
  initialStage?: FieldStage    // 'far' で開く（宇宙）
  mode?: FieldMode             // 'cluster' で族ごとの星団（宇宙）
  free?: boolean               // 近景の縦回しの頭打ちを外す（球・R5）
  lockNear?: boolean           // 近景から出ない（球から勝手に抜けない）
  fanOnTouch?: boolean         // 触れたときだけ記事の扇形を出す（案4）
  show?: FieldFrameArgs['show']
  familyLabels?: FieldFrameArgs['familyLabels']
  onPlanetTap?: (slot: number) => void
  onFamilyTap?: (kind: CoreKind) => void
  shelf: string[]              // 棚に並ぶ主張（並び順のまま）
  shelfBottom?: number         // 棚の高さ（画面の下端から px）。下の UI に重ねない
  again: Set<string>           // 「まだ」と答えたもの
  lensPageId: string | null
  cardOpen: boolean
  onFront: (slot: number | null) => void
  onStage: (stage: FieldStage, slot: number | null) => void
  onDotTap: (claimId: string) => void
  onShelfTap: (claimId: string) => void
  onLens: (pageId: string | null) => void
  onCloseCard: () => void
}

type Anim = { claimId: string; p: number; dir: 1 | -1; from: { X: number; Y: number }; startAt: number }

export const RecallField = forwardRef<FieldHandle, Props>(function RecallField(props, ref) {
  const cv = useRef<HTMLCanvasElement>(null)
  const latest = useRef(props)
  latest.current = props

  const cam = useRef<FieldCamera>(initialCamera(props.planets.map((p) => p.seat)))
  const stage = useRef<FieldStage>('mid')
  const nearSlot = useRef<number | null>(null)
  const nearBaseYaw = useRef(0)
  const handYaw = useRef(0)
  const vel = useRef(0)
  const drag = useRef<{ x: number; y: number; moved: boolean; t: number } | null>(null)
  const ptrs = useRef(new Map<number, [number, number]>())
  const pinch = useRef<{ d: number; zoom: number; fov: number } | null>(null)
  const fly = useRef<{ from: FieldCamera; to: FieldCamera; t0: number; dur: number } | null>(null)
  const enteredAt = useRef(0)
  const touchedAt = useRef(0)                                             // 最後に触れた時刻（扇形の弧）
  const midSlot = useRef<number | null>(null)                             // 星団で中央に寄せた惑星
  const farFocus = useRef<{ at: [number, number, number] } | null>(null)  // 族名を押したときの焦点
  const familyFocus = useRef<{ kind: CoreKind; until: number } | null>(null)
  const dragged = useRef(false)
  const hits = useRef<FieldHits>({ planets: [], dots: [], pages: [], shelf: [], dotPos: new Map(), families: [] })
  const anims = useRef<Anim[]>([])
  const size = useRef({ W: 0, H: 0 })

  const seatOf = (slot: number | null) =>
    slot === null ? null : latest.current.planets.find((p) => p.seat.slot === slot)?.seat ?? null

  const startFly = (to: FieldCamera, dur: number) => {
    if (latest.current.reduced) { cam.current = to; fly.current = null; return }
    fly.current = { from: { ...cam.current, focus: [...cam.current.focus], eye: [...cam.current.eye] }, to, t0: performance.now(), dur }
  }

  const goStage = (next: FieldStage, slot: number | null) => {
    const P = latest.current
    // 球の段では近景に留まる（背景タップ・ホイール・ピンチで抜けない）。
    if (P.lockNear && stage.current === 'near' && next !== 'near') return false
    if (next === 'near') {
      const seat = seatOf(slot)
      if (!seat || seat.n === 0) return false
      nearSlot.current = seat.slot
      handYaw.current = 0
      nearBaseYaw.current = wrapNear(angleOf(seat.at), cam.current.rotY)
      enteredAt.current = performance.now()
      dragged.current = false
    } else {
      nearSlot.current = null
      handYaw.current = 0
      midSlot.current = next === 'mid' ? slot : null
    }
    vel.current = 0
    const target = next === 'near' ? nearSlot.current : midSlot.current
    startFly(cameraFor(cam.current, P.center, next, seatOf(target), P.mode ?? 'ring'), FLY_MS)
    stage.current = next
    P.onStage(next, target)
    return true
  }

  useImperativeHandle(ref, () => ({
    enterNear: (slot?: number) => goStage('near', slot ?? nearSlot.current ?? frontSlotOf(latest.current.planets.map((p) => p.seat), cam.current.rotY)),
    backToMid: () => { goStage('mid', null) },
    backToFar: () => { goStage('far', null) },
    jumpTo: (slot: number) => {
      const seat = seatOf(slot)
      if (!seat) return
      if (stage.current === 'near') goStage('mid', null)
      vel.current = 0
      const next = cameraFor(cam.current, latest.current.center, stage.current === 'far' ? 'far' : 'mid', null)
      startFly({ ...next, rotY: wrapNear(angleOf(seat.at), cam.current.rotY) }, JUMP_MS)
    },
    frontSlot: () => stage.current === 'near'
      ? nearSlot.current
      : frontSlotOf(latest.current.planets.map((p) => p.seat), cam.current.rotY),
    stage: () => stage.current,
  }))

  // 主張が届く前は席が1つも無い。届いた時点で、使われている席が正面に来るよう置き直す。
  const inited = useRef(false)
  useEffect(() => {
    if (inited.current || !props.planets.length) return
    inited.current = true
    const seats = props.planets.map((p) => p.seat)
    const mode = props.mode ?? 'ring'
    const initial = initialCamera(seats, mode)
    const nearSeat = props.initialNear !== undefined
      ? seats.find((s) => s.slot === props.initialNear && s.n > 0) ?? null
      : null
    if (nearSeat) {
      cam.current = cameraFor(initial, props.center, 'near', nearSeat, mode)
      stage.current = 'near'
      nearSlot.current = nearSeat.slot
      enteredAt.current = performance.now()
      return
    }
    if (props.initialStage === 'far') {
      cam.current = cameraFor(initial, props.center, 'far', null, mode)
      stage.current = 'far'
      return
    }
    cam.current = initial
  }, [props.planets]) // eslint-disable-line react-hooks/exhaustive-deps

  // 視点A/B を切り替えたら、いまの段のカメラへ即座に置き換える（混ぜて飛ばさない）。
  useEffect(() => {
    vel.current = 0
    fly.current = null
    cam.current = cameraFor(cam.current, props.center, stage.current, seatOf(nearSlot.current))
    if (stage.current === 'near' && nearSlot.current !== null) nearBaseYaw.current = cam.current.rotY - handYaw.current
  }, [props.center]) // eslint-disable-line react-hooks/exhaustive-deps

  // 動きを減らす設定に変わったら、その場で慣性を落とす。
  useEffect(() => { if (props.reduced) { vel.current = 0; fly.current = null } }, [props.reduced])

  useEffect(() => {
    const el = cv.current
    // 2D コンテキストが取れない環境では例外にせず何もしない（球の canvas と同じ倒し方）。
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return
    const resize = () => {
      const dpr = Math.min(devicePixelRatio || 1, 2)
      size.current = { W: el.clientWidth, H: el.clientHeight }
      el.width = size.current.W * dpr
      el.height = size.current.H * dpr
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(el)

    let raf = 0
    let last = performance.now()
    let lastFront: number | null = null

    const syncShelf = (now: number, dt: number) => {
      const P = latest.current
      const list = anims.current
      P.shelf.forEach((id, i) => {
        if (list.some((a) => a.claimId === id)) return
        list.push({
          claimId: id,
          p: P.reduced ? 1 : 0,
          dir: 1,
          from: hits.current.dotPos.get(id) ?? { X: size.current.W / 2, Y: -20 },
          // ずらしは RAF の中で数える。setTimeout を使わないので、戻すで残る心配がない。
          startAt: P.reduced ? now : now + SHELF_DELAY_MS + i * SHELF_STAGGER_MS,
        })
      })
      for (const a of list) if (!P.shelf.includes(a.claimId)) a.dir = -1
      for (let i = list.length - 1; i >= 0; i--) {
        const a = list[i]
        if (now < a.startAt) continue
        a.p = Math.max(0, Math.min(1, a.p + ((dt * 1000) / SHELF_MS) * a.dir))
        if (a.dir === -1 && a.p <= 0) list.splice(i, 1)
      }
    }

    const frame = (now: number) => {
      const dt = Math.min(now - last, 50) / 1000
      last = now
      const P = latest.current
      const seats = P.planets.map((p) => p.seat)

      if (fly.current) {
        const f = fly.current
        const k = easeInOutCubic(Math.min(1, (now - f.t0) / f.dur))
        cam.current = lerpCamera(f.from, f.to, k)
        if (k >= 1) fly.current = null
      } else {
        if (!drag.current && vel.current) {
          if (stage.current === 'near') handYaw.current += vel.current * dt
          else cam.current.rotY += vel.current * dt
          vel.current = coast(vel.current, dt)
        } else if (!drag.current && !P.reduced && stage.current !== 'near') {
          // ゆっくりした自転（決定14）。手で回していないあいだだけ、リングが自分で回る。
          cam.current.rotY += IDLE_SPIN * dt
        }
        const c = cam.current
        if (stage.current === 'near') {
          const seat = seatOf(nearSlot.current)
          if (seat) {
            if (P.center === 'inside') {
              c.rotY = nearBaseYaw.current + handYaw.current
              c.eye = eyeFor(seat, c.rotY, c.pitch)
            } else {
              c.focus = [...seat.at]
            }
          }
        } else if (stage.current === 'mid') {
          c.rotX = P.mode === 'cluster' ? CLUSTER_PITCH : RING_PITCH
          const ms = seatOf(midSlot.current)
          // 星団の中景は、寄せた惑星そのものを見る。
          c.focus = P.mode === 'cluster' && ms ? [...ms.at] : focusPointOf(P.mode ?? 'ring', c.rotY)
        } else {
          c.rotX = P.mode === 'cluster' ? CLUSTER_PITCH : RING_PITCH
          // 族名を押しているあいだは、その星団を見る。
          c.focus = farFocus.current ? [...farFocus.current.at] : [0, 0, 0]
        }
      }

      syncShelf(now, dt)
      const flying: FlyingDot[] = anims.current.map((a) => ({
        claimId: a.claimId, from: a.from, p: a.p, dir: a.dir,
        again: P.again.has(a.claimId), slot: 0,
      }))

      hits.current = drawField(ctx, {
        W: size.current.W, H: size.current.H,
        cam: cam.current, center: P.center, planets: P.planets,
        nearSlot: nearSlot.current, handYaw: handYaw.current,
        lensPageId: P.lensPageId, flying,
        t: now * 0.001, reduced: P.reduced,
        edgeAlpha: edgeLabelAlpha(enteredAt.current, now, dragged.current, stage.current),
        // 地と線の色はアプリの実効テーマ（<html>.dark）で毎コマ決める。設定パネルで
        // 切り替えた瞬間から次のコマで紙⇄紺が入れ替わる。
        palette: paletteOf(isDarkNow()),
        shelfBottom: P.shelfBottom,
        // 案4: 触れたときだけ扇形の弧を出し、2.6 秒で消す（最後の 600ms で薄れる）。
        show: P.fanOnTouch
          ? { ...(P.show ?? {}), fans: true, fanAlpha: Math.max(0, Math.min(1, (FAN_MS - (now - touchedAt.current)) / 600)) }
          : P.show,
        familyLabels: stage.current === 'far' ? P.familyLabels : undefined,
        familyFocus: familyFocus.current,
      })

      const front = stage.current === 'near' ? nearSlot.current : frontSlotOf(seats, cam.current.rotY)
      if (front !== lastFront) { lastFront = front; P.onFront(front) }
      raf = requestAnimationFrame(frame)
    }

    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(raf)
      else { last = performance.now(); raf = requestAnimationFrame(frame) }
    }
    document.addEventListener('visibilitychange', onVis)

    // React の onWheel は root で passive 登録されるので、その中の preventDefault は効かない。
    // ここで passive:false を明示して登録する（球の canvas と同じ）。
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (stage.current === 'near') { if (e.deltaY > 0) goStage('mid', null); return }
      fly.current = null
      const P = latest.current
      const c = cam.current
      if (P.center === 'inside') {
        c.fov = fovStep(c.fov, e.deltaY)
        const next = stageOfFov(c.fov)
        const s = next === 'far' ? INSIDE_STAGE.far : INSIDE_STAGE.mid
        c.pitch = s.pitch
        c.eye = [0, s.eyeY, 0]
        if (next !== stage.current) { stage.current = next; P.onStage(next, null) }
        return
      }
      c.zoom = zoomStep(c.zoom, e.deltaY)
      const next = stageOfZoom(c.zoom)
      if (next !== stage.current) {
        stage.current = next
        if (next === 'far') midSlot.current = null
        P.onStage(next, null)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })

    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      el.removeEventListener('wheel', onWheel)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 指が2本そろっているときだけピンチの基準を取り直す。3本目が下りたあと2本に戻ったときも
  // ここを通す（古い基準のままだと、指を1本離した瞬間に倍率が飛ぶ）。
  const syncPinch = () => {
    const v = [...ptrs.current.values()]
    pinch.current = v.length === 2
      ? { d: Math.max(1, Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1])), zoom: cam.current.zoom, fov: cam.current.fov }
      : null
  }

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 捕まえられない端末は諦める */ }
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY])
    if (ptrs.current.size >= 2) { drag.current = null; syncPinch(); return }
    vel.current = 0
    touchedAt.current = performance.now()
    drag.current = { x: e.clientX, y: e.clientY, moved: false, t: performance.now() }
  }

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, [e.clientX, e.clientY])
    if (ptrs.current.size === 2 && pinch.current) {
      const v = [...ptrs.current.values()]
      const ratio = Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]) / pinch.current.d
      if (stage.current === 'near') { if (ratio < 0.8) goStage('mid', null); return }
      fly.current = null
      const P = latest.current
      if (P.center === 'inside') {
        cam.current.fov = clampFov(pinch.current.fov / ratio)
        const next = stageOfFov(cam.current.fov)
        const s = next === 'far' ? INSIDE_STAGE.far : INSIDE_STAGE.mid
        cam.current.pitch = s.pitch
        cam.current.eye = [0, s.eyeY, 0]
        if (next !== stage.current) { stage.current = next; P.onStage(next, null) }
        return
      }
      cam.current.zoom = clampZoom(pinch.current.zoom * ratio)
      const next = stageOfZoom(cam.current.zoom)
      if (next !== stage.current) {
        stage.current = next
        if (next === 'far') midSlot.current = null
        P.onStage(next, null)
      }
      return
    }
    if (ptrs.current.size > 2) return // 3本以上のあいだは回さない
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    d.moved = true
    dragged.current = true
    fly.current = null
    const now = performance.now()
    const yaw = dragYaw(dx)
    const P = latest.current
    if (stage.current === 'near') {
      handYaw.current += yaw
      if (P.center === 'inside') cam.current.pitch = clampPitchInside(cam.current.pitch - dragPitch(dy))
      // 球の段（free）は縦横斜めに頭打ちなし（R5）。輪が裏返るのは眺める段なので許容する。
      else cam.current.rotX = P.free ? cam.current.rotX + dragPitch(dy) : clampPitchOutside(cam.current.rotX + dragPitch(dy))
    } else {
      cam.current.rotY += yaw
    }
    vel.current = dragVelocity(yaw, now - d.t)
    drag.current = { x: e.clientX, y: e.clientY, moved: true, t: now }
  }

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    ptrs.current.delete(e.pointerId)
    if (ptrs.current.size >= 2) { drag.current = null; syncPinch(); return }
    pinch.current = null
    // ピンチから指が1本残っただけの状態では、ドラッグもタップも始めない。
    if (ptrs.current.size === 1) { drag.current = null; return }
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved) {
      // 押さえて止めてから離したときは慣性を付けない。
      vel.current = releaseVelocity(vel.current, performance.now() - d.t)
      return
    }
    vel.current = 0
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left, my = e.clientY - rect.top
    const P = latest.current
    const h = hits.current
    const onShelf = pickNearest(h.shelf, mx, my, 16)
    if (onShelf) { P.onShelfTap(onShelf.claimId); return }
    if (stage.current === 'near') {
      const dot = pickNearest(h.dots, mx, my, 11)
      if (dot) { P.onDotTap(dot.claimId); return }
      const page = pickPage(h, mx, my)
      if (page) { P.onLens(P.lensPageId === page ? null : page); return }
      if (P.cardOpen) { P.onCloseCard(); return }
      goStage('mid', null)
      return
    }
    // 宇宙の遠景。族名を押すとその星団へ寄り、族の名詞と惑星の名前が 3.2 秒出る（R7）。
    if (stage.current === 'far') {
      const fam = h.families.find((f) => mx >= f.x && mx <= f.x + f.w && my >= f.y && my <= f.y + f.h)
      const fl = fam ? P.familyLabels?.find((f) => f.kind === fam.kind) : undefined
      if (fam && fl) {
        farFocus.current = { at: [fl.at[0], fl.at[1] - 0.2, fl.at[2]] }
        familyFocus.current = { kind: fam.kind, until: performance.now() + FAMILY_FOCUS_MS }
        fly.current = null
        startFly({ ...cam.current, focus: [...farFocus.current.at], zoom: FAMILY_FOCUS_ZOOM }, FLY_MS)
        P.onFamilyTap?.(fam.kind)
        return
      }
    }
    const slot = pickPlanet(h, mx, my)
    // 空を押したら族の寄りを解いて、宇宙の全体へ戻る。
    if (slot === null && stage.current === 'far' && farFocus.current) {
      farFocus.current = null
      startFly({ ...cam.current, focus: [0, 0, 0], zoom: CLUSTER_ZOOM }, FLY_MS)
      return
    }
    if (slot === null) return
    // 空の席は押せない（R9）。
    if ((seatOf(slot)?.n ?? 0) === 0) return
    if (P.mode === 'cluster') {
      // 中央に寄せた惑星をもう一度押すと球へ。ほかは中景へ寄せる。
      if (stage.current === 'mid' && midSlot.current === slot) {
        if (P.onPlanetTap) P.onPlanetTap(slot)
        else goStage('near', slot)
      } else goStage('mid', slot)
      return
    }
    if (P.onPlanetTap) P.onPlanetTap(slot)
    else goStage('near', slot)
  }

  return (
    <canvas ref={cv} className="absolute inset-0 w-full h-full touch-none cursor-grab active:cursor-grabbing"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
  )
})
