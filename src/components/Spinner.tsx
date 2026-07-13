'use client'
import { Loader2 } from 'lucide-react'

// ローディング表示の共通スピナー。
// 以前使っていた回転グリフはフォント依存で字形・回転中心がばらつくため、lucide Loader2 に統一。
// テキストと同じ行に置く用途が多いので inline-block ＋ ベースライン微調整をデフォルトに。
export function Spinner({ className = 'w-4 h-4' }: { className?: string }) {
  return <Loader2 className={`animate-spin inline-block align-[-0.125em] ${className}`} aria-hidden />
}
