import { describe, it, expect } from 'vitest'
import { kindOf, secretMatches, corsHeaders } from '../../app/api/garden/_core'

describe('kindOf: 知識レベル準拠のkind判定', () => {
  it('reference sourceは無条件でreference', () => {
    expect(kindOf({ source: 'reference', knowledgeLevel: '💡 ナレッジ' })).toBe('reference')
    expect(kindOf({ source: 'reference' })).toBe('reference')
  })
  it('💡を含む→knowledge・📋を含む→matome・それ以外のmedical→cq', () => {
    expect(kindOf({ source: 'medical', knowledgeLevel: '💡 ナレッジ' })).toBe('knowledge')
    expect(kindOf({ source: 'medical', knowledgeLevel: '📋 まとめ' })).toBe('matome')
    expect(kindOf({ source: 'medical', knowledgeLevel: '❓ CQ' })).toBe('cq')
    expect(kindOf({ source: 'medical', knowledgeLevel: '' })).toBe('cq')
    expect(kindOf({ source: 'medical' })).toBe('cq')
  })
})

describe('secretMatches: timing-safeな秘密比較', () => {
  it('一致でtrue・不一致/欠落/未設定でfalse', () => {
    expect(secretMatches('abc123', 'abc123')).toBe(true)
    expect(secretMatches('abc124', 'abc123')).toBe(false)
    expect(secretMatches(null, 'abc123')).toBe(false)
    expect(secretMatches('abc123', undefined)).toBe(false)
    expect(secretMatches('', '')).toBe(false) // 空文字同士も拒否（env未設定を通さない）
    expect(secretMatches('short', 'longer-secret')).toBe(false)
  })
})

describe('corsHeaders: 庭のallowlist', () => {
  it('許可originはそのまま・非許可は既定originに落とす', () => {
    expect(corsHeaders('https://chi-no-niwa.vercel.app')['Access-Control-Allow-Origin']).toBe('https://chi-no-niwa.vercel.app')
    expect(corsHeaders('http://localhost:5173')['Access-Control-Allow-Origin']).toBe('http://localhost:5173')
    expect(corsHeaders('https://evil.example')['Access-Control-Allow-Origin']).toBe('https://chi-no-niwa.vercel.app')
    expect(corsHeaders(null)['Access-Control-Allow-Origin']).toBe('https://chi-no-niwa.vercel.app')
  })
  it('private cache（token/keyがURLに乗るため共有キャッシュ禁止）', () => {
    expect(corsHeaders(null)['Cache-Control']).toBe('private, max-age=300')
  })
})
