'use client'
import { CONFIDENCE_LABEL, type Confidence } from '@/lib/reader-confidence'
import { ConfidenceMark } from './ConfidenceMark'

// マークの意味色ごとの塗り（選択時）／アウトライン（非選択時）トークン。
// テキスト色はマーク色に頼らずグレー基調にし、色以外（アイコン形状＋塗り/線の状態）でも判別できるようにする。
const CHIP_TONE: Record<Confidence, { filled: string; outline: string }> = {
  ok: {
    filled: 'bg-teal-50 dark:bg-teal-900/30 border-teal-600 dark:border-teal-400',
    outline: 'bg-transparent border-teal-600/50 dark:border-teal-400/50',
  },
  caut: {
    filled: 'bg-amber-50 dark:bg-amber-900/30 border-amber-600 dark:border-amber-400',
    outline: 'bg-transparent border-amber-600/50 dark:border-amber-400/50',
  },
  unk: {
    filled: 'bg-red-50 dark:bg-red-900/30 border-red-600 dark:border-red-400',
    outline: 'bg-transparent border-red-600/50 dark:border-red-400/50',
  },
}

export function ConfidenceChips({
  marks,
  active,
  onToggle,
}: {
  marks: Confidence[]
  active: Set<Confidence>
  onToggle: (c: Confidence) => void
}) {
  if (marks.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2 my-2">
      <span className="text-xs text-gray-500 dark:text-gray-400">確信度で拾う</span>
      {marks.map((mark) => {
        const selected = active.has(mark)
        const tone = selected ? CHIP_TONE[mark].filled : CHIP_TONE[mark].outline
        return (
          <button
            key={mark}
            type="button"
            aria-pressed={selected}
            onClick={() => onToggle(mark)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 min-h-[44px] text-sm font-medium text-gray-700 dark:text-gray-200 transition-colors duration-150 motion-reduce:transition-none ${tone}`}
          >
            <ConfidenceMark kind={mark} />
            <span>{CONFIDENCE_LABEL[mark]}</span>
          </button>
        )
      })}
    </div>
  )
}
