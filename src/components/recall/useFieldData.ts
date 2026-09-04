'use client'
// 惑星の画面ぶんの導出だけを担うフック。取得・保存は RecallProvider が持つ
//（読む画面と Recall 画面が同じ在庫を見るため）。
//
// 球の useRecallData と同じ立ち位置で、球のらせん・かけら・枝の代わりに
// 惑星（席）・輪の上の点・記事の扇形を作る。
import { useEffect, useMemo, useState } from 'react'
import { useRecallStore } from '@/components/recall/RecallProvider'
import { stateOf, pickCandidates, nextDue, type SeatFilter } from '@/lib/recall/srs'
import { fieldLayout, type FieldSeat } from '@/lib/recall/field'
import { planetSummary, isEscaping } from '@/lib/recall/field-layout'
import { fanOf, type PageFan } from '@/lib/recall/field-angle'
import { GENRE_SEATS } from '@/lib/recall/genres'
import type { ClaimDot, Planet } from '@/lib/recall/field-render'
import type { RecallState } from '@/lib/recall/types'

const TICK_MS = 60_000 // 「記憶の残り」と期限は時間で動く。操作がなくても進める

// 主張IDから決まる 0..1。同期で並びが変わっても、同じ主張は同じ揺れ方・同じ明滅になる。
function hashOf(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0
  return (h >>> 0) / 4294967296
}

export type BandSeat = { slot: number; label: string; n: number; escaping: number }

export function useFieldData() {
  const { claims, progress, reads, loading, error, saveError, clearSaveError, keep, review } = useRecallStore()
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), TICK_MS)
    return () => clearInterval(id)
  }, [])
  // 保存のたびに「記憶の残り」を計算し直す（間隔・期限が変わった直後の見た目を合わせる）。
  useEffect(() => { setNow(new Date()) }, [progress])

  const claimById = useMemo(() => new Map(claims.map((c) => [c.claimId, c])), [claims])
  const slotOf = useMemo(() => {
    const m = new Map(claims.map((c) => [c.claimId, c.genreSlot]))
    return (claimId: string) => m.get(claimId)
  }, [claims])

  const bySlot = useMemo(() => {
    const m = new Map<number, typeof claims>()
    for (const c of claims) {
      const list = m.get(c.genreSlot)
      if (list) list.push(c)
      else m.set(c.genreSlot, [c])
    }
    return m
  }, [claims])

  const seats: FieldSeat[] = useMemo(() => {
    const counts = new Array(GENRE_SEATS.length).fill(0)
    for (const [slot, list] of bySlot) if (slot < counts.length) counts[slot] = list.length
    return fieldLayout(counts)
  }, [bySlot])

  // 記事の扇形は主張の並びだけで決まる。now では作り直さない。
  const fans = useMemo(() => {
    const m = new Map<number, { pages: PageFan[]; angles: Map<string, number> }>()
    for (const [slot, list] of bySlot) m.set(slot, fanOf(list))
    return m
  }, [bySlot])

  const progressById = useMemo(() => new Map(progress.map((p) => [p.claimId, p])), [progress])
  const readSet = useMemo(() => new Set(reads.map((r) => `${r.pageId}#${r.sectionKey}`)), [reads])

  const stateById = useMemo(() => {
    const m = new Map<string, RecallState>()
    for (const c of claims) {
      m.set(c.claimId, stateOf(c.claimId, progressById.get(c.claimId), readSet.has(`${c.pageId}#${c.sectionKey}`), now))
    }
    return m
  }, [claims, progressById, readSet, now])

  const planets: Planet[] = useMemo(() => seats.map((seat) => {
    const list = bySlot.get(seat.slot) ?? []
    const fan = fans.get(seat.slot)
    const keptRemainings: number[] = []
    let escaping = 0
    const dots: ClaimDot[] = list.map((c) => {
      const state = stateById.get(c.claimId) ?? { kind: 'cold' as const, remaining: 0 }
      if (state.kind === 'kept' || state.kind === 'settled') keptRemainings.push(state.remaining)
      if (isEscaping(state.kind, state.remaining)) escaping++
      const h = hashOf(c.claimId)
      return {
        claimId: c.claimId,
        pageId: c.pageId,
        state,
        angle: fan?.angles.get(c.claimId) ?? 0,
        jitter: (h - 0.5) * 0.14,
        phase: h * Math.PI * 2,
      }
    })
    return {
      seat,
      summary: planetSummary({ total: list.length, keptRemainings, escaping }),
      dots,
      pages: fan?.pages,
    }
  }), [seats, bySlot, fans, stateById])

  const escapingBySlot = useMemo(() => {
    const m = new Map<number, number>()
    for (const p of planets) m.set(p.seat.slot, p.summary.halos)
    return m
  }, [planets])

  // 帯。主張のある席を先頭に席番号順、空の席は末尾（畳むのは画面側）。
  const band: BandSeat[] = useMemo(() => seats.map((s) => ({
    slot: s.slot, label: s.label, n: s.n, escaping: escapingBySlot.get(s.slot) ?? 0,
  })), [seats, escapingBySlot])

  // 数えるのは「いま画面で開ける主張」だけ。同期でページが外れると記録だけが残り、
  // 「いま確かめる主張はありません」と「期限が来ている主張が N 件」が同時に出る。
  const claimIdSet = useMemo(() => new Set(claims.map((c) => c.claimId)), [claims])
  const openable = useMemo(() => progress.filter((p) => claimIdSet.has(p.claimId)), [progress, claimIdSet])

  const seatFilter = (slot: number): SeatFilter => ({ slot, slotOf })
  const candidatesOf = (slot: number | null) =>
    pickCandidates(openable, now, undefined, slot === null ? undefined : seatFilter(slot))
  const nextDueOf = (slot: number | null) =>
    nextDue(openable, now, slot === null ? undefined : seatFilter(slot))

  const counts = useMemo(() => {
    const c = { kept: 0, touched: 0, cold: 0, settled: 0 }
    for (const s of stateById.values()) c[s.kind]++
    return c
  }, [stateById])

  return {
    loading, error, saveError, clearSaveError, keep, review,
    claims, claimById, seats, planets, band, counts,
    progressById, candidatesOf, nextDueOf,
  }
}
