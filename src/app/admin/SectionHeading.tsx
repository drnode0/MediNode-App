'use client'
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { HelpCircle } from 'lucide-react'

// 見出し＋常時キャプション＋「?」定義。既存の h2（text-sm font-semibold）に合わせた見た目。
export function SectionHeading({
  title,
  caption,
  help,
  className = '',
}: {
  title: string
  caption?: string
  help?: ReactNode
  className?: string
}) {
  return (
    <div className={`mb-2 ${className}`}>
      <div className="flex items-center gap-1.5">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">{title}</h2>
        {help && <InfoPopover>{help}</InfoPopover>}
      </div>
      {caption && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 leading-snug">{caption}</p>
      )}
    </div>
  )
}

// 「?」アイコン。PCはホバー、スマホはタップで開く（title属性頼みにしない）。
// ポップオーバーはビューポート幅からはみ出さないよう開いた後に横位置を補正する
// （スマホで右端のカードだと画面外に切れていたのを防ぐ）。
export function InfoPopover({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [shift, setShift] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)
  const popRef = useRef<HTMLSpanElement>(null)

  const close = () => {
    setOpen(false)
    setShift(0)
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // 開いた直後にビューポート内へ収める（右端／左端のはみ出しを平行移動で補正）。
  useLayoutEffect(() => {
    if (!open || !popRef.current) return
    const rect = popRef.current.getBoundingClientRect()
    const margin = 8
    let delta = 0
    if (rect.right > window.innerWidth - margin) delta = window.innerWidth - margin - rect.right
    else if (rect.left < margin) delta = margin - rect.left
    if (delta !== 0) setShift((prev) => prev + delta)
  }, [open])

  return (
    <span
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={close}
    >
      <button
        type="button"
        aria-label="この指標の説明"
        onClick={() => (open ? close() : setOpen(true))}
        className="text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400"
      >
        <HelpCircle className="w-3.5 h-3.5" aria-hidden />
      </button>
      {open && (
        <span
          ref={popRef}
          role="tooltip"
          style={{ transform: `translateX(${shift}px)` }}
          className="absolute left-0 top-5 z-30 w-60 max-w-[calc(100vw-1rem)] rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 p-2.5 text-[11px] leading-relaxed text-gray-600 dark:text-gray-300 shadow-lg"
        >
          {children}
        </span>
      )}
    </span>
  )
}
