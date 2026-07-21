import { describe, it, expect } from 'vitest'
import {
  parseStage, parseSlot, jstSlot, isPreviewEmail,
  parsePrefs, kindEnabled, DEFAULT_PREFS, DEFAULT_SLOT,
} from '../push'

describe('parseStage', () => {
  it('未知値は off に倒す', () => {
    expect(parseStage('on')).toBe('on')
    expect(parseStage('preview')).toBe('preview')
    expect(parseStage('nonsense')).toBe('off')
    expect(parseStage(undefined)).toBe('off')
  })
})

describe('parseSlot', () => {
  it('プリセット外は既定スロットに倒す', () => {
    expect(parseSlot('20:00')).toBe('20:00')
    expect(parseSlot('03:17')).toBe(DEFAULT_SLOT)
    expect(parseSlot(null)).toBe(DEFAULT_SLOT)
  })
})

describe('jstSlot', () => {
  it('UTCを+9してHH:MMを返す', () => {
    // 2026-01-01T22:30:00Z = JST 2026-01-02 07:30
    const ms = Date.parse('2026-01-01T22:30:00Z')
    expect(jstSlot(ms)).toBe('07:30')
  })
})

describe('isPreviewEmail', () => {
  it('env未設定なら誰も許可しない', () => {
    delete process.env.COMP_ADMIN_EMAILS
    delete process.env.PUSH_PREVIEW_EMAILS
    expect(isPreviewEmail('a@b.com')).toBe(false)
  })
  it('許可リストに含まれるメールを大小無視で許可', () => {
    process.env.PUSH_PREVIEW_EMAILS = 'Owner@Ex.com, mon@ex.com'
    expect(isPreviewEmail('owner@ex.com')).toBe(true)
    expect(isPreviewEmail('none@ex.com')).toBe(false)
  })
})

describe('prefs', () => {
  it('壊れた入力は既定に倒す', () => {
    expect(parsePrefs(undefined)).toEqual(DEFAULT_PREFS)
    expect(parsePrefs({ master: 'x' })).toEqual(DEFAULT_PREFS)
  })
  it('種別トグルはマスターOFFで全て無効', () => {
    const p = parsePrefs({ master: false, daily: true, resolvedCq: true, announce: true, slot: '20:00' })
    expect(kindEnabled(p, 'daily')).toBe(false)
    expect(kindEnabled(p, 'resolved_cq')).toBe(false)
  })
  it('マスターONなら種別トグルに従う', () => {
    const p = parsePrefs({ master: true, daily: true, resolvedCq: false, announce: true, slot: '20:00' })
    expect(kindEnabled(p, 'daily')).toBe(true)
    expect(kindEnabled(p, 'resolved_cq')).toBe(false)
    expect(kindEnabled(p, 'announce')).toBe(true)
  })
})
