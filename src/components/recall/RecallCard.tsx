'use client'
// 1主張1枚。mode='quiz' は確かめるのカード（表: 穴か全文伏せ、裏: 原文＋出典、覚えた／まだ）。
// mode='view' は閲覧カード（原文＋出典＋残す／外す）。AI の解説は付けない。選択肢は出さない。
import { useState } from 'react'
import type { RecallClaim } from '@/lib/recall/types'
import { CONFIDENCE_MARKS } from '@/lib/reader-confidence'

type Props = {
  claim: RecallClaim; mode: 'quiz' | 'view'; kept: boolean
  onAnswer?: (result: 'ok' | 'ng') => void
  onKeep?: (keep: boolean) => void
  onClose: () => void
}

// RecallClaim.confidence は 'ok' | 'caut' | 'essentials'。CONFIDENCE_MARKS（reader-confidence）は
// 'ok' | 'caut' | 'unk' しか持たないため essentials 分は自前のマークで受ける。
function markOf(c: RecallClaim) {
  return c.confidence === 'ok' ? CONFIDENCE_MARKS.ok : c.confidence === 'caut' ? CONFIDENCE_MARKS.caut : '📚'
}

// 伏せ字は承認済みの穴だけ。未承認は想起カード（全文伏せ）。
function hasCloze(claim: RecallClaim) {
  return claim.clozeStatus === 'approved' && claim.holes.length > 0
}

export function RecallCard({ claim, mode, kept, onAnswer, onKeep, onClose }: Props) {
  const [revealed, setRevealed] = useState(mode === 'view')
  const cloze = hasCloze(claim)

  const body = () => {
    if (mode === 'view' || revealed) {
      if (!cloze) return <span>{claim.body}</span>
      const parts: React.ReactNode[] = []; let last = 0
      claim.holes.forEach(([a, b], i) => {
        parts.push(claim.body.slice(last, a))
        parts.push(<span key={i} className="inline-block min-w-[74px] text-center border-b-[1.5px] border-cyan-400/40 text-cyan-300 mx-[3px]">{claim.body.slice(a, b)}</span>)
        last = b
      })
      parts.push(claim.body.slice(last))
      return <>{parts}</>
    }
    if (cloze) {
      const parts: React.ReactNode[] = []; let last = 0
      claim.holes.forEach(([a, b], i) => {
        parts.push(claim.body.slice(last, a))
        parts.push(<span key={i} className="inline-block min-w-[74px] border-b-[1.5px] border-cyan-400 text-transparent mx-[3px]" aria-label="伏せ字">{claim.body.slice(a, b)}</span>)
        last = b
      })
      parts.push(claim.body.slice(last))
      return <>{parts}</>
    }
    return <span className="text-slate-400">この節の主張を思い出す</span>
  }

  const answer = (r: 'ok' | 'ng') => { setRevealed(true); setTimeout(() => onAnswer?.(r), 900) }

  return (
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[22px] z-30 w-[min(520px,calc(100vw-32px))] rounded-2xl border border-slate-600/40 border-t-cyan-400/50 bg-[rgba(10,16,24,.96)] p-6 text-slate-100 shadow-[0_-10px_60px_rgba(111,215,232,.10),0_20px_60px_rgba(0,0,0,.6)]"
      style={{ transformOrigin: '50% 0%', animation: 'recall-card-rise .62s cubic-bezier(.16,.9,.3,1)' }} role="dialog" aria-label="主張のカード">
      <div className="text-[10.5px] tracking-widest text-cyan-300 mb-1">{claim.pageTitle}</div>
      <div className="text-[11px] text-slate-400 mb-3">{claim.sectionHeading} {markOf(claim)}</div>
      <div className="text-[15px] leading-[1.95] font-light">{body()}</div>
      {(mode === 'view' || revealed) && <div className="mt-4 text-[11px] text-slate-400">{claim.source}</div>}
      <div className="flex gap-2.5 mt-4">
        {mode === 'quiz' && !revealed && (
          <>
            <button type="button" className="flex-1 rounded-full border border-slate-600/40 py-3 text-[12.5px] hover:border-cyan-400" onClick={() => answer('ok')}>覚えた</button>
            <button type="button" className="flex-1 rounded-full border border-slate-600/40 py-3 text-[12.5px] hover:border-cyan-400" onClick={() => answer('ng')}>まだ</button>
          </>
        )}
        {mode === 'view' && (
          <>
            <button type="button" className="flex-1 rounded-full border border-cyan-400/60 text-cyan-300 py-3 text-[12.5px]" onClick={() => onKeep?.(!kept)}>{kept ? '残すのをやめる' : '残す'}</button>
            <button type="button" className="rounded-full border border-slate-600/40 px-5 py-3 text-[12.5px]" onClick={onClose}>閉じる</button>
          </>
        )}
      </div>
    </div>
  )
}
