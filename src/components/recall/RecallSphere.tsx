'use client'
// 球の canvas。回す（ドラッグ・慣性）、寄る（ホイール・ピンチ 1.0〜3.4倍）、タップ（主張を選ぶ）。
// 描画は drawFrame に委ね、ここは操作と RAF だけを持つ。タブ非表示のときは RAF を止める。
import { useEffect, useRef } from 'react'
import { drawFrame, pickAt, hereMark, viewport, MAX_ZOOM, type Camera, type Sprite, type Mark, type LensMode } from '@/lib/recall/render'

type Props = {
  sprites: Sprite[]; marks: Mark[]; flying: Map<string, number>; dimmed: boolean; lens: LensMode; shakeUntil: number
  onPick: (claimId: string | null, at: { x: number; y: number }) => void
  onDeckTap: (claimId: string) => void
  onHere: (text: string | null) => void
  onZoom: (zoom: number) => void
}

export function RecallSphere({ sprites, marks, flying, dimmed, lens, shakeUntil, onPick, onDeckTap, onHere, onZoom }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  const cam = useRef<Camera>({ rotY: 0, rotX: -0.12, zoom: 1 })
  const vel = useRef({ vy: 0.0013, vx: 0 })
  const drag = useRef<{ x: number; y: number; moved: number } | null>(null)
  const ptrs = useRef(new Map<number, [number, number]>())
  const pinch = useRef<{ d: number; z: number } | null>(null)
  const deckPos = useRef(new Map<string, { X: number; Y: number }>())
  const latest = useRef({ sprites, marks, flying, dimmed, lens, shakeUntil, onHere, onZoom })
  latest.current = { sprites, marks, flying, dimmed, lens, shakeUntil, onHere, onZoom }
  // pickAt は「最後に描いたフレーム」と同じ t・reduced を要る（当たり判定はゆらいだ描画位置を見るため）。
  // frame() が毎回書き込み、ポインタハンドラ（effect の外）はここから読む。
  const tRef = useRef(0)
  const reducedRef = useRef(false)

  useEffect(() => {
    const cv = ref.current!
    const ctx = cv.getContext('2d')!
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
    reducedRef.current = reduced
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
      if (!drag.current) {
        c.rotY += v.vy * dt; c.rotX += v.vx * dt; v.vx *= 0.98
        const base = reduced ? 0 : 0.0001
        if (Math.abs(v.vy) > base) v.vy *= 0.985; else v.vy = base * Math.sign(v.vy || 1)
      }
      c.rotX = Math.max(-1.2, Math.min(1.2, c.rotX))
      const L = latest.current
      const t = now * 0.001
      tRef.current = t
      const shake = now < L.shakeUntil ? Math.sin(now * 0.05) * ((L.shakeUntil - now) / 420) * 0.28 : 0
      ctx.save(); ctx.translate(shake * 8, 0)
      deckPos.current = drawFrame(ctx, { W, H, cam: c, sprites: L.sprites, flying: L.flying, marks: L.marks, t, reduced, dimmed: L.dimmed, lens: L.lens })
      ctx.restore()
      const here = hereMark(L.marks, c, viewport(W, H, c, L.flying.size))
      const hereText = here ? `いま見ている区画　${here.text}　${here.n}主張` : null
      if (hereText !== lastHere) { lastHere = hereText; L.onHere(hereText) }
      raf = requestAnimationFrame(frame)
    }
    const onVis = () => { if (document.hidden) cancelAnimationFrame(raf); else { last = performance.now(); raf = requestAnimationFrame(frame) } }
    document.addEventListener('visibilitychange', onVis)
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener('visibilitychange', onVis) }
  }, [])

  const setZoom = (z: number) => { cam.current.zoom = Math.max(1, Math.min(MAX_ZOOM, z)); latest.current.onZoom(cam.current.zoom) }

  const onWheel = (e: React.WheelEvent) => { e.preventDefault(); setZoom(cam.current.zoom * (1 - e.deltaY * 0.0016)) }
  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY])
    if (ptrs.current.size === 2) {
      const v = [...ptrs.current.values()]
      pinch.current = { d: Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]), z: cam.current.zoom }; drag.current = null; return
    }
    drag.current = { x: e.clientX, y: e.clientY, moved: 0 }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, [e.clientX, e.clientY])
    if (ptrs.current.size === 2 && pinch.current) {
      const v = [...ptrs.current.values()]
      setZoom(pinch.current.z * Math.hypot(v[0][0] - v[1][0], v[0][1] - v[1][1]) / pinch.current.d); return
    }
    const d = drag.current; if (!d) return
    const dx = e.clientX - d.x, dy = e.clientY - d.y
    d.moved += Math.abs(dx) + Math.abs(dy)
    vel.current = { vy: dx * 0.00035, vx: dy * 0.00025 }
    cam.current.rotY += dx * 0.005; cam.current.rotX += dy * 0.004
    d.x = e.clientX; d.y = e.clientY
  }
  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    ptrs.current.delete(e.pointerId)
    if (ptrs.current.size < 2) pinch.current = null
    const d = drag.current; drag.current = null
    if (!d || d.moved >= 6) return
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left, my = e.clientY - rect.top
    for (const [id, p] of deckPos.current) if (Math.hypot(p.X - mx, p.Y - my) < 26) { onDeckTap(id); return }
    const W = rect.width, H = rect.height, c = cam.current
    // 半径・中心は viewport() 一本から取る（drawFrame・hereMark と同じ値。ここで計算し直さない）。
    const view = viewport(W, H, c, latest.current.flying.size)
    const hit = pickAt(
      latest.current.sprites.filter((s) => !latest.current.flying.has(s.claimId)),
      c, view, tRef.current, reducedRef.current, mx, my, c.zoom > 1.4 ? 26 : 20,
    )
    onPick(hit?.claimId ?? null, { x: mx, y: my })
  }

  return (
    <canvas ref={ref} className="absolute inset-0 w-full h-full touch-none cursor-grab active:cursor-grabbing"
      onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
  )
}
