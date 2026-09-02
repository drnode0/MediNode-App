'use client'
// Recall 画面。球＋上部の内訳＋下部の「確かめる」。
// 確かめる: 離脱候補（最大5）が順に離脱して山になる。球は退いて42%に暗くなる。
// 山をタップ→カード→覚えた／まだ→主張が光として元の位置へ帰る。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRecallData } from './useRecallData'
import { useReducedMotion } from './useReducedMotion'
import { RecallSphere } from './RecallSphere'
import { RecallCard } from './RecallCard'
import type { LensMode } from '@/lib/recall/render'
import { genreLabel } from '@/lib/recall/genres'
import { checkNotice } from '@/lib/recall/notice'

const FLY_MS = 900
const NOTICE_MS = 4000
const TIP_W = 290

export function RecallScreen() {
  const data = useRecallData()
  const reduced = useReducedMotion()
  const [flying, setFlying] = useState<Map<string, number>>(new Map())
  const [deck, setDeck] = useState<string[]>([])
  const [shakeUntil, setShakeUntil] = useState(0)
  const [card, setCard] = useState<{ claimId: string; mode: 'quiz' | 'view' } | null>(null)
  const [saving, setSaving] = useState(false)
  const [tip, setTip] = useState<{ claimId: string; x: number; y: number } | null>(null)
  const [here, setHere] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [lens, setLens] = useState<LensMode>('all')
  const [notice, setNotice] = useState<string | null>(null)
  const [vw, setVw] = useState(0)
  const raf = useRef(0)

  // 走らせた setTimeout は全部ここに控える。控えないと「確かめる」直後に「戻す」を押したとき、
  // まだ走っている離脱のタイマーが空の山を作り直し、戻すボタンが消えたまま画面が暗いだけになる。
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>())
  const later = useCallback((fn: () => void, ms: number) => {
    const id = setTimeout(() => { timers.current.delete(id); fn() }, ms)
    timers.current.add(id)
    return id
  }, [])
  const clearTimers = useCallback(() => {
    for (const id of timers.current) clearTimeout(id)
    timers.current.clear()
  }, [])
  useEffect(() => () => clearTimers(), [clearTimers])

  const say = useCallback((msg: string) => { setNotice(msg); later(() => setNotice(null), NOTICE_MS) }, [later])

  // 吹き出しの左右の収まりに画面幅を使う。描画のたびに window を読むと SSR で落ちるうえ、
  // 回転やウィンドウの変更で古いままになる。
  useEffect(() => {
    const sync = () => setVw(window.innerWidth)
    sync()
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', sync)
    return () => { window.removeEventListener('resize', sync); window.removeEventListener('orientationchange', sync) }
  }, [])

  const claimById = useMemo(() => new Map(data.claims.map((c) => [c.claimId, c])), [data.claims])

  // 離脱アニメーション（0→1 を FLY_MS で進める）
  useEffect(() => {
    if (![...flying.values()].some((v) => v < 1)) return
    let last = performance.now()
    const step = (now: number) => {
      const dt = now - last; last = now
      setFlying((prev) => { const n = new Map(prev); for (const [k, v] of n) if (v < 1) n.set(k, Math.min(1, v + dt / FLY_MS)); return n })
      raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf.current)
  }, [flying])

  // 動きを減らす設定のときは飛ばさず、その場で山に置く（drawFrame は 1 で山の位置に描く）。
  const startFly = useCallback((id: string) => {
    setFlying((prev) => new Map(prev).set(id, reduced ? 1 : 0.001))
  }, [reduced])

  const check = useCallback(() => {
    const cands = data.candidates.map((p) => p.claimId).filter((id) => claimById.has(id))
    data.clearSaveError()
    if (!cands.length) {
      const msg = checkNotice(0, data.nextDue, new Date())
      if (msg) say(msg)
      return
    }
    setNotice(null)
    if (!reduced) setShakeUntil(performance.now() + 420)
    setDeck(cands)
    if (reduced) { setFlying(new Map(cands.map((id) => [id, 1]))); return }
    cands.forEach((id, k) => later(() => startFly(id), 120 + k * 55))
  }, [data, claimById, reduced, later, say, startFly])

  const reset = () => {
    clearTimers()
    setFlying(new Map()); setDeck([]); setCard(null); setNotice(null); setSaving(false)
    data.clearSaveError()
  }

  const onAnswer = async (claimId: string, result: 'ok' | 'ng') => {
    // review は失敗すると reject する（useRecallData）。ここで必ず受け止める。
    // 保存できたときだけ山とカードを動かす。先に動かすと、保存されていない主張が
    // 山から消え「薄れている主張が N」も減って、答え直せなくなる。
    setSaving(true)
    try {
      await data.review(claimId, result)
    } catch {
      setSaving(false); setCard(null)
      say('保存に失敗しました。通信を確かめてもう一度')
      return
    }
    setSaving(false); setCard(null)
    setFlying((prev) => { const n = new Map(prev); n.delete(claimId); return n })
    setDeck((prev) => result === 'ok' ? prev.filter((x) => x !== claimId) : [...prev.filter((x) => x !== claimId), claimId])
    if (result === 'ng') later(() => startFly(claimId), 300)
  }

  const kept = (id: string) => { const p = data.progressById.get(id); return !!p && !p.removedAt }
  const cardClaim = card ? claimById.get(card.claimId) : undefined
  const tipClaim = tip ? claimById.get(tip.claimId) : undefined
  const dimmed = flying.size > 0
  // 読み込みに失敗して出すものが無いときだけ、画面いっぱいの知らせにする。
  // 出すものがあるなら操作を止めない（覆いには pointer-events-none を付ける）。
  const fatal = data.error && !data.claims.length ? data.error : null
  // 出す知らせは1つ。押した直後の一言を優先し、無ければ保存の失敗、
  // 最後に「出すものはあるが読み直しに失敗した」を出す。どれも操作は止めない。
  const pill = notice ?? data.saveError ?? (data.error && !fatal ? data.error : null)
  const tipLeft = vw ? Math.max(12, Math.min(vw - TIP_W - 12, tip ? tip.x - TIP_W / 2 : 12)) : Math.max(12, (tip?.x ?? 12) - TIP_W / 2)

  return (
    <div className="fixed inset-0 z-20 bg-[#05080e] text-slate-100 overflow-hidden" style={{ fontFamily: '"Zen Kaku Gothic New",-apple-system,"Hiragino Sans",sans-serif' }}>
      <RecallSphere sprites={data.sprites} marks={data.marks} flying={flying} dimmed={dimmed} lens={lens} shakeUntil={shakeUntil} reduced={reduced}
        onPick={(id, at) => setTip(id ? { claimId: id, ...at } : null)}
        onDeckTap={(id) => { setTip(null); setCard({ claimId: id, mode: 'quiz' }) }}
        onHere={setHere} onZoom={setZoom} />

      <div className="absolute top-6 left-7 pointer-events-none">
        <h1 className="text-[21px] tracking-[.14em] font-semibold" style={{ fontFamily: '"Shippori Mincho",serif' }}>Recall</h1>
        <p className="mt-1.5 text-[11px] font-light tracking-[.08em] text-slate-400">検証済みの主張 {data.claims.length}　明るさは、思い出せる度合い</p>
      </div>
      <div className="absolute top-7 right-7 text-right pointer-events-none">
        <div className="text-[28px] font-light tabular-nums">{data.claims.length}<small className="text-[11px] text-slate-400 tracking-widest ml-1.5">主張</small></div>
        <p className="text-[10.5px] text-slate-400 tracking-[.1em] mt-1">残した {data.counts.kept + data.counts.settled} ／ 読んだ {data.counts.touched} ／ 未着手 {data.counts.cold}</p>
      </div>
      {here && <div className="absolute top-[22px] left-1/2 -translate-x-1/2 text-[12.5px] tracking-[.06em] text-cyan-200 pointer-events-none">{here}</div>}

      <div className="absolute left-7 bottom-7 text-[10.5px] text-slate-400 leading-8 tracking-[.06em] pointer-events-none max-[680px]:hidden">
        <div><i className="inline-block w-2 h-2 rounded-full mr-2 align-[1px]" style={{ background: '#eaf7fd', boxShadow: '0 0 8px #bfe9f5' }} />定着した</div>
        <div><i className="inline-block w-2 h-2 rounded-full mr-2 align-[1px]" style={{ background: '#bfe9f5' }} />残した（明るいほど思い出せる）</div>
        <div><i className="inline-block w-2 h-2 rounded-full mr-2 align-[1px]" style={{ background: '#5b6a7a' }} />読んだ節の主張</div>
        <div><i className="inline-block w-2 h-2 rounded-full mr-2 align-[1px]" style={{ background: '#2b333d' }} />未着手</div>
      </div>
      <div className="absolute right-7 bottom-7 text-[10.5px] text-slate-400 tracking-[.08em] pointer-events-none">ホイール／ピンチで寄る　<b className="text-cyan-300 font-medium">{zoom.toFixed(1)}x</b></div>

      {deck.length > 0 && !card && !pill && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[148px] text-[11px] tracking-[.1em] text-slate-400 pointer-events-none">薄れている主張が <b className="text-cyan-300 font-medium tabular-nums">{deck.length}</b>　山をタップで開く</div>
      )}
      {pill && <div className="absolute left-1/2 -translate-x-1/2 bottom-[148px] text-[12px] tracking-[.06em] text-cyan-200 bg-[rgba(12,20,30,.9)] border border-slate-600/40 rounded-full px-4 py-2 pointer-events-none">{pill}</div>}

      <div className="absolute left-1/2 -translate-x-1/2 bottom-6 flex gap-2.5 items-center">
        <button type="button" onClick={check} className="rounded-full border border-slate-600/40 bg-[rgba(12,20,30,.9)] px-5 py-[11px] text-[12.5px] tracking-[.08em] hover:border-cyan-400 backdrop-blur">確かめる</button>
        <div className="flex rounded-full border border-slate-600/40 bg-[rgba(12,20,30,.9)] overflow-hidden">
          <button type="button" onClick={() => setLens('all')} className={`px-3.5 py-[11px] text-[11.5px] ${lens === 'all' ? 'text-cyan-300' : ''}`}>すべて</button>
          <button type="button" onClick={() => setLens('kept')} className={`px-3.5 py-[11px] text-[11.5px] ${lens === 'kept' ? 'text-cyan-300' : ''}`}>残したものだけ</button>
        </div>
        {(deck.length > 0 || flying.size > 0) && <button type="button" onClick={reset} className="rounded-full border border-slate-600/40 bg-[rgba(12,20,30,.9)] px-5 py-[11px] text-[12.5px] tracking-[.08em]">戻す</button>}
      </div>

      {tip && tipClaim && !card && (
        <button type="button" className="absolute z-30 max-w-[290px] text-left bg-[rgba(10,16,24,.96)] border border-slate-600/40 rounded-[10px] px-3.5 py-2.5 text-[12px] leading-relaxed"
          style={{ left: tipLeft, top: Math.max(12, tip.y - 90) }}
          onClick={() => { setCard({ claimId: tip.claimId, mode: 'view' }); setTip(null) }}>
          <div className="text-[10px] text-cyan-300 tracking-[.12em] mb-0.5">{genreLabel(tipClaim.genreSlot)} ／ {tipClaim.sectionHeading}</div>
          <div>{tipClaim.body.slice(0, 80)}{tipClaim.body.length > 80 ? '…' : ''}　タップで開く</div>
        </button>
      )}

      {card && cardClaim && (
        <RecallCard key={card.claimId + card.mode} claim={cardClaim} mode={card.mode} kept={kept(cardClaim.claimId)} pending={saving}
          onAnswer={(r) => void onAnswer(cardClaim.claimId, r)}
          onKeep={async (k) => {
            // keep も失敗すると reject する（useRecallData）。ここで必ず受け止める。
            setSaving(true)
            try { await data.keep(cardClaim.claimId, k) } catch { say('保存に失敗しました。通信を確かめてもう一度') }
            setSaving(false)
          }}
          onClose={() => setCard(null)} />
      )}
      {data.loading && <div className="absolute inset-0 grid place-items-center text-slate-400 text-sm pointer-events-none">読み込んでいます</div>}
      {fatal && <div className="absolute inset-0 grid place-items-center text-rose-300 text-sm pointer-events-none">{fatal}</div>}
    </div>
  )
}
