'use client'
// 検索タブの「前にも調べています」と「外で調べる」の入口（大型アップデート段階1）。
// isTrailEnabled() が偽なら何も描かない（既存の検索画面のまま）。
//
// 1. 打ち終わった問いを /api/trail/lookup へ送り、前の自分（残したもの・前の検索）を受け取る。
//    重なりが無ければ何も出さない（約束「確かでないときは出さない」）。
// 2. 自分の記録に無いときのために「外で調べる」を1行だけ置く。MediNode を
//    「調べはじめる場所」にするための入口なので、結果の有無にかかわらず出す。
import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronRight, Clock, ExternalLink, PenLine } from 'lucide-react'
import { isTrailEnabled, isTrailRecording } from '@/lib/trail-flag'
import type { Previous, PreviousLookup, PreviousSaved } from '@/lib/trail/match'
import { formatTrailDate, shortHost } from '@/lib/trail/format'
import { outsideLabels } from '@/lib/trail/outside'
import { requestSaveSheet } from '@/lib/trail/pending'
import { TrailOutsideSheet } from './TrailOutsideSheet'

// 打ち終わりを待つ時間。検索そのもの（600ms）より長くし、打鍵の途中を記録しにくくする。
// それでも途中で記録された断片は、サーバー側（planLookupWrite）が続きの言葉にまとめる。
const RECORD_DEBOUNCE_MS = 1200
const MIN_LEN = 2

type LookupState = { q: string; lookupId: string | null; previous: Previous }

async function postLookup(query: string): Promise<{ lookupId: string | null; previous: Previous } | null> {
  try {
    const res = await fetch('/api/trail/lookup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, record: isTrailRecording() }),
    })
    if (!res.ok) return null
    const j = (await res.json()) as { lookupId?: string | null; previous?: Previous }
    return j.previous ? { lookupId: j.lookupId ?? null, previous: j.previous } : null
  } catch {
    return null
  }
}

export function TrailPanel({ query }: { query: string }) {
  const enabled = isTrailEnabled()
  const q = query.replace(/\s+/g, ' ').trim()
  const [state, setState] = useState<LookupState | null>(null)
  const [outsideOpen, setOutsideOpen] = useState(false)
  // 外へ出るときに記録がまだ無ければ（打ち終わりを待っている間に押された）、その場で記録する。
  const inflight = useRef<Promise<string | null> | null>(null)

  useEffect(() => {
    if (!enabled || q.length < MIN_LEN) { setState(null); return }
    let alive = true
    inflight.current = null
    const timer = setTimeout(() => {
      const p = postLookup(q).then((r) => {
        if (alive && r) setState({ q, ...r })
        return r?.lookupId ?? null
      })
      inflight.current = p
    }, RECORD_DEBOUNCE_MS)
    return () => { alive = false; clearTimeout(timer) }
  }, [q, enabled])

  const current = state && state.q === q ? state : null

  const ensureLookupId = useCallback(async (): Promise<string | null> => {
    if (current?.lookupId) return current.lookupId
    if (inflight.current) return inflight.current
    const r = await postLookup(q)
    if (r) setState({ q, ...r })
    return r?.lookupId ?? null
  }, [current, q])

  if (!enabled || q.length < MIN_LEN) return null
  const prev = current?.previous
  const hasPrev = !!prev && (prev.saved.length > 0 || prev.lookups.length > 0)

  return (
    <div className="mb-4 space-y-2">
      {hasPrev && prev && <PreviousStrip previous={prev} />}
      <div className="flex items-stretch gap-2">
        <button
          type="button"
          onClick={() => setOutsideOpen(true)}
          className="flex-1 min-w-0 min-h-[44px] flex items-center justify-between gap-2 rounded-xl px-4 py-2 bg-white dark:bg-gray-800 ring-1 ring-gray-200 dark:ring-gray-700 text-left text-sm leading-snug text-gray-700 dark:text-gray-200 active:scale-[0.99] transition-transform"
        >
          <span>ここに無いことを、外で調べる</span>
          <ChevronRight className="w-4 h-4 shrink-0 text-gray-400" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => requestSaveSheet({ lookupId: current?.lookupId ?? null, query: q, dest: null })}
          className="min-h-[44px] flex items-center gap-1.5 rounded-xl px-3.5 bg-brand-600 text-white text-sm font-semibold active:scale-[0.98] transition-transform"
        >
          <PenLine className="w-4 h-4" aria-hidden="true" />
          残す
        </button>
      </div>
      {outsideOpen && (
        <TrailOutsideSheet query={q} ensureLookupId={ensureLookupId} onClose={() => setOutsideOpen(false)} />
      )}
    </div>
  )
}

// 「前にも調べています」。残したものを先に、前の検索をあとに並べる。
// 色は琥珀（前のあなた）だけ。数は出さない（何回調べたかを責める形にしない）。
function PreviousStrip({ previous }: { previous: Previous }) {
  const now = new Date()
  return (
    <section
      aria-label="前にも調べています"
      className="rounded-2xl border border-past-200 dark:border-past-800 bg-past-50 dark:bg-past-900 px-4 py-3.5 animate-fade-in-up"
    >
      <div className="flex items-center gap-2">
        <Clock className="w-4 h-4 text-past-600 dark:text-past-300" aria-hidden="true" />
        <span className="text-sm font-bold text-past-700 dark:text-past-300">前にも調べています</span>
      </div>
      <ul className="mt-2.5 space-y-3">
        {previous.saved.map((s) => <SavedEntry key={s.id} s={s} now={now} />)}
        {previous.lookups.map((l) => <LookupEntry key={l.id} l={l} now={now} />)}
      </ul>
    </section>
  )
}

function SavedEntry({ s, now }: { s: PreviousSaved; now: Date }) {
  const host = shortHost(s.url)
  const text = s.note || s.title || host
  const places = s.outside ? outsideLabels([s.outside]) : []
  return (
    <li>
      <p className="text-xs font-bold text-past-700 dark:text-past-300">
        {formatTrailDate(s.createdAt, now)}のあなた<span className="font-normal text-past-600/90 dark:text-past-300/80">　残したもの</span>
      </p>
      {text && (
        <blockquote className="mt-1.5 pl-3 border-l-2 border-past-400 dark:border-past-500 text-[15px] leading-relaxed text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words">
          {text}
        </blockquote>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-past-700 dark:text-past-300">
        {s.query && <span>問い「{s.query}」</span>}
        {places.length > 0 && <span>そのとき開いた先：{places.join('・')}</span>}
        {s.url && host && (
          <a
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 min-h-[32px] font-semibold underline-offset-2 hover:underline"
          >
            {host}を開く
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        )}
      </div>
    </li>
  )
}

function LookupEntry({ l, now }: { l: PreviousLookup; now: Date }) {
  const places = outsideLabels(l.outside)
  return (
    <li>
      <p className="text-xs font-bold text-past-700 dark:text-past-300">{formatTrailDate(l.lastSearchedAt, now)}のあなた</p>
      <p className="mt-1 text-sm leading-relaxed text-gray-900 dark:text-gray-100">
        「{l.query}」を調べています。
        {places.length > 0 && <>そのときは{places.join('・')}を開いています。</>}
      </p>
    </li>
  )
}
