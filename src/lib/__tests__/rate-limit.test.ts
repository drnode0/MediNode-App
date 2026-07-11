// 固定ウィンドウ・レート制限のテスト。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { rateLimit, clientIp } from '../rate-limit'

afterEach(() => {
  vi.useRealTimers()
})

describe('rateLimit', () => {
  it('limit回まで許可し、超過は拒否する', () => {
    const key = `t1-${Math.random()}`
    for (let i = 0; i < 5; i++) expect(rateLimit(key, 5, 60_000)).toBe(true)
    expect(rateLimit(key, 5, 60_000)).toBe(false)
    expect(rateLimit(key, 5, 60_000)).toBe(false)
  })

  it('ウィンドウが切れたらカウントがリセットされる', () => {
    vi.useFakeTimers()
    const key = `t2-${Math.random()}`
    expect(rateLimit(key, 1, 10_000)).toBe(true)
    expect(rateLimit(key, 1, 10_000)).toBe(false)
    vi.advanceTimersByTime(10_001)
    expect(rateLimit(key, 1, 10_000)).toBe(true)
  })

  it('キーが違えば独立にカウントされる', () => {
    const a = `t3a-${Math.random()}`
    const b = `t3b-${Math.random()}`
    expect(rateLimit(a, 1, 60_000)).toBe(true)
    expect(rateLimit(b, 1, 60_000)).toBe(true)
    expect(rateLimit(a, 1, 60_000)).toBe(false)
  })
})

describe('clientIp', () => {
  it('x-forwarded-for の先頭を返す', () => {
    const req = new Request('http://x/', { headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } })
    expect(clientIp(req)).toBe('1.2.3.4')
  })
  it('ヘッダが無ければ unknown', () => {
    expect(clientIp(new Request('http://x/'))).toBe('unknown')
  })
})
