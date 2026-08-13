import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  pickPrefetchTargets,
  schedulePrefetch,
  PREFETCH_LIMIT_SUBSCRIPTION,
  PREFETCH_LIMIT_PERSONAL,
  PREFETCH_SETTLE_MS,
  type PrefetchCandidate,
} from '../reader-prefetch-plan'

const sub = (n: number): PrefetchCandidate => ({ objectID: `subscription_s${n}`, owner: 'subscription' })
const mine = (n: number): PrefetchCandidate => ({ objectID: `personal_p${n}`, owner: 'personal' })
const all = () => true

describe('pickPrefetchTargets（先読みするヒットの選定）', () => {
  it('アプリ内リーダーで開けないヒットは選ばない', () => {
    const hits = [sub(1), mine(1)]
    expect(pickPrefetchTargets(hits, () => false)).toEqual([])
  })

  it('サブスクは上位3件まで（サーバー側の共有キャッシュに載るので多めでよい）', () => {
    const hits = [sub(1), sub(2), sub(3), sub(4), sub(5)]
    expect(PREFETCH_LIMIT_SUBSCRIPTION).toBe(3)
    expect(pickPrefetchTargets(hits, all)).toEqual([
      'subscription_s1',
      'subscription_s2',
      'subscription_s3',
    ])
  })

  it('個人・部署は1件まで（本人のNotionトークンで毎回叩くのでレート制限を踏まない）', () => {
    const hits = [mine(1), mine(2), mine(3)]
    expect(PREFETCH_LIMIT_PERSONAL).toBe(1)
    expect(pickPrefetchTargets(hits, all)).toEqual(['personal_p1'])
  })

  it('上限は owner ごとに独立して数える', () => {
    const hits = [mine(1), sub(1), mine(2), sub(2), sub(3), sub(4)]
    expect(pickPrefetchTargets(hits, all)).toEqual([
      'personal_p1',
      'subscription_s1',
      'subscription_s2',
      'subscription_s3',
    ])
  })

  it('節レコードは親ページIDに解決する（#secN は本文APIに渡せない）', () => {
    const hits: PrefetchCandidate[] = [
      { objectID: 'subscription_abc#sec2', owner: 'subscription', recordType: 'section', parentId: 'subscription_abc' },
    ]
    expect(pickPrefetchTargets(hits, all)).toEqual(['subscription_abc'])
  })

  it('親が同じ節が複数ヒットしても1件に畳み、その分の枠を他へ回す', () => {
    const hits: PrefetchCandidate[] = [
      { objectID: 'subscription_abc#sec1', owner: 'subscription', recordType: 'section', parentId: 'subscription_abc' },
      { objectID: 'subscription_abc#sec2', owner: 'subscription', recordType: 'section', parentId: 'subscription_abc' },
      sub(9),
    ]
    expect(pickPrefetchTargets(hits, all)).toEqual(['subscription_abc', 'subscription_s9'])
  })

  it('parentId が無い節レコードは objectID のまま扱う（欠損データで落とさない）', () => {
    const hits: PrefetchCandidate[] = [{ objectID: 'subscription_x', owner: 'subscription', recordType: 'section' }]
    expect(pickPrefetchTargets(hits, all)).toEqual(['subscription_x'])
  })

  it('owner ごとに1回しか判定しない（isTargetはlocalStorageを読むため）', () => {
    const isTarget = vi.fn(() => true)
    pickPrefetchTargets([sub(1), sub(2), sub(3), mine(1), mine(2)], isTarget)
    expect(isTarget).toHaveBeenCalledTimes(2) // subscription と personal の2回だけ
  })

  it('空配列は空を返す', () => {
    expect(pickPrefetchTargets([], all)).toEqual([])
  })
})

describe('schedulePrefetch（入力が落ち着くまで待つ）', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('待ち時間が経つまでは1件も撃たない', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    schedulePrefetch(['a', 'b'], run)
    vi.advanceTimersByTime(PREFETCH_SETTLE_MS - 1)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run.mock.calls.map((c) => c[0])).toEqual(['a', 'b'])
  })

  it('待ち時間の途中で取り消すと1件も撃たない（打鍵で結果が入れ替わったとき）', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const cancel = schedulePrefetch(['a'], run)
    vi.advanceTimersByTime(PREFETCH_SETTLE_MS - 100)
    cancel()
    vi.advanceTimersByTime(10_000)
    expect(run).not.toHaveBeenCalled()
  })

  it('連続で入れ替わっても、最後の1回ぶんだけが撃たれる', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    // 100msごとに結果が差し替わる状況（useEffect の cleanup → 再スケジュール）を再現する。
    let cancel = schedulePrefetch(['c'], run)
    for (const ids of [['d'], ['e'], ['f']]) {
      vi.advanceTimersByTime(100)
      cancel()
      cancel = schedulePrefetch(ids, run)
    }
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(PREFETCH_SETTLE_MS)
    expect(run.mock.calls.map((c) => c[0])).toEqual(['f'])
  })

  it('空配列なら何も予約しない（取り消しも安全）', () => {
    vi.useFakeTimers()
    const run = vi.fn()
    const cancel = schedulePrefetch([], run)
    vi.advanceTimersByTime(10_000)
    expect(run).not.toHaveBeenCalled()
    expect(() => cancel()).not.toThrow()
  })
})
