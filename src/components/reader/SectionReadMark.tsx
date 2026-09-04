'use client'
// 節見出しに添える「既読」の印。節末のボタンとは別物で、押せない・情報だけ。
// 節の頭にこれが無いと、2回目以降にこの節を読むとき、読み終える（節末まで着く）まで
// 前に読んだ節かどうか分からない（2026-09-04 指摘）。未読了のときは何も描かない
// （「まだ」を主張する印は置かない。節末ボタンだけが行動を促す）。
import { CircleCheck } from 'lucide-react'
import { useRecallStore } from '@/components/recall/RecallProvider'
import { isSectionRead } from '@/lib/recall/reader-claims'

export function SectionReadMark({ pageId, sectionKey }: { pageId: string; sectionKey: string }) {
  const { enabled, reads } = useRecallStore()
  if (!enabled || !pageId) return null
  if (!isSectionRead(reads, pageId, sectionKey)) return null
  return (
    // 自分だけ完結した小さな札にする（アイコン単体で親のflexに乗せない）。
    // 見出しの行が align-items:flex-start（ReaderSpread の .secHead）でも
    // self-center で自分だけ縦中央に揃え、上にずれて見える問題を避ける。
    // タップが主体のスマホでは title のツールチップが出ないので、
    // 意味は文字（既読）で伝える。アイコン単体には頼らない（2026-09-04 指摘）。
    <span className="inline-flex shrink-0 self-center items-center gap-1 rounded-full bg-teal-100 dark:bg-teal-900/40 px-2 py-0.5 text-[0.62em] font-bold leading-none text-teal-800 dark:text-teal-300">
      <CircleCheck className="h-[1.1em] w-[1.1em] shrink-0" aria-hidden="true" strokeWidth={2.4} />
      既読
    </span>
  )
}
