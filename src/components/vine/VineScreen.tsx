'use client'
// 知の蔓のフル画面。開くと planReplay のスナップショットで成長リプレイが流れ、
// 完走（疾書含む）時に markSeen(state, to) をコミットする——リプレイ中に閉じたら次回また見られる。
// 禁止事項: 称賛語・感嘆符・色褪せの数字集計・「歩」。祝意は淡墨の賛が述べ、朱は寸法だけを指す。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  loadTowerState, saveTowerState, markSeen, planReplay, type TowerState,
} from '@/lib/tower-steps'
import { buildBackfillRequest, applyBackfill } from '@/lib/tower-backfill'
import { buildLeafVisuals, spotlightFaded } from '@/lib/vine-leaves'
import { formatHeight, heightMmFromLeaves, nextMilestone, passedMilestones } from '@/lib/vine-ladder'
import { sceneHeightPx, leafY } from '@/lib/vine-scroll'
import { kanjiNumber } from '@/lib/kanji-date'
import { crossedLine, grewLine, leafCountLine } from '@/lib/vine-copy'
import { useReplayEngine } from './useReplayEngine'
import { VineScene } from './VineScene'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
import { getSettings } from '@/lib/settings'
import styles from './vine.module.css'

function loadAllQuizStats(): Record<string, import('@/lib/quiz-srs').QuizStat> {
  try {
    return JSON.parse(localStorage.getItem('medinode_quiz_stats') || '{}')
  } catch {
    return {}
  }
}

