'use client'
// 隠しコマンド（D5）の覆い。分野ページの紋章を押すと、この覆いが紋章の位置から広がる。
// 中は段（設計 2026-09-05 再計画 §4.1）で出し分ける:
//   球（その惑星だけ）→「さらに宇宙へ」→ 宇宙（族ごとの星団）→ 惑星を押すと中景 → もう一度で球
// 段の遷移は純関数 lift-phase.ts が持ち、ここは出し分けと文字とボタンだけを持つ。
//
// 出方は設計 2026-09-04「標本帳（図鑑）の設計書」§2.6「隠しコマンド（D5）」のまま。
// transform-origin を紋章の中心に置き、scale(.2)→1・opacity 0→1 を 500ms。
// 戻りは 350ms の逆。動きを減らす設定なら遷移なし。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { RecallField } from './RecallField'
import type { Planet, FieldFrameArgs } from '@/lib/recall/field-render'
import type { Vec3 } from '@/lib/recall/layout'
import { genreEnglishOf, coreEnglishOf } from '@/lib/recall/genre-en'
import { FAMILY_ORDER, FAMILY_NOUN } from '@/lib/recall/families'
import { familyCenter } from '@/lib/recall/field-cluster'
import { liftOpen, liftNext, liftButtons, liftCaption, type LiftPhase, type LiftEvent } from '@/lib/recall/lift-phase'
import { useReducedMotion } from './useReducedMotion'

const ENTER_MS = 500
const EXIT_MS = 350
const EASE = 'cubic-bezier(.16,.9,.3,1)'

// RecallField の shelf/again は「この分野を確かめる」の棚アニメーション用。隠しコマンドでは
// 棚（D7 は廃止済み）を使わないので、常に空を渡す。作るたびに新しい参照になると
// RecallField 内の一部エフェクトが無駄に走るので、モジュール直下で1つだけ用意する。
const NO_SHELF: string[] = []
const NO_AGAIN = new Set<string>()

// 球（案4）: 芯・点・輪郭の円だけ。境目の円・境目の名前・記事名は消し、
// 扇形は触れたときだけ（fanOnTouch）。空の席はガス。
const SPHERE_SHOW: FieldFrameArgs['show'] = {
  edgeLabels: false, edgeCircles: false, fans: false, pageLabels: false, nebula: true,
}
// 宇宙: 文字は族名だけ（R6）。空の席はガス（R8）。
const SPACE_SHOW: FieldFrameArgs['show'] = { planetLabels: false, nebula: true }

