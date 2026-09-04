'use client'
// 隠しコマンド（D5）の覆い。分野ページの紋章を押すと、この覆いが紋章の位置から広がり、
// 中に既存の RecallField を近景（initialNear）で置く。ドラッグ・慣性・見下ろし・点のタップ・
// 記事の扇形・境目の名前は RecallField 側の実装のまま（このファイルはそれを変えない）。
//
// 見た目は設計 2026-09-04「標本帳（図鑑）の設計書」§2.6「隠しコマンド（D5）」。
// 出方: transform-origin を紋章の中心に置き、scale(.2)→1・opacity 0→1 を 500ms。
// 戻りは 350ms の逆。動きを減らす設定なら遷移なし。
import { useCallback, useEffect, useRef, useState } from 'react'
import { RecallField } from './RecallField'
import type { Planet } from '@/lib/recall/field-render'
import { genreEnglishOf } from '@/lib/recall/genre-en'
import { useReducedMotion } from './useReducedMotion'

const ENTER_MS = 500
const EXIT_MS = 350
const EASE = 'cubic-bezier(.16,.9,.3,1)'

// RecallField の shelf/again は「この分野を確かめる」の棚アニメーション用。隠しコマンドでは
// 棚（D7 は廃止済み）を使わないので、常に空を渡す。作るたびに新しい参照になると
// RecallField 内の一部エフェクトが無駄に走るので、モジュール直下で1つだけ用意する。
const NO_SHELF: string[] = []
const NO_AGAIN = new Set<string>()

type Props = {
  slot: number
  planets: Planet[]
  origin: { x: number; y: number }
  cardOpen: boolean
  onClose: () => void
  onCloseCard: () => void
  onDotTap: (claimId: string) => void
}

export function RecallLift({ slot, planets, origin, cardOpen, onClose, onCloseCard, onDotTap }: Props) {
  const reduced = useReducedMotion()
  const [lensPageId, setLensPageId] = useState<string | null>(null)
  const [entered, setEntered] = useState(false)
  const [closing, setClosing] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 出方: マウント直後の1フレームで entered を立て、scale(.2)→1 / opacity 0→1 の遷移を発火させる。
  // 動きを減らす設定では、遷移なしでいきなり出た状態にする。
  useEffect(() => {
    if (reduced) { setEntered(true); return }
    const raf = requestAnimationFrame(() => setEntered(true))
    return () => cancelAnimationFrame(raf)
  }, [reduced])

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  // 戻り: 逆の遷移を再生してから onClose を呼ぶ（動きを減らす設定では即時に閉じる）。
  const close = useCallback(() => {
    if (closing) return
    if (reduced) { onClose(); return }
    setClosing(true)
    closeTimer.current = setTimeout(onClose, EXIT_MS)
  }, [closing, reduced, onClose])

  // Esc。カードが上に出ているあいだは、そちらの Esc（RecallScreen 側）に譲る
  // （同時に両方閉じると、カードを閉じたつもりで球体からも弾き出される）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (document.querySelector('[role="dialog"][aria-label="主張のカード"]')) return
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  // タブを離れたら閉じる（見えていないので遷移は再生しない）。
  useEffect(() => {
    const onVis = () => { if (document.hidden) onClose() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [onClose])

  const seat = planets.find((p) => p.seat.slot === slot)?.seat ?? null
  const label = seat?.label ?? ''
  const en = genreEnglishOf(slot)

  const shown = entered && !closing
  const style: React.CSSProperties = {
    transformOrigin: `${origin.x}px ${origin.y}px`,
    transform: shown ? 'scale(1)' : 'scale(0.2)',
    opacity: shown ? 1 : 0,
    transition: reduced ? 'none' : `transform ${closing ? EXIT_MS : ENTER_MS}ms ${EASE}, opacity ${closing ? EXIT_MS : ENTER_MS}ms ${EASE}`,
  }

  return (
    <div className="fixed inset-0 z-20 bg-[#F5F7FA]/[.92] dark:bg-[#0B1524]/[.92]" style={style}>
      <RecallField
        planets={planets} center="outside" reduced={reduced} initialNear={slot}
        shelf={NO_SHELF} again={NO_AGAIN} lensPageId={lensPageId} cardOpen={cardOpen}
        onFront={() => {}}
        // 近景の背景タップ・ホイール下・ピンチインは既存の RecallField が内部で backToMid を呼び、
        // その結果として onStage('mid', …) が届く。ここでは「閉じる」に読み替える
        // （覆いの中で中景を見せることはしない。設計 §2.6）。
        // ただしカードが開いているあいだは RecallField 内部で cardOpen を見て
        // onCloseCard に回すので、ここに onStage('mid', …) は届かない。
        onStage={(stage) => { if (stage !== 'near') close() }}
        onDotTap={onDotTap}
        onShelfTap={() => {}}
        onLens={setLensPageId}
        onCloseCard={onCloseCard}
      />

      {/* 上に小さく和名・英名だけ（件数の内訳は出さない。球体を眺める画面なので）。 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 pt-[max(14px,env(safe-area-inset-top))] text-center">
        <p className="text-[13px] tracking-[.08em] text-slate-700 dark:text-[#F2F5F1]">{label}</p>
        <p className="mt-0.5 text-[10px] tracking-[.14em] uppercase text-slate-500 dark:text-slate-400">{en}</p>
      </div>

      {/* 閉じる（設計 §2.6「戻り」）。canvas の外側が無いので、下に置く。 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-[max(18px,env(safe-area-inset-bottom))]">
        <button type="button" onClick={close}
          className="pointer-events-auto rounded-full border border-slate-300/70 dark:border-white/25 bg-[#F5F7FA]/90 dark:bg-[#0B1524]/80 px-5 py-2.5 text-[12px] tracking-[.1em] text-slate-600 dark:text-slate-200 hover:border-slate-400 dark:hover:border-white/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500">
          戻る
        </button>
      </div>
    </div>
  )
}
