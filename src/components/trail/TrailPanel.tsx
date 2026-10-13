'use client'
// 検索タブの、以前の自分（琥珀のカード）と、外部サイトへのボタン列（大型アップデート段階1）。
// isTrailEnabled() が偽なら何も描かない（既存の検索画面のまま）。
//
// - TrailPast: 結果の上。今の検索語が、以前の検索や残したメモと重なるときだけ出す
//   （約束「確かでないときは出さない」）。見出しや説明の文は置かず、日付・出所・色で伝える
//   （2026-10-13 本人の指示「説明くさい表現をアプリ内で使わない」）。
// - TrailWeb: 結果の下。PubMed などを検索語入りで開くボタンと「残す」。
//
// 2つは別の場所に置くが、検索の記録（/api/trail/lookup）は同じ検索語につき1回だけ送る
// （下の lookupFor が、飛んでいる要求を共有する）。
import { useEffect, useState } from 'react'
import { Clock, ExternalLink, PenLine } from 'lucide-react'
import { isTrailEnabled, isTrailRecording } from '@/lib/trail-flag'
import type { Previous, PreviousLookup, PreviousSaved } from '@/lib/trail/match'
import { formatTrailDate, shortHost } from '@/lib/trail/format'
import { OUTSIDE_DESTS, outsideDest } from '@/lib/trail/outside'
import { requestSaveSheet, setPending, TRAIL_SAVED_EVENT } from '@/lib/trail/pending'

// 打ち終わりを待つ時間。検索そのもの（600ms）より長くし、打鍵の途中を記録しにくくする。
// それでも途中で記録された断片は、サーバー側（planLookupWrite）が続きの言葉にまとめる。
const RECORD_DEBOUNCE_MS = 1200
const MIN_LEN = 2

type LookupResult = { lookupId: string | null; previous: Previous } | null

// 同じ検索語の要求を共有する（TrailPast と TrailWeb が別々に送らないように）。
// 直近の数件だけを覚えておけば足りる。
const inflight = new Map<string, Promise<LookupResult>>()
let listening = false
function lookupFor(query: string): Promise<LookupResult> {
  // メモを残したあとは、同じ検索語でも新しい結果を取り直す（残したメモを琥珀のカードに出すため）。
  if (!listening && typeof window !== 'undefined') {
    listening = true
    window.addEventListener(TRAIL_SAVED_EVENT, () => inflight.clear())
  }
  const hit = inflight.get(query)
  if (hit) return hit
  const p = fetch('/api/trail/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, record: isTrailRecording() }),
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((j: { lookupId?: string | null; previous?: Previous } | null) =>
      j?.previous ? { lookupId: j.lookupId ?? null, previous: j.previous } : null,
    )
    .catch(() => null)
    .then((r: LookupResult) => {
      // 失敗は覚えない（次に同じ検索語を打ったとき、もう一度送る）。
      if (!r) inflight.delete(query)
      return r
    })
  inflight.set(query, p)
  if (inflight.size > 8) inflight.delete(inflight.keys().next().value as string)
  return p
}

function cleanQ(query: string): string {
  return query.replace(/\s+/g, ' ').trim()
}

// 打ち終わった検索語の結果を受け取る。検索語が変わったら前の結果は捨てる。
function useLookup(query: string): { q: string; result: LookupResult } {
  const enabled = isTrailEnabled()
  const q = cleanQ(query)
  const [state, setState] = useState<{ q: string; result: LookupResult } | null>(null)
  useEffect(() => {
    if (!enabled || q.length < MIN_LEN) { setState(null); return }
    let alive = true
    const timer = setTimeout(() => {
      void lookupFor(q).then((result) => { if (alive) setState({ q, result }) })
    }, RECORD_DEBOUNCE_MS)
    return () => { alive = false; clearTimeout(timer) }
  }, [q, enabled])
  return { q, result: state && state.q === q ? state.result : null }
}

export function TrailPast({ query }: { query: string }) {
  const enabled = isTrailEnabled()
  const { result } = useLookup(query)
  if (!enabled || !result) return null
  const { saved, lookups } = result.previous
  if (saved.length === 0 && lookups.length === 0) return null
  const now = new Date()
  return (
    <div className="mb-4 space-y-2">
      {saved.map((s) => <SavedCard key={s.id} s={s} now={now} />)}
      {lookups.map((l) => <LookupCard key={l.id} l={l} now={now} />)}
    </div>
  )
}

// 琥珀は「以前の自分」だけに使う色（約束・見た目2）。
const CARD = 'rounded-2xl border border-past-200 dark:border-past-800 bg-past-50 dark:bg-past-900 px-4 pt-3 pb-3.5 animate-fade-in-up'
const META = 'flex flex-wrap items-center gap-x-1.5 text-xs font-bold text-past-700 dark:text-past-300'
const ACT = 'inline-flex items-center gap-1 min-h-[32px] px-3 rounded-full border border-past-200 dark:border-past-800 bg-white dark:bg-gray-900 text-xs font-bold text-past-700 dark:text-past-300'

function Dot() {
  return <span aria-hidden="true" className="opacity-50 font-normal">·</span>
}

function SavedCard({ s, now }: { s: PreviousSaved; now: Date }) {
  const host = shortHost(s.url)
  const text = s.note || s.title || s.query || host
  const dest = outsideDest(s.outside)?.label
  return (
    <section className={CARD}>
      <p className={META}>
        <Clock className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{formatTrailDate(s.createdAt, now)}</span>
        <Dot /><span>メモ</span>
        {dest && <><Dot /><span>{dest}</span></>}
      </p>
      {text && (
        <p className="mt-2 pl-3 border-l-2 border-past-500 text-[15px] leading-relaxed text-gray-900 dark:text-gray-100 whitespace-pre-wrap break-words">
          {text}
        </p>
      )}
      {s.url && host && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <a href={s.url} target="_blank" rel="noopener noreferrer" className={ACT}>
            {host}
            <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
          </a>
        </div>
      )}
    </section>
  )
}

