'use client'
// 本文行末の丸い Node。空洞＝まだ残していない、塗り＝残した。
// 見た目は本文の字に合わせて 1.05em（実測 約15px）だが、当たり判定は 44px 四方を確保する
// （走りながら片手で押す前提。見た目を大きくすると本文の読みを壊す）。
import { useRecallStore } from '@/components/recall/RecallProvider'
import type { RecallClaim } from '@/lib/recall/types'

export function RecallNode({ claim }: { claim: RecallClaim }) {
  const { enabled, progress, pending, keep } = useRecallStore()
  // 呼び出し側（RenderedBlocks）は claim が見つかったときだけこの部品を置くが、
  // その判定は enabled 経由で間接的に効いているだけなので、ここでも自分で閉じる
  // （機能が閉じている利用者には一切描かない、という要件を部品単体で守る）。
  if (!enabled) return null
  const row = progress.find((p) => p.claimId === claim.claimId)
  const kept = !!row && !row.removedAt
  const busy = pending.has(claim.claimId)

  return (
    <span className="relative inline-flex items-center align-[-0.2em] ml-1">
      <button
        type="button"
        aria-pressed={kept}
        aria-busy={busy || undefined}
        aria-label={kept ? 'この主張を残すのをやめる' : 'この主張を残す'}
        disabled={busy}
        // keep は失敗すると reject する（RecallScreen が await/catch で受け止める契約のため）。
        // ここでは受け止める先が無いので飲み込む。ロールバックと知らせは Provider 側が済ませる。
        onClick={() => { keep(claim.claimId, !kept).catch(() => {}) }}
        className={`inline-flex h-[1.05em] w-[1.05em] items-center justify-center rounded-full border-[1.6px] border-brand-600 dark:border-brand-400 transition-colors motion-reduce:transition-none ${
          kept ? 'bg-brand-600 dark:bg-brand-400 shadow-[0_0_0_3px_rgba(25,107,79,0.16)]' : 'bg-transparent'
        } ${busy ? 'opacity-50' : ''} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-brand-600`}
      >
        {/* 当たり判定だけを 44px に広げる。見た目の丸は上の border が描く。 */}
        <span aria-hidden="true" className="absolute left-1/2 top-1/2 h-11 w-11 -translate-x-1/2 -translate-y-1/2" />
      </button>
    </span>
  )
}
