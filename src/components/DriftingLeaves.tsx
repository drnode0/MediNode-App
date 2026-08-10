'use client'
import { Leaf } from 'lucide-react'

// 空の背景に漂う葉。オンボーディング（OnboardingScreen）で使っている
// Leaf + animate-float と同じ語彙をそのまま持ってくる。
// 意味は持たない飾りなので aria-hidden、pointer-events も切って泡の邪魔をしない。
//
// 枚数は固定。データの件数で増やすと、溜めるほど画面が賑やかになってしまう。
const LEAVES = [
  { top: '8%', left: '6%', size: 'w-5 h-5', tone: 'text-brand-300/70 dark:text-brand-700/50', rotate: 'rotate-12', delay: '0s', duration: '11s' },
  { top: '58%', right: '5%', size: 'w-6 h-6', tone: 'text-brand-200/70 dark:text-brand-800/60', rotate: '-rotate-45', delay: '1.6s', duration: '14s' },
  { top: '82%', left: '14%', size: 'w-4 h-4', tone: 'text-brand-300/60 dark:text-brand-700/40', rotate: 'rotate-45', delay: '3.1s', duration: '12s' },
  { top: '30%', right: '16%', size: 'w-4 h-4', tone: 'text-brand-200/60 dark:text-brand-800/50', rotate: '-rotate-12', delay: '2.2s', duration: '16s' },
]

export function DriftingLeaves({ paused }: { paused: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      {LEAVES.map((l, i) => (
        <Leaf
          key={i}
          className={`absolute animate-float ${l.size} ${l.tone} ${l.rotate}`}
          style={{
            top: l.top,
            left: l.left,
            right: l.right,
            animationDelay: l.delay,
            animationDuration: l.duration,
            animationPlayState: paused ? 'paused' : 'running',
          }}
        />
      ))}
    </div>
  )
}
