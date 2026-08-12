// quiz-srs（間隔反復）のテスト。
// 仕様: 覚えた連続で 1/3/7/14/30日 と間隔が伸び、「まだ」で即時に戻る。
// 出題順は 期限到来 → 未学習 → 期限前。旧データ（due欠損）でも壊れない。
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// localStorage モック（Node環境・personal-data.test.ts と同方式）
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})

import { recordQuizResult, weightedQuizOrder, intervalLabelFor, getQuizStat } from '../quiz-srs'

const NOW = new Date('2026-08-12T03:00:00Z')

describe('quiz-srs 間隔反復', () => {
  beforeEach(() => {
    store.clear()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
  })
  afterEach(() => vi.useRealTimers())

  it('覚えた連続でdueが 1→3→7→14→30日 と伸びる', () => {
    const days = (iso: string) => Math.round((Date.parse(iso) - NOW.getTime()) / 86_400_000)
    expect(days(recordQuizResult('a', true).due!)).toBe(1)
    expect(days(recordQuizResult('a', true).due!)).toBe(3)
    expect(days(recordQuizResult('a', true).due!)).toBe(7)
    expect(days(recordQuizResult('a', true).due!)).toBe(14)
    expect(days(recordQuizResult('a', true).due!)).toBe(30)
    expect(days(recordQuizResult('a', true).due!)).toBe(30) // 6回目以降も30日で頭打ち
  })

  it('まだ でstreakが0に戻り、dueは今', () => {
    recordQuizResult('a', true)
    const s = recordQuizResult('a', false)
    expect(s.streak).toBe(0)
    expect(Date.parse(s.due!)).toBe(NOW.getTime())
  })

  it('出題順: 期限到来 → 未学習 → 期限前', () => {
    recordQuizResult('due-now', false) // due=今
    recordQuizResult('later', true) // due=明日
    const order = weightedQuizOrder(
      [{ objectID: 'later' }, { objectID: 'fresh' }, { objectID: 'due-now' }],
      NOW.getTime(),
    ).map((h) => h.objectID)
    expect(order).toEqual(['due-now', 'fresh', 'later'])
  })

  it('期限が来た「覚えた」カードは先頭グループに戻る', () => {
    recordQuizResult('a', true) // due=明日
    const dayAfter = NOW.getTime() + 2 * 86_400_000
    const order = weightedQuizOrder([{ objectID: 'a' }, { objectID: 'fresh' }], dayAfter).map(
      (h) => h.objectID,
    )
    expect(order).toEqual(['a', 'fresh'])
  })

  it('旧データ（due欠損）は落ちない: ng→期限到来 / ok→期限前', () => {
    store.set(
      'medinode_quiz_stats',
      JSON.stringify({
        oldNg: { ok: 0, ng: 1, last: '2026-08-01T00:00:00Z', lastResult: 'ng' },
        oldOk: { ok: 1, ng: 0, last: '2026-08-01T00:00:00Z', lastResult: 'ok' },
      }),
    )
    const order = weightedQuizOrder(
      [{ objectID: 'oldOk' }, { objectID: 'oldNg' }],
      NOW.getTime(),
    ).map((h) => h.objectID)
    expect(order).toEqual(['oldNg', 'oldOk'])
    expect(getQuizStat('oldNg')?.streak).toBeUndefined() // 読み出しで旧データを書き換えない
  })

  it('intervalLabelFor', () => {
    expect(intervalLabelFor(1)).toBe('明日')
    expect(intervalLabelFor(2)).toBe('3日後')
    expect(intervalLabelFor(3)).toBe('1週間後')
    expect(intervalLabelFor(4)).toBe('2週間後')
    expect(intervalLabelFor(5)).toBe('1か月後')
    expect(intervalLabelFor(9)).toBe('1か月後')
  })
})
