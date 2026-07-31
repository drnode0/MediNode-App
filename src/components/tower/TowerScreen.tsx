'use client'
// 知の塔のフル画面。開くと前回からの差分がひとつずつ積まれる（自分の仕事の収穫）。
// 下へスクロール＝時間を遡る（巻の地層）。音なし・祝いは小さく。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import {
  loadTowerState, saveTowerState, markSeen, type TowerState,
} from '@/lib/tower-steps'
import { buildBackfillRequest, applyBackfill } from '@/lib/tower-backfill'
import { formatHeight, heightMm, nextMilestone, passedMilestones, stepsThisWeek } from '@/lib/tower-ladder'
import { deriveVolumes, dullIds, lastLeafStep, aYearAgoStep, type Volume } from '@/lib/tower-volumes'
import { TowerStack } from './TowerStack'
import { useBodyScrollLock } from '@/lib/use-body-scroll-lock'
import { getSettings } from '@/lib/settings'

// quiz-srs は一件読み（getQuizStat）しかexportしていないため、くすみ集合の一括計算だけは
// キーを直接読む。localStorageキー名の直書きはこの1箇所に限定する（tower-steps.ts の TOWER_KEY 以外）。
function loadAllQuizStats(): Record<string, import('@/lib/quiz-srs').QuizStat> {
  try {
    return JSON.parse(localStorage.getItem('medinode_quiz_stats') || '{}')
  } catch {
    return {}
  }
}

