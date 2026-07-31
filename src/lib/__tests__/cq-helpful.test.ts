import { describe, it, expect } from 'vitest'
import { helpfulCountLabel, HELPFUL_BADGE_MIN } from '../cq-helpful'

describe('helpfulCountLabel', () => {
  it('下限未満（0〜2）は空文字＝何も描かない（寂しい数字を見せない）', () => {
    expect(helpfulCountLabel(0)).toBe('')
    expect(helpfulCountLabel(1)).toBe('')
    expect(helpfulCountLabel(HELPFUL_BADGE_MIN - 1)).toBe('')
  })

  it('下限以上は「N人が役に立ったと言っています」', () => {
    expect(helpfulCountLabel(3)).toBe('3人が役に立ったと言っています')
    expect(helpfulCountLabel(1234)).toBe('1234人が役に立ったと言っています')
  })
})
