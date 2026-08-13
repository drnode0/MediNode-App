// サーバー（/api/notion/search）と端末内インデックスが共有するマッチャ。
// ここが両者の「結果が一致する」ことの根拠なので、正規化とAND一致を固定しておく。
import { describe, it, expect } from 'vitest'
import { matchesKeyword, normalizeForSearch, filterIndexed } from '../notion-search-match'

const rec = (title: string, aiSummary = '', aiKeywords = '') => ({ title, aiSummary, aiKeywords })

describe('normalizeForSearch', () => {
  it('小文字化する', () => {
    expect(normalizeForSearch('PCT')).toBe('pct')
  })
  it('全角英数を半角にする', () => {
    expect(normalizeForSearch('ＰＣＴ１２３')).toBe('pct123')
  })
  it('全角スペースを半角にし、前後を落とす', () => {
    expect(normalizeForSearch('　敗血症　ガイドライン　')).toBe('敗血症 ガイドライン')
  })
  it('空・undefined相当でも落ちない', () => {
    expect(normalizeForSearch('')).toBe('')
  })
})

describe('matchesKeyword', () => {
  it('タイトルで一致する', () => {
    expect(matchesKeyword(rec('敗血症の初期治療'), '敗血症')).toBe(true)
  })

  it('要約・キーワードでも一致する（Notionのtitle前方一致では拾えない語）', () => {
    expect(matchesKeyword(rec('無関係なタイトル', '低Na血症の補正速度'), '低na')).toBe(true)
    expect(matchesKeyword(rec('無関係なタイトル', '', 'SBT,抜管'), '抜管')).toBe(true)
  })

  it('スペース区切りは全部含む必要がある（AND一致）', () => {
    expect(matchesKeyword(rec('敗血症の初期治療'), '敗血症 初期')).toBe(true)
    expect(matchesKeyword(rec('敗血症の初期治療'), '敗血症 心不全')).toBe(false)
  })

  it('全角スペース区切りも同じ扱い', () => {
    expect(matchesKeyword(rec('敗血症の初期治療'), '敗血症　初期')).toBe(true)
  })

  it('大文字小文字・全角半角の揺れを吸収する', () => {
    expect(matchesKeyword(rec('PCTの解釈'), 'pct')).toBe(true)
    expect(matchesKeyword(rec('PCTの解釈'), 'ＰＣＴ')).toBe(true)
  })

  it('空キーワードは全件一致（絞り込みなし＝インデックス取得と同じ意味）', () => {
    expect(matchesKeyword(rec('なんでも'), '')).toBe(true)
    expect(matchesKeyword(rec('なんでも'), '   ')).toBe(true)
  })

  it('部分文字列で一致する（形態素解析はしない）', () => {
    expect(matchesKeyword(rec('抗菌薬適正使用'), '菌薬')).toBe(true)
  })

  it('欠けているフィールドがあっても落ちない', () => {
    expect(matchesKeyword({ title: '敗血症' }, '敗血症')).toBe(true)
    expect(matchesKeyword({}, '敗血症')).toBe(false)
  })
})

describe('filterIndexed（端末内インデックスの絞り込み）', () => {
  const many = (owner: string, source: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({ title: `敗血症 ${owner}${source}${i}`, owner, source }))

  it('owner×source ごとに上限を数える（サーバーの件数配分に合わせる）', () => {
    const recs = [
      ...many('personal', 'medical', 80),
      ...many('personal', 'reference', 40),
      ...many('team', 'medical', 80),
    ]
    const out = filterIndexed(recs, '敗血症')
    const count = (o: string, s: string) => out.filter((r) => r.owner === o && r.source === s).length
    expect(count('personal', 'medical')).toBe(50)
    expect(count('personal', 'reference')).toBe(20)
    expect(count('team', 'medical')).toBe(50)
    expect(out).toHaveLength(120)
  })

  it('一致しないものは落とす', () => {
    const recs = [
      { title: '敗血症', owner: 'personal', source: 'medical' },
      { title: '心不全', owner: 'personal', source: 'medical' },
    ]
    expect(filterIndexed(recs, '敗血症').map((r) => r.title)).toEqual(['敗血症'])
  })

  it('元の並び順を保つ（最終更新日時降順のまま）', () => {
    const recs = [
      { title: 'a 敗血症', owner: 'personal', source: 'medical' },
      { title: 'b 敗血症', owner: 'personal', source: 'medical' },
      { title: 'c 敗血症', owner: 'personal', source: 'medical' },
    ]
    expect(filterIndexed(recs, '敗血症').map((r) => r.title[0])).toEqual(['a', 'b', 'c'])
  })

  it('source が未知でも落ちない（既定の上限で扱う）', () => {
    const recs = many('personal', 'unknown', 60)
    expect(filterIndexed(recs, '敗血症')).toHaveLength(50)
  })
})
