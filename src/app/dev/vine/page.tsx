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
  joinedAt: '', undergroundClearedAt: '', levels: {}, // joinedAt空＝分割しない（既存3シナリオは全部地上のまま）
})

// 地下シナリオ用: joined より古い wrote（持ち込み）と、joined 後の read（芽を出した分）
const JOINED = new Date(Date.now() - 30 * 86_400_000).toISOString()
function mkOld(n: number): Step[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `old-${i}`, kind: 'wrote' as const,
    at: new Date(new Date(JOINED).getTime() - (n - i) * 86_400_000).toISOString(),
    genre: 'dev', title: `持ち込みの知識 ${i + 1}`,
  }))
}
function mkSurfaced(ids: string[]): Step[] {
  return ids.map((id, i) => ({
    id, kind: 'read' as const,
    at: new Date(new Date(JOINED).getTime() + (i + 1) * 3_600_000).toISOString(),
    genre: 'dev', title: `芽を出した ${i + 1}`,
  }))
}

// 点景シナリオ用: 途中に長い休みのある記録（空白区間に季節の点が連なるのを見る）
function mkSpread(spec: { daysAgo: number; n: number }[]): Step[] {
  const out: Step[] = []
  let i = 0
  for (const { daysAgo, n } of spec) {
    for (let j = 0; j < n; j++) {
      out.push({
        id: `sp-${i}`, kind: 'recall',
        at: new Date(Date.now() - (daysAgo - j) * 86_400_000).toISOString(),
        genre: 'dev', title: `季節の知識 ${++i}`,
      })
    }
  }
  return out
}

const SCENARIOS: Record<string, TowerState> = {
  'ふつうの日（+4枚）': mk(14, 10),
  '追い越しの日（湯のみ35枚越え）': mk(40, 30),
  '大量バックフィル（+80枚）': mk(200, 120),
  '持ち込みの朝（地下274・地上0）': {
    steps: mkOld(274), lastSeenSteps: 0, lastSeenAt: '', backfilledAt: 'dev',
    joinedAt: JOINED, undergroundClearedAt: '', levels: {},
  },
  '地下から芽吹く（地上8・+5枚）': {
    steps: [...mkOld(40), ...mkSurfaced(['old-0', 'old-1', 'old-2', 'old-3', 'old-4', 'old-5', 'old-6', 'old-7'])],
    lastSeenSteps: 3, lastSeenAt: '', backfilledAt: 'dev',
    joinedAt: JOINED, undergroundClearedAt: '', levels: {},
  },
  '地下が尽きた日': {
    steps: [...mkOld(6), ...mkSurfaced(['old-0', 'old-1', 'old-2', 'old-3', 'old-4', 'old-5'])],
    lastSeenSteps: 5, lastSeenAt: '', backfilledAt: 'dev',
    joinedAt: JOINED, undergroundClearedAt: new Date(new Date(JOINED).getTime() + 6 * 3_600_000).toISOString(), levels: {},
  },
  '点景の一年（長い休みつき）': {
    steps: mkSpread([{ daysAgo: 400, n: 20 }, { daysAgo: 120, n: 15 }]),
    lastSeenSteps: 35, lastSeenAt: '', backfilledAt: 'dev',
    joinedAt: '', undergroundClearedAt: '', levels: {},
  },
  '口上（見本のグイーン）': mk(3, 3),
  // 葉→本文の導線。行き先はidの owner 接頭辞で決まる（vine-open）ので、
  // 実データと同じ `${owner}_${pageId}` 形式のidを置く。
  // ⚠️ devハーネスには ReaderProvider が無いので「本文を読む」は押しても何も起きない
  //（no-op が返る契約）。ここで見るのは「どの葉にどの導線が出るか」だけ。
  '本文への導線（配信・個人・見本）': {
    steps: [
      { id: 'subscription_1f2e3d4c5b6a7988990a1b2c3d4e5f60', kind: 'read', at: new Date(Date.now() - 10_800_000).toISOString(), genre: 'dev', title: '配信の知識（アプリ内リーダー）' },
      { id: 'personal_0a1b2c3d4e5f60718293a4b5c6d7e8f9', kind: 'wrote', at: new Date(Date.now() - 7_200_000).toISOString(), genre: 'dev', title: '自分で書いた知識（Notion）' },
      { id: 'dev-x', kind: 'recall', at: new Date(Date.now() - 3_600_000).toISOString(), genre: 'dev', title: '行き先の無い知識（導線を出さない）' },
    ],
    lastSeenSteps: 3, lastSeenAt: '', backfilledAt: 'dev',
    joinedAt: '', undergroundClearedAt: '', levels: {},
  },
  '芽と解決と濃い輪郭': {
    steps: [
      ...mkSteps(10),
      { id: 'dev-0', kind: 'resolved', at: new Date(Date.now() - 3_600_000).toISOString(), genre: 'dev', title: 'CQを解決した知識' },
      { id: 'bud-1', kind: 'attempt', at: new Date(Date.now() - 7_200_000).toISOString(), genre: 'dev', title: 'まだの知識 一' },
      { id: 'bud-2', kind: 'attempt', at: new Date(Date.now() - 3_600_000).toISOString(), genre: 'dev', title: 'まだの知識 二' },
      { id: 'bud-3', kind: 'attempt', at: new Date(Date.now() - 1_800_000).toISOString(), genre: 'dev', title: 'まだの知識 三' },
    ],
    lastSeenSteps: 9, lastSeenAt: '', backfilledAt: 'dev',
    joinedAt: '', undergroundClearedAt: '', levels: {},
  },
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
        <VineScreen
          key={key + Date.now()} initialState={state}
          forceIntro={key.includes('口上')}
          onClose={() => setKey(null)} onGoQuiz={() => alert('クイズへ（dev）')}
        />
      )}
    </div>
  )
}
