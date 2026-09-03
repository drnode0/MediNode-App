'use client'
// Recall の在庫を1か所に集める Provider。読む画面（Node・節末ボタン）と Recall 画面
// （useRecallData）が同じ配列を見るので、「反映する」処理を別途書かなくても、
// どちらかで書けば両方に映る（リーダーはオーバレイで Recall タブの上に重なるだけで、
// Recall 画面はマウントされたまま残るため）。
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { RecallClaim, RecallProgress, RecallSectionRead } from '@/lib/recall/types'
import { keepOptimistic, replaceProgress, readOptimistic, removeRead } from '@/lib/recall/optimistic'
import { isRecallEnabled } from '@/lib/recall-flag'

// 取り消しを出しておく時間。走りながら片手で押す前提なので、通知として短すぎない長さにする。
const UNDO_MS = 8000

export type RecallStore = {
  enabled: boolean
  loading: boolean
  error: string | null
  saveError: string | null
  clearSaveError: () => void
  claims: RecallClaim[]
  progress: RecallProgress[]
  reads: RecallSectionRead[]
  // 保存中の鍵。主張は claimId、節は `read:${pageId}#${sectionKey}`。
  pending: Set<string>
  keep: (claimId: string, keep: boolean) => Promise<void>
  review: (claimId: string, result: 'ok' | 'ng') => Promise<void>
  markSectionRead: (pageId: string, sectionKey: string) => Promise<void>
  refresh: () => Promise<void>
}

/* 反映の順番を守る門。旧 useRecallData から移設（説明もそのまま）。 */
type Gate = { issue: () => number; isLatest: (id: number) => boolean }
function createGate(): Gate {
  let seq = 0
  return { issue: () => ++seq, isLatest: (id: number) => id === seq }
}

const Ctx = createContext<RecallStore | null>(null)

// 機能が閉じている利用者・Provider の外では、何も持たない在庫を返す。
// 呼び出し側が enabled を見ずに書いても、通信も描画も起きない。
const EMPTY: RecallStore = {
  enabled: false, loading: false, error: null, saveError: null, clearSaveError: () => {},
  claims: [], progress: [], reads: [], pending: new Set(),
  keep: async () => {}, review: async () => {}, markSectionRead: async () => {}, refresh: async () => {},
}

export function useRecallStore(): RecallStore {
  return useContext(Ctx) ?? EMPTY
}

