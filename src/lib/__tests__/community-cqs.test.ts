import { describe, it, expect } from 'vitest'
import {
  toAuthorCqs,
  toReaderCqs,
  mergeCommunityCqs,
  communityVoteLabel,
  COMMUNITY_MAX,
  type CommunityCq,
} from '../community-cqs'

const noVotes = { counts: {}, mine: [] }

describe('toAuthorCqs', () => {
  it('プレミアムindexのヒットを作者のCQにする', () => {
    const [cq] = toAuthorCqs([
      {
        objectID: 'subscription_p1',
        title: '低体温療法の復温速度は何で決まるか',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ])
    expect(cq).toEqual({
      id: 'subscription_p1',
      title: '低体温療法の復温速度は何で決まるか',
      origin: 'author',
      posterLabel: '',
      createdAt: '2026-07-01T00:00:00.000Z',
    })
  })

  it('createdAt が無ければ lastEdited で代用する', () => {
    const [cq] = toAuthorCqs([
      { objectID: 'a', title: 'x', lastEdited: '2026-06-01T00:00:00.000Z' },
    ])
    expect(cq.createdAt).toBe('2026-06-01T00:00:00.000Z')
  })

  it('題やIDが無いヒットは落とす', () => {
    expect(toAuthorCqs([{ objectID: 'a', title: '  ' }, { title: 'x' }])).toEqual([])
  })
})

describe('toReaderCqs', () => {
  it('板の項目を読者投稿のCQにし、名乗りを組み立てる', () => {
    const [cq] = toReaderCqs([
      { id: 'p1', title: '尿道カテーテルはいつ抜くか', posterRole: '看護師', posterName: 'のどか', createdAt: 'x' },
    ])
    expect(cq).toMatchObject({ id: 'p1', origin: 'reader', posterLabel: 'のどかさん（看護師）' })
  })

  it('ペンネームが無ければ匿名さん', () => {
    const [cq] = toReaderCqs([{ id: 'p1', title: 'x', posterRole: '薬剤師' }])
    expect(cq.posterLabel).toBe('匿名さん（薬剤師）')
  })

  it('職種も無ければ名乗りだけ', () => {
    const [cq] = toReaderCqs([{ id: 'p1', title: 'x' }])
    expect(cq.posterLabel).toBe('匿名さん')
  })
})

describe('mergeCommunityCqs', () => {
  const author = (id: string, createdAt = '2026-01-01T00:00:00.000Z'): CommunityCq => ({
    id,
    title: `作者の問い ${id}`,
    origin: 'author',
    posterLabel: '',
    createdAt,
  })
  const reader = (id: string, createdAt = '2026-01-01T00:00:00.000Z'): CommunityCq => ({
    id,
    title: `読者の問い ${id}`,
    origin: 'reader',
    posterLabel: '匿名さん',
    createdAt,
  })

  it('作者と読者を1つの空にまとめる', () => {
    const merged = mergeCommunityCqs([author('a')], [reader('r')], noVotes)
    expect(merged.map((c) => c.id).sort()).toEqual(['a', 'r'])
  })

  it('票の多い順に並べる（出どころは順位に効かせない）', () => {
    const merged = mergeCommunityCqs(
      [author('a')],
      [reader('r')],
      { counts: { a: 5, r: 1 }, mine: [] },
    )
    expect(merged.map((c) => c.id)).toEqual(['a', 'r'])
  })

  it('同票なら新しい順', () => {
    const merged = mergeCommunityCqs(
      [author('old', '2026-01-01T00:00:00.000Z'), author('new', '2026-08-01T00:00:00.000Z')],
      [],
      noVotes,
    )
    expect(merged.map((c) => c.id)).toEqual(['new', 'old'])
  })

  it('自分が入れた票を voted で返す', () => {
    const merged = mergeCommunityCqs([author('a')], [], { counts: { a: 2 }, mine: ['a'] })
    expect(merged[0]).toMatchObject({ voteCount: 2, voted: true })
  })

  it('上限を超えた分は出さない', () => {
    const many = Array.from({ length: COMMUNITY_MAX + 5 }, (_, i) => author(`a${i}`))
    expect(mergeCommunityCqs(many, [], noVotes)).toHaveLength(COMMUNITY_MAX)
  })

  it('同じidが両方に出ても1つにする', () => {
    const merged = mergeCommunityCqs([author('same')], [reader('same')], noVotes)
    expect(merged).toHaveLength(1)
    // 読者投稿を先に採る（名乗りの情報がある方を残す）
    expect(merged[0].origin).toBe('reader')
  })
})

describe('communityVoteLabel', () => {
  const base = { id: 'a', title: 'x', createdAt: '', voted: false }

  it('票がついていれば人数を出す', () => {
    expect(
      communityVoteLabel({ ...base, origin: 'author', posterLabel: '', voteCount: 4 }),
    ).toBe('4人が気にしています')
  })

  it('0票の作者CQは「筆者が気にしている問い」', () => {
    expect(
      communityVoteLabel({ ...base, origin: 'author', posterLabel: '', voteCount: 0 }),
    ).toBe('筆者が気にしている問い')
  })

  it('0票の読者投稿は名乗りを出す', () => {
    expect(
      communityVoteLabel({ ...base, origin: 'reader', posterLabel: '匿名さん（看護師）', voteCount: 0 }),
    ).toBe('匿名さん（看護師）')
  })
})
