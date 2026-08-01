'use client'
// 成長リプレイの再生エンジン。時間ベース（30fps環境でもコマが減るだけ）・
// visibilitychangeで一時停止（バックグラウンドで進めて「戻ったら終わっていた」を防ぐ）・
// skip()は残りを約500msで走り切る疾書（カットしない——筆の連続が世界観）。
import { useCallback, useEffect, useRef, useState } from 'react'
import { buildPhases, replayAt, totalDurMs, type ReplayPhaseName } from '@/lib/vine-replay'

const SHISSHO_MS = 500

export function useReplayEngine(opts: {
  play: boolean; from: number; to: number
  lastCrossedLeaves: number | null; reduced: boolean; onDone: () => void
}): { leavesNow: number; phaseName: ReplayPhaseName | null; running: boolean; skip: () => void } {
  const { play, from, to, lastCrossedLeaves, reduced } = opts
  const [view, setView] = useState(() =>
    play
      ? (reduced
          ? { leavesNow: to, phaseName: 'yoin' as ReplayPhaseName | null, running: true }
          : { leavesNow: from, phaseName: 'tame' as ReplayPhaseName | null, running: true })
      : { leavesNow: to, phaseName: null, running: false })
  const raf = useRef(0)
  const tMs = useRef(0)          // 再生位置（一時停止をまたいで累積）
  const lastNow = useRef(0)
  const speed = useRef(1)
  const doneFired = useRef(false)
  const onDoneRef = useRef(opts.onDone)
  onDoneRef.current = opts.onDone
  const phases = useRef(buildPhases(from, to, lastCrossedLeaves, reduced))

  useEffect(() => {
    if (!play) return
    const step = (now: number) => {
      if (lastNow.current) tMs.current += (now - lastNow.current) * speed.current
      lastNow.current = now
      const s = replayAt(phases.current, tMs.current)
      setView({ leavesNow: s.leavesNow, phaseName: s.done ? null : s.name, running: !s.done })
      if (s.done) {
        if (!doneFired.current) { doneFired.current = true; onDoneRef.current() }
        return
      }
      raf.current = requestAnimationFrame(step)
    }
    const onVisibility = () => {
      if (document.hidden) {
        cancelAnimationFrame(raf.current)
        lastNow.current = 0 // 復帰フレームで巨大dtを加算しない
      } else if (!doneFired.current) {
        raf.current = requestAnimationFrame(step)
      }
    }
    raf.current = requestAnimationFrame(step)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelAnimationFrame(raf.current)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // 再生条件は開いた瞬間のスナップショットで固定（リプレイ中の新イベントは次回へ）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play])

  const skip = useCallback(() => {
    const remaining = totalDurMs(phases.current) - tMs.current
    if (remaining > 0) speed.current = Math.max(1, remaining / SHISSHO_MS)
  }, [])

  return { ...view, skip }
}
