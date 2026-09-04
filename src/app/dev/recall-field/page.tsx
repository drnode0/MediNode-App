'use client'
// 惑星（Recall）の dev ハーネス（development限定）。
// Supabase にも API にも触れない。仮の主張を作って、実物の RecallField を目視確認する。
//
// 見るところ:
//   ・空の惑星のモヤの量（37席のうち22席が空＝遠景の6割）が「これから埋まる場所」に見えるか
//   ・中景で芯が族として見分けられるか。近景で輪の5段と記事の扇形が読めるか
//   ・回し心地（慣性・近景の2軸）と、境目の名前が3秒で消えること
import { notFound } from 'next/navigation'
import { useMemo, useRef, useState } from 'react'
import { RecallField, type FieldHandle } from '@/components/recall/RecallField'
import { fieldLayout } from '@/lib/recall/field'
import { planetSummary, isEscaping } from '@/lib/recall/field-layout'
import { fanOf, type FanClaim } from '@/lib/recall/field-angle'
import { GENRE_SEATS, genreLabel } from '@/lib/recall/genres'
import type { ClaimDot, Planet } from '@/lib/recall/field-render'
import type { FieldCenter, FieldStage } from '@/lib/recall/field'
import type { RecallState, RecallStateKind } from '@/lib/recall/types'

// 09-02 の実測に近い形（使用中15席・約590主張）。残る22席は空のまま。
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

type Fake = FanClaim & { state: RecallState }

function makeClaims(): Map<number, Fake[]> {
  const out = new Map<number, Fake[]>()
  for (const [slot, n] of USED) {
    const g = rnd(slot * 7919 + 11)
    const pages = 2 + Math.floor(g() * 5)
    const list: Fake[] = []
    for (let i = 0; i < n; i++) {
      const page = i % pages
      const v = g()
      const kind: RecallStateKind = v < 0.42 ? 'cold' : v < 0.66 ? 'touched' : v < 0.93 ? 'kept' : 'settled'
      const remaining = kind === 'kept' ? Math.max(0.02, g()) : kind === 'settled' ? 0.6 + g() * 0.4 : 0
      list.push({
        claimId: `${slot}-${i}`,
        pageId: `${slot}-p${page}`,
        pageTitle: `${genreLabel(slot)}の記事 ${page + 1}`,
        sectionKey: `sec${Math.floor(i / 4) % 7}`,
        createdAt: `2026-08-01T00:00:${String(i % 60).padStart(2, '0')}Z`,
        state: { kind, remaining },
      })
    }
    out.set(slot, list)
  }
  return out
}

