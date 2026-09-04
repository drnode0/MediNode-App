'use client'

// 表に出るものの一覧。節を開かずに読めるのは表層だけなので、そこに何を置いたかを
// 節ごとに1回ずつ通すための場所。未決＝主役をまだ決めていない節で、これは間違いでは
// ないので保存は止めない（数を出すだけ）。
import type { SpreadOverlay, SpreadPart } from '@/lib/reader-spread'
import { isDecidedPart, sourceCandidates } from '@/lib/spread-edit'
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
        // 「決定ずみ」は undecidedAnchors と同じ関門（isDecidedPart）で判定する。
        // ここだけ「parts[anchor] があるか」で見ると、source を選んだ直後（blockId 空文字）を
        // 決定ずみと誤って数えてしまう（プレビュー・保存は自動判定のままなのに一覧だけが進む）。
        const decided = isDecidedPart(main)
        const undecided = !decided
        // 主役の呼び名だけ「決定ずみか自動判定か」で出し分け、追加部品（extras）は
        // 主役が未決でも常に並べる。主役が未決の節に追加部品だけ置いても、実際には
        // 表層に出ているのに一覧からは見えない、という取りこぼしを防ぐため。
        //
        // 追加部品も主役と同じ関門を通す。ここを素通しにすると、追加メニューから
        // 「原本の表・図」を選んだ直後（blockId 空文字）が一覧には並ぶのに、
        // sanitizeOverlay が落とすのでプレビューにも保存結果にも出ない、という
        // 主役側で潰したのと同じ嘘が追加部品側に残る。
        const mainLabel = decided ? kindLabel[main!.kind] ?? main!.kind : `自動判定のまま（${kindLabel[r.autoKind] ?? r.autoKind}）`
        const shown = [mainLabel, ...extras.filter(isDecidedPart).map((p) => kindLabel[p.kind] ?? p.kind)].join(' ＋ ')
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
