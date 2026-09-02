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
  it('次の期限は最も早い due_at とその日の件数（すべて未来のとき）', () => {
    const now = d('2026-09-02T00:00:00Z')
    const a = { ...newProgress('a', now), dueAt: '2026-09-05T00:00:00.000Z' }
    const b = { ...newProgress('b', now), dueAt: '2026-09-05T09:00:00.000Z' }
    const c = { ...newProgress('c', now), dueAt: '2026-09-09T00:00:00.000Z' }
    expect(nextDue([a, b, c], now)).toEqual({ at: d('2026-09-05T00:00:00Z'), count: 2, overdue: false })
    expect(nextDue([], now)).toBeNull()
  })
  it('すべて期限切れなら「今」が答えで、最も古い日だけでなく全件を数える', () => {
    const now = d('2026-09-20T00:00:00Z')
    const a = { ...newProgress('a', now), dueAt: '2026-09-05T00:00:00.000Z' }
    const b = { ...newProgress('b', now), dueAt: '2026-09-11T00:00:00.000Z' }
    const c = { ...newProgress('c', now), dueAt: '2026-09-18T00:00:00.000Z' }
    expect(nextDue([a, b, c], now)).toEqual({ at: now, count: 3, overdue: true })
  })
  it('期限切れと未来が混ざれば期限切れが勝ち、期限切れ全件を数える', () => {
    const now = d('2026-09-20T00:00:00Z')
    const a = { ...newProgress('a', now), dueAt: '2026-09-05T00:00:00.000Z' }
    const b = { ...newProgress('b', now), dueAt: '2026-09-11T00:00:00.000Z' }
    const c = { ...newProgress('c', now), dueAt: '2026-09-25T00:00:00.000Z' }
    const e = { ...newProgress('e', now), dueAt: '2026-10-01T00:00:00.000Z' }
    expect(nextDue([a, b, c, e], now)).toEqual({ at: now, count: 2, overdue: true })
  })
  it('ちょうど now の期限は「期限切れ（今が答え）」に数える', () => {
    const now = d('2026-09-20T00:00:00Z')
    const a = { ...newProgress('a', now), dueAt: '2026-09-20T00:00:00.000Z' }
    const b = { ...newProgress('b', now), dueAt: '2026-09-25T00:00:00.000Z' }
    expect(nextDue([a, b], now)).toEqual({ at: now, count: 1, overdue: true })
  })
  it('同じ日かどうかは日本の暦日で数える（JST 8:00 と 10:30 は同じ日で2件）', () => {
    const now = d('2026-09-01T00:00:00Z')
    // JST 2026-09-05 08:00 / 10:30。UTC では 09-04 と 09-05 に割れる
    const a = { ...newProgress('a', now), dueAt: '2026-09-04T23:00:00.000Z' }
    const b = { ...newProgress('b', now), dueAt: '2026-09-05T01:30:00.000Z' }
    expect(nextDue([a, b], now)).toEqual({ at: d('2026-09-04T23:00:00Z'), count: 2, overdue: false })
  })
  it('日本時間で日をまたげば別の日（JST 23:00 と翌 01:00 は早い方の1件）', () => {
    const now = d('2026-09-01T00:00:00Z')
    // JST 2026-09-05 23:00 / 2026-09-06 01:00。UTC ではどちらも 09-05
    const a = { ...newProgress('a', now), dueAt: '2026-09-05T14:00:00.000Z' }
    const b = { ...newProgress('b', now), dueAt: '2026-09-05T16:00:00.000Z' }
    expect(nextDue([a, b], now)).toEqual({ at: d('2026-09-05T14:00:00Z'), count: 1, overdue: false })
  })
  it('外した主張は期限切れでも未来でも数えない', () => {
    const now = d('2026-09-20T00:00:00Z')
    const rmPast = { ...newProgress('rm-past', now), dueAt: '2026-09-05T00:00:00.000Z', removedAt: now.toISOString() }
    const rmFuture = { ...newProgress('rm-future', now), dueAt: '2026-09-25T00:00:00.000Z', removedAt: now.toISOString() }
    const live = { ...newProgress('live', now), dueAt: '2026-09-25T09:00:00.000Z' }
    // 期限切れは外したものだけ→未来の live が答え。件数にも入らない
    expect(nextDue([rmPast, rmFuture, live], now)).toEqual({ at: d('2026-09-25T09:00:00Z'), count: 1, overdue: false })
    expect(nextDue([rmPast, rmFuture], now)).toBeNull()
  })
})