export default function DevRecallFieldPage() {
  if (process.env.NODE_ENV === 'production') notFound()
  const field = useRef<FieldHandle>(null)
  const [center, setCenter] = useState<FieldCenter>('outside')
  const [reduced, setReduced] = useState(false)
  const [stage, setStage] = useState<FieldStage>('mid')
  const [front, setFront] = useState<number | null>(null)
  const [lensPageId, setLensPageId] = useState<string | null>(null)
  const [shelf, setShelf] = useState<string[]>([])
  const [foldEmpty, setFoldEmpty] = useState(true)

  const planets: Planet[] = useMemo(() => {
    const bySlot = makeClaims()
    const counts = new Array(GENRE_SEATS.length).fill(0)
    for (const [slot, list] of bySlot) counts[slot] = list.length
    return fieldLayout(counts).map((seat) => {
      const list = bySlot.get(seat.slot) ?? []
      const fan = fanOf(list)
      const keptRemainings: number[] = []
      let escaping = 0
      const dots: ClaimDot[] = list.map((c, i) => {
        if (c.state.kind === 'kept' || c.state.kind === 'settled') keptRemainings.push(c.state.remaining)
        if (isEscaping(c.state.kind, c.state.remaining)) escaping++
        return {
          claimId: c.claimId, pageId: c.pageId, state: c.state,
          angle: fan.angles.get(c.claimId) ?? 0,
          jitter: ((i * 2654435761) % 1000) / 1000 * 0.14 - 0.07,
          phase: ((i * 40503) % 628) / 100,
        }
      })
      return {
        seat,
        summary: planetSummary({ total: list.length, keptRemainings, escaping }),
        dots,
        pages: fan.pages,
      }
    })
  }, [])

  const hereSlot = stage === 'near' ? front : front
  const here = planets.find((p) => p.seat.slot === hereSlot)
  const escapingHere = here ? here.dots.filter((d) => isEscaping(d.state.kind, d.state.remaining)).slice(0, 5) : []

  const btn = 'rounded-full border border-slate-500/50 px-3 py-1.5 text-[12px] text-slate-200 hover:bg-white/10'

  // 帯（本番と同じ作り）。主張のある席が先頭・席番号順、空の席は末尾に畳む。
  const band = planets.map((p) => ({
    slot: p.seat.slot, label: p.seat.label, n: p.seat.n,
    escaping: p.dots.filter((d) => isEscaping(d.state.kind, d.state.remaining)).length,
  }))
  const full = band.filter((s) => s.n > 0)
  const empty = band.filter((s) => s.n === 0)
  const seatButton = (s: typeof band[number]) => (
    <li key={s.slot}>
      <button type="button" onClick={() => field.current?.jumpTo(s.slot)}
        aria-current={front === s.slot ? 'true' : undefined}
        className={`whitespace-nowrap rounded px-2 py-1 text-[11.5px] ${front === s.slot ? 'bg-amber-200/90 text-slate-900' : 'text-slate-400 hover:text-slate-100 hover:bg-white/10'}`}>
        {s.label}
        {s.n > 0 && <span className="ml-1.5 opacity-60 tabular-nums">{s.n}</span>}
        {s.escaping > 0 && <span className={`ml-1.5 tabular-nums ${front === s.slot ? 'text-amber-800' : 'text-amber-200'}`}>●{s.escaping}</span>}
      </button>
    </li>
  )

  return (
    <div className="fixed inset-0 bg-[#0B1524] text-slate-100" style={{ fontFamily: '"Zen Kaku Gothic New",sans-serif' }}>
      <RecallField ref={field}
        planets={planets} center={center} reduced={reduced}
        shelf={shelf} again={new Set()} lensPageId={lensPageId} cardOpen={false}
        onFront={setFront}
        onStage={(s) => { setStage(s); if (s !== 'near') setLensPageId(null) }}
        onDotTap={() => { /* dev: 何もしない */ }}
        onShelfTap={(id) => setShelf((prev) => prev.filter((x) => x !== id))}
        onLens={setLensPageId}
        onCloseCard={() => { /* dev: カードは出さない */ }} />

      <div className="absolute left-4 top-4 flex flex-wrap gap-2 items-center">
        <span className="text-[11px] tracking-widest text-amber-200">dev｜惑星</span>
        <button type="button" className={btn} onClick={() => setCenter(center === 'outside' ? 'inside' : 'outside')}>
          中心: {center === 'outside' ? '外から' : '中心から'}
        </button>
        <button type="button" className={btn} onClick={() => setReduced((v) => !v)}>動きを減らす: {reduced ? 'する' : 'しない'}</button>
        <button type="button" className={btn} onClick={() => field.current?.enterNear()}>寄る</button>
        <button type="button" className={btn} onClick={() => field.current?.backToMid()}>中景へ</button>
        <button type="button" className={btn} onClick={() => setShelf(escapingHere.map((d) => d.claimId))}>この惑星を確かめる</button>
        <button type="button" className={btn} onClick={() => setShelf([])}>戻す</button>
      </div>
      <nav aria-label="ジャンル" className="absolute left-3 right-3 bottom-3 rounded-[10px] border border-slate-600/40 bg-[rgba(22,41,63,.92)] overflow-hidden backdrop-blur">
        <ul className="flex gap-1 m-0 px-2 py-1.5 list-none overflow-x-auto">
          {full.map(seatButton)}
          {empty.length > 0 && (
            <li>
              <button type="button" onClick={() => setFoldEmpty((v) => !v)}
                className="whitespace-nowrap rounded px-2 py-1 text-[11.5px] text-slate-500 hover:text-slate-300">
                {foldEmpty ? `空の席 ${empty.length} ▸` : '空の席を畳む ◂'}
              </button>
            </li>
          )}
          {!foldEmpty && empty.map(seatButton)}
        </ul>
      </nav>

      <div className="absolute right-4 top-4 text-right text-[11.5px] text-slate-400">
        <div>{stage}　{here ? here.seat.label : '—'}</div>
        <div>主張 {here?.seat.n ?? 0}　離れかけ {escapingHere.length}</div>
        <div>空の席 {planets.filter((p) => p.summary.haze).length} / {planets.length}</div>
        <div data-shelf={shelf.length}>棚 {shelf.length}</div>
      </div>
    </div>
  )
}
