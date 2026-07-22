import { describe, it, expect } from 'vitest'
import { blockConfidence, docConfidenceMarks, isDimmed } from '../reader-confidence'
import type { ReaderBlock } from '../reader-doc'

const li = (text: string): ReaderBlock => ({ kind: 'list_item', ordered: false, inlines: [{ text }] })
const p = (text: string): ReaderBlock => ({ kind: 'paragraph', inlines: [{ text }] })
const h = (text: string): ReaderBlock => ({ kind: 'heading', level: 2, inlines: [{ text }] })

describe('blockConfidence', () => {
  it('行末の確信度マークを検出', () => {
    expect(blockConfidence(li('上限は8〜10。✅ 出典'))).toEqual(['ok'])
    expect(blockConfidence(li('施設差あり。⚠️ 総説'))).toEqual(['caut'])
    expect(blockConfidence(li('議論あり。❓ 検索例'))).toEqual(['unk'])
    expect(blockConfidence(p('→ だからまとめ'))).toEqual([])
  })

  it('VARIATION SELECTOR-16 抜けの裸 ⚠(U+26A0) でも caut を検出（安全要件）', () => {
    // '⚠' のみ（'️' なし）
    expect(blockConfidence(li('施設差あり。⚠ 総説'))).toEqual(['caut'])
  })
})

describe('docConfidenceMarks', () => {
  it('本文に実在するマークのみ（順序固定）', () => {
    expect(docConfidenceMarks([li('a❓'), li('b✅'), h('見出し✅')])).toEqual(['ok', 'unk'])
  })
})

describe('isDimmed', () => {
  const active = (...cs: any[]) => new Set(cs)
  it('active 空なら淡色化しない', () => {
    expect(isDimmed(li('a✅'), active())).toBe(false)
  })
  it('見出し等の構造は常に保護', () => {
    expect(isDimmed(h('1. 見出し'), active('caut'))).toBe(false)
    expect(isDimmed({ kind: 'divider' }, active('caut'))).toBe(false)
    expect(isDimmed({ kind: 'callout', icon: '⚡', color: null, blocks: [] }, active('caut'))).toBe(false)
  })
  it('⚠️・❓ 行は常に保護（安全要件）', () => {
    expect(isDimmed(li('施設差。⚠️ x'), active('ok'))).toBe(false)
    expect(isDimmed(li('議論。❓ x'), active('ok'))).toBe(false)
  })
  it('VARIATION SELECTOR-16 抜けの裸 ⚠ 行も保護され続ける（安全要件）', () => {
    expect(isDimmed(li('施設差。⚠ x'), active('ok'))).toBe(false)
  })
  it('✅ 行は active に ok が無ければ淡色化', () => {
    expect(isDimmed(li('確立。✅ x'), active('caut'))).toBe(true)
    expect(isDimmed(li('確立。✅ x'), active('ok'))).toBe(false)
  })
  it('無マーク/recap 行は active があれば淡色化', () => {
    expect(isDimmed(p('→ まとめ'), active('caut'))).toBe(true)
    expect(isDimmed(p('ただの解説'), active('ok'))).toBe(true)
  })
})
