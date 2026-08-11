import { describe, it, expect } from 'vitest'
import { isValidOccupation } from '../account-profile'

describe('isValidOccupation', () => {
  it('リスト内の職種を受け入れる', () => {
    expect(isValidOccupation('医師')).toBe(true)
    expect(isValidOccupation('看護師')).toBe(true)
    expect(isValidOccupation('その他')).toBe(true)
  })
  it('リスト外・非文字列を弾く', () => {
    expect(isValidOccupation('宇宙飛行士')).toBe(false)
    expect(isValidOccupation('')).toBe(false)
    expect(isValidOccupation(null)).toBe(false)
    expect(isValidOccupation(undefined)).toBe(false)
    expect(isValidOccupation(123)).toBe(false)
    // 旧リストにしか無かった値は無効（CqCapture.loadCqProfile と同じ判断）
    expect(isValidOccupation('学生')).toBe(false)
  })
})
