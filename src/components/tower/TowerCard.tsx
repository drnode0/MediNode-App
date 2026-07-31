'use client'
// ホームの1行カード。開いて5秒で現在地（当直の合間ルール）。追加API呼び出しゼロ。
import { useEffect, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { loadTowerState, TOWER_EVENT } from '@/lib/tower-steps'
import { isTowerEnabled } from '@/lib/tower-flags'
import { formatHeight, heightMm, nextMilestone, stepsThisWeek } from '@/lib/tower-ladder'

export function TowerCard({ onOpen }: { onOpen: () => void }) {
  const [count, setCount] = useState(0)
  const [week, setWeek] = useState(0)
  const [popKey, setPopKey] = useState(0)

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
    }
    window.addEventListener(TOWER_EVENT, onStep)
    return () => window.removeEventListener(TOWER_EVENT, onStep)
  }, [])

  if (!isTowerEnabled() || count === 0) return null // v1はオーナーのみ。歩0の端末でも出さない（初回は取込で積もってから）

  const next = nextMilestone(count)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mb-3 flex w-full items-center gap-3 rounded-2xl border border-emerald-100 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 text-left shadow-sm"
    >
      <TrendingUp className="h-5 w-5 shrink-0 text-brand dark:text-brand-300" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-200">
        <span className="font-bold text-gray-900 dark:text-gray-50">{formatHeight(heightMm(count))}</span>
        <span className="ml-2 text-gray-500 dark:text-gray-400">今週 +{week}</span>
        {next && (
          <span className="ml-2 text-brand dark:text-brand-300">
            あと{next.steps - count}歩で{next.label}
          </span>
        )}
      </span>
      {popKey > 0 && (
        <span key={popKey} className="animate-pop rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-white motion-reduce:animate-none">
          +1
        </span>
      )}
    </button>
  )
}
