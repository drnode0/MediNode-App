'use client'
// 調べた記録（大型アップデート段階1）の dev ハーネス（development 限定）。ログインもDBも要らない。
// /api/trail/* への fetch をメモリ上の表に差し替え、照合と書き方は本物の純ロジック
// （src/lib/trail/match.ts）で計算する。見た目と流れ（前にも調べています → 外で調べる →
// 戻ってきたら残す → 最近残したもの → 記録の扱い）を目で確かめるためのもの。
// 機能フラグは localStorage の設定に 'trail' を足して開ける（localhost の設定にだけ書く）。
import { notFound } from 'next/navigation'
import { useEffect, useState } from 'react'
import { TrailPanel } from '@/components/trail/TrailPanel'
import { TrailSavedList } from '@/components/trail/TrailSavedList'
import { TrailReturnSheet } from '@/components/trail/TrailReturnSheet'
import { normalizeQuery, pickPrevious, planLookupWrite, type PastLookup, type SavedItem } from '@/lib/trail/match'
import { setPending } from '@/lib/trail/pending'

const DAY = 86_400_000

function seed(now: number): { lookups: PastLookup[]; saved: SavedItem[] } {
  const at = (msAgo: number) => new Date(now - msAgo).toISOString()
  return {
    lookups: [
      { id: 'l1', query: '敗血症 初期輸液', norm: normalizeQuery('敗血症 初期輸液'), firstSearchedAt: at(60 * DAY), lastSearchedAt: at(60 * DAY), times: 1, outside: ['pubmed'] },
      { id: 'l2', query: 'PLR 輸液反応性', norm: normalizeQuery('PLR 輸液反応性'), firstSearchedAt: at(5 * DAY), lastSearchedAt: at(5 * DAY), times: 2, outside: [] },
    ],
    saved: [
      {
        id: 's1', lookupId: null, query: 'セフトリアキソン 偽胆石', title: 'ロセフィン静注用 添付文書',
        note: '小児で起きやすい。多くは中止で消える。腹痛が出たら疑う。', body: '',
        url: 'https://www.pmda.go.jp/', origin: 'lookup', outside: 'pmda', createdAt: at(12 * DAY),
      },
    ],
  }
}

export default function DevTrailPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  const [ready, setReady] = useState(false)
  const [query, setQuery] = useState('敗血症　初期輸液')
  const [dark, setDark] = useState(false)

  useEffect(() => {
    try {
      const key = 'medical_search_settings'
      const cur = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>
      const feats = Array.isArray(cur.earlyAccessFeatures) ? (cur.earlyAccessFeatures as string[]) : []
      if (!feats.includes('trail')) localStorage.setItem(key, JSON.stringify({ searchMode: 'notion', ...cur, earlyAccessFeatures: [...feats, 'trail'] }))
    } catch { /* 書けない端末では何も出ない（フラグが閉じている扱い） */ }

    const db = seed(Date.now())
    let seq = 0
    const real = window.fetch.bind(window)
    const json = (body: unknown, status = 200) =>
      Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))
    const bodyOf = (init?: RequestInit) => {
      try { return JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> } catch { return {} }
    }
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const method = (init?.method ?? 'GET').toUpperCase()
      if (url.startsWith('/api/trail/lookup')) {
        const b = bodyOf(init) as { query?: string; record?: boolean }
        const q = String(b.query ?? '')
        const now = Date.now()
        const previous = pickPrevious({ query: q, now, lookups: db.lookups, saved: db.saved })
        if (b.record === false) return json({ lookupId: null, previous })
        const norm = normalizeQuery(q)
        const plan = planLookupWrite({ norm, now, lookups: db.lookups })
        const iso = new Date(now).toISOString()
        let id: string
        if (plan.kind === 'insert') {
          id = `n${++seq}`
          db.lookups.unshift({ id, query: q, norm, firstSearchedAt: iso, lastSearchedAt: iso, times: 1, outside: [] })
        } else {
          id = plan.id
          const row = db.lookups.find((l) => l.id === id)
          if (row) Object.assign(row, { query: q, lastSearchedAt: iso }, plan.kind === 'replace' ? { norm } : {})
          if (plan.kind === 'touchAndDrop') db.lookups = db.lookups.filter((l) => l.id !== plan.dropId)
        }
        return json({ lookupId: id, previous })
      }
      if (url.startsWith('/api/trail/outside')) {
        const b = bodyOf(init) as { lookupId?: string; dest?: string }
        const row = db.lookups.find((l) => l.id === b.lookupId)
        if (row && b.dest && !row.outside.includes(b.dest)) row.outside.push(b.dest)
        return json({ ok: true, recorded: !!row })
      }
      if (url.startsWith('/api/trail/saves') && method === 'GET') {
        return json({ items: db.saved.map(({ body: _b, lookupId: _l, ...rest }) => rest) })
      }
      if (url.startsWith('/api/trail/saves') && method === 'POST') {
        const b = bodyOf(init) as Record<string, string | null>
        if (!b.url && !b.note && !b.body) return json({ error: 'empty' }, 400)
        const item: SavedItem = {
          id: `s${++seq}`, lookupId: b.lookupId ?? null, query: b.query ?? null, title: '', note: b.note ?? '', body: b.body ?? '',
          url: b.url ?? null, origin: b.lookupId || b.outside ? 'lookup' : 'paste', outside: b.outside ?? null, createdAt: new Date().toISOString(),
        }
        db.saved.unshift(item)
        return json({ item }, 201)
      }
      if (url.startsWith('/api/trail/saves') && method === 'DELETE') {
        const id = new URL(url, 'http://x').searchParams.get('id')
        db.saved = db.saved.filter((s) => s.id !== id)
        return json({ ok: true })
      }
      if (url.startsWith('/api/trail/lookups') && method === 'DELETE') {
        db.lookups = []
        return json({ ok: true })
      }
      return real(input, init)
    }
    setDark(document.documentElement.classList.contains('dark'))
    setReady(true)
    return () => { window.fetch = real }
  }, [])

  const simulateReturn = () => {
    setPending({ lookupId: null, query: 'セフトリアキソン 偽胆石 小児', dest: 'pubmed', at: Date.now() - 90_000 })
    window.dispatchEvent(new Event('focus'))
  }

  if (!ready) return null
  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-50 to-gray-50 dark:from-gray-900 dark:to-gray-800">
      <div className="max-w-2xl mx-auto px-4 py-4">
        <div className="flex flex-wrap gap-2 mb-3 text-xs">
          <span className="text-gray-400">dev｜調べた記録</span>
          <button type="button" className="px-2 py-1 rounded ring-1 ring-gray-300" onClick={() => setDark(document.documentElement.classList.toggle('dark'))}>
            {dark ? 'ライト' : 'ダーク'}
          </button>
          <button type="button" className="px-2 py-1 rounded ring-1 ring-gray-300" onClick={() => setQuery('')}>空の画面</button>
          <button type="button" className="px-2 py-1 rounded ring-1 ring-gray-300" onClick={() => setQuery('セフトリアキソン 偽胆石')}>残したものに一致</button>
          <button type="button" className="px-2 py-1 rounded ring-1 ring-gray-300" onClick={simulateReturn}>外から戻った</button>
        </div>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={1}
          aria-label="検索語"
          className="w-full resize-none border border-gray-200 dark:border-gray-600 dark:bg-gray-800 dark:text-white rounded-xl px-4 py-2.5 text-sm mb-3"
        />
        <TrailPanel query={query} />
        {!query && <TrailSavedList />}
      </div>
      <TrailReturnSheet />
    </div>
  )
}
