import { describe, it, expect } from 'vitest'
import {
  normalizeQuestion,
  buildDispatchStates,
  dispatchLabel,
  type SentCq,
} from '../cq-dispatch'

const QUESTION = 'CHDFの開始タイミングは何で決めるのか'

const cq = (objectID: string, title = QUESTION) => ({ objectID, title })

const sent = (over: Partial<SentCq> & { objectID: string }): SentCq => ({
  question: QUESTION,
  sentAt: '2026-08-01T00:00:00.000Z',
  ...over,
})

const submission = (over: Partial<{
  question: string
  stage: 'received' | 'onBoard' | 'answered' | 'closed'
  voteCount: number
  createdAt: string
}> = {}) => ({
  question: QUESTION,
  stage: 'received' as const,
  voteCount: 0,
  createdAt: '2026-07-20T00:00:00.000Z',
  ...over,
})

describe('normalizeQuestion', () => {
  it('前後の空白と連続する空白を潰す', () => {
    expect(normalizeQuestion('  CHDFの  開始タイミングは ')).toBe('CHDFの 開始タイミングは')
  })
})

describe('buildDispatchStates', () => {
  it('端末に記録が無くても、題が一致すればサーバー側の状態が出る（別端末で見ても残る）', () => {
    const states = buildDispatchStates([cq('personal_a')], [], [submission({ stage: 'onBoard', voteCount: 3 })])
    expect(states.personal_a).toMatchObject({ stage: 'onBoard', voteCount: 3 })
  })

  it('板に出ていない段では票を出さない（0票と「まだ出ていない」を混ぜない）', () => {
    const states = buildDispatchStates([cq('personal_a')], [], [submission({ stage: 'received', voteCount: 0 })])
    expect(states.personal_a.voteCount).toBeNull()
  })

  it('解決済みは answered として出る', () => {
    const states = buildDispatchStates([cq('personal_a')], [], [submission({ stage: 'answered' })])
    expect(states.personal_a.stage).toBe('answered')
  })

  it('モーダルで書き換えて送った分は、その端末の記録の文で当てる', () => {
    const states = buildDispatchStates(
      [cq('personal_a', '別の題に変えたCQ')],
      [sent({ objectID: 'personal_a', question: '送るときに書き直した疑問文' })],
      [submission({ question: '送るときに書き直した疑問文', stage: 'onBoard', voteCount: 2 })],
    )
    expect(states.personal_a).toMatchObject({ stage: 'onBoard', voteCount: 2 })
  })

  it('サーバーに出ない投稿（通知に同意していない）は端末の記録だけで「届いている」を出す', () => {
    const states = buildDispatchStates([cq('personal_a')], [sent({ objectID: 'personal_a' })], [])
    expect(states.personal_a).toEqual({
      sentAt: '2026-08-01T00:00:00.000Z',
      voteCount: null,
      stage: 'received',
    })
  })

  it('送っていない泡は状態を持たない', () => {
    const states = buildDispatchStates([cq('personal_a'), cq('personal_b', 'ほかの疑問')], [], [submission()])
    expect(states.personal_b).toBeUndefined()
  })

  it('空白の違いは同じ問いとして突き合わせる', () => {
    const states = buildDispatchStates(
      [cq('personal_a', 'CHDFの 開始タイミングは')],
      [],
      [submission({ question: '  CHDFの  開始タイミングは  ', stage: 'onBoard', voteCount: 2 })],
    )
    expect(states.personal_a.voteCount).toBe(2)
  })
})

describe('dispatchLabel', () => {
  it('答えが出たらそれを最優先で出す', () => {
    expect(dispatchLabel({ sentAt: '', voteCount: 5, stage: 'answered' })).toBe('答えが出ました')
  })

  it('票がついていれば人数を出す', () => {
    expect(dispatchLabel({ sentAt: '', voteCount: 3, stage: 'onBoard' })).toBe('3人が同じことを気にしています')
  })

  it('票が0なら数字を出さない（0人が気になる、を見せない）', () => {
    expect(dispatchLabel({ sentAt: '', voteCount: 0, stage: 'onBoard' })).toBe('作者に届いています')
    expect(dispatchLabel({ sentAt: '', voteCount: null, stage: 'received' })).toBe('作者に届いています')
  })

  it('送った記録が無ければ何も出さない', () => {
    expect(dispatchLabel(undefined)).toBe('')
  })

  it('対応不要は「今回は記事化しません」と理由を出す', () => {
    expect(dispatchLabel({ sentAt: '2026-09-01', voteCount: null, stage: 'closed' }))
      .toBe('今回は記事化しません')
  })
})
