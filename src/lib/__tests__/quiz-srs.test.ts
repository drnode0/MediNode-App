// クイズSRS（まだ→未学習→覚えた の出題順）のテスト。
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { recordQuizResult, weightedQuizOrder } from '../quiz-srs'

// localStorage モック（Node環境）。
const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
})

const hits = [{ objectID: 'a' }, { objectID: 'b' }, { objectID: 'c' }, { objectID: 'd' }]

beforeEach(() => store.clear())

describe('weightedQuizOrder', () => {
  it('記録なしなら全件が返る（欠落しない）', () => {
    const order = weightedQuizOrder(hits)
    expect(order.map((h) => h.objectID).sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('「まだ」→未学習→「覚えた」の順に並ぶ', () => {
    recordQuizResult('b', true) // 覚えた
    recordQuizResult('c', false) // まだ
    const order = weightedQuizOrder(hits).map((h) => h.objectID)
    expect(order[0]).toBe('c') // まだ が先頭
    expect(order[3]).toBe('b') // 覚えた が末尾
  })

  it('最後の申告が優先される（まだ→覚えた で末尾グループへ）', () => {
    recordQuizResult('c', false)
    recordQuizResult('c', true)
    const order = weightedQuizOrder(hits).map((h) => h.objectID)
    expect(order.indexOf('c')).toBe(3) // 唯一の「覚えた」なので末尾
  })
})
