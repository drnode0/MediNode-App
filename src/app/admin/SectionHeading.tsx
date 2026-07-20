'use client'
import { useEffect, useRef, useState, type ReactNode } from 'react'
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
export function InfoPopover({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  return (
    <span
      ref={ref}
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="この指標の説明"
        onClick={() => setOpen((v) => !v)}
        className="text-gray-300 hover:text-gray-500 dark:text-gray-600 dark:hover:text-gray-400"
      >
        <HelpCircle className="w-3.5 h-3.5" aria-hidden />
      </button>
      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-5 z-30 w-60 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-900 p-2.5 text-[11px] leading-relaxed text-gray-600 dark:text-gray-300 shadow-lg"
        >
          {children}
        </span>
      )}
    </span>
  )
}
