'use client'

// モーダル表示中に背景スクロールを止める共有フック。
//
// 以前は body { overflow: hidden } を使っていたが、iOSではキーボード表示時に
// ページ全体がパンして、モーダルを閉じた後も表示位置がズレたままになることがある。
// position: fixed でbodyを現在のスクロール位置に「釘付け」にし、解除時に
// 元のスクロール位置へ戻す方式ならこの問題が起きない。
import { useEffect } from 'react'

export function useBodyScrollLock() {
  useEffect(() => {
    const body = document.body
    const scrollY = window.scrollY
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    }
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    return () => {
      body.style.position = prev.position
      body.style.top = prev.top
      body.style.left = prev.left
      body.style.right = prev.right
      body.style.width = prev.width
      window.scrollTo(0, scrollY)
    }
  }, [])
}
