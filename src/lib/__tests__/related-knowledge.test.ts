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
  it('詳細ジャンル一致 > キーワード一致 の順に強く効く', () => {
    const a = cand({ objectID: 'a', detailGenre: '電解質' })
    const b = cand({ objectID: 'b', genre: ['腎臓'], aiKeywords: 'ODS' })
    expect(pickRelated(cur, [b, a]).map((r) => r.objectID)).toEqual(['a', 'b'])
  })

  it('詳細ジャンルはカンマ区切りの複数値を分割して比較する（部分共通で+3）', () => {
    // 実データ例: 「ショック, 敗血症」vs「ショック」— 完全一致でなくても共通値があれば関連
    const shockCur: RelatedSource = { objectID: 'subscription_self', title: '乳酸値', detailGenre: 'ショック, 敗血症' }
    const rose = cand({ objectID: 'rose', detailGenre: 'ショック' })
    expect(pickRelated(shockCur, [rose]).map((r) => r.objectID)).toEqual(['rose'])
  })

  it('「同ジャンルなだけ（+1）」は関連に出さない（足切り2点）', () => {
    // 実障害例: 乳酸値ページに「救急蘇生ジャンルが同じだけ」の抗精神病薬が出た
    const genreOnly = cand({ objectID: 'genre-only', genre: ['救急'] })
    expect(pickRelated(cur, [genreOnly])).toEqual([])
  })

  it('ジャンル共通＋キーワード重複なら合算で足切りを超える', () => {
    const a = cand({ objectID: 'a', genre: ['救急'], aiKeywords: 'ODS, 補正速度' }) // 1+2=3
    const b = cand({ objectID: 'b', genre: ['救急'] }) // 1 → 足切り
    expect(pickRelated(cur, [b, a]).map((r) => r.objectID)).toEqual(['a'])
  })

  it('自分自身・節レコードは除外し、limit件に絞る', () => {
    const self = cand({ objectID: 'subscription_self', detailGenre: '電解質' })
    const section = cand({ objectID: 's', detailGenre: '電解質', recordType: 'section' })
    const ok = cand({ objectID: 'ok', detailGenre: '電解質' })
    expect(pickRelated(cur, [self, section, ok]).map((r) => r.objectID)).toEqual(['ok'])
  })

  it('同点はlastEditedが新しい順', () => {
    const a = cand({ objectID: 'a', detailGenre: '電解質', lastEdited: '2026-01-01' })
    const b = cand({ objectID: 'b', detailGenre: '電解質', lastEdited: '2026-07-01' })
    expect(pickRelated(cur, [a, b]).map((r) => r.objectID)).toEqual(['b', 'a'])
  })
})
