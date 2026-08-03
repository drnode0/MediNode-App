// かんたん接続の state まわりの純関数。時刻は引数で受けるので Date への依存が無く、
// 期限の境界をそのまま書ける。
import { describe, it, expect } from 'vitest'
import {
  generateState,
  isPendingExpired,
  isClaimExpired,
  maskEmail,
  PENDING_TTL_MS,
  CLAIM_WINDOW_MS,
} from '../oauth-state'

describe('generateState', () => {
  it('48文字の16進文字列（24バイト）を返す', () => {
    const s = generateState()
    expect(s).toMatch(/^[0-9a-f]{48}$/)
  })
  it('呼ぶたびに違う値になる', () => {
    const set = new Set(Array.from({ length: 50 }, () => generateState()))
    expect(set.size).toBe(50)
  })
})

describe('isPendingExpired', () => {
  const base = Date.parse('2026-08-02T00:00:00.000Z')
  it('作成直後は期限内', () => {
    expect(isPendingExpired('2026-08-02T00:00:00.000Z', base)).toBe(false)
  })
  it('TTLちょうどはまだ期限内', () => {
    expect(isPendingExpired('2026-08-02T00:00:00.000Z', base + PENDING_TTL_MS)).toBe(false)
  })
  it('TTLを1ms超えたら期限切れ', () => {
    expect(isPendingExpired('2026-08-02T00:00:00.000Z', base + PENDING_TTL_MS + 1)).toBe(true)
  })
  it('解釈できない日時は期限切れ扱い（安全側）', () => {
    expect(isPendingExpired('not-a-date', base)).toBe(true)
  })
})

describe('isClaimExpired', () => {
  const base = Date.parse('2026-08-02T00:00:00.000Z')
  it('完了直後は引き取り可能', () => {
    expect(isClaimExpired('2026-08-02T00:00:00.000Z', base)).toBe(false)
  })
  it('猶予を超えたら引き取り不可', () => {
    expect(isClaimExpired('2026-08-02T00:00:00.000Z', base + CLAIM_WINDOW_MS + 1)).toBe(true)
  })
  it('completed_at が無ければ引き取り不可（安全側）', () => {
    expect(isClaimExpired(null, base)).toBe(true)
  })
})

describe('maskEmail', () => {
  it('ローカル部の先頭2文字だけ残す', () => {
    expect(maskEmail('tatsuki@example.com')).toBe('ta***@example.com')
  })
  it('ローカル部が2文字以下でも先頭1文字は残す', () => {
    expect(maskEmail('a@example.com')).toBe('a***@example.com')
    expect(maskEmail('ab@example.com')).toBe('ab***@example.com')
  })
  it('メールが無い・形になっていない場合は伏せる', () => {
    expect(maskEmail(null)).toBe('（不明なアカウント）')
    expect(maskEmail('')).toBe('（不明なアカウント）')
    expect(maskEmail('no-at-sign')).toBe('（不明なアカウント）')
  })
})
