'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { RecallClaim, RecallProgress, RecallSectionRead } from '@/lib/recall/types'
import { layoutClaims, centroid, type Vec3 } from '@/lib/recall/layout'
import { stateOf, pickCandidates, nextDue } from '@/lib/recall/srs'
import type { Sprite, Mark } from '@/lib/recall/render'
import { GENRE_SEATS, OTHER_SLOT } from '@/lib/recall/genres'

export function useRecallData() {
  const [claims, setClaims] = useState<RecallClaim[]>([])
  const [progress, setProgress] = useState<RecallProgress[]>([])
  const [reads, setReads] = useState<RecallSectionRead[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => new Date())

  const refresh = useCallback(async () => {
    try {
      const [c, p] = await Promise.all([fetch('/api/recall/claims'), fetch('/api/recall/progress')])
      // 機能が閉じている利用者には claims・progress の両方が本文なしの404で返る
      // （src/lib/recall/guard.ts の notFound()）。存在を教える文言を出さず、
      // エラーにもせず、静かに空のまま終える（スピナーを回し続けない）。
      if (c.status === 404 || p.status === 404) {
        setClaims([]); setProgress([]); setReads([]); setError(null); setNow(new Date())
        return
      }
      if (!c.ok || !p.ok) throw new Error('読み込みに失敗しました')
      const cj = (await c.json()) as { claims: RecallClaim[] }
      const pj = (await p.json()) as { progress: RecallProgress[]; reads: RecallSectionRead[] }
      setClaims(cj.claims); setProgress(pj.progress); setReads(pj.reads); setError(null); setNow(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const positions = useMemo(() => layoutClaims(claims), [claims])
  const progressById = useMemo(() => new Map(progress.map((p) => [p.claimId, p])), [progress])
  const readSet = useMemo(() => new Set(reads.map((r) => `${r.pageId}#${r.sectionKey}`)), [reads])

  const sprites: Sprite[] = useMemo(() => claims.map((c, i) => ({
    claimId: c.claimId, home: positions.get(c.claimId) as Vec3,
    state: stateOf(c.claimId, progressById.get(c.claimId), readSet.has(`${c.pageId}#${c.sectionKey}`), now),
    phase: (i % 628) / 100,
  })), [claims, positions, progressById, readSet, now])

  const marks: Mark[] = useMemo(() => {
    const byPage = new Map<string, Vec3[]>(), bySlot = new Map<number, Vec3[]>()
    for (const c of claims) {
      const v = positions.get(c.claimId)!
      if (!byPage.has(c.pageId)) byPage.set(c.pageId, []); byPage.get(c.pageId)!.push(v)
      if (!bySlot.has(c.genreSlot)) bySlot.set(c.genreSlot, []); bySlot.get(c.genreSlot)!.push(v)
    }
    const titleOf = new Map(claims.map((c) => [c.pageId, c.pageTitle]))
    const pages: Mark[] = [...byPage].map(([id, vs]) => ({ text: (titleOf.get(id) ?? '').replace(/^[^\s]*\s/, '').slice(0, 22), v: centroid(vs), level: 'page', n: vs.length }))
    const genres: Mark[] = [...bySlot].map(([slot, vs]) => ({ text: slot === OTHER_SLOT ? 'その他' : GENRE_SEATS[slot].replace(/^\d+\./, ''), v: centroid(vs), level: 'genre', n: vs.length }))
    return [...pages, ...genres]
  }, [claims, positions])

  const counts = useMemo(() => {
    const c = { kept: 0, touched: 0, cold: 0, settled: 0 }
    for (const s of sprites) c[s.state.kind]++
    return c
  }, [sprites])

  const candidates = useMemo(() => pickCandidates(progress, now), [progress, now])
  // nextDue は { at, count, overdue } を返す（Task 8 以降の現行シグネチャ）。overdue=true は
  // 「すでに期限切れが count 件ある＝今すぐ」、false は「次の期限は at で、その日に count 件」。
  // ここでは加工せずそのまま通す。呼び出し側（画面）が overdue を見て「いま◯件」と
  // 「◯日後に◯件」を出し分ける。
  const due = useMemo(() => nextDue(progress, now), [progress, now])

  const keep = useCallback(async (claimId: string, keepIt: boolean) => {
    const res = await fetch('/api/recall/keep', { method: 'POST', body: JSON.stringify({ claimId, keep: keepIt }) })
    if (!res.ok) throw new Error('保存に失敗しました')
    const { progress: p } = (await res.json()) as { progress: RecallProgress }
    setProgress((prev) => [...prev.filter((x) => x.claimId !== claimId), p]); setNow(new Date())
  }, [])

  const review = useCallback(async (claimId: string, result: 'ok' | 'ng') => {
    const res = await fetch('/api/recall/review', { method: 'POST', body: JSON.stringify({ claimId, result }) })
    if (!res.ok) throw new Error('保存に失敗しました')
    const { progress: p } = (await res.json()) as { progress: RecallProgress }
    setProgress((prev) => [...prev.filter((x) => x.claimId !== claimId), p]); setNow(new Date())
  }, [])

  return { loading, error, claims, sprites, marks, progressById, candidates, nextDue: due, counts, keep, review, refresh }
}
