'use client'
import { CircleCheck, TriangleAlert, CircleHelp } from 'lucide-react'
import { CONFIDENCE_LABEL, type Confidence } from '@/lib/reader-confidence'

const ICON = { ok: CircleCheck, caut: TriangleAlert, unk: CircleHelp } as const
// コントラスト実測済みトークン（light は AA/3:1 が取れる濃さ、dark は明側）
export const MARK_COLOR: Record<Confidence, string> = {
  ok: 'text-teal-700 dark:text-teal-300',
  caut: 'text-amber-700 dark:text-amber-300',
  unk: 'text-red-700 dark:text-red-300',
}

export function ConfidenceMark({ kind, className = '' }: { kind: Confidence; className?: string }) {
  const Icon = ICON[kind]
  return (
    <span className={`inline-flex items-baseline ${MARK_COLOR[kind]} ${className}`}>
      <Icon className="w-[1em] h-[1em] shrink-0 self-center" aria-hidden="true" strokeWidth={2.2} />
      <span className="sr-only">（確信度: {CONFIDENCE_LABEL[kind]}）</span>
    </span>
  )
}
