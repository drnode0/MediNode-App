import { describe, it, expect } from 'vitest'
import { parsePending, shouldOfferReturn, RETURN_MIN_AWAY_MS, RETURN_MAX_AGE_MS } from '@/lib/trail/pending'
import { formatTrailDate, shortHost, looksLikeUrl } from '@/lib/trail/format'

describe('parsePending', () => {
  it('形のそろった値だけを通す', () => {
    expect(parsePending({ lookupId: 'L', query: 'q', dest: 'pubmed', at: 1 })).toEqual({ lookupId: 'L', query: 'q', dest: 'pubmed', at: 1 })
    expect(parsePending({ query: 'q', dest: 'pubmed', at: 1 })).toEqual({ lookupId: null, query: 'q', dest: 'pubmed', at: 1 })
    expect(parsePending({ query: 'q', at: 1 })).toBeNull()
    expect(parsePending('x')).toBeNull()
    expect(parsePending(null)).toBeNull()
  })
})

describe('shouldOfferReturn', () => {
  const p = { lookupId: null, query: 'q', dest: 'pubmed', at: 1_000_000 }
  it('すぐ戻った（押し間違い）・長く経った・記録が無いときは出さない', () => {
    expect(shouldOfferReturn(p, p.at + RETURN_MIN_AWAY_MS - 1)).toBe(false)
    expect(shouldOfferReturn(p, p.at + RETURN_MAX_AGE_MS + 1)).toBe(false)
    expect(shouldOfferReturn(null, p.at)).toBe(false)
  })
  it('その間なら出す', () => {
    expect(shouldOfferReturn(p, p.at + 60_000)).toBe(true)
  })
})

describe('formatTrailDate', () => {
  const now = new Date(2026, 9, 13, 21, 0)
  it('今日・昨日・同じ年は月日・前の年は年から', () => {
    expect(formatTrailDate(new Date(2026, 9, 13, 8, 0).toISOString(), now)).toBe('今日')
    expect(formatTrailDate(new Date(2026, 9, 12, 23, 0).toISOString(), now)).toBe('昨日')
    expect(formatTrailDate(new Date(2026, 7, 14, 10, 0).toISOString(), now)).toBe('8月14日')
    expect(formatTrailDate(new Date(2025, 10, 2, 10, 0).toISOString(), now)).toBe('2025年11月2日')
    expect(formatTrailDate('broken', now)).toBe('')
  })
  it('月をまたぐ昨日', () => {
    expect(formatTrailDate(new Date(2026, 8, 30, 12, 0).toISOString(), new Date(2026, 9, 1, 9, 0))).toBe('昨日')
  })
})

describe('shortHost / looksLikeUrl', () => {
  it('ホスト名だけにする', () => {
    expect(shortHost('https://www.pmda.go.jp/PmdaSearch/x')).toBe('pmda.go.jp')
    expect(shortHost('nope')).toBe('')
    expect(shortHost(null)).toBe('')
  })
  it('リンクだけの文字か', () => {
    expect(looksLikeUrl(' https://pubmed.ncbi.nlm.nih.gov/123/ ')).toBe(true)
    expect(looksLikeUrl('見て https://x.com')).toBe(false)
    expect(looksLikeUrl('小児で起きやすい')).toBe(false)
  })
})
