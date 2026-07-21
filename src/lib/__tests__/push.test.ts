import { describe, it, expect } from 'vitest'
import {
  parseStage, parseSlot, jstSlot, isPreviewEmail,
  parsePrefs, kindEnabled, DEFAULT_PREFS, DEFAULT_SLOT,
  pushEnabledFor, currentSlotBucket,
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

describe('pushEnabledFor', () => {
  it('on: 誰でも有効', () => {
    delete process.env.COMP_ADMIN_EMAILS
    delete process.env.PUSH_PREVIEW_EMAILS
    expect(pushEnabledFor('on', 'anyone@ex.com')).toBe(true)
    expect(pushEnabledFor('on', null)).toBe(true)
  })
  it('off: 誰も無効', () => {
    process.env.PUSH_PREVIEW_EMAILS = 'owner@ex.com'
    expect(pushEnabledFor('off', 'owner@ex.com')).toBe(false)
    expect(pushEnabledFor('off', null)).toBe(false)
  })
  it('preview: 許可メールのみ有効', () => {
    process.env.PUSH_PREVIEW_EMAILS = 'owner@ex.com'
    delete process.env.COMP_ADMIN_EMAILS
    expect(pushEnabledFor('preview', 'owner@ex.com')).toBe(true)
    expect(pushEnabledFor('preview', 'other@ex.com')).toBe(false)
    expect(pushEnabledFor('preview', null)).toBe(false)
  })
})

describe('currentSlotBucket', () => {
  it('分を30分バケットへ切り捨てる（JST）', () => {
    // 2026-01-01T22:01:00Z = JST 2026-01-02 07:01
    expect(currentSlotBucket(Date.parse('2026-01-01T22:01:00Z'))).toBe('07:00')
    // JST 07:41
    expect(currentSlotBucket(Date.parse('2026-01-01T22:41:00Z'))).toBe('07:30')
    // JST 12:30 ちょうど
    expect(currentSlotBucket(Date.parse('2026-01-02T03:30:00Z'))).toBe('12:30')
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
