import { describe, it, expect } from 'vitest'
import {
  normalizeQuestion,
  buildDispatchStates,
  dispatchLabel,
  type SentCq,
} from '../cq-dispatch'

const sent = (over: Partial<SentCq> & { objectID: string }): SentCq => ({
  question: 'CHDFの開始タイミングは何で決めるのか',
  sentAt: '2026-08-01T00:00:00.000Z',
  ...over,
})

describe('normalizeQuestion', () => {
  it('前後の空白と連続する空白を潰す', () => {
    expect(normalizeQuestion('  CHDFの  開始タイミングは ')).toBe('CHDFの 開始タイミングは')
  })
})

describe('buildDispatchStates', () => {
  it('板に載っていれば票数を持つ', () => {
    const states = buildDispatchStates(
      [sent({ objectID: 'personal_a' })],
      [{ title: 'CHDFの開始タイミングは何で決めるのか', voteCount: 3 }],
    )
    expect(states.personal_a).toEqual({ sentAt: '2026-08-01T00:00:00.000Z', voteCount: 3 })
  })

  it('板に載っていなければ voteCount は null（送った記録だけ残る）', () => {
    const states = buildDispatchStates([sent({ objectID: 'personal_a' })], [])
    expect(states.personal_a.voteCount).toBeNull()
  })

  it('票が0でも板に載っていれば0として区別する', () => {
    const states = buildDispatchStates(
      [sent({ objectID: 'personal_a' })],
      [{ title: 'CHDFの開始タイミングは何で決めるのか', voteCount: 0 }],
    )
    expect(states.personal_a.voteCount).toBe(0)
  })

  it('空白の違いは同じ問いとして突き合わせる', () => {
    const states = buildDispatchStates(
      [sent({ objectID: 'personal_a', question: 'CHDFの 開始タイミングは' })],
      [{ title: '  CHDFの  開始タイミングは  ', voteCount: 2 }],
    )
    expect(states.personal_a.voteCount).toBe(2)
  })

  it('送っていない泡は状態を持たない', () => {
    const states = buildDispatchStates([sent({ objectID: 'personal_a' })], [])
    expect(states.personal_b).toBeUndefined()
  })
})

describe('dispatchLabel', () => {
  it('票がついていれば人数を出す', () => {
    expect(dispatchLabel({ sentAt: '', voteCount: 3 })).toBe('3人が同じことを気にしています')
  })

  it('票が0なら数字を出さない（0人が気になる、を見せない）', () => {
    expect(dispatchLabel({ sentAt: '', voteCount: 0 })).toBe('作者に届いています')
    expect(dispatchLabel({ sentAt: '', voteCount: null })).toBe('作者に届いています')
  })

  it('送った記録が無ければ何も出さない', () => {
    expect(dispatchLabel(undefined)).toBe('')
  })
})
