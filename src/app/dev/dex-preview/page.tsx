'use client'
// RecallDex（標本帳の一覧）だけを見る dev ハーネス（development限定）。
// /dev/recall-screen と同じ手口（fetch を仮の応答に差し替え、RecallProvider に流す）で、
// 画面全体（帯・ボタン・カード）ではなく一覧の見た目だけを確かめる。
// タスク7の見た目確認用。次のタスクで RecallScreen に差し込むまでの仮のページ。
import { notFound } from 'next/navigation'
import { useEffect, useState } from 'react'
import { RecallProvider } from '@/components/recall/RecallProvider'
import { RecallDex } from '@/components/recall/RecallDex'
import { useFieldData } from '@/components/recall/useFieldData'
import { platesOf, todayOf } from '@/lib/recall/dex'
import { genreLabel } from '@/lib/recall/genres'
import type { RecallClaim, RecallProgress, RecallSectionRead } from '@/lib/recall/types'

const DAY = 86_400_000
const USED: Array<[number, number]> = [
  [2, 34], [3, 178], [4, 61], [5, 42], [6, 18], [9, 25], [12, 97], [13, 12],
  [14, 33], [16, 9], [21, 30], [23, 14], [24, 11], [25, 20], [26, 8],
]

const rnd = (seed: number) => {
  let s = seed | 0
  return () => {
    s = (s + 1831565813) | 0
    let r = Math.imul(s ^ (s >>> 15), 1 | s)
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

// /dev/recall-screen の仮データ作りをそのまま使う（同じ在庫で一覧の見た目を確かめるため）。
function fakeData(now: number) {
  const claims: RecallClaim[] = []
  const progress: RecallProgress[] = []
  const reads: RecallSectionRead[] = []
  for (const [slot, n] of USED) {
    const g = rnd(slot * 7919 + 11)
    const pages = 2 + Math.floor(g() * 5)
    for (let i = 0; i < n; i++) {
      const page = i % pages
      const pageId = `${slot}-p${page}`
      const sectionKey = `sec${Math.floor(i / 4) % 7}`
      const claimId = `${slot}-${i}`
      const body = `${genreLabel(slot)}の主張 ${i + 1}。初期輸液は 30 mL/kg を 3 時間以内に。`
      claims.push({
        claimId, pageId, pageTitle: `${genreLabel(slot)}の記事 ${page + 1}`, pageKind: 'knowledge',
        sectionKey, sectionHeading: `第${(i % 7) + 1}節`, body,
        source: 'Surviving Sepsis Campaign 2021', confidence: 'ok',
        genres: [genreLabel(slot)], primaryGenre: genreLabel(slot), genreSlot: slot,
        holes: [[body.indexOf('30 mL/kg'), body.indexOf('30 mL/kg') + 8]], clozeStatus: 'approved', active: true,
        createdAt: new Date(now - (n - i) * 60_000).toISOString(),
      })
      const v = g()
      if (v < 0.42) continue
      if (v < 0.66) { reads.push({ pageId, sectionKey, readAt: new Date(now - DAY).toISOString() }); continue }
      const settled = v >= 0.93
      const intervalDays = settled ? 120 : 10
      const remaining = settled ? 0.6 + g() * 0.4 : Math.max(0.02, g())
      const keptAt = new Date(now - (1 - remaining) * intervalDays * DAY).toISOString()
      progress.push({
        claimId, keptAt, streak: settled ? 6 : 2, intervalDays,
        dueAt: new Date(now + remaining * intervalDays * DAY).toISOString(),
        lastReviewedAt: keptAt, lastResult: 'ok', okCount: 3, ngCount: 0, removedAt: null,
      })
    }
  }
  return { claims, progress, reads }
}

function DexPreview() {
  const data = useFieldData()
  const [opened, setOpened] = useState<number | null>(null)
  if (data.loading) return <p className="p-4 text-sm text-slate-500">読み込んでいます</p>
  const { used, empty } = platesOf(data.planets)
  const today = todayOf(used, data.nextDueOf(null), new Date())
  return (
    <div className="max-w-2xl mx-auto px-4 py-4">
      {opened !== null && (
        <p className="mb-2 text-[11px] text-cyan-700 dark:text-cyan-300">分野ページへ（未実装）: slot {opened}</p>
      )}
      <RecallDex
        plates={used}
        empty={empty}
        today={today}
        counts={data.counts}
        total={data.claims.length}
        onOpen={setOpened}
        onSweep={() => setOpened(-1)}
      />
    </div>
  )
}

export default function DevDexPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  const [ready, setReady] = useState(false)
  const [dark, setDark] = useState(false)

  useEffect(() => {
    // 機能フラグ（表示制御）を localhost の設定に足す（/dev/recall-screen と同じ手口）。
    try {
      const key = 'medical_search_settings'
      const cur = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>
      const feats = Array.isArray(cur.earlyAccessFeatures) ? (cur.earlyAccessFeatures as string[]) : []
      if (!feats.includes('recall')) localStorage.setItem(key, JSON.stringify({ ...cur, earlyAccessFeatures: [...feats, 'recall'] }))
    } catch { /* 書けない端末では画面が空のまま（フラグが閉じている扱い） */ }
    const data = fakeData(Date.now())
    const real = window.fetch.bind(window)
    const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }))
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.startsWith('/api/recall/claims')) return json({ claims: data.claims })
      if (url.startsWith('/api/recall/progress')) return json({ progress: data.progress, reads: data.reads })
      if (url.startsWith('/api/recall/')) return json({ ok: true })
      return real(input, init)
    }
    setDark(document.documentElement.classList.contains('dark'))
    setReady(true)
    return () => { window.fetch = real }
  }, [])

  const toggleDark = () => setDark(document.documentElement.classList.toggle('dark'))

  return (
    <div className="min-h-screen bg-white dark:bg-gray-900">
      <div className="fixed inset-x-0 top-0 z-10 flex items-center justify-between bg-white/95 dark:bg-gray-900/95 px-4 py-2 border-b border-gray-100 dark:border-gray-700">
        <button type="button" onClick={toggleDark} className="text-[11px] text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
          {dark ? 'ダーク' : 'ライト'}
        </button>
        <span className="text-[12px] text-gray-400">RecallDex dev preview</span>
      </div>
      <div className="pt-10">
        {ready && (
          <RecallProvider>
            <DexPreview />
          </RecallProvider>
        )}
      </div>
    </div>
  )
}
