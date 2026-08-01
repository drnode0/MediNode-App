'use client'
// ホームの1行カード。開いて5秒で現在地（当直の合間ルール）。追加API呼び出しゼロ。
import { useEffect, useRef, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { loadTowerState, TOWER_EVENT } from '@/lib/tower-steps'
import { isTowerEnabled } from '@/lib/tower-flags'
import { stepsThisWeek } from '@/lib/tower-ladder'
import { formatHeight, heightMmFromLeaves, nextMilestone } from '@/lib/vine-ladder'

export function TowerCard({ onOpen }: { onOpen: () => void }) {
  const [count, setCount] = useState(0)
  const [week, setWeek] = useState(0)
  const [popKey, setPopKey] = useState(0)
  const hideTimer = useRef<number | null>(null)

  useEffect(() => {
    const refresh = () => {
      const s = loadTowerState()
      setCount(s.steps.length)
      setWeek(stepsThisWeek(s.steps, new Date().toISOString()))
    }
    refresh()
    const onStep = () => {
      refresh()
      setPopKey((k) => k + 1)
      // +1 は一瞬の確認であって常設バッジではない（うるさくしない原則）
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
      hideTimer.current = window.setTimeout(() => setPopKey(0), 1500)
    }
    window.addEventListener(TOWER_EVENT, onStep)
    return () => {
      window.removeEventListener(TOWER_EVENT, onStep)
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
    }
  }, [])

  if (!isTowerEnabled() || count === 0) return null // v1はオーナーのみ。葉0の端末でも出さない（初回は取込で積もってから）

  const next = nextMilestone(count)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mb-3 flex w-full items-center gap-3 rounded-2xl border border-emerald-100 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 text-left shadow-sm"
    >
      <TrendingUp className="h-5 w-5 shrink-0 text-brand dark:text-brand-300" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-200">
        <span className="font-bold text-gray-900 dark:text-gray-50">{formatHeight(heightMmFromLeaves(count))}</span>
        <span className="ml-2 text-gray-500 dark:text-gray-400">今週 +{week}</span>
        <span className="ml-2 text-brand dark:text-brand-300">
          {next.label}まで あと{formatHeight(next.mm - heightMmFromLeaves(count))}
        </span>
      </span>
      {popKey > 0 && (
        <span key={popKey} className="animate-pop rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-white motion-reduce:animate-none">
          +1
        </span>
      )}
    </button>
  )
}
