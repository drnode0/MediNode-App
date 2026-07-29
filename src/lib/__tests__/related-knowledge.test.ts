import { describe, it, expect } from 'vitest'
import { pickRelated, type RelatedSource } from '../related-knowledge'

const cur: RelatedSource = {
  objectID: 'subscription_self', title: '低Na血症', genre: ['腎臓', '救急'],
  detailGenre: '電解質', aiKeywords: '低ナトリウム, ODS, 補正速度',
}
const cand = (over: Partial<RelatedSource>): RelatedSource => ({
  objectID: 'subscription_x', title: 'x', ...over,
})

describe('pickRelated', () => {
  it('詳細ジャンル一致 > ジャンル一致 の順に強く効く', () => {
    const a = cand({ objectID: 'a', detailGenre: '電解質' })
    const b = cand({ objectID: 'b', genre: ['腎臓'] })
    expect(pickRelated(cur, [b, a]).map((r) => r.objectID)).toEqual(['a', 'b'])
  })
  it('キーワード重複が加点される', () => {
    const a = cand({ objectID: 'a', genre: ['救急'], aiKeywords: 'ODS, 補正速度' })
    const b = cand({ objectID: 'b', genre: ['救急'] })
    expect(pickRelated(cur, [b, a])[0].objectID).toBe('a')
  })
  it('自分自身・節レコード・スコア0は除外し、limit件に絞る', () => {
    const self = cand({ objectID: 'subscription_self', detailGenre: '電解質' })
    const section = cand({ objectID: 's', detailGenre: '電解質', recordType: 'section' })
    const zero = cand({ objectID: 'z' })
    const ok = cand({ objectID: 'ok', genre: ['腎臓'] })
    const picked = pickRelated(cur, [self, section, zero, ok])
    expect(picked.map((r) => r.objectID)).toEqual(['ok'])
  })
  it('同点はlastEditedが新しい順', () => {
    const a = cand({ objectID: 'a', genre: ['腎臓'], lastEdited: '2026-01-01' })
    const b = cand({ objectID: 'b', genre: ['腎臓'], lastEdited: '2026-07-01' })
    expect(pickRelated(cur, [a, b]).map((r) => r.objectID)).toEqual(['b', 'a'])
  })
})
