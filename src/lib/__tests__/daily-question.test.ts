import { describe, it, expect } from 'vitest'
import {
  isDailyQuestionCandidate,
  pickDailyIndex,
  parseStage,
  jstToday,
} from '../daily-question'

describe('isDailyQuestionCandidate', () => {
  const base = { title: 'ニカルジピンの末梢投与', aiSummary: '末梢からは希釈して投与する。'.repeat(2), knowledgeLevel: '💡 ナレッジ' }

  it('要約ありの💡ナレッジは候補になる', () => {
    expect(isDailyQuestionCandidate(base)).toBe(true)
  })

  it('要約が10文字未満なら除外', () => {
    expect(isDailyQuestionCandidate({ ...base, aiSummary: '短い', summary: '' })).toBe(false)
  })

  it('aiSummaryが無くてもsummaryで判定される', () => {
    expect(isDailyQuestionCandidate({ ...base, aiSummary: '', summary: '希釈して末梢から投与できる。' })).toBe(true)
  })

  it('ナレッジ系でない知識レベルは除外', () => {
    expect(isDailyQuestionCandidate({ ...base, knowledgeLevel: '📋 まとめ' })).toBe(false)
    expect(isDailyQuestionCandidate({ ...base, knowledgeLevel: '' })).toBe(false)
  })

  it('CQ形式のタイトルは除外（タイトル＝問いにならないため）', () => {
    expect(isDailyQuestionCandidate({ ...base, title: '❓ ニカルジピンは末梢からいけるのか' })).toBe(false)
    expect(isDailyQuestionCandidate({ ...base, title: 'CQ：末梢投与の可否' })).toBe(false)
  })
})

describe('pickDailyIndex', () => {
  it('同じ日付・同じプール数なら常に同じ値（決定的）', () => {
    expect(pickDailyIndex('2026-07-21', 13)).toBe(pickDailyIndex('2026-07-21', 13))
  })

  it('範囲内のインデックスを返す', () => {
    for (let size = 1; size <= 20; size++) {
      const idx = pickDailyIndex('2026-07-21', size)
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(size)
    }
  })

  it('プールが空なら-1', () => {
    expect(pickDailyIndex('2026-07-21', 0)).toBe(-1)
  })

  it('日付が変わると選ばれる問題も散らばる（全日同じにはならない）', () => {
    const days = Array.from({ length: 14 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`)
    const picks = new Set(days.map((d) => pickDailyIndex(d, 7)))
    expect(picks.size).toBeGreaterThan(1)
  })
})

describe('parseStage', () => {
  it('on/preview はそのまま、それ以外は off', () => {
    expect(parseStage('on')).toBe('on')
    expect(parseStage('preview')).toBe('preview')
    expect(parseStage('off')).toBe('off')
    expect(parseStage(null)).toBe('off')
    expect(parseStage(undefined)).toBe('off')
    expect(parseStage('全公開')).toBe('off')
  })
})

describe('jstToday', () => {
  it('UTC深夜でも日本時間の日付になる', () => {
    // UTC 2026-07-20 20:00 = JST 2026-07-21 05:00
    expect(jstToday(Date.UTC(2026, 6, 20, 20, 0, 0))).toBe('2026-07-21')
    // UTC 2026-07-21 10:00 = JST 2026-07-21 19:00
    expect(jstToday(Date.UTC(2026, 6, 21, 10, 0, 0))).toBe('2026-07-21')
  })
})
