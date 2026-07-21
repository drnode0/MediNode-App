import { describe, it, expect } from 'vitest'
import {
  usagePct,
  usageSignal,
  pendingSignal,
  failedSignal,
  livenessSignal,
  isUnresolved,
  countUnresolved,
  jstDateKey,
  isJstToday,
  jstStartOfTodayMs,
} from '../admin-daily'

describe('usagePct', () => {
  it('通常の割合を四捨五入で返す', () => {
    expect(usagePct(1234, 10000)).toBe(12)
    expect(usagePct(50, 100)).toBe(50)
  })
  it('上限0以下は0（ゼロ除算回避）', () => {
    expect(usagePct(5, 0)).toBe(0)
    expect(usagePct(5, -10)).toBe(0)
  })
  it('超過は100超をそのまま返す', () => {
    expect(usagePct(120, 100)).toBe(120)
  })
})

describe('usageSignal', () => {
  it('80%未満は正常', () => {
    expect(usageSignal(0)).toBe('ok')
    expect(usageSignal(79)).toBe('ok')
  })
  it('80〜99%は警告', () => {
    expect(usageSignal(80)).toBe('warn')
    expect(usageSignal(99)).toBe('warn')
  })
  it('100%以上は異常', () => {
    expect(usageSignal(100)).toBe('alert')
    expect(usageSignal(150)).toBe('alert')
  })
  it('警告しきい値は変更できる', () => {
    expect(usageSignal(50, 40)).toBe('warn')
  })
})

describe('pendingSignal / failedSignal / livenessSignal', () => {
  it('未対応は0で正常・1件以上で警告', () => {
    expect(pendingSignal(0)).toBe('ok')
    expect(pendingSignal(3)).toBe('warn')
  })
  it('失敗決済は0で正常・1件以上で異常', () => {
    expect(failedSignal(0)).toBe('ok')
    expect(failedSignal(1)).toBe('alert')
  })
  it('生存はupで正常・downで異常', () => {
    expect(livenessSignal(true)).toBe('ok')
    expect(livenessSignal(false)).toBe('alert')
  })
})

describe('isUnresolved', () => {
  it('空・null・undefinedは未対応', () => {
    expect(isUnresolved(null)).toBe(true)
    expect(isUnresolved(undefined)).toBe(true)
    expect(isUnresolved('')).toBe(true)
  })
  it('対応済み・対応不要は処理済み（未対応でない）', () => {
    expect(isUnresolved('対応済み')).toBe(false)
    expect(isUnresolved('対応不要')).toBe(false)
    expect(isUnresolved(' 対応済み ')).toBe(false) // 前後空白を吸収
  })
  it('未知の値は安全側で未対応扱い', () => {
    expect(isUnresolved('保留')).toBe(true)
  })
})

describe('countUnresolved', () => {
  const page = (name: string | null) => ({
    properties: { 対応状態: name === null ? { select: null } : { select: { name } } },
  })
  it('空・未対応だけを数える', () => {
    const results = [page(null), page('対応済み'), page('対応不要'), page('保留'), { properties: {} }]
    // null(1) + 保留(1) + プロパティ欠損(1) = 3
    expect(countUnresolved(results)).toBe(3)
  })
  it('プロパティ名を変更できる', () => {
    const results = [{ properties: { State: { select: { name: '対応済み' } } } }]
    expect(countUnresolved(results, 'State')).toBe(0)
  })
  it('空配列は0', () => {
    expect(countUnresolved([])).toBe(0)
  })
})

describe('jstDateKey', () => {
  it('JSTの日付を返す（UTCと日付が変わる境界）', () => {
    // 2026-07-21 00:30 JST = 2026-07-20 15:30 UTC
    const ms = Date.parse('2026-07-20T15:30:00Z')
    expect(jstDateKey(ms)).toBe('2026-07-21')
  })
})

describe('isJstToday', () => {
  const now = Date.parse('2026-07-21T05:00:00+09:00')
  it('同じJST日はtrue', () => {
    expect(isJstToday('2026-07-21T23:00:00+09:00', now)).toBe(true)
  })
  it('前日はfalse', () => {
    expect(isJstToday('2026-07-20T23:00:00+09:00', now)).toBe(false)
  })
  it('null・不正値はfalse', () => {
    expect(isJstToday(null, now)).toBe(false)
    expect(isJstToday('not-a-date', now)).toBe(false)
  })
})

describe('jstStartOfTodayMs', () => {
  it('JST今日の0時のUNIXミリ秒を返す', () => {
    const now = Date.parse('2026-07-21T05:00:00+09:00')
    expect(jstStartOfTodayMs(now)).toBe(Date.parse('2026-07-21T00:00:00+09:00'))
  })
})
