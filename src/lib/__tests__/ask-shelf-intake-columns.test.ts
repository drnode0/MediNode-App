import { describe, it, expect } from 'vitest'
import { readIntakeColumns, buildIntakeShelfProperties, declineMessage, DECLINE_REASONS } from '@/lib/ask-shelf/intake-columns'

const page = (props: Record<string, unknown>) => ({ id: 'x', properties: props } as never)
const rich = (s: string) => ({ rich_text: [{ plain_text: s }] })

describe('readIntakeColumns', () => {
  it('4つの列を読む', () => {
    const r = readIntakeColumns(page({
      段0結果: { select: { name: '該当なし' } },
      段0主張ID: rich('a1,a2'),
      正本主張ID: rich('c9'),
      見送りの理由: { select: { name: '根拠を確認できない' } },
    }))
    expect(r.shelfResult).toBe('該当なし')
    expect(r.shelfClaimIds).toEqual(['a1', 'a2'])
    expect(r.canonicalClaimIds).toEqual(['c9'])
    expect(r.declineReason).toBe('根拠を確認できない')
  })

  it('列がまったく無い受付DBでも落ちない（既存の受付DBを壊さない）', () => {
    const r = readIntakeColumns(page({}))
    expect(r).toEqual({ shelfResult: '', shelfClaimIds: [], canonicalClaimIds: [], declineReason: '' })
  })

  it('知らない理由の文字列は空として扱う（選択肢の改名に引きずられない）', () => {
    expect(readIntakeColumns(page({ 見送りの理由: { select: { name: '謎の理由' } } })).declineReason).toBe('')
  })
})

describe('buildIntakeShelfProperties', () => {
  it('受付DBに無い列は積まない', () => {
    const props = buildIntakeShelfProperties({ 段0結果: { type: 'select' } }, { shelfResult: '該当なし', shelfClaimIds: ['a1'] })
    expect(Object.keys(props)).toEqual(['段0結果'])
  })
  it('型が違う列にも積まない', () => {
    const props = buildIntakeShelfProperties({ 段0主張ID: { type: 'select' } }, { shelfResult: '', shelfClaimIds: ['a1'] })
    expect(props).toEqual({})
  })
})

describe('declineMessage', () => {
  it('5つの理由すべてに文がある', () => {
    for (const r of DECLINE_REASONS) expect(declineMessage(r).length).toBeGreaterThan(0)
  })
  it('理由が無いときは理由なしの文になる', () => {
    expect(declineMessage('')).toBe('今回は記事化しません。')
  })
})
