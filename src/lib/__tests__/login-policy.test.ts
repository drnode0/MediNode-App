// REQUIRE_LOGIN フラグ cookie（proxy.ts → クライアント）の読み取りテスト。
import { describe, it, expect } from 'vitest'
import { parseLoginRequired } from '../login-policy'

describe('parseLoginRequired', () => {
  it('mn_require_login=1 で必須と判定する', () => {
    expect(parseLoginRequired('mn_require_login=1')).toBe(true)
    expect(parseLoginRequired('foo=bar; mn_require_login=1; baz=1')).toBe(true)
  })

  it('=0・未設定・空文字は必須なしに倒す（初回アクセスやSWキャッシュ起動の安全側）', () => {
    expect(parseLoginRequired('mn_require_login=0')).toBe(false)
    expect(parseLoginRequired('foo=bar')).toBe(false)
    expect(parseLoginRequired('')).toBe(false)
  })

  it('名前が部分一致する別cookieには反応しない', () => {
    expect(parseLoginRequired('x_mn_require_login=1')).toBe(false)
    expect(parseLoginRequired('mn_require_login_v2=1')).toBe(false)
  })
})