export function TowerScreen({ onClose, onGoQuiz }: { onClose: () => void; onGoQuiz: () => void }) {
  const [state, setState] = useState<TowerState>(() => loadTowerState())
  const [volumeOpen, setVolumeOpen] = useState<Volume | null>(null)
  const [crossed, setCrossed] = useState<string | null>(null)
  const backfilled = useRef(false)
  useBodyScrollLock()

  const count = state.steps.length
  const dropCount = Math.min(Math.max(count - state.lastSeenSteps, 0), 8)
  const batchExtra = Math.max(count - state.lastSeenSteps - 8, 0)

  // 初回だけ: 既存の検索APIで1回だけ組み上げる（ゼロスタート禁止）。
  // 判定は backfilledAt。「wroteの有無」で判定してはいけない——Task 8 の passive ingest が
  // 先にwroteを数件積むと、全量バックフィルが永久に走らなくなる。
  // v1設計: mode:'search'+空keywordは何もfetchせず、mode:'recent'（keyword不要・個人medical最新50件
  // +reference20件）で組み上げる。残りは日常のpassive ingestで漸増させる（buildBackfillRequestのコメント参照）。
  useEffect(() => {
    if (backfilled.current) return
    backfilled.current = true
    if (state.backfilledAt) return
    const req = buildBackfillRequest(getSettings())
    // settings未設定（token/DB未接続）ならfetchせず、backfilledAtも刻まない（次回接続後に再試行できるように）
    if (!req) return
    ;(async () => {
      try {
        const res = await fetch('/api/notion/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(req.body),
        })
        if (!res.ok) return
        const data = await res.json()
        if (!Array.isArray(data.records)) return
        // updater関数内での副作用（保存・時刻生成）を避けるため、setStateの外で計算する。
        // mount〜fetch解決の間に走ったrecordTowerEvent等の書込を握り潰さないよう、
        // Reactのprev（mount時スナップショット）ではなく最新のlocalStorageをmerge baseにする。
        const fresh = loadTowerState()
        const next = applyBackfill(fresh, data.records, new Date().toISOString())
        saveTowerState(next)
        setState(next)
      } catch {
        // 組み上げ失敗でも画面は出す（イベントで徐々に積もる）
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 越え演出: 前回見た歩数と今の歩数の間に目盛りがあれば、一度だけカードを出す
  useEffect(() => {
    const before = passedMilestones(state.lastSeenSteps).length
    const after = passedMilestones(count).length
    if (after > before) {
      const m = passedMilestones(count)[after - 1]
      setCrossed(`${m.label}（${m.sizeLabel}）を越えました`)
    }
    // 見た水位を上げる（差分積みは初回描画の dropCount で消費済み）
    const seen = markSeen(loadTowerState())
    saveTowerState(seen)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { volumes, loose } = useMemo(() => deriveVolumes(state.steps), [state.steps])
  const dullSet = useMemo(() => dullIds(loadAllQuizStats(), new Date().toISOString()), [state.steps])
  const next = nextMilestone(count)
  const leaf = lastLeafStep(state.steps)
  const yearAgo = aYearAgoStep(state.steps, new Date().toISOString())

  const openVolume = useCallback((v: Volume) => setVolumeOpen(v), [])

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-gradient-to-b from-sky-50 via-emerald-50/60 to-white dark:from-gray-950 dark:via-gray-900 dark:to-gray-900">
      <div className="mx-auto max-w-md px-4 pb-16 pt-[calc(16px+env(safe-area-inset-top))]">
        <div className="mb-2 flex items-start justify-between">
          <div>
            <div className="text-xs font-bold tracking-widest text-brand dark:text-brand-300">知の塔</div>
            <div className="text-3xl font-bold text-gray-900 dark:text-gray-50">
              {formatHeight(heightMm(count))}
            </div>
            <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
              学び {count}歩 ・ 今週 +{stepsThisWeek(state.steps, new Date().toISOString())}
              {batchExtra > 0 && <span className="ml-2 text-brand dark:text-brand-300">+{batchExtra + 8}歩ぶん積まれました</span>}
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="閉じる" className="rounded-full p-2 text-gray-500 hover:bg-white/60 dark:text-gray-300">
            <X className="h-5 w-5" />
          </button>
        </div>

        {next && (
          <div className="mb-1 flex items-center justify-between border-b border-dashed border-emerald-200 dark:border-gray-700 pb-1 text-xs text-gray-500 dark:text-gray-400">
            <span>
              つぎは <span className="font-bold text-gray-700 dark:text-gray-200">{next.label} {next.sizeLabel}</span>
            </span>
            <span className="rounded-full bg-white dark:bg-gray-800 border border-emerald-100 dark:border-gray-700 px-2 py-0.5 font-bold text-brand dark:text-brand-300">
              あと{next.steps - count}歩
            </span>
          </div>
        )}

        {crossed && (
          <div className="animate-fade-in-up mb-2 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-800 dark:text-gray-100 motion-reduce:animate-none">
            🎉 {crossed}
            <button type="button" onClick={() => setCrossed(null)} className="ml-2 text-xs text-gray-400">とじる</button>
          </div>
        )}

        <TowerStack volumes={volumes} loose={loose} dullSet={dullSet} dropCount={dropCount} onOpenVolume={openVolume} />

        <div className="mt-4 space-y-1.5 border-t border-emerald-100 dark:border-gray-700 pt-3 text-xs text-gray-600 dark:text-gray-300">
          {leaf && (
            <p>
              🌿 <span className="font-bold text-brand dark:text-brand-300">{leaf.title || 'この知識'}</span> に葉がつきました
            </p>
          )}
          {dullSet.size > 0 && (
            <p>
              要再確認が {dullSet.size}件 →{' '}
              <button type="button" onClick={onGoQuiz} className="font-bold text-brand underline dark:text-brand-300">
                クイズで磨く
              </button>
            </p>
          )}
          {yearAgo && (
            <p className="text-gray-400 dark:text-gray-500">
              去年の今日ごろ、<span className="font-medium">{yearAgo.title || '1つの知識'}</span> を積みました
            </p>
          )}
          <p className="pt-1 text-[10px] text-gray-400 dark:text-gray-500">
            ブロック＝学びの1歩（読んだ・書いた・即答できた・磨き直した）・明るさ＝いま即答できるか
          </p>
        </div>

        <div className="mt-4 space-y-1 text-[10px] text-gray-400 dark:text-gray-500">
          {passedMilestones(count).slice(-3).reverse().map((m) => (
            <div key={m.steps}>✓ {m.label} {m.sizeLabel}（{m.steps}歩）</div>
          ))}
        </div>
      </div>

      {volumeOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/30" onClick={() => setVolumeOpen(null)}>
          <div
            className="max-h-[70vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white dark:bg-gray-900 p-4 pb-[calc(16px+env(safe-area-inset-bottom))]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 text-sm font-bold text-gray-900 dark:text-gray-50">
              第{volumeOpen.n}巻 <span className="ml-1 text-xs font-normal text-gray-400">{volumeOpen.from.slice(0, 10)} 〜 {volumeOpen.to.slice(0, 10)}</span>
            </div>
            <ul className="space-y-1.5 text-xs text-gray-700 dark:text-gray-200">
              {volumeOpen.steps.map((s) => (
                <li key={`${s.id}-${s.kind}-${s.at}`} className="flex items-baseline gap-2">
                  <span className="shrink-0 text-gray-400">{s.at.slice(5, 10)}</span>
                  <span className="min-w-0 flex-1 truncate">{s.title || s.id}</span>
                  <span className="shrink-0 text-[10px] text-gray-400">
                    {s.kind === 'read' ? '読んだ' : s.kind === 'wrote' ? '書いた' : s.kind === 'recall' ? '即答' : '磨き直し'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
