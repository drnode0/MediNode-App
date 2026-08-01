'use client'
// 知の蔓のdevハーネス（development限定）。台帳を作って3シナリオを目視確認する。
// 本物のlocalStorageに触れない（initialState注入・保存もされない）。
import { notFound } from 'next/navigation'
import { useMemo, useState } from 'react'
import type { Step, TowerState } from '@/lib/tower-steps'
import { VineScreen } from '@/components/vine/VineScreen'

function mkSteps(n: number): Step[] {
  const kinds: Step['kind'][] = ['read', 'recall', 'wrote', 'recall', 'repolish']
  return Array.from({ length: n }, (_, i) => ({
    id: `dev-${i}`, kind: kinds[i % kinds.length],
    at: new Date(Date.now() - (n - i) * 43_200_000).toISOString(),
    genre: 'dev', title: `知識のたね ${i + 1}`,
  }))
}
const mk = (count: number, seen: number): TowerState => ({
  steps: mkSteps(count), lastSeenSteps: seen, lastSeenAt: '', backfilledAt: 'dev',
})

const SCENARIOS: Record<string, TowerState> = {
  'ふつうの日（+4枚）': mk(14, 10),
  '追い越しの日（湯のみ35枚越え）': mk(40, 30),
  '大量バックフィル（+80枚）': mk(200, 120),
}

export default function DevVinePage() {
  if (process.env.NODE_ENV !== 'development') notFound()
  const [key, setKey] = useState<string | null>(null)
  const state = useMemo(() => (key ? SCENARIOS[key] : null), [key])
  return (
    <div className="min-h-screen bg-neutral-200 p-6">
      <h1 className="mb-3 text-sm font-bold">知の蔓 devハーネス</h1>
      <div className="flex flex-wrap gap-2">
        {Object.keys(SCENARIOS).map((k) => (
          <button key={k} type="button" onClick={() => { setKey(null); setTimeout(() => setKey(k), 30) }}
            className="rounded-full border border-neutral-400 bg-white px-3 py-1.5 text-xs">
            {k}
          </button>
        ))}
      </div>
      {key && state && (
        <VineScreen key={key + Date.now()} initialState={state} onClose={() => setKey(null)} onGoQuiz={() => alert('クイズへ（dev）')} />
      )}
    </div>
  )
}