const LIFT_BTN = 'pointer-events-auto rounded-full border border-slate-300/70 dark:border-white/25 bg-[#F5F7FA]/90 dark:bg-[#0B1524]/80 px-5 py-2.5 text-[12px] font-light tracking-[.1em] text-slate-600 dark:text-slate-200 hover:border-slate-400 dark:hover:border-white/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500'

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
  const [phase, setPhase] = useState<LiftPhase>(() => liftOpen(slot))
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

  // 段を1つ進める。null が返ったら覆いを閉じる。
  const dispatch = useCallback((ev: LiftEvent) => {
    setPhase((cur) => {
      const next = liftNext(cur, ev)
      if (next === null) { close(); return cur }
      return next
    })
  }, [close])

  // Esc。カードが上に出ているあいだは、そちらの Esc（RecallScreen 側）に譲る
  // （同時に両方閉じると、カードを閉じたつもりで球体からも弾き出される）。
  // 宇宙から入った球では、Esc は宇宙へ戻る（いきなり覆いを閉じない）。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (document.querySelector('[role="dialog"][aria-label="主張のカード"]')) return
      dispatch({ type: 'back' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dispatch])

  // タブを離れたら閉じる（見えていないので遷移は再生しない）。
  useEffect(() => {
    const onVis = () => { if (document.hidden) onClose() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [onClose])

  const caption = liftCaption(phase)
  const buttons = liftButtons(phase)
  const seatOf = (s: number | null) =>
    s === null ? null : planets.find((p) => p.seat.slot === s)?.seat ?? null
  const topSeat = seatOf(caption.top)
  const belowSeat = seatOf(caption.below)

  // 族名は星団の中心の少し上（実際の置き場所は描画側が星団の上端に合わせる）。
  const familyLabels = useMemo(() => FAMILY_ORDER.map((kind, i) => {
    const c = familyCenter(i)
    return { text: coreEnglishOf(kind), sub: FAMILY_NOUN[kind], kind, at: [c[0], c[1] + 0.2, c[2]] as Vec3 }
  }), [])

  const shown = entered && !closing
  const style: React.CSSProperties = {
    transformOrigin: `${origin.x}px ${origin.y}px`,
    transform: shown ? 'scale(1)' : 'scale(0.2)',
    opacity: shown ? 1 : 0,
    transition: reduced ? 'none' : `transform ${closing ? EXIT_MS : ENTER_MS}ms ${EASE}, opacity ${closing ? EXIT_MS : ENTER_MS}ms ${EASE}`,
  }

  return (
    <div className="fixed inset-0 z-20 bg-[#F5F7FA]/[.92] dark:bg-[#0B1524]/[.92]" style={style}>
      {/* 段ごとに置き直す（カメラの初期化は planets の初回にしか走らないため、key を変える）。 */}
      {phase.kind === 'sphere' ? (
        <RecallField key={`sphere-${phase.slot}`}
          planets={planets.filter((p) => p.seat.slot === phase.slot)}
          center="outside" reduced={reduced} initialNear={phase.slot}
          free lockNear fanOnTouch show={SPHERE_SHOW}
          shelf={NO_SHELF} again={NO_AGAIN} lensPageId={null} cardOpen={cardOpen}
          onFront={() => {}}
          // lockNear なので、背景タップ・ホイール下・ピンチインでは段が動かない。
          onStage={() => {}}
          onDotTap={onDotTap}
          onShelfTap={() => {}}
          onLens={() => {}}
          onCloseCard={onCloseCard}
        />
      ) : (
        <RecallField key="space"
          planets={planets} mode="cluster" center="outside" reduced={reduced}
          // 球から戻ったときは、その惑星を中央に寄せた中景で開き直す（名前と見え方を食い違わせない）
          initialStage={phase.focus === null ? 'far' : 'mid'} initialMid={phase.focus ?? undefined}
          show={SPACE_SHOW} familyLabels={familyLabels}
          onPlanetTap={(s) => dispatch({ type: 'planetTap', slot: s })}
          shelf={NO_SHELF} again={NO_AGAIN} lensPageId={null} cardOpen={false}
          onFront={() => {}}
          onStage={(stage, s) => { if (stage === 'mid' || stage === 'far') dispatch({ type: 'stage', stage, slot: s }) }}
          onDotTap={() => {}}
          onShelfTap={() => {}}
          onLens={() => {}}
          onCloseCard={onCloseCard}
        />
      )}

      {/* 球のあいだ、上に小さく和名・英名だけ（件数の内訳は出さない。眺める画面なので）。 */}
      {topSeat && (
        <div className="pointer-events-none absolute inset-x-0 top-0 pt-[max(14px,env(safe-area-inset-top))] text-center">
          <p className="text-[13px] tracking-[.08em] font-light text-slate-700 dark:text-[#F2F5F1]">{topSeat.label}</p>
          <p className="mt-0.5 text-[10px] tracking-[.14em] font-light uppercase text-slate-500 dark:text-slate-400 font-[family-name:var(--font-jost)]">
            {genreEnglishOf(topSeat.slot)}
          </p>
        </div>
      )}

      {/* 宇宙で中央に寄せた惑星の名前は、惑星の下（画面の高さ 61%）に出す（R6）。 */}
      {belowSeat && (
        <div key={belowSeat.slot} className="pointer-events-none absolute inset-x-0 text-center"
          style={{ top: '61%', animation: 'recall-lift-name .5s ease-out' }}>
          <p className="font-light text-slate-700 dark:text-[#F2F5F1]" style={{ fontSize: 22, letterSpacing: '0.22em' }}>
            {belowSeat.label}
          </p>
          <p className="mt-1.5 font-light uppercase text-slate-500 dark:text-slate-400 font-[family-name:var(--font-jost)]"
            style={{ fontSize: 11, letterSpacing: '0.34em' }}>
            {coreEnglishOf(belowSeat.kind)}
          </p>
        </div>
      )}

      {/* 下のボタン（設計 §4.1）。canvas の外側が無いので、下に置く。 */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center gap-2 pb-[max(18px,env(safe-area-inset-bottom))]">
        <button type="button" onClick={() => dispatch({ type: 'back' })} className={LIFT_BTN}>
          {buttons.back}
        </button>
        {buttons.toSpace && (
          <button type="button" onClick={() => dispatch({ type: 'toSpace' })} className={LIFT_BTN}>
            さらに宇宙へ
          </button>
        )}
      </div>
    </div>
  )
}