export function VineScreen({ onClose, onGoQuiz, initialState }: {
  onClose: () => void; onGoQuiz: () => void; initialState?: TowerState
}) {
  const [state, setState] = useState<TowerState>(() => initialState ?? loadTowerState())
  const [leafOpen, setLeafOpen] = useState<number | null>(null)
  const backfilled = useRef(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(700)
  useBodyScrollLock()

  // 開いた瞬間のスナップショット（リプレイ中の新イベントは次回へ）
  const snapshot = useRef(planReplay(state))
  const { from, to, play } = snapshot.current

  const reduced = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const crossed = useMemo(() => {
    const beforeCount = passedMilestones(from).length
    const passed = passedMilestones(to)
    return passed.length > beforeCount ? passed[passed.length - 1] : null
  }, [from, to])

  const commitSeen = useCallback(() => {
    if (initialState) return // devハーネスでは保存しない
    const fresh = loadTowerState()
    saveTowerState(markSeen(fresh, to))
  }, [to, initialState])

  const engine = useReplayEngine({
    play, from, to,
    lastCrossedLeaves: crossed?.leaves ?? null,
    reduced, onDone: commitSeen,
  })

  // 初回バックフィル（旧TowerScreenの挙動をそのまま維持。表示スナップショットには影響させない）
  useEffect(() => {
    if (backfilled.current || initialState) return
    backfilled.current = true
    if (state.backfilledAt) return
    const req = buildBackfillRequest(getSettings())
    if (!req) return
    ;(async () => {
      try {
        const res = await fetch('/api/notion/search', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req.body),
        })
        if (!res.ok) return
        const data = await res.json()
        if (!Array.isArray(data.records)) return
        const fresh = loadTowerState()
        const next = applyBackfill(fresh, data.records, new Date().toISOString())
        saveTowerState(next)
        setState(next)
      } catch {
        // 組み上げ失敗でも画面は出す
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 開いた直後は穂先（＝今日）を見せる。下へスクロールすると過去へ遡る（§3）
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setViewportH(el.clientHeight || 700)
    el.scrollTop = 0
  }, [to])

  const nowIso = useMemo(() => new Date().toISOString(), [])
  const stats = useMemo(() => loadAllQuizStats(), [])
  const visuals = useMemo(() => buildLeafVisuals(state.steps, stats, nowIso), [state.steps, stats, nowIso])
  const spotlight = useMemo(() => spotlightFaded(state.steps, stats, nowIso), [state.steps, stats, nowIso])

  const leavesNow = engine.leavesNow
  const next = nextMilestone(to)
  const hMm = heightMmFromLeaves(leavesNow)
  const newLeaves = to - from
  const todayLeaf = state.steps[to - 1]
  const showSan = !engine.running || engine.phaseName === 'yoin'

  const openLeaf = leafOpen != null ? state.steps[leafOpen] : null
  const openVisual = leafOpen != null ? visuals[leafOpen] : null

  return (
    <div className={`fixed inset-0 z-50 overflow-y-auto ${styles.frame}`} onClick={() => engine.running && engine.skip()}>
      <div className="mx-auto max-w-md px-4 pb-10 pt-[calc(14px+env(safe-area-inset-top))]">
        <div className="mb-1 flex items-start justify-between">
          <div>
            <div className="text-[11px] tracking-[.35em] text-[#7d6f52]">知　の　蔓</div>
            <div className="text-2xl font-semibold">{formatHeight(hMm)}</div>
            <div className="mt-0.5 text-[11px] text-[#8b8272]">{leafCountLine(newLeaves, to)}</div>
          </div>
          <div className="flex items-start gap-2">
            <div className="text-right text-[10px] leading-relaxed text-[#a39678]">
              つぎは<br /><span className="text-[#2c2a22] font-semibold">{next.label} {next.sizeLabel}</span>
            </div>
            <button type="button" onClick={(e) => { e.stopPropagation(); onClose() }} aria-label="閉じる" className="rounded-full p-2 text-[#8b8272]">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="relative">
          <div
            ref={scrollRef}
            className="relative overflow-y-auto overscroll-contain"
            style={{ maxHeight: '70vh' }}
            onScroll={(e) => setScrollTop((e.target as HTMLDivElement).scrollTop)}
          >
            <VineScene
              leavesNow={leavesNow} from={from} to={to}
              visuals={visuals} spotlightIds={spotlight} steps={state.steps}
              crossedNow={crossed != null && leavesNow >= (crossed?.leaves ?? Infinity)}
              onLeafTap={(i) => { if (!engine.running) setLeafOpen(i) }}
              scrollTop={scrollTop} viewportH={viewportH}
            />
          </div>
          {/* 賛（縦書きHTMLオーバーレイ・上部余白・蔓先端の対角＝右上。数字は漢数字） */}
          {showSan && play && (crossed || newLeaves > 0) && (
            <div className={`absolute right-3 top-4 text-[21px] leading-[1.9] ${styles.san} ${styles.fadeIn}`}>
              {crossed ? crossedLine(crossed.label) : grewLine(kanjiNumber(Math.min(newLeaves, 99)))}
            </div>
          )}
        </div>

        <div className="mt-2 space-y-1 text-[11px] text-[#5f5a4c]">
          {todayLeaf && !engine.running && (
            <p>今日の葉：<span className="font-semibold">{todayLeaf.title || 'ひとつの知識'}</span></p>
          )}
          <p className="text-[10px] text-[#a39678]">
            葉＝学びのひとつ（読んだ・書いた・即答できた・磨き直した）・色＝いま即答できるか
          </p>
        </div>
      </div>

      {/* 葉の中身（タイトル・日付・行為の一言だけ。数字は出さない） */}
      {openLeaf && openVisual && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/25" onClick={(e) => { e.stopPropagation(); setLeafOpen(null) }}>
          <div className={`w-full max-w-md rounded-t-2xl p-4 pb-[calc(16px+env(safe-area-inset-bottom))] ${styles.frame}`} onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold">{openLeaf.title || 'ひとつの知識'}</div>
            <div className="mt-1 text-[11px] text-[#8b8272]">
              {openLeaf.at.slice(0, 10)}・
              {openLeaf.kind === 'read' ? '読んだ' : openLeaf.kind === 'wrote' ? '書いた' : openLeaf.kind === 'recall' ? '即答できた' : '磨き直した'}
            </div>
            {spotlight.includes(openLeaf.id) && (
              <button
                type="button"
                onClick={() => { setLeafOpen(null); onGoQuiz() }}
                className="mt-3 rounded-full border border-[#cbbf9f] bg-[#faf5e8] px-4 py-1.5 text-xs"
              >
                たしかめる
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
