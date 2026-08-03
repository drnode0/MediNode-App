'use client'
// ホームの1行カード。開いて5秒で現在地（当直の合間ルール）。追加API呼び出しゼロ。
import { useEffect, useRef, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { loadTowerState, leafSteps, TOWER_EVENT } from '@/lib/tower-steps'
import { isTowerEnabled } from '@/lib/tower-flags'
import { stepsThisWeek } from '@/lib/tower-ladder'
import { splitByJoin } from '@/lib/vine-scroll'
import { formatHeight, heightMmFromLeaves, nextMilestone } from '@/lib/vine-ladder'

export function TowerCard({ onOpen }: { onOpen: () => void }) {
  const [count, setCount] = useState(0)
  const [underground, setUnderground] = useState(0)
  const [week, setWeek] = useState(0)
  const [popKey, setPopKey] = useState(0)
  const hideTimer = useRef<number | null>(null)

  useEffect(() => {
    const refresh = () => {
      const s = loadTowerState()
      // 高さも今週も「地上の葉」だけで数える（正典§7・§9。持ち込みは地下・attemptは芽）
      const split = splitByJoin(s.steps, s.joinedAt)
      const leaves = leafSteps(split.above)
      setCount(leaves.length)
      setUnderground(split.underground.length)
      setWeek(stepsThisWeek(leaves, new Date().toISOString()))
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

  // v1はオーナーのみ。地上0でも地下（持ち込み）があるなら入口は残す——消すと再会の道が断たれる
  if (!isTowerEnabled() || (count === 0 && underground === 0)) return null

  const next = nextMilestone(count)
  const remainMm = next.mm - heightMmFromLeaves(count)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="mb-3 flex w-full items-center gap-3 rounded-2xl border border-emerald-100 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3 text-left shadow-sm"
    >
      <TrendingUp className="h-5 w-5 shrink-0 text-brand dark:text-brand-300" aria-hidden />
      <span className="min-w-0 flex-1 truncate text-sm text-gray-700 dark:text-gray-200">
        {count > 0 ? (
          <>
            <span className="font-bold text-gray-900 dark:text-gray-50">{formatHeight(heightMmFromLeaves(count))}</span>
            <span className="ml-2 text-gray-500 dark:text-gray-400">今週 +{week}</span>
            {remainMm > 0 && (
              <span className="ml-2 text-brand dark:text-brand-300">
                {next.label}まで あと{formatHeight(remainMm)}
              </span>
            )}
          </>
        ) : (
          // 地上0（移行直後・持ち込みだけの端末）。数字の0を並べず、入口の名前だけ置く
          <span className="font-bold text-gray-900 dark:text-gray-50">知の蔓</span>
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
