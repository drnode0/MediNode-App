'use client'

// 🔍 無料会員プレビュー中の常時バナー。
// オーナーが「自分の画面だけ」を無料会員表示にしている間、付けっぱなしを防ぐため上部に常駐させ、
// ワンタップで解除できるようにする。自分の見え方だけの切替なので他ユーザーには影響しない。

import { useEffect, useState } from 'react'
import { isFreePreview, setFreePreview } from '@/lib/algolia'

export function FreePreviewBanner() {
  const [on, setOn] = useState(false)
  // localStorage 読み取りはクライアントのみ。ハイドレーション後に反映する。
  useEffect(() => {
    setOn(isFreePreview())
  }, [])

  if (!on) return null

  return (
    <div className="sticky top-0 z-[60] flex items-center justify-center gap-2 bg-amber-500 px-3 py-1.5 text-center text-xs font-medium text-white">
      <span>🔍 無料会員プレビュー中（あなただけ・実際の会員には影響しません）</span>
      <button
        type="button"
        onClick={() => {
          setFreePreview(false)
          window.location.reload()
        }}
        className="shrink-0 rounded-full bg-white/20 px-2 py-0.5 font-semibold underline-offset-2 hover:bg-white/30"
      >
        解除してプレミアムに戻す
      </button>
    </div>
  )
}
