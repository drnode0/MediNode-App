'use client'
// 本物の Recall 画面（RecallScreen＝凡例・帯・ボタン・カードまで）を、ログイン無しで見る
// dev ハーネス（development限定）。API への fetch を仮の応答に差し替えて RecallProvider に流す。
// /dev/recall-field が canvas だけを見るのに対し、こちらはタブから来たときの画面全体を見る
//（ヘッダーの真似を上に置き、ライト／ダークを切り替える）。
//
// 仮の応答は /api/recall/claims と /api/recall/progress の2つ。keep / review / read は
// 成功だけ返す（記録はどこにも残らない）。機能フラグは localStorage の設定に 'recall' を足して開ける
//（localhost の設定にだけ書く。本番の設定には触れない）。
import { notFound } from 'next/navigation'
import { useEffect, useState } from 'react'
import { RecallProvider } from '@/components/recall/RecallProvider'
import { RecallScreen } from '@/components/recall/RecallScreen'
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
      if (v < 0.42) continue                                   // 未着手
      if (v < 0.66) { reads.push({ pageId, sectionKey, readAt: new Date(now - DAY).toISOString() }); continue } // 読んだ
      // 残した（保持力は乱数）／深く残した（間隔 90 日以上）
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

export default function DevRecallScreenPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  const [ready, setReady] = useState(false)
  const [dark, setDark] = useState(false)

  useEffect(() => {
    // 機能フラグ（表示制御）を localhost の設定に足す。
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
    <>
      {/* アプリのヘッダーの真似（page.tsx の data-app-header と同じ色・高さの目安）。 */}
      <div data-app-header className="fixed inset-x-0 top-0 z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-gray-100 dark:border-gray-700 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 pt-3 pb-2">
          <div className="flex items-center justify-between mb-3">
            <button type="button" onClick={toggleDark} className="w-16 text-left text-[11px] text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">
              {dark ? 'ダーク' : 'ライト'}
            </button>
            <span className="text-lg font-bold text-gray-900 dark:text-white">MediNode</span>
            <span className="w-16 text-right text-[11px] text-gray-400">dev</span>
          </div>
          <div className="flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1 gap-0.5 overflow-x-auto">
            {['検索', '新着', 'ジャンル', 'クイズ', 'Recall'].map((t) => (
              <span key={t} className={`shrink-0 flex-1 text-center py-1.5 px-1 rounded-lg text-[11px] font-semibold whitespace-nowrap ${t === 'Recall' ? 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300' : 'text-gray-500 dark:text-gray-400'}`}>{t}</span>
            ))}
          </div>
        </div>
      </div>
      {ready && (
        <RecallProvider>
          <RecallScreen />
        </RecallProvider>
      )}
    </>
  )
}
