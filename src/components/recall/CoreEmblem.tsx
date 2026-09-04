'use client'
// 紋章。一覧の一枚（72px）と分野ページの見出し（96px）で使う小さな canvas。
// 芯そのものの描き方は drawCore3D（field-render.ts）に委ね、ここは
// canvas の張り方（dpr）・rAF への登録・画面外の間引き・テーマの読み方だけを持つ。
//
// 見た目の正本はオーナーのラフ（drawEmblem）。ラフは地を塗ってから芯を描いていたが、
// canvas 自体は塗りつぶさない（clearRect のみ＝透明）。一枚（plate）の背景をそのまま
// 透かすことで、線画の原則（面・塗り・影を使わない）にも合わせ、画面外で間引かれて
// いた紋章がテーマ替わりの再描画前に見えても「白い箱」にはならないようにする
// （古いテーマの線色が透明地に残るだけで済む。線色の残りは registerThemeRedraw で消す）。
// 半径 size×0.47 の薄い輪郭（alpha 0.5）を重ねる。
import { useEffect, useRef } from 'react'
import { drawCore3D } from '@/lib/recall/field-render'
import { coreIndividual, CORE_SPIN, type CoreKind } from '@/lib/recall/cores'
import { paletteOf } from '@/lib/recall/field-palette'
import { isDarkNow } from './useIsDark'
import { useReducedMotion } from './useReducedMotion'
import { registerEmblem, registerThemeRedraw } from './emblem-loop'

type Props = {
  slot: number
  kind: CoreKind
  size: 72 | 96
  className?: string
}

export function CoreEmblem({ slot, kind, size, className }: Props) {
  const cv = useRef<HTMLCanvasElement>(null)
  const reduced = useReducedMotion()

  useEffect(() => {
    const el = cv.current
    const ctx = el?.getContext('2d')
    if (!el || !ctx) return

    const dpr = Math.min(devicePixelRatio || 1, 2)
    el.width = size * dpr
    el.height = size * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const ind = coreIndividual(slot)

    const draw = (now: number) => {
      // テーマは毎フレーム DOM から見る。フックの初回値（false）を使うと、
      // ダークで開いた最初の1コマだけ紙の地が白く光る不具合になる（RecallField と同じ理由）。
      const palette = paletteOf(isDarkNow())
      const t = now * 0.001
      ctx.clearRect(0, 0, size, size)
      drawCore3D(ctx, {
        cx: size / 2,
        cy: size / 2,
        CR: size * 0.36 * ind.scale,
        kind,
        t: t * ind.rate,
        reduced,
        yaw: t * ind.rate * CORE_SPIN[kind],
        pitch: ind.tilt,
        palette,
        // ライトの紙の上では奥行きのぼかし（奥ほど薄くする既定 0.1）で奥の線が消える。
        // 線の本数が少ない signal（枝）の族で特にはっきり出るため、ライトのときだけ底上げする。
        // ダークはオーナー承認済みの見た目なので既定のまま変えない。
        minA: isDarkNow() ? undefined : 0.25,
      })
      ctx.globalAlpha = 0.5
      ctx.strokeStyle = palette.outline
      ctx.lineWidth = 0.8
      ctx.beginPath()
      ctx.arc(size / 2, size / 2, size * 0.47, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    let unregister: (() => void) | null = null
    let io: IntersectionObserver | null = null

    // テーマ（<html> の dark クラス）が変わった瞬間は、画面外で間引かれている紋章
    // （動きを減らす設定で1回描いて止めた紋章も含む）も可視判定を無視して描き直す。
    // これをしないと、ライトで開いて下へスクロールする前にダークへ切り替えたとき、
    // 次にその紋章が見えるまで古いテーマの線色が残ってしまう。
    const unregisterTheme = registerThemeRedraw(draw)

    if (reduced) {
      // 動きを減らす設定では1回だけ描いて止める（共有 rAF には登録しない）。
      draw(performance.now())
    } else {
      let visible = true
      const wrapped = (now: number) => { if (visible) draw(now) }
      // 画面外の紋章は描かない。IntersectionObserver が最初の判定を返すまでは
      // 見えている扱いにして、初回の1コマが欠けないようにする。
      io = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting }, { rootMargin: '80px' })
      io.observe(el)
      unregister = registerEmblem(wrapped)
    }

    return () => {
      io?.disconnect()
      unregister?.()
      unregisterTheme()
    }
  }, [slot, kind, size, reduced])

  return <canvas ref={cv} className={className} style={{ width: size, height: size }} />
}
