'use client'
// 1主張1枚。mode='quiz' は確かめるのカード（表: 穴か全文伏せ、裏: 原文＋出典、覚えた／まだ）。
// mode='view' は閲覧カード（原文＋出典＋残す／外す）。AI の解説は付けない。選択肢は出さない。
import { useEffect, useRef, useState } from 'react'
import type { RecallClaim } from '@/lib/recall/types'
import { CONFIDENCE_MARKS } from '@/lib/reader-confidence'
import { segmentBody } from '@/lib/recall/segments'

type Props = {
  claim: RecallClaim; mode: 'quiz' | 'view'; kept: boolean
  pending?: boolean
  onAnswer?: (result: 'ok' | 'ng') => void
  onKeep?: (keep: boolean) => void
  onClose: () => void
}

// RecallClaim.confidence は 'ok' | 'caut' | 'essentials'。CONFIDENCE_MARKS（reader-confidence）は
// 'ok' | 'caut' | 'unk' しか持たないため essentials 分は自前のマークで受ける。
function markOf(c: RecallClaim) {
  return c.confidence === 'ok' ? CONFIDENCE_MARKS.ok : c.confidence === 'caut' ? CONFIDENCE_MARKS.caut : '📚'
}

export function RecallCard({ claim, mode, kept, pending = false, onAnswer, onKeep, onClose }: Props) {
  const [revealed, setRevealed] = useState(mode === 'view')
  // 段の切り分けは segments.ts に任せる（DB の範囲をそのまま slice しない）。
  // 伏せ字のカードにするのは承認済みで、かつ整えたあとにも使える範囲が残っているときだけ。
  // 無ければ想起カード（全文伏せ）に落とす。表示のときに穴を作り出すことはしない。
  const segs = segmentBody(claim.body, claim.holes)
  const cloze = claim.clozeStatus === 'approved' && segs.some((s) => s.blank)
  const answerTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (answerTimer.current) clearTimeout(answerTimer.current) }, [])

  const body = () => {
    if (!cloze) {
      if (mode === 'view' || revealed) return <span>{claim.body}</span>
      return <span className="text-slate-500 dark:text-slate-400">この節の主張を思い出す</span>
    }
    const open = mode === 'view' || revealed
    return (
      <>
        {segs.map((s, i) => s.blank
          ? <span key={i} aria-label={open ? undefined : '伏せ字'}
              className={open
                ? 'inline-block min-w-[74px] text-center border-b-[1.5px] border-cyan-600/50 text-cyan-700 dark:border-cyan-400/40 dark:text-cyan-300 mx-[3px]'
                : 'inline-block min-w-[74px] border-b-[1.5px] border-cyan-600 dark:border-cyan-400 text-transparent mx-[3px]'}>{s.text}</span>
          : <span key={i}>{s.text}</span>)}
      </>
    )
  }

  const answer = (r: 'ok' | 'ng') => {
    setRevealed(true)
    answerTimer.current = setTimeout(() => onAnswer?.(r), 900)
  }

  return (
    <>
      {/* カードの後ろの覆い。カードの外側を押したら閉じる（記録は書かない）。
          覆いが無いと、カードの上に覗いている行を押せてしまい、カードを閉じたつもりがなく
          中身だけ別の主張に差し替わる（2026-09-05 実画面で確認）。
          隠しコマンドの覆い（z-20）より上・カード（z-30）より下。 */}
      <div role="presentation" onClick={onClose}
        className="fixed inset-0 z-[29] bg-slate-900/[.12] dark:bg-black/[.35] motion-safe:animate-[recall-card-veil_.3s_ease-out]" />
    <div className="fixed left-1/2 -translate-x-1/2 bottom-[22px] z-30 w-[min(520px,calc(100vw-32px))] rounded-2xl border border-slate-200 border-t-cyan-600/60 bg-white/[.97] p-6 text-slate-800 shadow-[0_-10px_50px_rgba(14,116,144,.08),0_20px_60px_rgba(15,23,42,.18)] dark:border-slate-600/40 dark:border-t-cyan-400/50 dark:bg-[rgba(10,16,24,.96)] dark:text-slate-100 dark:shadow-[0_-10px_60px_rgba(111,215,232,.10),0_20px_60px_rgba(0,0,0,.6)]"
      style={{ transformOrigin: '50% 0%', animation: 'recall-card-rise .62s cubic-bezier(.16,.9,.3,1)' }} role="dialog" aria-label="主張のカード">
      <div className="text-[10.5px] tracking-widest text-cyan-700 dark:text-cyan-300 mb-1">{claim.pageTitle}</div>
      <div className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">{claim.sectionHeading} {markOf(claim)}</div>
      <div className="text-[15px] leading-[1.95] font-light">{body()}</div>
      {(mode === 'view' || revealed) && <div className="mt-4 text-[11px] text-slate-500 dark:text-slate-400">{claim.source}</div>}
      <div className="flex gap-2.5 mt-4">
        {mode === 'quiz' && !revealed && (
          <>
            <button type="button" className="flex-1 rounded-full border border-slate-300 hover:border-cyan-600 dark:border-slate-600/40 dark:hover:border-cyan-400 py-3 text-[12.5px]" onClick={() => answer('ok')}>覚えた</button>
            <button type="button" className="flex-1 rounded-full border border-slate-300 hover:border-cyan-600 dark:border-slate-600/40 dark:hover:border-cyan-400 py-3 text-[12.5px]" onClick={() => answer('ng')}>まだ</button>
          </>
        )}
        {/* 保存の途中は、答えを開いたまま何も操作できない見た目にしない（回線が細いと数秒続く）。 */}
        {mode === 'quiz' && revealed && pending && (
          <div className="flex-1 py-3 text-[12px] text-center text-slate-500 dark:text-slate-400" role="status" aria-live="polite">記録しています</div>
        )}
        {/* カードは下の操作列を覆う。答える前でも、答えを見ている間でも、保存が詰まっている間でも、
            答えずに抜けられる閉じるを必ず置く。閉じるは覚えた／まだを押さない限り記録を書かない
            （答え後に閉じても、下で走っている保存はそのまま続く。誤タップ対策と、意図した保存の
            取り消しは別）。 */}
        {mode === 'quiz' && (
          <button type="button" className="rounded-full border border-slate-300 dark:border-slate-600/40 px-5 py-3 text-[12.5px]" onClick={onClose}>閉じる</button>
        )}
        {mode === 'view' && (
          <>
            <button type="button" disabled={pending} className="flex-1 rounded-full border border-cyan-600/60 text-cyan-700 dark:border-cyan-400/60 dark:text-cyan-300 py-3 text-[12.5px] disabled:opacity-50" onClick={() => onKeep?.(!kept)}>{pending ? '記録しています' : kept ? '残すのをやめる' : '残す'}</button>
            <button type="button" className="rounded-full border border-slate-300 dark:border-slate-600/40 px-5 py-3 text-[12.5px]" onClick={onClose}>閉じる</button>
          </>
        )}
      </div>
    </div>
    </>
  )
}
