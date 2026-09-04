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
    <span
      className="inline-flex shrink-0 items-center text-teal-700 dark:text-teal-300"
      title="この節は読みました"
    >
      <CircleCheck className="h-[0.95em] w-[0.95em]" aria-hidden="true" strokeWidth={2.2} />
      <span className="sr-only">この節は読みました</span>
    </span>
  )
}
