'use client'
// 知の蔓のフル画面。開くと planReplay のスナップショットで成長リプレイが流れ、
// 完走（疾書含む）時に markSeen(state, to) をコミットする——リプレイ中に閉じたら次回また見られる。
// 禁止事項: 称賛語・感嘆符・色褪せの数字集計・「歩」。祝意は淡墨の賛が述べ、朱は寸法だけを指す。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  loadTowerState, saveTowerState, markSeen, planReplay, leafSteps, type TowerState,
} from '@/lib/tower-steps'
import { buildBackfillRequest, applyBackfill } from '@/lib/tower-backfill'
import { buildLeafVisuals, spotlightFaded, pendingBudIds } from '@/lib/vine-leaves'
import { loadRereads } from '@/lib/reader-marks'
import { sceneryMarks } from '@/lib/vine-scenery'
import { formatHeight, heightMmFromLeaves, passedMilestones } from '@/lib/vine-ladder'
import { kanjiNumber } from '@/lib/kanji-date'
import { crossedLine, grewLine, leafCountLine, indexHeading, sampleLabel, INTRO_LINES } from '@/lib/vine-copy'
import { leafY, markPositions, splitByJoin } from '@/lib/vine-scroll'
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

// 初回の口上（見本の蔓）を見たか。PERSONAL_DEVICE_KEYS 登録済み。
const INTRO_KEY = 'medinode_vine_intro_seen_v1'
// 見本は20枚（48枚は多すぎた＝オーナーFB）。カタツムリ（18枚）までの4つの背くらべが入る
const DEMO_TOTAL = 20
const DEMO_KINDS = ['recall', 'read', 'wrote', 'recall', 'recall', 'repolish'] as const

