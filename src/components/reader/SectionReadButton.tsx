'use client'
// 節末の明示ボタン。スクロールでの自動判定はしない（2026-09-03 オーナー決定）。
// 押した後も押し戻せる操作は置かない（読んだ記録は消す対象ではない）。
import { useRecallStore } from '@/components/recall/RecallProvider'
import { normalizePageId } from '@/lib/recall/claim-text'

export function SectionReadButton({ pageId, sectionKey }: { pageId: string; sectionKey: string }) {
  const { enabled, reads, pending, markSectionRead } = useRecallStore()
  // 呼び出し側の条件に頼らず、自分でも閉じる。機能が閉じている利用者には
  // ボタンも節末の操作も一切描かない（設計の要件）。
  if (!enabled || !pageId) return null
  const id = normalizePageId(pageId)
  const done = reads.some((r) => r.pageId === id && r.sectionKey === sectionKey)
  const busy = pending.has(`read:${pageId}#${sectionKey}`)

  if (done) {
    return (
      <p className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-gray-400/60" />
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
