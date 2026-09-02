'use client'
// 球の canvas。回す（ドラッグ・慣性）、寄る（ホイール・ピンチ 1.0〜3.4倍）、タップ（主張を選ぶ）。
// 描画は drawFrame に委ね、ここは操作と RAF だけを持つ。タブ非表示のときは RAF を止める。
// 動きを減らす設定のときは、慣性回転（放っておいても回り続ける分）と揺れを止める。
import { useEffect, useRef } from 'react'
import { drawFrame, pickAt, hereMark, viewport, MAX_ZOOM, type Camera, type Sprite, type Mark, type LensMode } from '@/lib/recall/render'
import type { Vec3 } from '@/lib/recall/layout'

type Props = {
  sprites: Sprite[]; marks: Mark[]; strands: Vec3[][]; flying: Map<string, number>; dimmed: boolean; lens: LensMode; shakeUntil: number
  reduced: boolean
  onPick: (claimId: string | null, at: { x: number; y: number }) => void
  onDeckTap: (claimId: string) => void
  onHere: (text: string | null) => void
  onZoom: (zoom: number) => void
}

const IDLE_SPIN = 0.0013

export function RecallSphere({ sprites, marks, strands, flying, dimmed, lens, shakeUntil, reduced, onPick, onDeckTap, onHere, onZoom }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const cam = useRef<Camera>({ rotY: 0, rotX: -0.12, zoom: 1 })
  const vel = useRef({ vy: 0, vx: 0 })
  const drag = useRef<{ x: number; y: number; moved: number } | null>(null)
  const ptrs = useRef(new Map<number, [number, number]>())
  const pinch = useRef<{ d: number; z: number } | null>(null)
  const deckPos = useRef(new Map<string, { X: number; Y: number }>())
  const latest = useRef({ sprites, marks, strands, flying, dimmed, lens, shakeUntil, onHere, onZoom })
  latest.current = { sprites, marks, strands, flying, dimmed, lens, shakeUntil, onHere, onZoom }
  // pickAt は「最後に描いたフレーム」と同じ t・reduced を要る（当たり判定はゆらいだ描画位置を見るため）。
  // frame() が毎回書き込み、ポインタハンドラ（effect の外）はここから読む。
  const tRef = useRef(0)
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced

  const setZoom = (z: number) => { cam.current.zoom = Math.max(1, Math.min(MAX_ZOOM, z)); latest.current.onZoom(cam.current.zoom) }

  // 設定が「動きを減らす」に変わったら、その場で慣性を落とす（回り続けたままにしない）。
  useEffect(() => { if (reduced) vel.current = { vy: 0, vx: 0 } }, [reduced])

  useEffect(() => {
    const cv = ref.current
    // 2D コンテキストが取れない環境（描画を止めている等）では例外にせず何もしない。
    // render.ts の sprites() も同じ倒し方をしている。
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return
    if (!reducedRef.current) vel.current = { vy: IDLE_SPIN, vx: 0 }
    let W = 0, H = 0
    const size = () => {
      const DPR = Math.min(devicePixelRatio || 1, 2)
      W = cv.clientWidth; H = cv.clientHeight
      cv.width = W * DPR; cv.height = H * DPR; ctx.setTransform(DPR, 0, 0, DPR, 0, 0)
    }
    size()
    const ro = new ResizeObserver(size); ro.observe(cv)
    let raf = 0, last = performance.now(), lastHere: string | null = null
    const frame = (now: number) => {
      const dt = Math.min(now - last, 50); last = now
      const c = cam.current, v = vel.current
      const red = reducedRef.current
      if (!drag.current) {
        c.rotY += v.vy * dt; c.rotX += v.vx * dt; v.vx *= 0.98
        // 動きを減らす設定では基準の回転も 0。慣性も残さず、その場で止める
        // （減衰は1フレームあたり 1.5% しかないので、放っておくと数秒回り続ける）。
        const base = red ? 0 : 0.0001
        if (red) { v.vy = 0; v.vx = 0 }
        else if (Math.abs(v.vy) > base) v.vy *= 0.985
        else v.vy = base * Math.sign(v.vy || 1)
      }
      c.rotX = Math.max(-1.2, Math.min(1.2, c.rotX))
      const L = latest.current
      const t = now * 0.001
      tRef.current = t
      const shake = !red && now < L.shakeUntil ? Math.sin(now * 0.05) * ((L.shakeUntil - now) / 420) * 0.28 : 0
      ctx.save(); ctx.translate(shake * 8, 0)
      deckPos.current = drawFrame(ctx, { W, H, cam: c, sprites: L.sprites, flying: L.flying, marks: L.marks, strands: L.strands, t, reduced: red, dimmed: L.dimmed, lens: L.lens })
      ctx.restore()
      const here = hereMark(L.marks, c, viewport(W, H, c, L.flying.size))
      const hereText = here ? `いま見ている区画　${here.text}　${here.n}主張` : null
      if (hereText !== lastHere) { lastHere = hereText; L.onHere(hereText) }
      raf = requestAnimationFrame(frame)
    }
    const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else { last = performance.now(); raf = requestAnimationFrame(frame) } }
    document.addEventListener('visibilitychange', onVis)
    // React の onWheel は root で passive 登録されるため、その中の preventDefault は効かない
    // （Ctrl+ホイールでブラウザ側が拡大し、Chrome は毎回 intervention の警告を出す）。
    // ここで passive:false を明示して登録する。
    const onWheel = (e: WheelEvent) => { e.preventDefault(); setZoom(cam.current.zoom * (1 - e.deltaY * 0.0016)) }
    cv.addEventListener('wheel', onWheel, { passive: false })
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf); ro.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      cv.removeEventListener('wheel', onWheel)
    }
  }, [])

  // 指が2本そろっているときだけピンチの基準を取り直す。3本目が下りたあと2本に戻ったときも
  // ここを通す（古い基準のままだと、指を1本離した瞬間に倍率が飛ぶ）。
  const syncPinch = () => {
    const v = [...ptrs.current.values()]
    pinch.current = v.length === 2
      ? { d: Math.max(1, Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1])), z: cam.current.zoom }
      : null
  }

  const capture = (e: React.PointerEvent<HTMLCanvasElement>) => {
    // 2本目以降も捕まえる。捕まえないと canvas の外で離した指の pointerup が来ず、
    // ptrs に幽霊が残って以後のピンチ判定が狂う（ペンとタッチが混じるときに起きる）。
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 捕まえられない端末は諦める */ }
  }

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    capture(e)
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY])
    if (ptrs.current.size >= 2) { drag.current = null; syncPinch(); return }
    drag.current = { x: e.clientX, y: e.clientY, moved: 0 }
  }
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, [e.clientX, e.clientY])
    if (ptrs.current.size === 2 && pinch.current) {
      const v = [...ptrs.current.values()]
      setZoom(pinch.current.z * Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]) / pinch.current.d); return
    }
    if (ptrs.current.size > 2) return // 3本以上のあいだは回さない
    const d = drag.current; if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    d.moved += Math.abs(dx) + Math.abs(dy)
    // 動きを減らす設定では、指を離したあとに滑らせない（ドラッグ中の回転そのものは残す）。
    vel.current = reducedRef.current ? { vy: 0, vx: 0 } : { vy: dx * 0.00035, vx: dy * 0.00025 }
    cam.current.rotY += dx * 0.005; cam.current.rotX += dy * 0.004
    d.x = e.clientX; d.y = e.clientY
  }
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    ptrs.current.delete(e.pointerId)
    if (ptrs.current.size >= 2) { drag.current = null; syncPinch(); return }
    pinch.current = null
    // ピンチから指が1本残っただけの状態では、ドラッグもタップも始めない。
    if (ptrs.current.size === 1) { drag.current = null; return }
    const d = drag.current; drag.current = null
    if (!d || d.moved >= 6) return
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left, my = e.clientY - rect.top
    for (const [id, p] of deckPos.current) if (Math.hypot(p.X - mx, p.Y - my) < 26) { onDeckTap(id); return }
    const c = cam.current
    // 半径・中心は viewport() 一本から取る（drawFrame・hereMark と同じ値。ここで計算し直さない）。
    const view = viewport(rect.width, rect.height, c, latest.current.flying.size)
    const hit = pickAt(
      latest.current.sprites.filter((s) => !latest.current.flying.has(s.claimId)),
      c, view, tRef.current, reducedRef.current, mx, my, c.zoom > 1.4 ? 26 : 20,
    )
    onPick(hit?.claimId ?? null, { x: mx, y: my })
  }

  return (
    <canvas ref={ref} className="absolute inset-0 w-full h-full touch-none cursor-grab active:cursor-grabbing"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
  )
}
