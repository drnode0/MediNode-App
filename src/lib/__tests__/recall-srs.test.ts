import { describe, it, expect } from 'vitest'
import { SRS_INTERVAL_DAYS, newProgress, applyResult, remainingOf, stateOf, pickCandidates, nextDue } from '@/lib/recall/srs'

const d = (iso: string) => new Date(iso)
const day = 86400000

describe('SRS', () => {
  it('段は 1/3/7/14/30/60/120/240/365 で頭打ち', () => {
    expect(SRS_INTERVAL_DAYS).toEqual([1, 3, 7, 14, 30, 60, 120, 240, 365])
    let p = newProgress('c', d('2026-09-02T00:00:00Z'))
    expect(p.intervalDays).toBe(1)
    let t = d('2026-09-03T00:00:00Z')
    const seen: number[] = []
    for (let i = 0; i < 11; i++) { p = applyResult(p, 'ok', t); seen.push(p.intervalDays); t = new Date(t.getTime() + p.intervalDays * day) }
    expect(seen).toEqual([1, 3, 7, 14, 30, 60, 120, 240, 365, 365, 365])
    expect(p.okCount).toBe(11)
  })
  it('「まだ」で段0へ戻り、間隔1日・期限は翌日', () => {
    let p = newProgress('c', d('2026-09-02T00:00:00Z'))
    for (let i = 0; i < 4; i++) p = applyResult(p, 'ok', d('2026-09-10T00:00:00Z'))
    p = applyResult(p, 'ng', d('2026-09-20T00:00:00Z'))
    expect(p).toMatchObject({ streak: 0, intervalDays: 1, lastResult: 'ng', ngCount: 1 })
    expect(p.dueAt).toBe('2026-09-21T00:00:00.000Z')
  })
  it('残りは 1 − 経過/間隔（0..1）。残した直後は 1、期限で 0', () => {
    const p = { ...newProgress('c', d('2026-09-02T00:00:00Z')), intervalDays: 10, lastReviewedAt: '2026-09-02T00:00:00.000Z', dueAt: '2026-09-12T00:00:00.000Z' }
    expect(remainingOf(p, d('2026-09-02T00:00:00Z'))).toBeCloseTo(1)
    expect(remainingOf(p, d('2026-09-07T00:00:00Z'))).toBeCloseTo(0.5)
    expect(remainingOf(p, d('2026-09-20T00:00:00Z'))).toBe(0)
  })
  it('状態: 記録なし→cold、読んだだけ→touched、残した→kept、間隔90日以上→settled、外した→cold/touched', () => {
    const now = d('2026-09-02T00:00:00Z')
    const p = newProgress('c', now)
    expect(stateOf('c', undefined, false, now).kind).toBe('cold')
    expect(stateOf('c', undefined, true, now).kind).toBe('touched')
    expect(stateOf('c', p, false, now).kind).toBe('kept')
    expect(stateOf('c', { ...p, intervalDays: 120 }, false, now).kind).toBe('settled')
    expect(stateOf('c', { ...p, removedAt: now.toISOString() }, true, now).kind).toBe('touched')
  })
  it('離脱候補は残り<0.28 の残した主張を小さい順に最大5。定着も期限が来れば入る。外したものは入らない', () => {
    const now = d('2026-09-30T00:00:00Z')
    const mk = (id: string, intervalDays: number, reviewedDaysAgo: number, removed = false) => ({
      ...newProgress(id, now), intervalDays,
      lastReviewedAt: new Date(now.getTime() - reviewedDaysAgo * day).toISOString(),
      dueAt: new Date(now.getTime() + (intervalDays - reviewedDaysAgo) * day).toISOString(),
      removedAt: removed ? now.toISOString() : null,
    })
    const list = [mk('fresh', 10, 1), mk('due', 10, 12), mk('near', 10, 8), mk('settled-due', 120, 130), mk('removed', 10, 12, true),
      mk('a', 10, 9), mk('b', 10, 9.5), mk('c', 10, 9.9)]
    const got = pickCandidates(list, now).map((p) => p.claimId)
    expect(got).toHaveLength(5)
    expect(got[0]).toBe('due')
    expect(got).toContain('settled-due')
    expect(got).not.toContain('fresh')
    expect(got).not.toContain('removed')
  })
  it('次の期限は最も早い due_at とその日の件数', () => {
    const now = d('2026-09-02T00:00:00Z')
    const a = { ...newProgress('a', now), dueAt: '2026-09-05T00:00:00.000Z' }
    const b = { ...newProgress('b', now), dueAt: '2026-09-05T09:00:00.000Z' }
    const c = { ...newProgress('c', now), dueAt: '2026-09-09T00:00:00.000Z' }
    expect(nextDue([a, b, c], now)).toEqual({ at: d('2026-09-05T00:00:00Z'), count: 2 })
    expect(nextDue([], now)).toBeNull()
  })
})