export function VineScreen({ onClose, onGoQuiz, initialState, forceIntro }: {
  onClose: () => void; onGoQuiz: () => void; initialState?: TowerState
  forceIntro?: boolean // devハーネス専用: 口上（見本）のプレビュー
}) {
  const [state, setState] = useState<TowerState>(() => initialState ?? loadTowerState())
  const [leafOpen, setLeafOpen] = useState<number | null>(null)
  const backfilled = useRef(false)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const lastCommittedScroll = useRef(0) // 量子化の基準（前回stateに反映した値）
  const [viewportH, setViewportH] = useState(700)
  const [viewportW, setViewportW] = useState(358)
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

  // 開いた直後は穂先（＝今日）を見せる。下へスクロールすると過去へ遡る（§3）。
  // 幅・高さの実測はResizeObserverで追随させる——[to]は開いた瞬間のスナップショット
  // （useRef由来で以後変わらない）なのでeffect自体は初回しか走らないが、
  // 横→縦の回転などスクロール容器のサイズ変化はResizeObserverのコールバックが拾い続ける。
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = 0
    const measure = () => {
      setViewportH(el.clientHeight || 700)
      setViewportW(el.clientWidth || 358)
    }
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure)
      ro.observe(el)
      return () => ro.disconnect()
    }
    // ResizeObserver非対応環境向けのフォールバック。対象は古いSafari/WebViewのみで
    // window.resizeだけでもカバーできる（回転時は多くの環境でこれも発火する）。
    // 専用のvisualViewport購読までは、非対応環境の実利用が確認できるまで見送る。
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [to])

  // 地下茎と地上部（正典§7）。表示・リプレイ・高さはすべて above だけを見る。
  const split = useMemo(() => splitByJoin(state.steps, state.joinedAt), [state.steps, state.joinedAt])
  // 葉＝attemptを除いた地上の歩（正典§9）。芽（attempt）は枚数・高さに入れない
  const aboveLeaves = useMemo(() => leafSteps(split.above), [split.above])
  const buds = useMemo(() => pendingBudIds(split.above), [split.above])
  const rereads = useMemo(() => loadRereads(), [])
  const marks = useMemo(() => markPositions(to), [to])
  const nowIso = useMemo(() => new Date().toISOString(), [])
  // 時間の点景（正典§7）。実時間に紐づく小さな出会い。通知はしない——開いたとき見つけるもの
  const scenery = useMemo(() => sceneryMarks(aboveLeaves, nowIso), [aboveLeaves, nowIso])
  const stats = useMemo(() => loadAllQuizStats(), [])
  const visuals = useMemo(() => buildLeafVisuals(aboveLeaves, stats, nowIso, rereads), [aboveLeaves, stats, nowIso, rereads])
  const spotlight = useMemo(() => spotlightFaded(aboveLeaves, stats, nowIso), [aboveLeaves, stats, nowIso])

  const leavesNow = engine.leavesNow
  const hMm = heightMmFromLeaves(leavesNow)
  const newLeaves = to - from
  const todayLeaf = aboveLeaves[to - 1]
  const showSan = !engine.running || engine.phaseName === 'yoin'

  // リプレイ中だけ穂先を追う（§ 開始位置は穂先だが成長は根元から始まるため、
  // from=0のような久しぶりの再開では伸びる様子がビューポートの外で起きてしまう）。
  // リプレイが終わったら何もしない＝ユーザーのスクロールを邪魔しない。
  useEffect(() => {
    if (!engine.running) return
    const el = scrollRef.current
    if (!el) return
    const revealIndex = Math.max(0, Math.min(to, Math.floor(leavesNow)))
    el.scrollTop = Math.max(0, leafY(revealIndex, to) - viewportH * 0.55)
  }, [engine.running, leavesNow, to, viewportH])

  const openLeaf = leafOpen != null ? aboveLeaves[leafOpen] : null
  const openVisual = leafOpen != null ? visuals[leafOpen] : null

  // 和紙の3段トーン（昼・夕・夜）。アプリのダーク設定は夜トーン優先。
  // 初期値は昼の和紙のまま、マウント後に切り替える＝「行灯が灯る」800msフェード。
  const [tone, setTone] = useState('#f2ead6')
  useEffect(() => {
    const h = new Date().getHours()
    const dark = document.documentElement.classList.contains('dark')
    setTone(dark ? '#CBB58C' : h >= 5 && h < 16 ? '#F2EAD6' : h < 19 ? '#E4D6B8' : '#CBB58C')
  }, [])

  // ── 初回の口上（オンボーディング）: タップで進む4段（オーナーFBで段階式に・2026-08-03）。
  // 0=芽 → 1=見本の蔓がゆっくり伸びる → 2=背くらべ → 3=薄れて自分の蔓へ。-1=終了。
  // 一瞬のグイーンは「初めて開く人には一瞬にしか映らない」ため廃止。
  const [introStep, setIntroStep] = useState(() => {
    if (initialState) return forceIntro ? 0 : -1
    try { return localStorage.getItem(INTRO_KEY) ? -1 : 0 } catch { return -1 }
  })
  const intro = introStep >= 0
  const [introLeaves, setIntroLeaves] = useState(0)
  const demoSteps = useMemo<import('@/lib/tower-steps').Step[]>(
    () => Array.from({ length: DEMO_TOTAL }, (_, i) => ({
      id: `demo-${i}`, kind: DEMO_KINDS[i % DEMO_KINDS.length], at: '', genre: '', title: '',
    })), [],
  )
  const demoVisuals = useMemo(() => buildLeafVisuals(demoSteps, {}, nowIso), [demoSteps, nowIso])
  // 段1: 見本がゆっくり伸びる（6秒・溜めてから）。reduced-motionは一息で
  useEffect(() => {
    if (introStep !== 1) return
    if (reduced) { setIntroLeaves(DEMO_TOTAL); return }
    const DUR = 6000
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / DUR)
      const ease = p < 0.2
        ? (p / 0.2) * (p / 0.2) * 0.08
        : 0.08 + 0.92 * (1 - Math.pow(1 - (p - 0.2) / 0.8, 1.8))
      setIntroLeaves(DEMO_TOTAL * ease)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [introStep, reduced])
  // 段3: 薄れて自分の蔓へ
  useEffect(() => {
    if (introStep !== 3) return
    const id = window.setTimeout(() => {
      if (!initialState) { try { localStorage.setItem(INTRO_KEY, '1') } catch {} } // devハーネスでは保存しない
      setIntroStep(-1)
    }, 1400)
    return () => window.clearTimeout(id)
  }, [introStep, initialState])
  const introTap = useCallback(() => {
    setIntroStep((s) => {
      if (s === 1) setIntroLeaves(DEMO_TOTAL) // 伸び途中のタップは伸ばし切ってから次へ
      return s >= 0 && s < 3 ? s + 1 : s
    })
  }, [])
  // 口上のあいだは見本の穂先を追う（段0は地面の芽）
  useEffect(() => {
    if (!intro) return
    const el = scrollRef.current
    if (!el) return
    if (introStep === 0) { el.scrollTop = el.scrollHeight; return }
    const reveal = Math.max(0, Math.min(DEMO_TOTAL, Math.floor(introLeaves)))
    el.scrollTop = Math.max(0, leafY(reveal, DEMO_TOTAL) - viewportH * 0.55)
  }, [intro, introStep, introLeaves, viewportH])

  return (
    <div
      className={`fixed inset-0 z-50 overflow-y-auto ${styles.frame}`}
      style={{ backgroundColor: tone, transition: 'background-color 800ms ease' }}
      onClick={() => engine.running && engine.skip()}
    >
      <div className="mx-auto max-w-md px-4 pb-10 pt-[calc(14px+env(safe-area-inset-top))]">
        <div className="mb-1 flex items-start justify-between">
          <div>
            <div className="text-[11px] tracking-[.35em] text-[#7d6f52]">知　の　蔓</div>
            {/* 地上0のときは数字を出さない——最初の一画面を0で語らない。口上（見本）の間も出さない */}
            {to > 0 && !intro && <div className="text-2xl font-semibold">{formatHeight(hMm)}</div>}
            {to > 0 && !intro && <div className="mt-0.5 text-[11px] text-[#8b8272]">{leafCountLine(to)}</div>}
          </div>
          {/* 「つぎは◯◯」はVineScene側の穂先の上に一本化（正典§7＝二重表示の禁止）。
              ここではボタンだけを置く。 */}
          <button type="button" onClick={(e) => { e.stopPropagation(); onClose() }} aria-label="閉じる" className="rounded-full p-2 text-[#8b8272]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="relative" onClick={intro ? introTap : undefined}>
          <div
            ref={scrollRef}
            className="relative overflow-y-auto overscroll-contain"
            style={{ maxHeight: '70vh' }}
            onScroll={(e) => {
              // 量子化: 窓は前後1画面分の余裕を持つので、viewportH/4以上動いたときだけ
              // stateを更新する（毎イベントの再描画を間引く。窓の余裕内なので葉が消えることはない）。
              const top = (e.target as HTMLDivElement).scrollTop
              if (Math.abs(top - lastCommittedScroll.current) >= viewportH / 4) {
                lastCommittedScroll.current = top
                setScrollTop(top)
              }
            }}
          >
            {intro ? (
              // 初回の口上: 段0=芽だけ、段1以降=見本の蔓。段3で薄れて自分の蔓へ
              <div style={{ opacity: introStep === 3 ? 0 : 1, transition: 'opacity 1300ms ease' }}>
                <VineScene
                  leavesNow={introStep === 0 ? 0 : introLeaves} from={0}
                  to={introStep === 0 ? 0 : DEMO_TOTAL}
                  visuals={demoVisuals} spotlightIds={[]} steps={demoSteps}
                  crossedNow={false}
                  onLeafTap={() => {}}
                  scrollTop={scrollTop} viewportH={viewportH} width={viewportW} popping
                  undergroundCount={0} undergroundClearedAt=""
                  pendingBuds={0}
                  scenery={[]}
                />
              </div>
            ) : (
              <VineScene
                leavesNow={leavesNow} from={from} to={to}
                visuals={visuals} spotlightIds={spotlight} steps={aboveLeaves}
                crossedNow={crossed != null && leavesNow >= (crossed?.leaves ?? Infinity)}
                onLeafTap={(i) => { if (!engine.running) setLeafOpen(i) }}
                scrollTop={scrollTop} viewportH={viewportH} width={viewportW} popping={engine.running}
                undergroundCount={split.underground.length} undergroundClearedAt={state.undergroundClearedAt}
                pendingBuds={buds.length}
                scenery={scenery}
              />
            )}
          </div>
          {/* 賛（縦書きHTMLオーバーレイ・上部余白・蔓先端の対角＝右上。数字は漢数字） */}
          {!intro && showSan && play && (crossed || newLeaves > 0) && (
            <div className={`absolute right-3 top-4 text-[21px] leading-[1.9] ${styles.san} ${styles.fadeIn} ${styles.tanzaku}`}>
              {crossed ? crossedLine(crossed.label) : grewLine(kanjiNumber(Math.min(newLeaves, 99)))}
            </div>
          )}
          {/* 口上のオーバーレイ（スクロールに載せない）。見本の明記＋段ごとの一文＋操作の言葉 */}
          {intro && (
            <>
              {introStep >= 1 && (
                <div className={`absolute left-3 top-4 text-[13px] ${styles.san}`} style={{ opacity: 0.6 }}>
                  {sampleLabel()}
                </div>
              )}
              <div
                key={introStep}
                className={`absolute inset-x-0 bottom-9 px-6 text-center text-[15px] leading-relaxed text-[#4c4536] ${styles.fadeIn}`}
              >
                {INTRO_LINES[Math.max(0, Math.min(introStep, INTRO_LINES.length - 1))]}
              </div>
              {introStep < 3 && (
                <div className="absolute inset-x-0 bottom-2 text-center text-[10px] text-[#a39678]">
                  タップでつぎへ
                </div>
              )}
            </>
          )}
        </div>

        {/* 越えた印の目次（§4）。ラダーは全24段しかないので、これがそのまま目次になる。
            タップでその位置へスクロール。1つだけなら目次にならないので出さない。 */}
        {marks.length > 1 && (
          <div className="mt-2 px-3">
            <div className="mb-1 text-[10px] tracking-[.25em] text-[#7d6f52]">{indexHeading()}</div>
            <div className="flex flex-wrap gap-1.5">
              {[...marks].reverse().map((m) => (
                <button
                  key={m.milestone.label}
                  type="button"
                  onClick={() => { const el = scrollRef.current; if (el) el.scrollTop = Math.max(0, m.y - 120) }}
                  className="rounded-full border border-[#cbbf9f] bg-[#faf5e8] px-2.5 py-1 text-[11px] text-[#5c5340]"
                >
                  {m.milestone.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="mt-2 space-y-1 text-[11px] text-[#5f5a4c]">
          {todayLeaf && !engine.running && (
            <p>今日の葉：<span className="font-semibold">{todayLeaf.title || 'ひとつの知識'}</span></p>
          )}
          <p className="text-[10px] text-[#a39678]">
            葉＝学びのひとつ（読んだ・書いた・解決した・即答できた・磨き直した）・色＝いま即答できるか
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
              {openLeaf.kind === 'read' ? '読んだ' : openLeaf.kind === 'wrote' ? '書いた'
                : openLeaf.kind === 'resolved' ? '解決した'
                : openLeaf.kind === 'recall' ? '即答できた' : '磨き直した'}
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
