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
  it('x-real-ip を最優先する（プラットフォームが設定する詐称困難な値）', () => {
    const req = new Request('http://x/', {
      headers: { 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '1.2.3.4, 10.0.0.1' },
    })
    expect(clientIp(req)).toBe('203.0.113.9')
  })
  it('x-real-ip が無ければ x-forwarded-for の末尾（信頼できるプロキシ付与側）を返す', () => {
    // 先頭はクライアントが詐称できるため、末尾を採用してレート制限回避を防ぐ。
    const req = new Request('http://x/', { headers: { 'x-forwarded-for': '1.2.3.4, 10.0.0.1' } })
    expect(clientIp(req)).toBe('10.0.0.1')
  })
  it('ヘッダが無ければ unknown', () => {
    expect(clientIp(new Request('http://x/'))).toBe('unknown')
  })
})
