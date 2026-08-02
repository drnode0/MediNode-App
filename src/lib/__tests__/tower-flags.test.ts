// 知の塔の開放判定のテスト。
// features 配列があればそれだけを見る（tower を含むか）。
// features が届いていない端末では分離前の earlyAccess にフォールバックする。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getSettingsMock } = vi.hoisted(() => ({
  getSettingsMock: vi.fn(),
}))

vi.mock('../settings', () => ({
  getSettings: getSettingsMock,
}))

import { isTowerEnabled } from '../tower-flags'

beforeEach(() => {
  getSettingsMock.mockReset()
})

describe('isTowerEnabled', () => {
  it('features に tower が含まれていれば true', () => {
    getSettingsMock.mockReturnValue({ earlyAccessFeatures: ['tower'] })
    expect(isTowerEnabled()).toBe(true)
  })

  it('features はあるが tower を含まなければ false（earlyAccessがtrueでも見ない）', () => {
    getSettingsMock.mockReturnValue({ earlyAccessFeatures: ['easy_connect'], earlyAccess: true })
    expect(isTowerEnabled()).toBe(false)
  })

  it('features が未設定なら earlyAccess にフォールバックする', () => {
    getSettingsMock.mockReturnValue({ earlyAccess: true })
    expect(isTowerEnabled()).toBe(true)
  })

  it('設定が無ければ false', () => {
    getSettingsMock.mockReturnValue(null)
    expect(isTowerEnabled()).toBe(false)
  })
})
