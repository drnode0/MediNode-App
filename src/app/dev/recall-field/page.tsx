'use client'
// 惑星（Recall）の dev ハーネス（development限定）。
// Supabase にも API にも触れない。仮の主張を作って、実物の RecallField を目視確認する。
//
// 見るところ:
//   ・空の惑星のモヤの量（37席のうち22席が空＝遠景の6割）が「これから埋まる場所」に見えるか
//   ・中景で芯が族として見分けられるか。近景で輪の5段と記事の扇形が読めるか
//   ・回し心地（慣性・近景の2軸）と、境目の名前が3秒で消えること
//   ・ライト（紙に紺の線）とダーク（紺に白の線）で、同じ5段が同じ強さで見分けられるか。
//     上の帯はアプリのヘッダーを真似たもの（本物は page.tsx）。タブから来た印象を見るために置く
import { notFound } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { RecallField, type FieldHandle } from '@/components/recall/RecallField'
import { fieldLayout } from '@/lib/recall/field'
import { familyCenter, FAMILY_ORDER } from '@/lib/recall/field-cluster'
import { FAMILY_NOUN } from '@/lib/recall/families'
import { coreEnglishOf } from '@/lib/recall/genre-en'
import { planetSummary, isEscaping } from '@/lib/recall/field-layout'
import { fanOf, type FanClaim } from '@/lib/recall/field-angle'
import { GENRE_SEATS, genreLabel } from '@/lib/recall/genres'
import type { ClaimDot, Planet } from '@/lib/recall/field-render'
import type { FieldCenter, FieldStage } from '@/lib/recall/field'
import type { Vec3 } from '@/lib/recall/layout'
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
  // タスク13の検証用: initialNear を渡す/渡さないを切り替える（本番の隠しコマンドはまだ無い＝14で足す）
  const [initialNear, setInitialNear] = useState<number | undefined>(undefined)
  const [stage, setStage] = useState<FieldStage>('mid')
  const [front, setFront] = useState<number | null>(null)
  const [lensPageId, setLensPageId] = useState<string | null>(null)
  const [shelf, setShelf] = useState<string[]>([])
  const [foldEmpty, setFoldEmpty] = useState(true)
  const [dark, setDark] = useState(false)
  useEffect(() => { setDark(document.documentElement.classList.contains('dark')) }, [])
  const toggleDark = () => {
    const next = document.documentElement.classList.toggle('dark')
    setDark(next)
  }

  // 隠しコマンドの段（再計画 §4）。段0の承認用: 球（案4）と宇宙（星団）を切り替える。
  const [lift, setLift] = useState<'off' | 'sphere' | 'space'>('off')
  // 前の版（initialNear の近景）と同じ惑星で見比べられるよう、既定を揃えておく
  const [liftSlot, setLiftSlot] = useState(2)
  const [midName, setMidName] = useState<number | null>(null)
  const [tappedFamily, setTappedFamily] = useState<string | null>(null)  // 撮影用: 族名に当たったか

  const both = useMemo(() => {
    const bySlot = makeClaims()
    const counts = new Array(GENRE_SEATS.length).fill(0)
    for (const [slot, list] of bySlot) counts[slot] = list.length
    const build = (seat: ReturnType<typeof fieldLayout>[number]) => {
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
    }
    return {
      ring: fieldLayout(counts).map(build) as Planet[],
      cluster: fieldLayout(counts, 'cluster').map(build) as Planet[],
    }
  }, [])
  const planets = both.ring
  const cluster = both.cluster

  // 族名は星団の中心の少し上に置く。
  const familyLabels = useMemo(() => FAMILY_ORDER.map((kind, i) => {
    const c = familyCenter(i)
    return { text: coreEnglishOf(kind), sub: FAMILY_NOUN[kind], kind, at: [c[0], c[1] + 0.2, c[2]] as Vec3 }
  }), [])

  const midPlanet = midName === null ? null : cluster.find((p) => p.seat.slot === midName)
  const liftPlanet = cluster.find((p) => p.seat.slot === liftSlot)

  const hereSlot = stage === 'near' ? front : front
  const here = planets.find((p) => p.seat.slot === hereSlot)
  const escapingHere = here ? here.dots.filter((d) => isEscaping(d.state.kind, d.state.remaining)).slice(0, 5) : []

  const btn = 'rounded-full border border-slate-300 bg-white/85 px-3 py-1.5 text-[12px] text-slate-700 hover:bg-slate-100 dark:border-slate-500/50 dark:bg-transparent dark:text-slate-200 dark:hover:bg-white/10'

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
        className={`whitespace-nowrap rounded px-2 py-1 text-[11.5px] ${front === s.slot ? 'bg-amber-200/90 text-slate-900' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-900/[.06] dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-white/10'}`}>
        {s.label}
        {s.n > 0 && <span className="ml-1.5 opacity-60 tabular-nums">{s.n}</span>}
        {s.escaping > 0 && <span className={`ml-1.5 tabular-nums ${front === s.slot ? 'text-amber-800' : 'text-amber-700 dark:text-amber-200'}`}>●{s.escaping}</span>}
      </button>
    </li>
  )

  return (
    <div className="fixed inset-0 bg-[#F5F7FA] dark:bg-[#0B1524] text-slate-800 dark:text-slate-100" style={{ fontFamily: '"Zen Kaku Gothic New",sans-serif' }}>
      {lift === 'off' && (
        <RecallField ref={field} key={initialNear ?? 'none'}
          planets={planets} center={center} reduced={reduced} initialNear={initialNear}
          shelf={shelf} again={new Set()} lensPageId={lensPageId} cardOpen={false} shelfBottom={72}
          onFront={setFront}
          onStage={(s) => { setStage(s); if (s !== 'near') setLensPageId(null) }}
          onDotTap={() => { /* dev: 何もしない */ }}
          onShelfTap={(id) => setShelf((prev) => prev.filter((x) => x !== id))}
          onLens={setLensPageId}
          onCloseCard={() => { /* dev: カードは出さない */ }} />
      )}

      {/* 球（案4）。その惑星だけ・芯と点と輪郭だけ・触れると扇形の弧・縦横斜めに頭打ちなし */}
      {lift === 'sphere' && liftPlanet && (
        <RecallField ref={field} key={`sphere-${liftSlot}`}
          planets={[liftPlanet]} center="outside" reduced={reduced} initialNear={liftSlot}
          free lockNear fanOnTouch
          show={{ edgeLabels: false, edgeCircles: false, fans: false, pageLabels: false, nebula: true }}
          shelf={[]} again={new Set()} lensPageId={null} cardOpen={false}
          onFront={setFront} onStage={() => {}}
          onDotTap={() => {}} onShelfTap={() => {}} onLens={() => {}} onCloseCard={() => {}} />
      )}

      {/* 宇宙（族ごとの星団・遠景）。文字は族名だけ・空の席はガス */}
      {lift === 'space' && (
        <RecallField ref={field} key="space"
          planets={cluster} mode="cluster" center="outside" reduced={reduced} initialStage="far"
          show={{ planetLabels: false, nebula: true }} familyLabels={familyLabels}
          onPlanetTap={(s) => { setLiftSlot(s); setLift('sphere') }}
          onFamilyTap={setTappedFamily}
          shelf={[]} again={new Set()} lensPageId={null} cardOpen={false}
          onFront={setFront}
          onStage={(s, slot) => { setStage(s); setMidName(s === 'mid' ? slot : null) }}
          onDotTap={() => {}} onShelfTap={() => {}} onLens={() => {}} onCloseCard={() => {}} />
      )}

      {/* 中景で寄せた惑星の名前（本番は RecallLift が DOM で出す） */}
      {lift === 'space' && midPlanet && (
        <div data-testid="mid-caption"
          className="pointer-events-none absolute inset-x-0 text-center" style={{ top: '61%' }}>
          <div className="text-slate-700 dark:text-slate-100" style={{ fontSize: 22, letterSpacing: '0.22em', fontWeight: 300 }}>
            {midPlanet.seat.label}
          </div>
          <div className="mt-1.5 text-slate-500 dark:text-slate-400"
            style={{ fontSize: 11, letterSpacing: '0.34em', fontWeight: 300 }}>
            {coreEnglishOf(midPlanet.seat.kind).toUpperCase()}
          </div>
        </div>
      )}

      {/* アプリのヘッダーの真似（page.tsx の data-app-header と同じ色・高さの目安）。タブから来た印象を見る用。 */}
      <div data-app-header hidden={lift !== 'off'} className="absolute inset-x-0 top-0 z-10 bg-white/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-gray-100 dark:border-gray-700 shadow-sm">
        <div className="max-w-2xl mx-auto px-4 pt-3 pb-2">
          <div className="flex items-center justify-between mb-3">
            <span className="w-16 text-[11px] text-gray-400">dev</span>
            <span className="text-lg font-bold text-gray-900 dark:text-white">MediNode</span>
            <span className="w-16" />
          </div>
          <div className="flex rounded-xl bg-gray-100 dark:bg-gray-800 p-1 gap-0.5 overflow-x-auto">
            {['検索', '新着', 'ジャンル', 'クイズ', 'Recall'].map((t) => (
              <span key={t} className={`shrink-0 flex-1 text-center py-1.5 px-1 rounded-lg text-[11px] font-semibold whitespace-nowrap ${t === 'Recall' ? 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-700 dark:text-cyan-300' : 'text-gray-500 dark:text-gray-400'}`}>{t}</span>
            ))}
          </div>
        </div>
      </div>

      {/* 隠しコマンドを見ているあいだは、dev の飾りを下へ逃がす（本番の見え方に近づけるため） */}
      <div className={`absolute left-4 flex flex-wrap gap-2 items-center ${lift === 'off' ? 'top-[110px]' : 'bottom-3 opacity-40'}`}>
        <span className="text-[11px] tracking-widest text-amber-700 dark:text-amber-200">dev｜惑星</span>
        <button type="button" className={btn} onClick={toggleDark} data-dark={dark}>テーマ: {dark ? 'ダーク' : 'ライト'}</button>
        <span hidden data-testid="tapped-family" data-family={tappedFamily ?? ''} />
        {/* 撮影用: 席→族と、正面に来る席（族名の当たり判定を外から計算するため） */}
        <span hidden data-seat-kinds={JSON.stringify(Object.fromEntries(cluster.map((p) => [p.seat.slot, p.seat.kind])))}
          data-first-slot={cluster.find((p) => p.seat.n > 0)?.seat.slot ?? 0} />
        <button type="button" className={btn} data-testid="lift-toggle" data-lift={lift}
          onClick={() => setLift((v) => (v === 'off' ? 'sphere' : v === 'sphere' ? 'space' : 'off'))}>
          隠しコマンド: {lift === 'off' ? '切' : lift === 'sphere' ? '球' : '宇宙'}
        </button>
        <button type="button" className={btn} onClick={() => setCenter(center === 'outside' ? 'inside' : 'outside')}>
          中心: {center === 'outside' ? '外から' : '中心から'}
        </button>
        <button type="button" className={btn} onClick={() => setReduced((v) => !v)}>動きを減らす: {reduced ? 'する' : 'しない'}</button>
        <button type="button" className={btn} onClick={() => field.current?.enterNear()}>寄る</button>
        <button type="button" className={btn} data-testid="initial-near-toggle"
          onClick={() => setInitialNear((v) => (v === undefined ? 2 : undefined))}>
          initialNear: {initialNear ?? 'なし'}
        </button>
        <button type="button" className={btn} onClick={() => field.current?.backToMid()}>中景へ</button>
        <button type="button" className={btn} onClick={() => setShelf(escapingHere.map((d) => d.claimId))}>この惑星を確かめる</button>
        <button type="button" className={btn} onClick={() => setShelf([])}>戻す</button>
      </div>
      <nav aria-label="ジャンル" hidden={lift !== 'off'} className="absolute left-3 right-3 bottom-3 rounded-[10px] border border-slate-300/80 bg-white/90 dark:border-slate-600/40 dark:bg-[rgba(22,41,63,.92)] overflow-hidden backdrop-blur">
        <ul className="flex gap-1 m-0 px-2 py-1.5 list-none overflow-x-auto">
          {full.map(seatButton)}
          {empty.length > 0 && (
            <li>
              <button type="button" onClick={() => setFoldEmpty((v) => !v)}
                className="whitespace-nowrap rounded px-2 py-1 text-[11.5px] text-slate-400 hover:text-slate-700 dark:text-slate-500 dark:hover:text-slate-300">
                {foldEmpty ? `空の席 ${empty.length} ▸` : '空の席を畳む ◂'}
              </button>
            </li>
          )}
          {!foldEmpty && empty.map(seatButton)}
        </ul>
      </nav>

      <div hidden={lift !== 'off'} className="absolute right-4 top-[110px] text-right text-[11.5px] text-slate-500 dark:text-slate-400">
        <div>{stage}　{here ? here.seat.label : '—'}</div>
        <div>主張 {here?.seat.n ?? 0}　離れかけ {escapingHere.length}</div>
        <div>空の席 {planets.filter((p) => p.summary.haze).length} / {planets.length}</div>
        <div data-shelf={shelf.length}>棚 {shelf.length}</div>
      </div>
    </div>
  )
}
