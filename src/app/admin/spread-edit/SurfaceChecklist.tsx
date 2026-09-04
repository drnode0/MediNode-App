'use client'

// 表に出るものの一覧。節を開かずに読めるのは表層だけなので、そこに何を置いたかを
// 節ごとに1回ずつ通すための場所。未決＝主役をまだ決めていない節で、これは間違いでは
// ないので保存は止めない（数を出すだけ）。
import type { SpreadOverlay, SpreadPart } from '@/lib/reader-spread'
import { sourceCandidates } from '@/lib/spread-edit'
import type { ReaderBlock } from '@/lib/reader-doc'

type Row = { anchor: string; n: number | null; title: string; deep: ReaderBlock[]; autoKind: SpreadPart['kind'] }

export function SurfaceChecklist({
  rows,
  overlay,
  kindLabel,
  onPickSource,
  onNone,
}: {
  rows: Row[]
  overlay: SpreadOverlay
  kindLabel: Record<string, string>
  onPickSource: (anchor: string, blockId: string) => void
  onNone: (anchor: string) => void
}) {
  return (
    <div className="mb-4 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800/60 overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-700">
        <p className="text-xs font-bold">表に出すものを決める</p>
        <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">
          節を開かずに読めるのはここだけです。細かい数値と原文の主張は折りたたみに残ります。
        </p>
      </div>
      {rows.map((r) => {
        const main = overlay.parts?.[r.anchor]
        const extras = overlay.extraParts?.[r.anchor] ?? []
        const undecided = !main
        const shown = main
          ? [main, ...extras].map((p) => kindLabel[p.kind] ?? p.kind).join(' ＋ ')
          : `自動判定のまま（${kindLabel[r.autoKind] ?? r.autoKind}）`
        return (
          <div
            key={r.anchor}
            className={`flex gap-2 px-3 py-2.5 border-b border-gray-200 dark:border-gray-700 last:border-b-0 ${undecided ? 'bg-amber-50 dark:bg-amber-900/10' : ''}`}
          >
            <span className="w-5 h-5 shrink-0 rounded-full bg-brand-600 text-white text-[11px] font-bold inline-flex items-center justify-center">
              {r.n ?? '-'}
            </span>
            <div className="flex-1 min-w-0">
              <a href={`#edit-${r.anchor}`} className="text-xs font-bold block truncate">{r.title}</a>
              <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{shown}</p>
              {undecided && (
                <div className="mt-1.5 flex flex-wrap gap-1.5 items-center">
                  {sourceCandidates(r.deep).map((c) => (
                    <button
                      key={c.blockId}
                      type="button"
                      onClick={() => onPickSource(r.anchor, c.blockId)}
                      className="text-[11px] rounded-full border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 px-2.5 py-1"
                    >
                      {c.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => onNone(r.anchor)}
                    className="text-[11px] rounded-full border border-gray-300 dark:border-gray-600 text-gray-500 dark:text-gray-400 px-2.5 py-1"
                  >
                    表層なしで確定
                  </button>
                </div>
              )}
            </div>
            <span
              className={`self-start text-[10px] px-1.5 py-0.5 rounded ${undecided ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300' : 'bg-brand-50 dark:bg-white/10 text-brand-700 dark:text-brand-300'}`}
            >
              {undecided ? '未決' : '決定ずみ'}
            </span>
          </div>
        )
      })}
    </div>
  )
}