export function RecallProvider({ children }: { children: React.ReactNode }) {
  const [claims, setClaims] = useState<RecallClaim[]>([])
  const [progress, setProgress] = useState<RecallProgress[]>([])
  const [reads, setReads] = useState<RecallSectionRead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [pending, setPending] = useState<Set<string>>(() => new Set())
  const [undo, setUndo] = useState<{ claimId: string } | null>(null)
  const enabled = isRecallEnabled()

  const gateRef = useRef<Gate | null>(null)
  if (!gateRef.current) gateRef.current = createGate()
  const aliveRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const mark = useCallback((key: string, on: boolean) => {
    setPending((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
  }, [])

  const refresh = useCallback(async () => {
    if (!enabled) { setLoading(false); return }
    const gate = gateRef.current!
    const id = gate.issue()
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    const usable = () => aliveRef.current && gate.isLatest(id)
    try {
      const [c, p] = await Promise.all([
        fetch('/api/recall/claims', { signal: ac.signal }),
        fetch('/api/recall/progress', { signal: ac.signal }),
      ])
      // 機能が閉じている利用者には claims・progress の両方が本文なしの404で返る
      // （src/lib/recall/guard.ts の notFound()）。存在を教える文言を出さず、
      // エラーにもせず、静かに空のまま終える（スピナーを回し続けない）。
      if (c.status === 404 || p.status === 404) {
        if (!usable()) return
        setClaims([]); setProgress([]); setReads([]); setError(null)
        return
      }
      if (!c.ok || !p.ok) throw new Error('読み込みに失敗しました')
      const cj = (await c.json()) as { claims: RecallClaim[] }
      const pj = (await p.json()) as { progress: RecallProgress[]; reads: RecallSectionRead[] }
      if (!usable()) return
      setClaims(cj.claims); setProgress(pj.progress); setReads(pj.reads); setError(null)
    } catch (e) {
      // 打ち切り（画面を離れた・新しい読み込みが始まった）は失敗ではない
      if (ac.signal.aborted || !usable()) return
      setError(e instanceof Error ? e.message : '読み込みに失敗しました')
    } finally {
      // スピナーは「最初の読み込みが終わったか」だけを見る。どの応答を採ったかとは別。
      if (aliveRef.current && !ac.signal.aborted) setLoading(false)
    }
  }, [enabled])

  useEffect(() => {
    aliveRef.current = true
    void refresh()
    return () => {
      aliveRef.current = false
      abortRef.current?.abort()
      if (undoTimer.current) clearTimeout(undoTimer.current)
      if (errorTimer.current) clearTimeout(errorTimer.current)
    }
  }, [refresh])

  // 失敗の知らせは読む画面にも出す（RecallScreen は自分の pill で別途表示するが、
  // 読む画面はここでしか出せない）。RecallScreen 側の表示と重なって見える窓は
  // 短い自動消去で縮める。
  useEffect(() => {
    if (errorTimer.current) { clearTimeout(errorTimer.current); errorTimer.current = null }
    if (!saveError) return
    errorTimer.current = setTimeout(() => setSaveError(null), 5000)
  }, [saveError])

  const keep = useCallback(async (claimId: string, keepIt: boolean) => {
    const before = progress
    const at = new Date()
    setProgress((prev) => keepOptimistic(prev, claimId, keepIt, at))
    mark(claimId, true)
    try {
      const res = await fetch('/api/recall/keep', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId, keep: keepIt }),
      })
      if (!res.ok) throw new Error('保存に失敗しました')
      const { progress: row } = (await res.json()) as { progress: RecallProgress }
      if (!aliveRef.current) return
      gateRef.current!.issue() // これより前に始まった読み込みの応答は、この1件を巻き戻さない
      setProgress((prev) => replaceProgress(prev, row))
      setSaveError(null)
      // 残したときだけ取り消しを出す。外したときは出さない（もう一度押せば戻るため）。
      if (keepIt) {
        if (undoTimer.current) clearTimeout(undoTimer.current)
        setUndo({ claimId })
        undoTimer.current = setTimeout(() => setUndo(null), UNDO_MS)
      } else {
        setUndo(null)
      }
    } catch (e) {
      // 押す前の一覧へ戻す。押したことが無かったのと同じ状態にする。
      if (aliveRef.current) {
        setProgress(before)
        setSaveError(e instanceof Error ? e.message : '保存に失敗しました')
      }
      // RecallScreen（既存・無変更）は keep の失敗を await/catch で受け止め、
      // 保存中の見た目（「記録しています」）を必ず終わらせる契約を持つ。
      // ここで飲み込むと、失敗時にその後始末が一生走らない（画面が固まって見える）。
      throw e
    } finally {
      mark(claimId, false)
    }
  }, [progress, mark])

  const review = useCallback(async (claimId: string, result: 'ok' | 'ng') => {
    const before = progress
    mark(claimId, true)
    try {
      const res = await fetch('/api/recall/review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ claimId, result }),
      })
      if (!res.ok) throw new Error('保存に失敗しました')
      const { progress: row } = (await res.json()) as { progress: RecallProgress }
      if (!aliveRef.current) return
      gateRef.current!.issue()
      setProgress((prev) => replaceProgress(prev, row))
      setSaveError(null)
    } catch (e) {
      if (aliveRef.current) {
        setProgress(before)
        setSaveError(e instanceof Error ? e.message : '保存に失敗しました')
      }
      // RecallScreen（既存・無変更）は review の失敗を await/catch で受け止める契約を持つ。
      throw e
    } finally {
      mark(claimId, false)
    }
  }, [progress, mark])

  const markSectionRead = useCallback(async (pageId: string, sectionKey: string) => {
    const key = `read:${pageId}#${sectionKey}`
    const at = new Date()
    setReads((prev) => readOptimistic(prev, pageId, sectionKey, at))
    mark(key, true)
    try {
      const res = await fetch('/api/recall/read', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pageId, sectionKey }),
      })
      if (!res.ok) throw new Error('保存に失敗しました')
      if (aliveRef.current) setSaveError(null)
    } catch (e) {
      if (aliveRef.current) {
        setReads((prev) => removeRead(prev, pageId, sectionKey))
        setSaveError(e instanceof Error ? e.message : '保存に失敗しました')
      }
    } finally {
      mark(key, false)
    }
  }, [mark])

  const clearSaveError = useCallback(() => setSaveError(null), [])

  const value = useMemo<RecallStore>(() => ({
    enabled, loading, error, saveError, clearSaveError,
    claims, progress, reads, pending, keep, review, markSectionRead, refresh,
  }), [enabled, loading, error, saveError, clearSaveError, claims, progress, reads, pending, keep, review, markSectionRead, refresh])

  return (
    <Ctx.Provider value={value}>
      {children}
      {undo && (
        // 取り消しは画面下の1行。カード・モーダルは開かない（読書を止めない）。
        // z-[10010]: 読む画面のオーバレイ（ReaderOverlay の最大 z-[10000]）より上に出す。
        // Node は読む画面の中にあるので、トーストがオーバレイの下に隠れては見えない。
        <div
          role="status"
          aria-live="polite"
          className="fixed left-1/2 -translate-x-1/2 bottom-[86px] z-[10010] flex items-center gap-3 rounded-full border border-brand-500/40 bg-white/95 dark:bg-gray-800/95 px-4 py-2 text-xs text-gray-700 dark:text-gray-200 shadow-lg"
        >
          <span>Recall に残しました</span>
          <button
            type="button"
            className="font-bold text-brand-700 dark:text-brand-300 min-h-[32px] px-1"
            onClick={() => { const id = undo.claimId; setUndo(null); void keep(id, false) }}
          >
            取り消す
          </button>
        </div>
      )}
      {!undo && saveError && (
        // 読む画面での保存失敗はここでしか出せない（RecallScreen は自分の pill で別途表示する）。
        // 画面全体は覆わない。5秒で自動的に消える。
        <div
          role="status"
          aria-live="polite"
          className="fixed left-1/2 -translate-x-1/2 bottom-[86px] z-[10010] rounded-full border border-red-400/40 bg-white/95 dark:bg-gray-800/95 px-4 py-2 text-xs text-red-700 dark:text-red-300 shadow-lg"
        >
          {saveError}
        </div>
      )}
    </Ctx.Provider>
  )
}
