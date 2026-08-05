// from= はクライアントから来る値なので、そのままイベントに載せない。
// whitelist を通し、外れた値は 'unknown' に潰すことを見る。
import { describe, it, expect } from 'vitest'
import { normalizeEntry } from '../easy-connect-telemetry'

describe('normalizeEntry', () => {
  it('既知の入口はそのまま通す', () => {
    expect(normalizeEntry('setup')).toBe('setup')
    expect(normalizeEntry('settings')).toBe('settings')
    expect(normalizeEntry('settings_repick')).toBe('settings_repick')
    expect(normalizeEntry('reauth')).toBe('reauth')
  })

  it('知らない値・空・欠落はすべて unknown', () => {
    expect(normalizeEntry('../../etc')).toBe('unknown')
    expect(normalizeEntry('')).toBe('unknown')
    expect(normalizeEntry(null)).toBe('unknown')
    expect(normalizeEntry(undefined)).toBe('unknown')
  })
})
