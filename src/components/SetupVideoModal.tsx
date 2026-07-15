'use client'

// セットアップ動画（実機の通し操作・約3分）をアプリ内で再生するモーダル。
// 動画は public/guide/setup-video.mp4 に同梱（YouTube等の外部サービス不要）。
// Service Worker は mp4 をキャッシュしない（sw.js の静的アセット判定は画像/フォントのみ）ため、
// 端末ストレージを圧迫しない。preload="metadata" で開くまで本体はダウンロードされない。
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'

export default function SetupVideoModal({ onClose }: { onClose: () => void }) {
  const [mounted, setMounted] = useState(false)

  useBodyScrollLock()
  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!mounted) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 px-4 py-6"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="セットアップ動画"
        className="w-full max-w-sm rounded-2xl bg-gray-900 shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-2.5">
          <p className="text-xs font-semibold text-white leading-relaxed">
            セットアップの流れ（2分53秒）
            <span className="block font-normal text-gray-400">音は小さめのBGMのみ。赤枠がタップする場所です</span>
          </p>
          <button
            onClick={onClose}
            aria-label="閉じる"
            className="text-gray-300 hover:text-white p-2 -m-2 shrink-0"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video
          src="/guide/setup-video.mp4"
          controls
          autoPlay
          playsInline
          preload="metadata"
          className="w-full max-h-[75vh] bg-black"
        />
      </div>
    </div>,
    document.body,
  )
}
