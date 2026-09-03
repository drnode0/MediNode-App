'use client'
import { useEffect, useMemo, useState } from 'react'
import { useRecallStore } from '@/components/recall/RecallProvider'
import { layoutClaims, strandsOf, centroid, type Vec3 } from '@/lib/recall/layout'
import { stateOf, pickCandidates, nextDue } from '@/lib/recall/srs'
import type { Sprite, Mark } from '@/lib/recall/render'
import { genreLabel } from '@/lib/recall/genres'

const TICK_MS = 60_000 // 「記憶の残り」と期限は時間で動く。操作がなくても進める（間隔は日単位なので1分で足りる）

// 取得・保存は RecallProvider が持つ（読む画面と Recall 画面が同じ在庫を見るため）。
// このフックは Recall 画面専用の導出（配置・粒・目印・候補・期限）だけを担う。
export function useRecallData() {
  const { claims, progress, reads, loading, error, saveError, clearSaveError, keep, review, refresh } = useRecallStore()
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS)
    return () => clearInterval(id)
  }, [])
  // 保存のたびに「記憶の残り」を計算し直す（間隔・期限が変わった直後の見た目を合わせる）。
  useEffect(() => { setNow(new Date()) }, [progress])

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

  return { loading, error, saveError, clearSaveError, claims, sprites, marks, strands, progressById, candidates, nextDue: due, counts, keep, review, refresh }
}
