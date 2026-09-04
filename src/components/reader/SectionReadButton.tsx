'use client'
// 節末の明示ボタン。スクロールでの自動判定はしない（2026-09-03 オーナー決定）。
// 押した後も押し戻せる操作は置かない（読んだ記録は消す対象ではない）。
import { CircleCheck } from 'lucide-react'
import { useRecallStore } from '@/components/recall/RecallProvider'
import { isSectionRead } from '@/lib/recall/reader-claims'

export function SectionReadButton({ pageId, sectionKey }: { pageId: string; sectionKey: string }) {
  const { enabled, reads, pending, markSectionRead } = useRecallStore()
  // 呼び出し側の条件に頼らず、自分でも閉じる。機能が閉じている利用者には
  // ボタンも節末の操作も一切描かない（設計の要件）。
  if (!enabled || !pageId) return null
  const done = isSectionRead(reads, pageId, sectionKey)
  const busy = pending.has(`read:${pageId}#${sectionKey}`)

  if (done) {
    // 未読了のボタンと同じ大きさ・実線の面にして、テキストを読まなくても
    // チェックの色と塗りだけで「済み」と分かるようにする（実測: 文字だけの薄い表示は
    // スクロール中に見分けが付かないとの指摘、2026-09-04）。
    // 確信度✅と同じ teal を使い、「残す」の brand 色（Node・節ボタン未読了）とは
    // 別の色にして、「残した」と「読んだ」を混同させない。
    return (
      <p className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-teal-500/30 bg-teal-50/70 dark:bg-teal-900/20 px-4 text-xs font-bold text-teal-800 dark:text-teal-300">
        <CircleCheck className="h-[1.1em] w-[1.1em] shrink-0" aria-hidden="true" strokeWidth={2.2} />
        この節を読みました
      </p>
    )
  }
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => { void markSectionRead(pageId, sectionKey) }}
      className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-dashed border-brand-500/40 bg-brand-50/60 dark:bg-brand-900/20 px-4 text-xs font-bold text-brand-800 dark:text-brand-200 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
    >
      {busy ? '記録しています' : 'この節を読んだ'}
    </button>
  )
}
