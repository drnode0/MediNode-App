import { describe, it, expect } from 'vitest'
import { mergePrefs } from '../push-prefs'
import { DEFAULT_PREFS } from '../push'

describe('mergePrefs', () => {
  it('部分更新は既定にマージされる', () => {
    expect(mergePrefs({ announce: false })).toEqual({ ...DEFAULT_PREFS, announce: false })
  })
  it('不正スロットは既定に矯正', () => {
    expect(mergePrefs({ slot: '03:03' }).slot).toBe(DEFAULT_PREFS.slot)
  })
})
