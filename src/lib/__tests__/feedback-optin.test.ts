import { describe, it, expect } from 'vitest'
import { signOptinToken, verifyOptinToken, OPTIN_TOKEN_TTL_MS } from '../feedback-optin'

// 「拡充通知希望」の追いPOSTは、サーバーが直近発行したページIDにしか書けないことを
// HMAC署名で保証する（無状態のまま、他人のページや任意ページの書き換えを防ぐ）。
describe('optinトークン（署名と検証）', () => {
  const secret = 'test-secret'
  const pageId = 'abcd1234-0000-0000-0000-000000000000'

  it('正しい署名は期限内なら通る', () => {
    const ts = 1_000_000
    const sig = signOptinToken(pageId, ts, secret)
    expect(verifyOptinToken({ pageId, ts, sig }, secret, ts + 1000)).toBe(true)
  })

  it('期限（60分）を過ぎたら通らない', () => {
    const ts = 1_000_000
    const sig = signOptinToken(pageId, ts, secret)
    expect(verifyOptinToken({ pageId, ts, sig }, secret, ts + OPTIN_TOKEN_TTL_MS + 1)).toBe(false)
  })

  it('pageIdやtsを差し替えた署名は通らない', () => {
    const ts = 1_000_000
    const sig = signOptinToken(pageId, ts, secret)
    expect(verifyOptinToken({ pageId: 'other-page-id', ts, sig }, secret, ts)).toBe(false)
    expect(verifyOptinToken({ pageId, ts: ts + 1, sig }, secret, ts)).toBe(false)
  })

  it('鍵が違えば通らない', () => {
    const ts = 1_000_000
    const sig = signOptinToken(pageId, ts, secret)
    expect(verifyOptinToken({ pageId, ts, sig }, 'other-secret', ts)).toBe(false)
  })

  it('壊れた入力でも落ちない', () => {
    expect(verifyOptinToken({ pageId: '', ts: NaN, sig: '' }, secret, 0)).toBe(false)
    expect(verifyOptinToken({ pageId, ts: 1, sig: 'zz' }, secret, 1)).toBe(false)
  })

  it('未来すぎるts（時計ずれの範囲を超える）は通らない', () => {
    const ts = 1_000_000
    const sig = signOptinToken(pageId, ts, secret)
    // 発行より2分前の「今」= tsが2分未来 → 拒否（許容ずれは60秒）
    expect(verifyOptinToken({ pageId, ts, sig }, secret, ts - 120_000)).toBe(false)
  })
})
