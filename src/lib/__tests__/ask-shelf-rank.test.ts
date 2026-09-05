import { describe, it, expect } from 'vitest'
import { rankAskShelf, SHELF_EMPTY_MESSAGE } from '@/lib/ask-shelf/rank'
import type { ShelfClaim, ShelfSection, ShelfBoardItem } from '@/lib/ask-shelf/rank'

const claim = (over: Partial<ShelfClaim>): ShelfClaim => ({
  claimId: 'c1', pageId: 'p1', pageTitle: '💡 ショックの問い', sectionKey: 'sec1',
  sectionHeading: '1. 低血圧は要件ではない', body: '低血圧はショックの定義の要件ではない',
  source: 'ESICM 2014', confidence: 'ok', keywords: 'ショック, 組織低灌流', ...over,
})
const section = (over: Partial<ShelfSection>): ShelfSection => ({
  objectID: 'subscription_p1#sec1', pageId: 'p1', pageTitle: '💡 ショックの問い',
  sectionHeading: '1. 低血圧は要件ではない', ...over,
})
const board = (over: Partial<ShelfBoardItem>): ShelfBoardItem => ({
  id: 'b1', title: '尿道カテーテルはいつ抜くべき？', voteCount: 0, ...over,
})

const base = {
  claims: [claim({}), claim({ claimId: 'c2', body: '乳酸値は組織低灌流の指標である', sectionKey: 'sec2', sectionHeading: '2. 乳酸値' })],
  sections: [section({})],
  boardItems: [board({})],
  keptClaimIds: new Set<string>(),
  paid: true,
}

describe('rankAskShelf', () => {
  it('覆い率が閾値以上の主張だけを返す', () => {
    const r = rankAskShelf({ ...base, query: '低血圧はショックの定義の要件ではない' })
    expect(r.claims.map((c) => c.claim.claimId)).toContain('c1')
    expect(r.emptyMessage).toBeNull()
  })

  it('棚に無い問いは主張を返さず、決まった1行を返す', () => {
    const r = rankAskShelf({ ...base, query: '白内障手術後の眼圧上昇はいつまで見る？' })
    expect(r.claims).toEqual([])
    expect(r.emptyMessage).toBe('MediNodeにはこの問いの検証済みの主張はまだありません')
    expect(SHELF_EMPTY_MESSAGE).toBe('MediNodeにはこの問いの検証済みの主張はまだありません')
  })

  it('自分が残した主張は覆い率が低くても最上位に出て、印が付く', () => {
    const r = rankAskShelf({ ...base, query: '低血圧はショックの定義の要件ではない', keptClaimIds: new Set(['c2']) })
    expect(r.claims[0].claim.claimId).toBe('c2')
    expect(r.claims[0].kept).toBe(true)
  })

  it('無料の利用者には本文を出さない（題名・節名までにする）', () => {
    const r = rankAskShelf({ ...base, query: '低血圧はショックの定義の要件ではない', paid: false })
    expect(r.claims.length).toBeGreaterThan(0)
    expect(r.claims[0].bodyVisible).toBe(false)
    expect(r.claims[0].claim.body).toBe('')
    expect(r.claims[0].claim.source).toBe('')
    expect(r.claims[0].claim.pageTitle).not.toBe('')
  })

  it('層1で出した節は層2から落とす（同じ場所を二度出さない）', () => {
    const r = rankAskShelf({ ...base, query: '低血圧はショックの定義の要件ではない' })
    expect(r.sections.find((s) => s.pageId === 'p1' && s.sectionHeading === '1. 低血圧は要件ではない')).toBeUndefined()
  })

  it('板の近い疑問は緩い閾値で最大2件', () => {
    const r = rankAskShelf({ ...base, query: '尿道カテーテルはいつ抜くべき？' })
    expect(r.board.map((b) => b.id)).toEqual(['b1'])
  })

  it('問いが空なら何も返さず、1行も出さない', () => {
    const r = rankAskShelf({ ...base, query: '   ' })
    expect(r.claims).toEqual([])
    expect(r.sections).toEqual([])
    expect(r.board).toEqual([])
    expect(r.emptyMessage).toBeNull()
  })
})
