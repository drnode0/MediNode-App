// かんたん接続の表示判定。端末に同期済みの機能一覧だけを見る（判定の正はサーバー）。
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getSettingsMock } = vi.hoisted(() => ({ getSettingsMock: vi.fn() }))
vi.mock('../settings', () => ({ getSettings: getSettingsMock }))

import { isEasyConnectVisible } from '../easy-connect-flag'

beforeEach(() => { getSettingsMock.mockReset() })

describe('isEasyConnectVisible', () => {
  it('機能一覧に easy_connect があれば true', () => {
    getSettingsMock.mockReturnValue({ earlyAccessFeatures: ['easy_connect'] })
    expect(isEasyConnectVisible()).toBe(true)
  })

  it('機能一覧はあるが easy_connect が無ければ false', () => {
    getSettingsMock.mockReturnValue({ earlyAccessFeatures: ['tower', 'multi_department'] })
    expect(isEasyConnectVisible()).toBe(false)
  })

  it('機能一覧が空配列なら false', () => {
    getSettingsMock.mockReturnValue({ earlyAccessFeatures: [] })
    expect(isEasyConnectVisible()).toBe(false)
  })

  it('機能一覧がまだ同期されていなければ false（レガシーのearlyAccessでは開かない）', () => {
    getSettingsMock.mockReturnValue({ earlyAccess: true })
    expect(isEasyConnectVisible()).toBe(false)
  })

  it('設定が無ければ false', () => {
    getSettingsMock.mockReturnValue(null)
    expect(isEasyConnectVisible()).toBe(false)
  })

  it('getSettings が例外を投げても false', () => {
    getSettingsMock.mockImplementation(() => { throw new Error('boom') })
    expect(isEasyConnectVisible()).toBe(false)
  })
})
