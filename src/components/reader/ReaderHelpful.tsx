'use client'
// リーダー末尾の「役に立った」＋参照回数。読了位置に静かに置く（読書中の画面を汚さない・
// 検索結果カードには出さない、という設計判断はspec参照）。
// 数は下限方式: 役に立った=HELPFUL_BADGE_MIN、参照回数=VIEW_BADGE_MIN 以上のときだけ表示。
import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { HelpfulButton } from '@/components/HelpfulButton'
import { fetchHelpfulState, toggleHelpful, helpfulCountLabel } from '@/lib/cq-helpful'
import { fetchCqViewCounts, VIEW_BADGE_MIN } from '@/lib/cq-views'

export function ReaderHelpful({ objectID }: { objectID: string }) {
  const [count, setCount] = useState(0)
  const [mine, setMine] = useState(false)
  const [views, setViews] = useState(0)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    setCount(0); setMine(false); setViews(0)
    fetchHelpfulState([objectID]).then((s) => {
      if (!alive) return
      setCount(s.counts[objectID] || 0)
      setMine(s.mine.includes(objectID))
    })
    fetchCqViewCounts([objectID]).then((c) => { if (alive) setViews(c[objectID] || 0) })
    return () => { alive = false }
  }, [objectID])

  // 押した瞬間に見た目を変え、サーバーの返した合計で確定させる（待たせない）。
  const onToggle = async () => {
    if (busy) return
    const next = !mine
    setBusy(true)
    setMine(next)
    setCount((c) => Math.max(0, c + (next ? 1 : -1)))
    const r = await toggleHelpful(objectID, next)
    if (r) {
      setMine(r.helpful)
      setCount(r.count)
    } else {
      // 失敗したら見た目を戻す（押せたのに入っていない、を残さない）
      setMine(!next)
      setCount((c) => Math.max(0, c + (next ? -1 : 1)))
    }
    setBusy(false)
  }

  return (
    <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <HelpfulButton pressed={mine} disabled={busy} onClick={onToggle} />
      {helpfulCountLabel(count) && (
        <span className="text-[11px] text-gray-400 dark:text-gray-500">{helpfulCountLabel(count)}</span>
      )}
      {views >= VIEW_BADGE_MIN && (
        <span className="inline-flex items-center gap-1 text-[11px] text-gray-400 dark:text-gray-500">
          <Search className="w-3 h-3 shrink-0" strokeWidth={2.2} />
          これまで {views.toLocaleString()}回 調べられています
        </span>
      )}
    </div>
  )
}