function LookupCard({ l, now }: { l: PreviousLookup; now: Date }) {
  const dests = l.outside.map((k) => outsideDest(k)).filter((d): d is NonNullable<typeof d> => !!d)
  return (
    <section className={CARD}>
      <p className={META}>
        <Clock className="w-3.5 h-3.5" aria-hidden="true" />
        <span>{formatTrailDate(l.lastSearchedAt, now)}</span>
        <Dot /><span>履歴</span>
      </p>
      <p className="mt-1.5 text-[15px] font-medium text-gray-900 dark:text-gray-100 break-words">{l.query}</p>
      {dests.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {dests.map((d) => (
            <a key={d.key} href={d.url(l.query)} target="_blank" rel="noopener noreferrer" className={ACT}>
              {d.label}
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          ))}
        </div>
      )}
    </section>
  )
}

// 結果の下に置くボタン列。外部サイトは本物のリンクで開く（ホーム画面のアプリでも止まらない）。
// 押した時点で「外へ出た」ことを端末に覚え、戻ったときに残すシートを出す（TrailReturnSheet）。
export function TrailWeb({ query }: { query: string }) {
  const enabled = isTrailEnabled()
  const { q, result } = useLookup(query)
  if (!enabled || q.length < MIN_LEN) return null

  const onPick = (dest: string) => {
    const at = Date.now()
    setPending({ lookupId: result?.lookupId ?? null, query: q, dest, at })
    // 記録はリンクを開く操作を待たせない。keepalive で、画面が裏へ回っても送り切る。
    void lookupFor(q).then((r) => {
      const lookupId = r?.lookupId ?? null
      if (lookupId) setPending({ lookupId, query: q, dest, at })
      return fetch('/api/trail/outside', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lookupId, dest }),
        keepalive: true,
      })
    }).catch(() => {})
  }

  return (
    <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700 flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => requestSaveSheet({ lookupId: result?.lookupId ?? null, query: q, dest: null })}
        className="min-h-[40px] inline-flex items-center gap-1.5 rounded-full px-4 bg-brand-600 text-white text-[13px] font-bold active:scale-[0.98] transition-transform"
      >
        <PenLine className="w-4 h-4" aria-hidden="true" />
        残す
      </button>
      {OUTSIDE_DESTS.map((d) => (
        <a
          key={d.key}
          href={d.url(q)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => onPick(d.key)}
          className="min-h-[40px] inline-flex items-center gap-1.5 rounded-full px-3.5 bg-white dark:bg-gray-800 ring-1 ring-gray-300 dark:ring-gray-600 text-[13px] font-bold text-gray-800 dark:text-gray-100 active:scale-[0.98] transition-transform"
        >
          {d.label}
          <ExternalLink className="w-3.5 h-3.5 text-gray-400" aria-hidden="true" />
        </a>
      ))}
    </div>
  )
}
