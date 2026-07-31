'use client'
// 塔の描画（純粋コンポーネント）。上が新しい歩・下が古い巻。
// ソフト物理スキン: 角丸ブロック・決定的なズレと傾き・つぶれて戻る着地。
// 明るさ＝いま即答できるか（くすみ=要再確認は彩度を落とす）。塔は縮まない。
import type { Step } from '@/lib/tower-steps'
import { jitterFor, type Volume } from '@/lib/tower-volumes'
import { genreHueIndex, DEPARTMENT_COLOR_TOKENS, canonicalGenreKey } from '@/lib/genre'

// ジャンル→色クラス。DEPARTMENT_COLOR_TOKENS の6色相に写像（既存のジャンル配色と同じ理屈）
const TONE_BG: Record<string, string> = {
  green: 'bg-emerald-400 dark:bg-emerald-500',
  amber: 'bg-amber-400 dark:bg-amber-500',
  sky: 'bg-sky-400 dark:bg-sky-500',
  rose: 'bg-rose-300 dark:bg-rose-400',
  teal: 'bg-teal-400 dark:bg-teal-500',
  orange: 'bg-orange-300 dark:bg-orange-400',
}
export function genreTone(genre: string): string {
  if (!genre) return 'bg-gray-300 dark:bg-gray-600'
  const key = canonicalGenreKey(genre)
  return TONE_BG[DEPARTMENT_COLOR_TOKENS[genreHueIndex(key, DEPARTMENT_COLOR_TOKENS.length)]]
}

function Leaf() {
  return (
    <svg viewBox="0 0 14 10" className="absolute -right-2 -top-1.5 h-2.5 w-3.5" aria-hidden>
      <path d="M0,7 Q5,-2 13,1 Q11,8 3,9 Q1,8 0,7 Z" fill="#2c8a6a" />
    </svg>
  )
}

function Block({ step, dull, drop, index }: { step: Step; dull: boolean; drop: boolean; index: number }) {
  const j = jitterFor(step.id + step.kind)
  const thick = step.kind === 'read' ? 'h-2.5' : step.kind === 'wrote' ? 'h-4' : 'h-5'
  const tone =
    step.kind === 'read'
      ? 'bg-white/70 dark:bg-gray-700/60 border border-gray-200 dark:border-gray-600'
      : genreTone(step.genre)
  return (
    <div
      className={`relative mx-auto w-40 rounded-full shadow-sm ${thick} ${tone} ${dull ? 'saturate-[.25] opacity-70' : ''} ${drop ? 'animate-tower-drop motion-reduce:animate-none' : ''}`}
      style={{ transform: `translateX(${j.offset}px) rotate(${j.rot}deg)`, animationDelay: drop ? `${index * 120}ms` : undefined }}
    >
      {(step.kind === 'recall' || step.kind === 'repolish') && !dull && <Leaf />}
    </div>
  )
}

function VolumeSlab({ v, onOpen }: { v: Volume; onOpen: (v: Volume) => void }) {
  const total = v.steps.length
  return (
    <button
      type="button"
      onClick={() => onOpen(v)}
      className="relative mx-auto block w-48 rounded-xl bg-white dark:bg-gray-800 border border-emerald-100 dark:border-gray-700 shadow-sm px-3 py-2 text-left"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold text-brand dark:text-brand-300">第{v.n}巻</span>
        <span className="flex gap-0.5" aria-label={`葉 ${v.leaves}`}>
          {Array.from({ length: Math.min(v.leaves, 5) }, (_, i) => (
            <svg key={i} viewBox="0 0 14 10" className="h-2 w-3"><path d="M0,7 Q5,-2 13,1 Q11,8 3,9 Q1,8 0,7 Z" fill="#2c8a6a" /></svg>
          ))}
        </span>
      </div>
      <div className="mt-1.5 flex h-2 overflow-hidden rounded-full" aria-hidden>
        {v.stripes.slice(0, 4).map((s) => (
          <div key={s.genreKey} className={genreTone(s.genreKey)} style={{ width: `${(s.count / total) * 100}%` }} />
        ))}
      </div>
    </button>
  )
}

export function TowerStack({
  volumes, loose, dullSet, dropCount, onOpenVolume,
}: {
  volumes: Volume[]
  loose: Step[]
  dullSet: Set<string>
  dropCount: number
  onOpenVolume: (v: Volume) => void
}) {
  // 表示は上が新しい: 端数（新しい順）→巻（新しい順）
  const looseDesc = [...loose].reverse()
  const volsDesc = [...volumes].reverse()
  return (
    <div className="flex flex-col gap-1 py-2">
      {looseDesc.map((s, i) => (
        <Block key={`${s.id}-${s.kind}-${s.at}`} step={s} dull={dullSet.has(s.id)} drop={i < dropCount} index={dropCount - i} />
      ))}
      <div className="flex flex-col gap-1.5 mt-1">
        {volsDesc.map((v) => (
          <VolumeSlab key={v.n} v={v} onOpen={onOpenVolume} />
        ))}
      </div>
      <div className="mx-auto mt-1 h-1 w-56 rounded-full bg-emerald-100 dark:bg-gray-700" aria-hidden />
    </div>
  )
}
