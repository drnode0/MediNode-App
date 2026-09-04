'use client'

// 節の中の表・画像から1つ選ぶ。選んだ結果として保存されるのは原本のブロックIDだけで、
// 中身は写さない（原本を直せば表層も追いつく）。
import type { ReaderBlock } from '@/lib/reader-doc'
import { sourceCandidates } from '@/lib/spread-edit'

export function SourcePicker({ deep, value, onChange }: { deep: ReaderBlock[]; value: string; onChange: (blockId: string) => void }) {
  const items = sourceCandidates(deep)
  if (items.length === 0) {
    return <p className="text-[11px] text-gray-400 dark:text-gray-500">この節の原本に、表も図もありません。</p>
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((it) => (
        <button
          key={it.blockId}
          type="button"
          onClick={() => onChange(it.blockId)}
          className={`text-[11px] rounded-full border px-2.5 py-1 ${
            it.blockId === value
              ? 'border-brand-600 bg-brand-50 dark:bg-white/10 text-brand-700 dark:text-brand-300'
              : 'border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400'
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  )
}
