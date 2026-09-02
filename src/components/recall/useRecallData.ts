'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RecallClaim, RecallProgress, RecallSectionRead } from '@/lib/recall/types'
import { layoutClaims, strandsOf, centroid, type Vec3 } from '@/lib/recall/layout'
import { stateOf, pickCandidates, nextDue } from '@/lib/recall/srs'
import type { Sprite, Mark } from '@/lib/recall/render'
import { genreLabel } from '@/lib/recall/genres'

// 反映の順番を守る門。読み込みは始めるときに番号を取り、応答が届いたときに自分が
// 最新でなければ捨てる。残す・確かめるの保存も番号を進めるので、保存より前に始まった
// 読み込みの古い一覧が、いま保存したばかりの1件を巻き戻すことがない。
// （React 18 の StrictMode は初回に読み込みを2本走らせるので、番号なしでは実際に起きる）
type Gate = { issue: () => number; isLatest: (id: number) => boolean }
function createGate(): Gate {
  let seq = 0
  return { issue: () => ++seq, isLatest: (id: number) => id === seq }
}

const TICK_MS = 60_000 // 「記憶の残り」と期限は時間で動く。操作がなくても進める（間隔は日単位なので1分で足りる）

export function useRecallData() {
  const [claims, setClaims] = useState<RecallClaim[]>([])
  const [progress, setProgress] = useState<RecallProgress[]>([])
  const [reads, setReads] = useState<RecallSectionRead[]>([])
  const [loading, setLoading] = useState(true)
  // error は「読み込みに失敗した＝出すものが無い」ときだけ。保存の失敗（一度の通信の途切れ）は
  // saveError に分ける。同じ入れ物にすると、一度の保存失敗で画面全体を覆う知らせが出続け、
  // そのあとの操作がすべて効かなくなる。
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  const gateRef = useRef<Gate | null>(null)
  if (!gateRef.current) gateRef.current = createGate()
  const aliveRef = useRef(true)
  const abortRef = useRef<AbortController | null>(null)

  const refresh = useCallback(async () => {
    const gate = gateRef.current!
    const id = gate.issue()
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    // 応答を state に入れてよいのは「まだ生きていて、自分が最新」のときだけ
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
        setClaims([]); setProgress([]); setReads([]); setError(null); setNow(new Date())
        return
      }
      if (!c.ok || !p.ok) throw new Error('読み込みに失敗しました')
      const cj = (await c.json()) as { claims: RecallClaim[] }
      const pj = (await p.json()) as { progress: RecallProgress[]; reads: RecallSectionRead[] }
      if (!usable()) return
      setClaims(cj.claims); setProgress(pj.progress); setReads(pj.reads); setError(null); setNow(new Date())
    } catch (e) {
      // 打ち切り（画面を離れた・新しい読み込みが始まった）は失敗ではない
      if (ac.signal.aborted || !usable()) return
      setError(e instanceof Error ? e.message : '読み込みに失敗しました')
    } finally {
      // スピナーは「最初の読み込みが終わったか」だけを見る。どの応答を採ったかとは別。
      if (aliveRef.current && !ac.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    aliveRef.current = true
    void refresh()
    return () => { aliveRef.current = false; abortRef.current?.abort() }
  }, [refresh])

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS)
    return () => clearInterval(id)
  }, [])

  // 配置は主張の並びだけで決まる。now では作り直さない（数百件で数ミリ秒かかる）。
  const positions = useMemo(() => layoutClaims(claims), [claims])
  // 枝（同じページの主張を繋ぐ筋）。配置と同じで、記憶の状態では変わらない。
  const strands = useMemo(() => strandsOf(claims, positions), [claims, positions])
  const progressById = useMemo(() => new Map(progress.map((p) => [p.claimId, p])), [progress])
  const readSet = useMemo(() => new Set(reads.map((r) => `${r.pageId}#${r.sectionKey}`)), [reads])

  // ゆらぎの位相。並び順ではなく主張IDから決める（同期で並びが変わっても同じ主張は同じ揺れ方）。
  const phaseById = useMemo(() => new Map(claims.map((c) => {
    let h = 0
    for (let i = 0; i < c.claimId.length; i++) h = (Math.imul(h, 31) + c.claimId.charCodeAt(i)) | 0
    return [c.claimId, ((h >>> 0) % 6283) / 1000]
  })), [claims])

  const sprites: Sprite[] = useMemo(() => claims.map((c) => {
    const p = positions.get(c.claimId)!
    return {
      claimId: c.claimId, home: p.v, dir: p.dir, scale: p.scale, variant: p.variant,
      state: stateOf(c.claimId, progressById.get(c.claimId), readSet.has(`${c.pageId}#${c.sectionKey}`), now),
      phase: phaseById.get(c.claimId) ?? 0,
    }
  }), [claims, positions, progressById, readSet, now, phaseById])

  const marks: Mark[] = useMemo(() => {
    const byPage = new Map<string, Vec3[]>(), bySlot = new Map<number, Vec3[]>()
    for (const c of claims) {
      const v = positions.get(c.claimId)!.v
      if (!byPage.has(c.pageId)) byPage.set(c.pageId, []); byPage.get(c.pageId)!.push(v)
      if (!bySlot.has(c.genreSlot)) bySlot.set(c.genreSlot, []); bySlot.get(c.genreSlot)!.push(v)
    }
    const titleOf = new Map(claims.map((c) => [c.pageId, c.pageTitle]))
    const pages: Mark[] = [...byPage].map(([id, vs]) => ({ text: (titleOf.get(id) ?? '').replace(/^[^\s]*\s/, '').slice(0, 22), v: centroid(vs), level: 'page', n: vs.length }))
    const genres: Mark[] = [...bySlot].map(([slot, vs]) => ({ text: genreLabel(slot), v: centroid(vs), level: 'genre', n: vs.length }))
    return [...pages, ...genres]
  }, [claims, positions])

  const counts = useMemo(() => {
    const c = { kept: 0, touched: 0, cold: 0, settled: 0 }
    for (const s of sprites) c[s.state.kind]++
    return c
  }, [sprites])

  // 数えるのは「いま画面で開ける主張」だけ。同期でページが外れると、記録だけが残って
  // 主張が無い状態になる。素の progress を数えると「いま確かめる主張はありません」と
  // 「期限が来ている主張が N 件」が同時に出て、画面が自分と食い違う。
  const claimIdSet = useMemo(() => new Set(claims.map((c) => c.claimId)), [claims])
  const openable = useMemo(() => progress.filter((p) => claimIdSet.has(p.claimId)), [progress, claimIdSet])

  const candidates = useMemo(() => pickCandidates(openable, now), [openable, now])
  // nextDue は { at, count, overdue } を返す（Task 8 以降の現行シグネチャ）。overdue=true は
  // 「すでに期限切れが count 件ある＝今すぐ」、false は「次の期限は at で、その日に count 件」。
  // ここでは加工せずそのまま通す。呼び出し側（画面）が overdue を見て「いま◯件」と
  // 「◯日後に◯件」を出し分ける。
  const due = useMemo(() => nextDue(openable, now), [openable, now])

  // 残す・確かめるの保存。失敗は error にも出す（呼び出し側が投げっぱなしでも黙って消えない）。
  const save = useCallback(async (path: string, claimId: string, body: unknown) => {
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('保存に失敗しました')
      const { progress: p } = (await res.json()) as { progress: RecallProgress }
      if (!aliveRef.current) return
      gateRef.current!.issue() // これより前に始まった読み込みの応答は、この1件を巻き戻さない
      setProgress((prev) => [...prev.filter((x) => x.claimId !== claimId), p]); setNow(new Date())
      setSaveError(null) // 次に成功した操作で、前の失敗の知らせを消す
    } catch (e) {
      if (aliveRef.current) setSaveError(e instanceof Error ? e.message : '保存に失敗しました')
      throw e
    }
  }, [])

  const clearSaveError = useCallback(() => setSaveError(null), [])

  const keep = useCallback((claimId: string, keepIt: boolean) => save('/api/recall/keep', claimId, { claimId, keep: keepIt }), [save])
  const review = useCallback((claimId: string, result: 'ok' | 'ng') => save('/api/recall/review', claimId, { claimId, result }), [save])

  return { loading, error, saveError, clearSaveError, claims, sprites, marks, strands, progressById, candidates, nextDue: due, counts, keep, review, refresh }
}
