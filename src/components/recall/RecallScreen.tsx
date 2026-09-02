'use client'
// Recall 画面。球＋上部の内訳＋下部の「確かめる」。
// 確かめる: 離脱候補（最大5）が順に離脱して山になる。球は退いて42%に暗くなる。
// 山をタップ→カード→覚えた／まだ→主張が光として元の位置へ帰る。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRecallData } from './useRecallData'
import { RecallSphere } from './RecallSphere'
import { RecallCard } from './RecallCard'
import type { LensMode } from '@/lib/recall/render'
import { GENRE_SEATS, OTHER_SLOT } from '@/lib/recall/genres'

const FLY_MS = 900

export function RecallScreen() {
  const data = useRecallData()
  const [flying, setFlying] = useState<Map<string, number>>(new Map())
  const [deck, setDeck] = useState<string[]>([])
  const [shakeUntil, setShakeUntil] = useState(0)
  const [card, setCard] = useState<{ claimId: string; mode: 'quiz' | 'view' } | null>(null)
  const [tip, setTip] = useState<{ claimId: string; x: number; y: number } | null>(null)
  const [here, setHere] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [lens, setLens] = useState<LensMode>('all')
  const [notice, setNotice] = useState<string | null>(null)
  const raf = useRef(0)

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

  const check = useCallback(() => {
    const cands = data.candidates.map((p) => p.claimId).filter((id) => claimById.has(id))
    if (!cands.length) {
      const d = data.nextDue
      // nextDue は overdue の日付をそのまま返す（overdue のとき at はほぼ「いま」）。
      // ここから ◯日後 を計算すると、期限切れの件を「1日後」のように誤って告げてしまうので、
      // overdue のときは日数計算をせず「いま◯件」と言う。
      const msg = !d
        ? 'まだ残した主張がありません。球の主張を開いて「残す」を押すと、ここから確かめられます'
        : d.overdue
          ? `いま確かめる主張はありません。期限が来ている主張が ${d.count} 件あります`
          : `いま確かめる主張はありません。次は ${Math.max(1, Math.ceil((d.at.getTime() - Date.now()) / 86400000))} 日後に ${d.count} 件`
      setNotice(msg)
      setTimeout(() => setNotice(null), 4000); return
    }
    setShakeUntil(performance.now() + 420)
    setDeck(cands)
    cands.forEach((id, k) => setTimeout(() => setFlying((prev) => new Map(prev).set(id, 0.001)), 120 + k * 55))
  }, [data.candidates, data.nextDue, claimById])

  const reset = () => { setFlying(new Map()); setDeck([]); setCard(null) }

  const onAnswer = async (claimId: string, result: 'ok' | 'ng') => {
    // review は失敗すると reject する（useRecallData）。ここで必ず受け止める。
    try { await data.review(claimId, result) } catch { setNotice('保存に失敗しました。通信を確かめてもう一度'); setTimeout(() => setNotice(null), 4000) }
    setCard(null)
    setFlying((prev) => { const n = new Map(prev); n.delete(claimId); return n })
    setDeck((prev) => result === 'ok' ? prev.filter((x) => x !== claimId) : [...prev.filter((x) => x !== claimId), claimId])
    if (result === 'ng') setTimeout(() => setFlying((prev) => new Map(prev).set(claimId, 0.001)), 300)
  }

  const kept = (id: string) => { const p = data.progressById.get(id); return !!p && !p.removedAt }
  const cardClaim = card ? claimById.get(card.claimId) : undefined
  const tipClaim = tip ? claimById.get(tip.claimId) : undefined
  const dimmed = flying.size > 0

  return (
    <div className="fixed inset-0 z-20 bg-[#05080e] text-slate-100 overflow-hidden" style={{ fontFamily: '"Zen Kaku Gothic New",-apple-system,"Hiragino Sans",sans-serif' }}>
      <RecallSphere sprites={data.sprites} marks={data.marks} flying={flying} dimmed={dimmed} lens={lens} shakeUntil={shakeUntil}
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

      {deck.length > 0 && !card && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-[148px] text-[11px] tracking-[.1em] text-slate-400">薄れている主張が <b className="text-cyan-300 font-medium tabular-nums">{deck.length}</b>　山をタップで開く</div>
      )}
      {notice && <div className="absolute left-1/2 -translate-x-1/2 bottom-[148px] text-[12px] tracking-[.06em] text-cyan-200 bg-[rgba(12,20,30,.9)] border border-slate-600/40 rounded-full px-4 py-2">{notice}</div>}

      <div className="absolute left-1/2 -translate-x-1/2 bottom-6 flex gap-2.5 items-center">
        <button type="button" onClick={check} className="rounded-full border border-slate-600/40 bg-[rgba(12,20,30,.9)] px-5 py-[11px] text-[12.5px] tracking-[.08em] hover:border-cyan-400 backdrop-blur">確かめる</button>
        <div className="flex rounded-full border border-slate-600/40 bg-[rgba(12,20,30,.9)] overflow-hidden">
          <button type="button" onClick={() => setLens('all')} className={`px-3.5 py-[11px] text-[11.5px] ${lens === 'all' ? 'text-cyan-300' : ''}`}>すべて</button>
          <button type="button" onClick={() => setLens('kept')} className={`px-3.5 py-[11px] text-[11.5px] ${lens === 'kept' ? 'text-cyan-300' : ''}`}>残したものだけ</button>
        </div>
        {deck.length > 0 && <button type="button" onClick={reset} className="rounded-full border border-slate-600/40 bg-[rgba(12,20,30,.9)] px-5 py-[11px] text-[12.5px] tracking-[.08em]">戻す</button>}
      </div>

      {tip && tipClaim && !card && (
        <button type="button" className="absolute z-30 max-w-[290px] text-left bg-[rgba(10,16,24,.96)] border border-slate-600/40 rounded-[10px] px-3.5 py-2.5 text-[12px] leading-relaxed"
          style={{ left: Math.max(12, Math.min(window.innerWidth - 302, tip.x - 145)), top: Math.max(12, tip.y - 90) }}
          onClick={() => { setCard({ claimId: tip.claimId, mode: 'view' }); setTip(null) }}>
          <div className="text-[10px] text-cyan-300 tracking-[.12em] mb-0.5">{(tipClaim.genreSlot === OTHER_SLOT ? 'その他' : GENRE_SEATS[tipClaim.genreSlot])} ／ {tipClaim.sectionHeading}</div>
          <div>{tipClaim.body.slice(0, 80)}{tipClaim.body.length > 80 ? '…' : ''}　タップで開く</div>
        </button>
      )}

      {card && cardClaim && (
        <RecallCard claim={cardClaim} mode={card.mode} kept={kept(cardClaim.claimId)}
          onAnswer={(r) => void onAnswer(cardClaim.claimId, r)}
          onKeep={async (k) => {
            // keep も失敗すると reject する（useRecallData）。ここで必ず受け止める。
            try { await data.keep(cardClaim.claimId, k) } catch { setNotice('保存に失敗しました'); setTimeout(() => setNotice(null), 4000) }
          }}
          onClose={() => setCard(null)} />
      )}
      {data.loading && <div className="absolute inset-0 grid place-items-center text-slate-400 text-sm">読み込んでいます</div>}
      {data.error && <div className="absolute inset-0 grid place-items-center text-rose-300 text-sm">{data.error}</div>}
    </div>
  )
}
