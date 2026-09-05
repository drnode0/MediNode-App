import { describe, it, expect } from 'vitest'
import { resolveAnswerTarget, answerLandingUrl } from '@/lib/ask-shelf/landing'
import { APP_URL } from '@/lib/trial-end-content'

const claims = new Map([['c9', { pageId: 'p1', sectionKey: 'sec3' }]])

describe('resolveAnswerTarget', () => {
  it('正本の主張が棚にあれば主張を指す（いちばん具体的）', () => {
    expect(resolveAnswerTarget({ canonicalClaimIds: ['c9'], claimsById: claims }))
      .toEqual({ kind: 'claim', claimId: 'c9', pageId: 'p1', sectionKey: 'sec3' })
  })
  it('主張が棚に無く記事だけ分かるときは記事を指す', () => {
    expect(resolveAnswerTarget({ canonicalClaimIds: ['missing'], claimsById: claims, articlePageId: 'p2' }))
      .toEqual({ kind: 'article', pageId: 'p2' })
  })
  it('何も分からなければ none', () => {
    expect(resolveAnswerTarget({ canonicalClaimIds: [], claimsById: claims })).toEqual({ kind: 'none' })
  })
  it('主張IDが複数あるときは、棚にある最初の1つを指す', () => {
    expect(resolveAnswerTarget({ canonicalClaimIds: ['missing', 'c9'], claimsById: claims }))
      .toEqual({ kind: 'claim', claimId: 'c9', pageId: 'p1', sectionKey: 'sec3' })
  })
})

describe('answerLandingUrl', () => {
  it('見せるものがあるときは着地画面へ', () => {
    expect(answerLandingUrl('i1', { kind: 'claim', claimId: 'c9', pageId: 'p1', sectionKey: 'sec3' }))
      .toBe(`${APP_URL}/cq/answered/i1`)
  })
  it('何も分からないときは従来どおりアプリの入口へ', () => {
    expect(answerLandingUrl('i1', { kind: 'none' })).toBe(APP_URL)
  })
})
