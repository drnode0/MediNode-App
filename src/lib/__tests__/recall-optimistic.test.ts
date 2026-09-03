import { describe, it, expect } from 'vitest'
import { keepOptimistic, replaceProgress, readOptimistic, removeRead } from '@/lib/recall/optimistic'
import type { RecallProgress } from '@/lib/recall/types'

const NOW = new Date('2026-09-10T03:00:00.000Z')
const row = (claimId: string, over: Partial<RecallProgress> = {}): RecallProgress => ({
  claimId, keptAt: '2026-09-01T00:00:00.000Z', streak: 3, intervalDays: 7,
  dueAt: '2026-09-08T00:00:00.000Z', lastReviewedAt: '2026-09-01T00:00:00.000Z',
  lastResult: 'ok', okCount: 3, ngCount: 0, removedAt: null, ...over,
})

describe('残すの楽観反映', () => {
  it('記録が無い主張を残すと、間隔1日・期限翌日の行がその場で増える', () => {
    const next = keepOptimistic([], 'c1', true, NOW)
    expect(next).toHaveLength(1)
    expect(next[0].claimId).toBe('c1')
    expect(next[0].intervalDays).toBe(1)
    expect(next[0].removedAt).toBeNull()
  })

  it('外していた主張を残し直すと、段と間隔を引き継いだまま removedAt だけ外れる', () => {
    const prev = [row('c1', { removedAt: '2026-09-05T00:00:00.000Z' })]
    const next = keepOptimistic(prev, 'c1', true, NOW)
    expect(next[0].streak).toBe(3)
    expect(next[0].intervalDays).toBe(7)
    expect(next[0].removedAt).toBeNull()
  })

  it('外すと removedAt が立つが、行そのものは消えない（再開の履歴を消さない）', () => {
    const next = keepOptimistic([row('c1')], 'c1', false, NOW)
    expect(next).toHaveLength(1)
    expect(next[0].removedAt).toBe(NOW.toISOString())
  })

  it('元の配列を書き換えない（失敗したときに巻き戻せる必要がある）', () => {
    const prev = [row('c1')]
    keepOptimistic(prev, 'c1', false, NOW)
    expect(prev[0].removedAt).toBeNull()
  })
})

describe('サーバーの答えで置き換える', () => {
  it('同じ主張の行を、返ってきた行で入れ替える（重複させない）', () => {
    const server = row('c1', { streak: 4, intervalDays: 14 })
    const next = replaceProgress([row('c1'), row('c2')], server)
    expect(next).toHaveLength(2)
    expect(next.find((p) => p.claimId === 'c1')!.intervalDays).toBe(14)
  })
})

describe('読んだの楽観反映', () => {
  it('同じ節を二度押しても1行のまま', () => {
    const a = readOptimistic([], 'pg', 'sec1', NOW)
    const b = readOptimistic(a, 'pg', 'sec1', NOW)
    expect(b).toHaveLength(1)
  })

  it('ページIDはダッシュ無し・小文字に揃えて持つ（記録側と同じ形）', () => {
    const a = readOptimistic([], 'AB-CD', 'sec1', NOW)
    expect(a[0].pageId).toBe('abcd')
  })

  it('失敗したら、いま足した行だけを取り消せる', () => {
    const a = readOptimistic([{ pageId: 'x', sectionKey: 'sec1', readAt: '2026-01-01T00:00:00.000Z' }], 'pg', 'sec2', NOW)
    const b = removeRead(a, 'pg', 'sec2')
    expect(b).toHaveLength(1)
    expect(b[0].pageId).toBe('x')
  })
})
