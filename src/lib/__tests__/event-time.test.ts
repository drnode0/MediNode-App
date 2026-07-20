import { describe, it, expect } from 'vitest'
import { eventStartMs, formatEventStamp } from '../event-time'

describe('eventStartMs', () => {
  it('日付のみは JST 0時として解釈', () => {
    expect(eventStartMs('2026-07-20')).toBe(Date.parse('2026-07-20T00:00:00+09:00'))
  })
  it('時刻つき(ISO)はそのままの絶対時刻', () => {
    expect(eventStartMs('2026-07-20T09:00:00+09:00')).toBe(Date.parse('2026-07-20T09:00:00+09:00'))
  })
})

describe('formatEventStamp', () => {
  it('日付のみは M/D', () => expect(formatEventStamp('2026-07-20')).toBe('7/20'))
  it('時刻つきは M/D H:MM（JST）', () => {
    expect(formatEventStamp('2026-07-20T09:00:00+09:00')).toBe('7/20 9:00')
    expect(formatEventStamp('2026-07-19T23:05:00+09:00')).toBe('7/19 23:05')
  })
  it('UTC表記の時刻も JST に直して表示', () => {
    // 11:00Z = 20:00 JST（ローンチ）
    expect(formatEventStamp('2026-07-18T11:00:00Z')).toBe('7/18 20:00')
  })
})
