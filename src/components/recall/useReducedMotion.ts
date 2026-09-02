'use client'
// 「動きを減らす」設定を1か所で読む。読んだ値は画面から球へ配って回る（render.ts が
// reduced を受け取っているのと同じ渡し方）。CSS のアニメーションは globals.css の
// 全体規則で止まるが、canvas の描画と JavaScript の慣性はそれでは止まらないので、
// 飛ぶ動き・揺れ・慣性回転はこの値を見て自分で止める。
import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

export function useReducedMotion(): boolean {
  // サーバ側では matchMedia が無い。初回は false で描き、mount 後に本当の値へ合わせる。
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (typeof matchMedia !== 'function') return
    const mq = matchMedia(QUERY)
    const sync = () => setReduced(mq.matches)
    sync()
    // Safari 13 以前は addEventListener を持たない。あるときだけ購読する。
    if (typeof mq.addEventListener !== 'function') return
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  return reduced
}
