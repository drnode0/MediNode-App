import React, { useMemo, useRef, useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { RecallField, type FieldHandle } from './RecallField'
import { fieldLayout } from './field'
import { KINDS, familyCenter } from './field-cluster'
import { planetSummary, isEscaping } from '@/lib/recall/field-layout'
import { fanOf, type FanClaim } from '@/lib/recall/field-angle'
import { GENRE_SEATS, genreLabel } from '@/lib/recall/genres'
import { genreEnglishOf } from '@/lib/recall/genre-en'
import type { ClaimDot, Planet } from './field-render'
import type { RecallState, RecallStateKind } from '@/lib/recall/types'

const USED: Array<[number, number]> = [
  [2, 34], [3, 178], [4, 61], [5, 42], [6, 18], [9, 25], [12, 97], [13, 12],
  [14, 33], [16, 9], [21, 30], [23, 14], [24, 11], [25, 20], [26, 8],
]
const rnd = (seed: number) => { let s = seed | 0; return () => { s = (s + 1831565813) | 0; let r = Math.imul(s ^ (s >>> 15), 1 | s); r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r; return ((r ^ (r >>> 14)) >>> 0) / 4294967296 } }
type Fake = FanClaim & { state: RecallState }
function makeClaims(): Map<number, Fake[]> {
  const out = new Map<number, Fake[]>()
  for (const [slot, n] of USED) {
    const g = rnd(slot * 7919 + 11); const pages = 2 + Math.floor(g() * 5); const list: Fake[] = []
    for (let i = 0; i < n; i++) {
      const page = i % pages; const v = g()
      const kind: RecallStateKind = v < 0.42 ? 'cold' : v < 0.66 ? 'touched' : v < 0.93 ? 'kept' : 'settled'
      const remaining = kind === 'kept' ? Math.max(0.02, g()) : kind === 'settled' ? 0.6 + g() * 0.4 : 0
      list.push({ claimId: `${slot}-${i}`, pageId: `${slot}-p${page}`, pageTitle: `${genreLabel(slot)}の記事 ${page + 1}`, sectionKey: `sec${Math.floor(i / 4) % 7}`, createdAt: `2026-08-01T00:00:${String(i % 60).padStart(2, '0')}Z`, state: { kind, remaining } })
    }
    out.set(slot, list)
  }
  return out
}
function makePlanets(mode: 'ring' | 'cluster'): Planet[] {
  const bySlot = makeClaims(); const counts = new Array(GENRE_SEATS.length).fill(0)
  for (const [slot, list] of bySlot) counts[slot] = list.length
  return fieldLayout(counts, mode).map((seat) => {
    const list = bySlot.get(seat.slot) ?? []; const fan = fanOf(list); const keptRemainings: number[] = []; let escaping = 0
    const dots: ClaimDot[] = list.map((c, i) => {
      if (c.state.kind === 'kept' || c.state.kind === 'settled') keptRemainings.push(c.state.remaining)
      if (isEscaping(c.state.kind, c.state.remaining)) escaping++
      return { claimId: c.claimId, pageId: c.pageId, state: c.state, angle: fan.angles.get(c.claimId) ?? 0, jitter: ((i * 2654435761) % 1000) / 1000 * 0.14 - 0.07, phase: ((i * 40503) % 628) / 100 }
    })
    return { seat, summary: planetSummary({ total: list.length, keptRemainings, escaping }), dots, pages: fan.pages }
  })
}

type Variant = 1 | 2 | 3 | 4
const SHOW: Record<Variant, NonNullable<React.ComponentProps<typeof RecallField>['show']>> = {
  1: {},
  2: { edgeLabels: false, edgeCircles: false, fans: false, pageLabels: false },
  3: { edgeLabels: false, pageLabels: false },
  4: { edgeLabels: false, edgeCircles: false, fans: false, pageLabels: false },
}
const FAMILY_EN: Record<string, string> = { flow: 'Flow', exchange: 'Exchange', signal: 'Signal', invasion: 'Invasion', structure: 'Structure', regulation: 'Regulation', system: 'System' }
// 族の下に添える代表分野（主張の多い順に3つ）。動きの言葉は出さない
const FAMILY_SUB: Record<string, string> = { flow: '巡る血液', exchange: '外とやり取りする臓器', signal: '伝える神経', invasion: '外から入るもの', structure: '形と手技', regulation: '全身の釣り合い', system: '仕組み' }
type Phase = { kind: 'solo'; slot: number; from: 'page' | 'space' } | { kind: 'space' }

function App() {
  const ring = useMemo(() => makePlanets('ring'), [])
  const cluster = useMemo(() => makePlanets('cluster'), [])
  const [variant, setVariant] = useState<Variant>(4)
  const [spaceFocus, setSpaceFocus] = useState<number | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'solo', slot: 3, from: 'page' })
  const [planetNames, setPlanetNames] = useState(false)
  const [nebula, setNebula] = useState(true)
  const [famSub, setFamSub] = useState(false)
  const [familyNames, setFamilyNames] = useState(true)
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => { document.documentElement.classList.toggle('dark', dark) }, [dark])
  const field = useRef<FieldHandle>(null)
  const familyLabels = useMemo(() => KINDS.map((k, i) => ({ text: FAMILY_EN[k], sub: FAMILY_SUB[k], always: famSub, kind: k, at: (() => { const c = familyCenter(i); return [c[0], c[1] + 0.2, c[2]] })() as [number, number, number] })), [famSub])
  const solo = phase.kind === 'solo' ? phase : null
  const soloPlanets = useMemo(() => solo ? cluster.filter((p) => p.seat.slot === solo.slot) : [], [solo?.slot, cluster])
  const label = solo ? genreLabel(solo.slot) : ''
  const btn = 'rounded-full border px-3 py-1.5 text-[11.5px] tracking-[.06em]'
  const key = phase.kind === 'space' ? 'space' : `solo-${phase.slot}-${variant}`
  return (
    <div className="fixed inset-0" style={{ background: dark ? '#0B1524' : '#F5F7FA', color: dark ? '#F2F5F1' : '#1e293b', fontFamily: 'system-ui,sans-serif' }}>
      {phase.kind === 'solo' ? (
        <RecallField key={key} ref={field} planets={soloPlanets} center="outside" reduced={false} initialNear={phase.slot}
          free lockNear show={{ ...SHOW[variant], nebula }} fanOnTouch={variant === 4} shelf={[]} again={new Set()} lensPageId={null} cardOpen={false}
          onFront={() => {}} onStage={() => {}} onDotTap={() => {}} onShelfTap={() => {}} onLens={() => {}} onCloseCard={() => {}} />
      ) : (
        <RecallField key={key} ref={field} planets={cluster} mode="cluster" center="outside" reduced={false} initialStage="far"
          show={{ planetLabels: planetNames, labelMinR: 12, nebula }} familyLabels={familyNames ? familyLabels : []}
          onPlanetTap={(slot) => setPhase({ kind: 'solo', slot, from: 'space' })}
          shelf={[]} again={new Set()} lensPageId={null} cardOpen={false}
          onFront={() => {}} onStage={(s, slot) => setSpaceFocus(s === 'mid' ? slot : null)} onDotTap={() => {}} onShelfTap={() => {}} onLens={() => {}} onCloseCard={() => {}} />
      )}
      {/* 上: 和名・英名（球のときだけ。宇宙では出さない） */}
      {solo && (
        <div className="pointer-events-none absolute inset-x-0 top-0 pt-3 text-center" style={{ fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 300 }}>
          <p className="text-[14px] tracking-[.18em]">{label}</p>
          <p className="mt-0.5 text-[10px] tracking-[.32em] uppercase opacity-60" style={{ fontFamily: 'Jost,sans-serif' }}>{genreEnglishOf(solo.slot)}</p>
        </div>
      )}
      {!solo && spaceFocus !== null && (
        <div key={spaceFocus} className="pointer-events-none absolute inset-x-0 text-center caption" style={{ top: '61%', fontFamily: '"Noto Sans JP",sans-serif', fontWeight: 300 }}>
          <p className="text-[22px] tracking-[.22em]">{genreLabel(spaceFocus)}</p>
          <p className="mt-1 text-[11px] tracking-[.34em] uppercase opacity-60" style={{ fontFamily: 'Jost,sans-serif' }}>{genreEnglishOf(spaceFocus)}</p>
        </div>
      )}
      {/* 試作の操作（実装には載らない） */}
      <div className="absolute left-3 top-3 flex flex-col gap-1.5 text-[11px] opacity-90">
        <span className="tracking-widest opacity-60">試作｜隠しコマンドの段</span>
        {solo && (
          <div className="flex gap-1">
            {([1, 2, 3, 4] as Variant[]).map((v) => (
              <button key={v} onClick={() => setVariant(v)} className={`${btn} ${variant === v ? 'border-current' : 'border-current/30 opacity-60'}`}>案{v}</button>
            ))}
          </div>
        )}
        {phase.kind === 'space' && (
          <div className="flex gap-1">
            <button onClick={() => setPlanetNames((v) => !v)} className={`${btn} border-current/40`}>惑星名 {planetNames ? 'あり' : 'なし'}</button>
            <button onClick={() => setFamilyNames((v) => !v)} className={`${btn} border-current/40`}>族名 {familyNames ? 'あり' : 'なし'}</button>
            <button onClick={() => setNebula((v) => !v)} className={`${btn} border-current/40`}>空席 {nebula ? 'ガス' : '粒'}</button>
            <button onClick={() => setFamSub((v) => !v)} className={`${btn} border-current/40`}>族の説明 {famSub ? '常に' : '押したとき'}</button>
          </div>
        )}
        <button onClick={() => setDark((v) => !v)} className={`${btn} border-current/40 self-start`}>{dark ? 'ダーク' : 'ライト'}</button>
      </div>
      <div className="absolute right-3 top-3 text-right text-[10.5px] opacity-60 leading-relaxed">
        {solo ? <>案1 今の近景・隣を消す<br/>案2 球だけ（文字ゼロ）<br/>案3 輪と扇形を残し文字だけ消す<br/>案4 案2＋触れると扇形が浮かぶ<br/>縦横斜めに回せます</> : <>宇宙（族ごとの星団・遠景）<br/>回す・ピンチで寄る<br/>族名を押すと星団へ寄り、惑星の名前が3秒<br/>惑星を押すと中央へ寄り名前が出る・もう一度押すと球へ</>}
      </div>
      {/* 下のボタン（本番と同じ位置） */}
      <div className="absolute inset-x-0 bottom-0 flex justify-center gap-2.5 pb-5">
        {solo ? (
          <>
            <button onClick={() => setPhase(solo.from === 'space' ? { kind: 'space' } : { kind: 'solo', slot: solo.slot, from: 'page' })} className={`${btn} border-current/40`}>
              {solo.from === 'space' ? '宇宙へ戻る' : '戻る（分野ページへ）'}
            </button>
            <button onClick={() => setPhase({ kind: 'space' })} className={`${btn} border-current/40`}>さらに宇宙へ</button>
          </>
        ) : (
          <button onClick={() => setPhase({ kind: 'solo', slot: 3, from: 'page' })} className={`${btn} border-current/40`}>戻る（分野ページへ）</button>
        )}
      </div>
    </div>
  )
}
createRoot(document.getElementById('root')!).render(<App />)
